"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickChart,
  ChevronDown,
  LineChart,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ChartPoint } from "@/lib/types";
import type { Timeframe } from "@/lib/candles";
import type { RevenueEvent } from "@/lib/pricing";
import { fmtPct, fmtPrice } from "@/lib/format";
import {
  axisTimeLabel,
  buildCandles,
  DEFAULT_TIMEFRAME,
  labelFor,
  niceTimeStep,
  tzOffsetMs,
  makePriceAt,
  refreshIntervalFor,
  TIMEFRAMES,
  timeframeFor,
  type Candle,
} from "@/lib/candles";
import Tri from "@/components/Tri";

const UP = "#22c55e";
const DOWN = "#f43f5e";
const AMBER = "#fbbf24";
const MUTED = "#8494ab";
const GRID = "#182236";

const MIN_BARS = 12; // zoomed all the way in
// Buckets on screen at full zoom-out. This is no longer the limit on how far
// BACK you can see — zoomAt steps up to a coarser granularity when you hit it,
// so 15m becomes 30m becomes 1h and the reach keeps going. It only decides how
// much detail is drawn before that handover, which keeps the browser from ever
// being handed twenty thousand points. 600 was the old hard ceiling on reach.
const MAX_BARS = 1000;
/** Below this many pixels per bucket a candle is a smear; draw a line instead. */
const CANDLE_MIN_STEP = 3;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (count * step) / span;
  const mult = err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1;
  const s = step * mult;
  const out: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max; v += s) out.push(v);
  return out.slice(0, 6);
}

/** Tick-scale windows need more decimals than dollars-and-cents. */
function makePriceFmt(span: number): (v: number) => string {
  if (span >= 0.05) return fmtPrice;
  const decimals = span >= 0.005 ? 3 : span >= 0.0005 ? 4 : 5;
  return (v: number) => `$${v.toFixed(decimals)}`;
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const mx = (p.x + q.x) / 2;
    d += ` C ${mx.toFixed(2)} ${p.y.toFixed(2)}, ${mx.toFixed(2)} ${q.y.toFixed(2)}, ${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
  }
  return d;
}

/**
 * The trading chart: candles or line, thirteen granularities from 1-second
 * ticks to weekly bars, live-ticking, with a scrubbable crosshair and an
 * OHLC readout. Bars are sampled from the continuous price function, so
 * every timeframe is real and identical for every viewer.
 */
export default function TradingChart({
  symbol,
  mrr,
  sentiment,
  series,
  fairPrice,
  multiple,
  shares,
  events = [],
  drift = 0,
  trades = [],
  earliest,
  heightClass = "h-[300px] sm:h-[380px]",
}: {
  symbol: string;
  mrr: number;
  sentiment: number;
  series: ChartPoint[];
  fairPrice: number;
  multiple: number;
  shares: number;
  /** Real Stripe revenue changes — the steps and spikes on the tape. */
  events?: RevenueEvent[];
  /** The recorded weather at render time — a draw, not a formula, so the
   *  server has to hand it over. */
  drift?: number;
  trades?: { t: number; shares: number }[];
  earliest?: number;
  heightClass?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [tfKey, setTfKey] = useState(DEFAULT_TIMEFRAME);
  const [tfOpen, setTfOpen] = useState(false);
  const [mode, setMode] = useState<"candle" | "line">("candle");
  const [now, setNow] = useState<number | null>(null); // null until mounted
  const [scrub, setScrub] = useState<number | null>(null);
  // the visible window: how many bars (zoom) and how many bars back from the
  // live edge the right side sits (pan). null = this frame's own default.
  const [view, setView] = useState<{ bars: number; offset: number } | null>(
    null
  );

  const tf = timeframeFor(tfKey);

  // how far back this ticker actually goes, in buckets
  const totalBars =
    earliest !== undefined && now !== null
      ? Math.max(MIN_BARS, Math.ceil((now - earliest) / tf.ms) + 1)
      : MAX_BARS;
  // never below the frame's own width: a two-day-old ticker on the 1D frame
  // should draw two bars at their natural size, not two bars stretched over
  // the whole plot.
  const maxBars = Math.max(tf.bars, Math.min(MAX_BARS, totalBars));
  const viewBars = Math.round(
    Math.min(maxBars, Math.max(MIN_BARS, view?.bars ?? tf.bars))
  );
  const offset = Math.max(
    0,
    Math.min(Math.round(view?.offset ?? 0), Math.max(0, totalBars - viewBars))
  );
  const zoomed = viewBars !== tf.bars || offset !== 0;

  const clampView = useCallback(
    (bars: number, off: number) => {
      const b = Math.round(Math.min(maxBars, Math.max(MIN_BARS, bars)));
      const o = Math.max(
        0,
        Math.min(Math.round(off), Math.max(0, totalBars - b))
      );
      return { bars: b, offset: o };
    },
    [maxBars, totalBars]
  );

  /**
   * Zoom by `factor`, keeping whatever sits at `fx` (0 = left, 1 = right).
   *
   * Past the ends of a granularity's useful range it changes granularity
   * rather than stopping: keep scrolling out on 15m and it becomes 1h, then
   * 4h, then 1d, so you can go from one second to the whole history in one
   * gesture. This is what stops the chart hitting a wall — a cap on buckets
   * alone would either stop early or ask the browser to draw twenty thousand
   * of them. The visible SPAN is what carries across the switch, so the
   * picture doesn't jump; only the bucket size changes under it.
   */
  const zoomAt = useCallback(
    (factor: number, fx: number) => {
      const bars = view?.bars ?? tf.bars;
      const off = view?.offset ?? 0;
      const want = bars * factor;
      const fromNow = off + (bars - 1) * (1 - fx);

      const idx = TIMEFRAMES.findIndex((t) => t.key === tf.key);
      const finer = idx > 0 ? TIMEFRAMES[idx - 1] : null;
      // Only step up while the ticker has enough life to fill the bigger
      // buckets. A two-day-old company on a weekly frame is one bucket and an
      // empty axis — the granularity has outrun the history, so stop here.
      const room = (t: Timeframe) =>
        earliest === undefined ||
        now === null ||
        (now - earliest) / t.ms >= MIN_BARS;
      const nextUp =
        idx >= 0 && idx < TIMEFRAMES.length - 1 ? TIMEFRAMES[idx + 1] : null;
      const coarser = nextUp && room(nextUp) ? nextUp : null;
      const step =
        want > maxBars && coarser ? coarser : want < MIN_BARS && finer ? finer : null;

      if (step) {
        // same window of time, bigger or smaller buckets
        const spanMs = want * tf.ms;
        const nowMs = fromNow * tf.ms;
        const b = Math.round(Math.min(MAX_BARS, Math.max(MIN_BARS, spanMs / step.ms)));
        const o = Math.max(0, Math.round(nowMs / step.ms - (b - 1) * (1 - fx)));
        setTfKey(step.key);
        setScrub(null);
        setView({ bars: b, offset: o });
        return;
      }

      const b = Math.round(Math.min(maxBars, Math.max(MIN_BARS, want)));
      const o = Math.max(
        0,
        Math.min(
          Math.round(fromNow - (b - 1) * (1 - fx)),
          Math.max(0, totalBars - b)
        )
      );
      setView({ bars: b, offset: o });
    },
    [tf.key, tf.ms, tf.bars, view, maxBars, totalBars, earliest, now]
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      if (r.width > 0 && r.height > 0) setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Escape closes the timeframe menu. Click-away already worked, but a menu
  // that only closes by mouse strands anyone on a keyboard behind its
  // full-screen backdrop.
  useEffect(() => {
    if (!tfOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTfOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tfOpen]);

  // live tape: re-tick at a cadence matched to the granularity
  useEffect(() => {
    setNow(Date.now());
    const every = refreshIntervalFor(tf);
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, every);
    return () => clearInterval(id);
  }, [tf]);

  const priceAt = useMemo(
    () =>
      makePriceAt(symbol, mrr, sentiment, series, multiple, shares, events, drift),
    [symbol, mrr, sentiment, series, multiple, shares, events, drift]
  );

  const candles = useMemo<Candle[]>(() => {
    if (now === null) return [];
    return buildCandles({
      priceAt,
      tf,
      now,
      earliest,
      trades,
      bars: viewBars,
      offset,
    });
  }, [priceAt, tf, now, earliest, trades, viewBars, offset]);

  const hasVolume = candles.some((c) => c.v > 0);

  const geo = useMemo(() => {
    if (!dims || candles.length < 2) return null;
    const { w, h } = dims;
    const padR = 52; // price axis
    const padT = 10;
    const padB = 20;
    const volH = hasVolume ? Math.min(46, h * 0.16) : 0;
    const plotH = h - padT - padB - volH;

    let vMin = Infinity;
    let vMax = -Infinity;
    for (const c of candles) {
      if (c.l < vMin) vMin = c.l;
      if (c.h > vMax) vMax = c.h;
    }
    // the anchor never stretches the scale — an indicator far outside the
    // window would squash the candles into a stripe. It draws only if it
    // already falls inside the price range (standard indicator behavior).
    const span = vMax - vMin || vMax || 1;
    if (fairPrice > vMin - span * 0.15 && fairPrice < vMax + span * 0.15) {
      vMin = Math.min(vMin, fairPrice);
      vMax = Math.max(vMax, fairPrice);
    }
    const pad = (vMax - vMin || vMax || 1) * 0.08;
    vMin = Math.max(0, vMin - pad);
    vMax += pad;

    const plotW = w - padR;
    // slots, not candles: when history is shorter than the window the bars
    // keep their width and sit at the live edge, with empty space behind.
    const slots = Math.max(candles.length, viewBars);
    const step = plotW / slots;
    const shift = plotW - step * candles.length;
    const x = (i: number) => shift + step * (i + 0.5);
    const y = (v: number) =>
      padT + (1 - (v - vMin) / (vMax - vMin || 1)) * plotH;

    const maxVol = Math.max(1, ...candles.map((c) => c.v));
    const vy = (v: number) => (v / maxVol) * (volH - 6);

    return {
      w, h, padR, padT, padB, plotW, plotH, volH, step, shift, x, y, vy, vMin, vMax,
    };
  }, [dims, candles, fairPrice, hasVolume, viewBars]);

  const pf = useMemo(
    () => makePriceFmt(geo ? geo.vMax - geo.vMin : 1),
    [geo]
  );

  // The toggle is a preference, not an instruction to draw something illegible:
  // zoomed far out we draw the line and put the mode back when you zoom in.
  const tooDenseForCandles = geo !== null && geo.step < CANDLE_MIN_STEP;
  const drawLine = mode === "line" || tooDenseForCandles;

  const active =
    scrub !== null && scrub >= 0 && scrub < candles.length
      ? candles[scrub]
      : candles[candles.length - 1];
  const first = candles[0];
  const change =
    first && active && first.o > 0 ? (active.c - first.o) / first.o : 0;
  const up = change >= 0;
  const color = up ? UP : DOWN;

  function scrubAt(e: React.PointerEvent) {
    if (!geo) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor((e.clientX - rect.left - geo.shift) / geo.step);
    setScrub(Math.max(0, Math.min(candles.length - 1, i)));
  }

  // wheel = zoom (shift or a horizontal wheel = pan). Non-passive, because the
  // page must not scroll out from under the chart while you are zooming it.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - 52);
      const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / plotW));
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      e.preventDefault();
      if (sideways || e.shiftKey) {
        const d = sideways ? e.deltaX : e.deltaY;
        setView((cur) => {
          const bars = cur?.bars ?? tf.bars;
          const off = cur?.offset ?? 0;
          return clampView(bars, off - d / Math.max(2, plotW / bars));
        });
      } else {
        zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, fx);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [tf.bars, clampView, zoomAt]);

  // drag to pan, two fingers to pinch — the same gestures a trading app has
  const drag = useRef<{ x: number; offset: number; moved: boolean } | null>(
    null
  );
  const touches = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; bars: number } | null>(null);

  function onDown(e: React.PointerEvent) {
    touches.current.set(e.pointerId, e.clientX);
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { dist: Math.abs(a - b) || 1, bars: viewBars };
      drag.current = null;
      setScrub(null);
      return;
    }
    drag.current = { x: e.clientX, offset, moved: false };
    scrubAt(e);
  }

  function onMove(e: React.PointerEvent) {
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, e.clientX);
    }
    if (touches.current.size === 2 && pinch.current) {
      const [a, b] = [...touches.current.values()];
      const dist = Math.abs(a - b) || 1;
      setView(clampView((pinch.current.bars * pinch.current.dist) / dist, offset));
      return;
    }
    const d = drag.current;
    if (d && e.buttons === 1 && geo) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 2) d.moved = true;
      if (d.moved) {
        setScrub(null);
        setView(clampView(viewBars, d.offset + dx / geo.step));
        return;
      }
    }
    scrubAt(e);
  }

  function onUp(e: React.PointerEvent) {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    drag.current = null;
  }

  /** Evenly spaced, round-numbered time ticks — the x axis. */
  const ticks = useMemo(() => {
    if (!geo || candles.length < 2) return [];
    const span = candles[candles.length - 1].t - candles[0].t + tf.ms;
    const step = niceTimeStep(span, Math.max(2, Math.floor(geo.plotW / 92)), tf.ms);
    const tzo = tzOffsetMs(candles[candles.length - 1].t);
    const slot = (t: number) => Math.floor((t - tzo) / step);
    const day = (t: number) => Math.floor((t - tzo) / 86_400_000);
    const out: { x: number; label: string; major: boolean }[] = [];
    let lastSlot: number | null = null;
    let lastDay: number | null = null;
    const rightEdge = geo.plotW - (offset === 0 ? 40 : 18);
    candles.forEach((c, i) => {
      const sl = slot(c.t);
      if (sl === lastSlot) return;
      lastSlot = sl;
      const x = geo.x(i);
      if (x < 26 || x > rightEdge) return;
      const newDay = lastDay !== null && day(c.t) !== lastDay;
      lastDay = day(c.t);
      out.push({ x, label: axisTimeLabel(c.t, step, newDay), major: newDay });
    });
    return out;
  }, [geo, candles, tf.ms, offset]);

  return (
    <div className="panel flex flex-col">
      {/* header: price readout + mode toggle */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-terminal-line px-3 py-2">
        <span className="font-mono text-sm font-bold">${symbol}</span>
        <span className="num font-mono text-xl font-bold">
          {active ? pf(active.c) : "—"}
        </span>
        <span
          className="num flex items-center gap-1 font-mono text-xs font-semibold"
          style={{ color }}
        >
          <Tri dir={up ? "up" : "down"} size={7} />
          {fmtPct(change)}
        </span>
        {active && (
          <span className="hidden gap-2.5 font-mono text-[10px] text-terminal-muted sm:flex">
            <span>
              O <span className="num text-terminal-text">{pf(active.o)}</span>
            </span>
            <span>
              H <span className="num text-terminal-up">{pf(active.h)}</span>
            </span>
            <span>
              L <span className="num text-terminal-down">{pf(active.l)}</span>
            </span>
            <span>
              C <span className="num text-terminal-text">{pf(active.c)}</span>
            </span>
            {active.v > 0 && (
              <span>
                V{" "}
                <span className="num text-terminal-text">
                  {active.v.toLocaleString("en-US")}
                </span>
              </span>
            )}
          </span>
        )}
        <div className="relative ml-auto flex items-center gap-1">
          {/* zoom: the wheel and pinch do this too, these are the visible way */}
          <button
            type="button"
            onClick={() => zoomAt(1.35, 1)}
            title="Zoom out (scroll down on the chart)"
            aria-label="Zoom out"
            disabled={viewBars >= maxBars}
            className="rounded p-1 text-terminal-muted transition-colors hover:text-terminal-text disabled:opacity-30"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={() => zoomAt(1 / 1.35, 1)}
            title="Zoom in (scroll up on the chart)"
            aria-label="Zoom in"
            disabled={viewBars <= MIN_BARS}
            className="rounded p-1 text-terminal-muted transition-colors hover:text-terminal-text disabled:opacity-30"
          >
            <ZoomIn size={13} />
          </button>
          {zoomed && (
            <button
              type="button"
              onClick={() => setView(null)}
              title="Reset the view"
              aria-label="Reset zoom"
              className="rounded p-1 text-terminal-accent transition-colors hover:bg-terminal-raise"
            >
              <RotateCcw size={12} />
            </button>
          )}
          {/* the granularity ladder, tucked behind one button */}
          <button
            type="button"
            onClick={() => setTfOpen((v) => !v)}
            aria-expanded={tfOpen}
            title="Timeframe"
            className={`flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${
              tfOpen
                ? "bg-terminal-raise text-terminal-text"
                : "text-terminal-accent hover:bg-terminal-raise"
            }`}
          >
            {tf.label}
            <ChevronDown
              size={11}
              className={`transition-transform ${tfOpen ? "rotate-180" : ""}`}
            />
          </button>
          {tfOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setTfOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 top-full z-20 mt-1.5 grid w-[184px] grid-cols-4 gap-0.5 rounded-md border border-terminal-line bg-terminal-panel p-1.5 shadow-xl">
                {TIMEFRAMES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setTfKey(t.key);
                      setScrub(null);
                      setView(null);
                      setTfOpen(false);
                    }}
                    className={`rounded px-1 py-1 font-mono text-[11px] font-semibold transition-colors ${
                      t.key === tfKey
                        ? "bg-terminal-accent/15 text-terminal-accent"
                        : "text-terminal-muted hover:bg-terminal-raise hover:text-terminal-text"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setMode("candle")}
            title="Candles"
            className={`rounded p-1 transition-colors ${
              mode === "candle"
                ? "bg-terminal-raise text-terminal-text"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
          >
            <CandlestickChart size={14} />
          </button>
          <button
            type="button"
            onClick={() => setMode("line")}
            title="Line"
            className={`rounded p-1 transition-colors ${
              mode === "line"
                ? "bg-terminal-raise text-terminal-text"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
          >
            <LineChart size={14} />
          </button>
        </div>
      </div>

      {/* the plot */}
      <div
        ref={wrapRef}
        className={`relative w-full ${heightClass} ${
          zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
        }`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setView(null)}
        onPointerLeave={(e) => {
          onUp(e);
          setScrub(null);
        }}
      >
        {geo && candles.length > 1 ? (
          <svg
            width={geo.w}
            height={geo.h}
            className="block touch-pan-y select-none"
            role="img"
            aria-label={`${symbol} ${tf.label} chart`}
          >
            <defs>
              <linearGradient id={`fill-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* price grid + right-hand axis */}
            {niceTicks(geo.vMin, geo.vMax).map((v) => (
              <g key={v}>
                <line
                  x1={0}
                  x2={geo.plotW}
                  y1={geo.y(v)}
                  y2={geo.y(v)}
                  stroke={GRID}
                  strokeDasharray="3 5"
                />
                <text
                  x={geo.w - 6}
                  y={geo.y(v) + 3}
                  textAnchor="end"
                  fill={MUTED}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                >
                  {pf(v)}
                </text>
              </g>
            ))}

            {/* fair-value anchor */}
            {fairPrice > geo.vMin && fairPrice < geo.vMax && (
              <line
                x1={0}
                x2={geo.plotW}
                y1={geo.y(fairPrice)}
                y2={geo.y(fairPrice)}
                stroke={AMBER}
                strokeWidth="1.5"
                strokeDasharray="5 4"
                opacity="0.7"
              />
            )}

            {drawLine ? (
              <>
                <path
                  d={`${smoothPath(
                    candles.map((c, i) => ({ x: geo.x(i), y: geo.y(c.c) }))
                  )} L ${geo.x(candles.length - 1)} ${geo.padT + geo.plotH} L ${geo.x(0)} ${geo.padT + geo.plotH} Z`}
                  fill={`url(#fill-${symbol})`}
                />
                <path
                  d={smoothPath(
                    candles.map((c, i) => ({ x: geo.x(i), y: geo.y(c.c) }))
                  )}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : (
              candles.map((c, i) => {
                const bull = c.c >= c.o;
                const col = bull ? UP : DOWN;
                const bw = Math.max(1.5, Math.min(14, geo.step * 0.66));
                const yO = geo.y(c.o);
                const yC = geo.y(c.c);
                const top = Math.min(yO, yC);
                const bodyH = Math.max(1, Math.abs(yC - yO));
                return (
                  <g key={c.t}>
                    <line
                      x1={geo.x(i)}
                      x2={geo.x(i)}
                      y1={geo.y(c.h)}
                      y2={geo.y(c.l)}
                      stroke={col}
                      strokeWidth="1"
                    />
                    <rect
                      x={geo.x(i) - bw / 2}
                      y={top}
                      width={bw}
                      height={bodyH}
                      fill={bull ? "none" : col}
                      stroke={col}
                      strokeWidth="1.2"
                    />
                  </g>
                );
              })
            )}

            {/* volume */}
            {hasVolume &&
              candles.map((c, i) => {
                if (c.v <= 0) return null;
                const bw = Math.max(1.5, Math.min(14, geo.step * 0.66));
                const hgt = geo.vy(c.v);
                return (
                  <rect
                    key={`v${c.t}`}
                    x={geo.x(i) - bw / 2}
                    y={geo.h - geo.padB - hgt}
                    width={bw}
                    height={hgt}
                    fill={c.c >= c.o ? UP : DOWN}
                    opacity="0.35"
                  />
                );
              })}

            {/* last price marker */}
            {active && (
              <line
                x1={0}
                x2={geo.plotW}
                y1={geo.y(candles[candles.length - 1].c)}
                y2={geo.y(candles[candles.length - 1].c)}
                stroke={color}
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.65"
              />
            )}

            {/* real revenue changes — the only marks on this chart that are
                news rather than price */}
            {events.map((e) => {
              if (candles.length < 2) return null;
              const first = candles[0].t;
              const last = candles[candles.length - 1].t + tf.ms;
              if (e.at < first || e.at > last) return null;
              const i = Math.min(
                candles.length - 1,
                Math.max(0, Math.floor((e.at - first) / tf.ms))
              );
              const up = e.mrr >= e.prevMrr;
              const x = geo.x(i);
              const y = geo.h - geo.padB - 4;
              return (
                <g key={`re${e.at}`} opacity="0.9">
                  <line
                    x1={x}
                    x2={x}
                    y1={geo.padT}
                    y2={geo.h - geo.padB}
                    stroke={up ? UP : DOWN}
                    strokeWidth="1"
                    strokeDasharray="1 4"
                    opacity="0.45"
                  />
                  <path
                    d={
                      up
                        ? `M ${x} ${y - 7} L ${x + 4} ${y} L ${x - 4} ${y} Z`
                        : `M ${x} ${y} L ${x + 4} ${y - 7} L ${x - 4} ${y - 7} Z`
                    }
                    fill={up ? UP : DOWN}
                  >
                    <title>
                      {`${up ? "Revenue up" : "Revenue down"}: ${e.prevMrr} → ${e.mrr} MRR`}
                    </title>
                  </path>
                </g>
              );
            })}

            {/* crosshair */}
            {scrub !== null && candles[scrub] && (
              <g>
                <line
                  x1={geo.x(scrub)}
                  x2={geo.x(scrub)}
                  y1={geo.padT}
                  y2={geo.h - geo.padB}
                  stroke={MUTED}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <text
                  x={Math.min(Math.max(geo.x(scrub), 34), geo.plotW - 34)}
                  y={geo.h - 6}
                  textAnchor="middle"
                  fill={MUTED}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                >
                  {labelFor(candles[scrub].t, tf)}
                </text>
              </g>
            )}

            {/* time axis: round-numbered ticks across the whole window */}
            {ticks.map((t) => (
              <g key={`x${t.x}`}>
                <line
                  x1={t.x}
                  x2={t.x}
                  y1={geo.padT}
                  y2={geo.h - geo.padB}
                  stroke={GRID}
                  strokeDasharray="2 6"
                  opacity={t.major ? 1 : 0.6}
                />
                <text
                  x={t.x}
                  y={geo.h - 6}
                  textAnchor="middle"
                  fill={MUTED}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  opacity={t.major ? 1 : 0.85}
                >
                  {t.label}
                </text>
              </g>
            ))}
            <text
              x={geo.plotW - 2}
              y={geo.h - 6}
              textAnchor="end"
              fill={MUTED}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              {offset === 0
                ? "now"
                : labelFor(candles[candles.length - 1].t, tf)}
            </text>
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            loading the tape…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-terminal-line px-3 py-1.5 text-[10px] text-terminal-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: color }}
          />
          {tf.label} {drawLine ? "line" : "candles"}
          {tooDenseForCandles && mode === "candle" ? " (zoomed out)" : ""} · play
          money
        </span>
        <span className="flex items-center gap-1.5 text-terminal-amber">
          <span className="inline-block h-0 w-4 border-t border-dashed border-terminal-amber" />
          {/* the float is per-ticker since 0004 — a hardcoded 10k here was
              printing the wrong formula on every company that isn't 10,000 */}
          fair value · {multiple.toFixed(1)}× ARR ÷{" "}
          {shares >= 1000
            ? `${(shares / 1000).toFixed(shares % 1000 === 0 ? 0 : 1)}k`
            : shares}
        </span>
        <span className="ml-auto hidden text-terminal-muted/70 md:block">
          scroll to zoom · drag to pan
          {zoomed ? " · double-click to reset" : ""}
        </span>
      </div>
    </div>
  );
}

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
import { fmtBarPct, fmtPct, fmtPrice } from "@/lib/format";
import { useLiveSentiment } from "@/lib/live";
import {
  axisTimeLabel,
  buildCandles,
  DEFAULT_TIMEFRAME,
  MAX_BARS,
  MIN_BARS,
  planZoom,
  labelFor,
  niceTimeStep,
  tzOffsetMs,
  makePriceAt,
  refreshIntervalFor,
  TIMEFRAMES,
  timeframeFor,
  type Candle,
} from "@/lib/candles";
import { fmtMarketDate } from "@/lib/market-time";
import { useClockPref } from "@/lib/clock-pref";
import Tri from "@/components/Tri";

const UP = "#22c55e";
const DOWN = "#f43f5e";
const MUTED = "#8494ab";
const GRID = "#182236";

// MIN_BARS / MAX_BARS live in lib/candles beside planZoom, which is the code
// that actually reasons about them.
/**
 * Below this many pixels per bucket there is no room for a BODY — so the bar
 * is drawn as its high–low wick alone, coloured by direction. That is what a
 * dense chart is supposed to look like: a forest of thin red and green bars,
 * not a smooth line. Falling back to a line here was a cop-out, and it made
 * the chart look nothing like a real one.
 */
const CANDLE_BODY_MIN_STEP = 3;
/**
 * Empty slots between the newest candle and the price axis. Every terminal
 * leaves this margin: the last bar is the one you are watching, and a bar
 * glued to the axis with its price tag over it reads as cut off.
 */
const FUTURE_SLOTS = 5;
/** Width of the price axis gutter — subtracted from the wrapper to get plot width. */
const PAD_R = 52;

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

/**
 * Market cap on the same axis: $1.234M rather than $12.34. The decimals
 * come from the visible span so neighbouring grid lines never print the
 * same label.
 */
function makeMcFmt(spanMc: number): (v: number) => string {
  const step = Math.max(spanMc / 4, 1e-9);
  return (v: number) => {
    const abs = Math.abs(v);
    const unit = abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e3 ? 1e3 : 1;
    const suffix = unit === 1e9 ? "B" : unit === 1e6 ? "M" : unit === 1e3 ? "k" : "";
    const decimals = Math.min(3, Math.max(0, Math.ceil(Math.log10(unit / step))));
    return `$${(v / unit).toFixed(decimals)}${suffix}`;
  };
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
  sentiment: sentimentProp,
  series,
  multiple,
  shares,
  events = [],
  drift = 0,
  trades = [],
  calls = [],
  earliest,
  initialTimeframe,
  heightClass = "h-[300px] sm:h-[380px]",
}: {
  symbol: string;
  mrr: number;
  sentiment: number;
  series: ChartPoint[];
  /** For the price function only — the chart never shows it. */
  multiple: number;
  shares: number;
  /** Real Stripe revenue changes — the steps and spikes on the tape. */
  events?: RevenueEvent[];
  /** The recorded weather at render time — a draw, not a formula, so the
   *  server has to hand it over. */
  drift?: number;
  trades?: { t: number; shares: number }[];
  /** The founder's earnings calls — marked on the tape where they were made. */
  calls?: { at: number; guidance: number }[];
  earliest?: number;
  /** Frame to open on — the server knows how old the ticker is. */
  initialTimeframe?: string;
  heightClass?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [tfKey, setTfKey] = useState(initialTimeframe ?? DEFAULT_TIMEFRAME);
  const [clock, setClock] = useClockPref();
  const hour12 = clock === "12h";
  const [tfOpen, setTfOpen] = useState(false);
  const [mode, setMode] = useState<"candle" | "line">("candle");
  // your own fill moves the curve here the moment it comes back
  const sentiment = useLiveSentiment(symbol, sentimentProp);
  // the y-axis reads in price or in market cap — same bars, one multiply
  const [scale, setScale] = useState<"price" | "mc">("price");
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
  //
  // Zoom does NOT change the granularity. Picking 1s means 1s: scrolling out
  // shows more one-second buckets until it runs out of room, and then it
  // stops. (It used to climb the ladder — 1s became 15s became 30s — which
  // reaches the whole history in one gesture and is completely useless when
  // what you wanted was to look at seconds. The frame is the selector's job.)
  //
  // The limit is MAX_BARS, or the ticker's whole life on this frame if that
  // comes first. Every bar is drawn as a candle at every zoom level — thin
  // ones lose their body and become a coloured high–low stroke — so running
  // out of body room is not a reason to stop zooming, and never a reason to
  // change the frame.
  const maxBars = Math.max(tf.bars, Math.min(MAX_BARS, totalBars));
  const viewBars = Math.round(
    Math.min(maxBars, Math.max(MIN_BARS, view?.bars ?? tf.bars))
  );
  const offset = Math.max(
    0,
    Math.min(Math.round(view?.offset ?? 0), Math.max(0, totalBars - viewBars))
  );
  const zoomed = viewBars !== tf.bars || offset !== 0;
  /** Is there anything off the left edge to drag into view? */
  const canPan = totalBars > viewBars;

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
   * Only ever changes how many buckets of the CURRENT frame are on screen —
   * never the frame itself. To see further back, pick a coarser one.
   */
  const zoomAt = useCallback(
    (factor: number, fx: number) => {
      const plan = planZoom({
        bars: view?.bars ?? tf.bars,
        offset: view?.offset ?? 0,
        factor,
        fx,
        maxBars,
        totalBars,
      });
      setView(plan);
    },
    [tf.bars, view, maxBars, totalBars]
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
    const padR = PAD_R; // price axis
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
    const pad = (vMax - vMin || vMax || 1) * 0.08;
    vMin = Math.max(0, vMin - pad);
    vMax += pad;

    const plotW = w - padR;
    // slots, not candles: when history is shorter than the window the bars
    // keep their width and sit at the live edge, with empty space behind.
    const slots = Math.max(candles.length, viewBars) + FUTURE_SLOTS;
    const step = plotW / slots;
    // `shift` is the x of slot zero: the newest candle sits FUTURE_SLOTS in
    // from the axis, so the scrub map (x → index) stays a single division
    const shift = plotW - step * (candles.length + FUTURE_SLOTS);
    const x = (i: number) => shift + step * (i + 0.5);
    const y = (v: number) =>
      padT + (1 - (v - vMin) / (vMax - vMin || 1)) * plotH;

    const maxVol = Math.max(1, ...candles.map((c) => c.v));
    const vy = (v: number) => (v / maxVol) * (volH - 6);

    return {
      w, h, padR, padT, padB, plotW, plotH, volH, step, shift, x, y, vy, vMin, vMax,
    };
  }, [dims, candles, hasVolume, viewBars]);

  // two formatters: `pf` labels the axis at grid-line precision, `pfx` is
  // the readout (header, OHLC, tooltip) and carries two more digits so a
  // bar's open and close don't round to the same market cap
  const [pf, pfx] = useMemo(() => {
    const span = geo ? geo.vMax - geo.vMin : 1;
    if (scale === "mc") {
      const axis = makeMcFmt(span * shares);
      const detail = makeMcFmt((span * shares) / 100);
      return [(v: number) => axis(v * shares), (v: number) => detail(v * shares)];
    }
    const price = makePriceFmt(span);
    return [price, price];
  }, [geo, scale, shares]);

  // The toggle is a preference, not an instruction to draw something illegible:
  // zoomed far out we draw the line and put the mode back when you zoom in.
  // Candles are drawn at every zoom level now. The only line is the one you
  // asked for with the toggle.
  const wickOnly = geo !== null && geo.step < CANDLE_BODY_MIN_STEP;
  const drawLine = mode === "line";

  /**
   * The scrub readout and the right-edge label share the axis strip with the
   * time ticks, and all three sit on the same baseline — so a tick underneath
   * either printed straight through it ("00:5◆1:00"). Those two own their
   * patch; a tick that would collide drops its label and keeps its gridline.
   */
  const AXIS_CHAR_PX = 6; // 10px ui-monospace
  const scrubLabel =
    scrub !== null && candles[scrub]
      ? labelFor(candles[scrub].t, tf, hour12)
      : null;
  const edgeLabel = candles.length
    ? offset === 0
      ? "now"
      : labelFor(candles[candles.length - 1].t, tf, hour12)
    : "";
  const axisLabelClear = (x: number, label: string): boolean => {
    if (!geo) return true;
    const half = (label.length * AXIS_CHAR_PX) / 2;
    const hits = (cx: number, other: string) =>
      Math.abs(x - cx) < half + (other.length * AXIS_CHAR_PX) / 2 + 6;
    if (
      scrubLabel !== null &&
      scrub !== null &&
      hits(Math.min(Math.max(geo.x(scrub), 34), geo.plotW - 34), scrubLabel)
    ) {
      return false;
    }
    return !hits(geo.plotW - 2 - (edgeLabel.length * AXIS_CHAR_PX) / 2, edgeLabel);
  };
  // ...and when the scrub readout reaches the right edge it collides with the
  // edge label itself. The readout wins: it is the thing being pointed at.
  const showEdgeLabel =
    !geo ||
    scrubLabel === null ||
    scrub === null ||
    Math.abs(
      Math.min(Math.max(geo.x(scrub), 34), geo.plotW - 34) -
        (geo.plotW - 2 - (edgeLabel.length * AXIS_CHAR_PX) / 2)
    ) >=
      ((scrubLabel.length + edgeLabel.length) * AXIS_CHAR_PX) / 2 + 6;

  const active =
    scrub !== null && scrub >= 0 && scrub < candles.length
      ? candles[scrub]
      : candles[candles.length - 1];
  const first = candles[0];
  const change =
    first && active && first.o > 0 ? (active.c - first.o) / first.o : 0;
  const up = change >= 0;
  const color = up ? UP : DOWN;

  // The bar you are pointing at, on its own terms. The big number beside it is
  // the change across the whole window, which is a different question and a
  // different sign as often as not — a green day inside a red month.
  const barChange =
    active && active.o > 0 ? (active.c - active.o) / active.o : 0;
  // same test the candle body uses, so the chip can never disagree with the
  // colour of the thing under the cursor
  const barUp = active ? active.c >= active.o : true;

  /**
   * One render per frame, however fast input arrives. Modern Chromium already
   * coalesces pointermove to the frame rate — measured: a 400-event burst
   * renders identically with and without this — but that courtesy is the
   * browser's, not the spec's: pen input and older WebKits deliver per event,
   * and at maximum zoom-out each render is 2,500 SVG nodes. Everything a move
   * wants to change is parked in a ref and flushed once per animation frame,
   * so the worst any input source can do is one render per frame.
   */
  const frame = useRef<number | null>(null);
  const pending = useRef<{ offset?: number; scrub?: number | null }>({});
  const flushOnFrame = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const p = pending.current;
      pending.current = {};
      if (p.offset !== undefined) setView(clampView(viewBars, p.offset));
      if (p.scrub !== undefined) setScrub(p.scrub);
    });
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  function scrubAt(e: React.PointerEvent) {
    if (!geo) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor((e.clientX - rect.left - geo.shift) / geo.step);
    pending.current.scrub = Math.max(0, Math.min(candles.length - 1, i));
    flushOnFrame();
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
  const pinch = useRef<{ dist: number; span: number } | null>(null);

  function onDown(e: React.PointerEvent) {
    // CAPTURE THE POINTER. Without this the wrapper only hears the drag while
    // the cursor stays inside it, and a real hand does not stay inside it — a
    // fast yank overshoots the edge on the first move, pointerleave fired,
    // and the gesture silently died a few pixels in. That is what "it won't
    // let me grab the graph" feels like. With capture, the drag follows the
    // hand wherever it goes and ends only when the button comes up.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // synthetic events and some embedders refuse — hover-drag still works
    }
    touches.current.set(e.pointerId, e.clientX);
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      // Anchored on the visible SPAN, not the bucket count: zoomAt can change
      // granularity mid-gesture, and a bar count captured in the old bucket
      // size would make the very next move jump.
      pinch.current = { dist: Math.abs(a - b) || 1, span: viewBars * tf.ms };
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
      // Pinch used to call setView directly, which is why a phone could never
      // zoom out past one granularity: setView clamps to the frame's own bar
      // ceiling and has no idea the ladder exists. Every other zoom path goes
      // through zoomAt; this one now does too, so pinching out on 15m walks up
      // to 30m, 1h, 4h and the whole history the same way the wheel does.
      const wantBars = ((pinch.current.span * pinch.current.dist) / dist) / tf.ms;
      const cur = view?.bars ?? tf.bars;
      if (cur > 0 && Math.abs(wantBars / cur - 1) > 0.01) {
        zoomAt(wantBars / cur, 0.5);
      }
      return;
    }
    const d = drag.current;
    if (d && e.buttons === 1 && geo) {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 2) d.moved = true;
      if (d.moved) {
        pending.current.offset = d.offset + dx / geo.step;
        pending.current.scrub = null; // panning, not pointing
        flushOnFrame();
        return;
      }
    }
    scrubAt(e);
  }

  function onUp(e: React.PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // never captured — nothing to release
    }
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
      out.push({
        x,
        label: axisTimeLabel(c.t, step, newDay, hour12),
        major: newDay,
      });
    });
    return out;
  }, [geo, candles, tf.ms, offset, hour12]);

  return (
    <div className="panel flex flex-col">
      {/* header: price readout + mode toggle */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-terminal-line px-3 py-2">
        <span className="font-mono text-sm font-bold">${symbol}</span>
        <span className="num font-mono text-xl font-bold">
          {active ? pfx(active.c) : "—"}
        </span>
        <span
          className="num flex items-center gap-1 font-mono text-xs font-semibold"
          style={{ color }}
        >
          <Tri dir={up ? "up" : "down"} size={7} />
          {fmtPct(change)}
        </span>
        {scrub !== null && active && (
          <span
            className="num flex items-center gap-1 rounded bg-terminal-raise px-1.5 py-0.5 font-mono text-[10px] font-semibold"
            style={{ color: barUp ? UP : DOWN }}
            title={`This ${tf.label} bar: open ${pfx(active.o)} → close ${pfx(active.c)}`}
          >
            <Tri dir={barUp ? "up" : "down"} size={6} />
            {fmtBarPct(barChange)}
            <span className="text-terminal-muted">bar</span>
          </span>
        )}
        {active && (
          <span className="hidden gap-2.5 font-mono text-[10px] text-terminal-muted sm:flex">
            <span>
              O <span className="num text-terminal-text">{pfx(active.o)}</span>
            </span>
            <span>
              H <span className="num text-terminal-up">{pfx(active.h)}</span>
            </span>
            <span>
              L <span className="num text-terminal-down">{pfx(active.l)}</span>
            </span>
            <span>
              C <span className="num text-terminal-text">{pfx(active.c)}</span>
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
        {/* Price / MC: the axis, the readout and the big number all follow */}
        <span
          role="group"
          aria-label="Chart scale"
          className="flex items-center rounded border border-terminal-line font-mono text-[10px] font-semibold"
        >
          {(["price", "mc"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setScale(k)}
              aria-pressed={scale === k}
              className={`px-1.5 py-0.5 transition-colors first:rounded-l last:rounded-r ${
                scale === k
                  ? "bg-terminal-raise text-terminal-text"
                  : "text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {k === "price" ? "Price" : "MC"}
            </button>
          ))}
        </span>
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
                {/* The clock lives here because this is where the times are.
                    There is no settings page to bury it in, and a preference
                    you can only find by leaving the thing it affects is a
                    preference nobody changes. */}
                <div className="col-span-4 mt-1 flex items-center justify-between gap-2 border-t border-terminal-line pt-1.5">
                  <span className="font-mono text-[10px] text-terminal-muted">
                    clock
                  </span>
                  <div className="flex gap-0.5">
                    {(["12h", "24h"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setClock(c)}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                          clock === c
                            ? "bg-terminal-accent/15 text-terminal-accent"
                            : "text-terminal-muted hover:bg-terminal-raise hover:text-terminal-text"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
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
          // The grab hand appears whenever there IS history off-screen, not
          // only once you have already zoomed or panned. It used to be the
          // latter, so the default view showed a crosshair — a cursor that
          // says "you cannot drag this" on a chart that has always been
          // draggable. You had to discover panning to be told it was allowed.
          canPan ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
        }`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setView(null)}
        onPointerLeave={() => {
          // Leaving only ends the HOVER. It used to end the gesture too,
          // which combined with the missing pointer capture meant any drag
          // that crossed the edge of the box was cancelled mid-pull. A drag
          // ends when the button comes up, nowhere else.
          if (!drag.current && !pinch.current) setScrub(null);
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

            {/* The beginning of the ticker. When the window reaches it, a
                pull that pins here is the END OF HISTORY, not a broken drag —
                and without this line there was nothing on screen to say so.
                A three-day-old listing at full zoom-out has its whole life
                visible; every further pull does nothing, which reads as a bug
                unless the wall is drawn. */}
            {earliest !== undefined &&
              candles.length > 1 &&
              (() => {
                const i = (earliest - candles[0].t) / tf.ms;
                if (i < -0.5 || i > candles.length - 1) return null;
                const x = geo.x(Math.max(0, i));
                return (
                  <g opacity="0.6">
                    <line
                      x1={x}
                      x2={x}
                      y1={geo.padT}
                      y2={geo.h - geo.padB}
                      stroke={MUTED}
                      strokeWidth="1"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={x + 5}
                      y={geo.padT + 10}
                      fill={MUTED}
                      fontSize="9"
                      fontFamily="ui-monospace, monospace"
                    >
                      listed {fmtMarketDate(earliest)}
                    </text>
                  </g>
                );
              })()}


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
                const yO = geo.y(c.o);
                const yC = geo.y(c.c);
                if (wickOnly) {
                  // No room for a body, so the bar IS the range: one stroke
                  // from high to low, as wide as its slot so neighbours nearly
                  // touch, coloured by the direction the bucket closed.
                  const yH = geo.y(c.h);
                  const yL = geo.y(c.l);
                  return (
                    <line
                      key={c.t}
                      x1={geo.x(i)}
                      x2={geo.x(i)}
                      y1={yH}
                      // a doji still has to be visible
                      y2={Math.max(yL, yH + 1)}
                      stroke={col}
                      strokeWidth={Math.max(0.75, Math.min(2, geo.step * 0.9))}
                      shapeRendering="crispEdges"
                    />
                  );
                }
                // The body takes most of its slot and is FILLED either way.
                // Hollow up-candles next to solid down-candles is a style of
                // its own, and mixed with a thin body it is the single thing
                // that made these read as not-quite-a-chart.
                const bw = Math.max(1.5, Math.min(24, geo.step * 0.72));
                const top = Math.min(yO, yC);
                const bodyH = Math.max(1, Math.abs(yC - yO));
                const wickW = Math.max(1, Math.min(2, bw * 0.12));
                return (
                  <g key={c.t}>
                    <line
                      x1={geo.x(i)}
                      x2={geo.x(i)}
                      y1={geo.y(c.h)}
                      y2={geo.y(c.l)}
                      stroke={col}
                      strokeWidth={wickW}
                      shapeRendering="crispEdges"
                    />
                    <rect
                      x={geo.x(i) - bw / 2}
                      y={top}
                      width={bw}
                      height={bodyH}
                      fill={col}
                      shapeRendering="crispEdges"
                    />
                  </g>
                );
              })
            )}

            {/* volume */}
            {hasVolume &&
              candles.map((c, i) => {
                if (c.v <= 0) return null;
                const bw = Math.max(1.5, Math.min(24, geo.step * 0.72));
                const hgt = geo.vy(c.v);
                return (
                  <rect
                    key={`v${c.t}`}
                    x={geo.x(i) - bw / 2}
                    y={geo.h - geo.padB - hgt}
                    width={bw}
                    height={hgt}
                    fill={c.c >= c.o ? UP : DOWN}
                    opacity="0.45"
                    shapeRendering="crispEdges"
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

            {/* Real revenue changes — the only marks on this chart that are
                news rather than price.

                One mark per CANDLE, not per event. Every change used to get
                its own triangle at its own timestamp, so a subscriber that
                churned and came back five minutes later drew a red arrow and
                a green one on the same fifteen-minute bar — and since the bar
                closes on the net, the red arrow sat under a fat green candle
                and read as a bug. A candle can only ever show what the market
                saw over that candle, so that is what the mark reports: the
                net move across the bar, with the individual changes in the
                tooltip. Zoom in and they separate again. */}
            {(() => {
              if (candles.length < 2) return null;
              const first = candles[0].t;
              const last = candles[candles.length - 1].t + tf.ms;
              const byCandle = new Map<number, RevenueEvent[]>();
              for (const e of [...events].sort((a, b) => a.at - b.at)) {
                if (e.at < first || e.at > last) continue;
                const i = Math.min(candles.length - 1, Math.max(0, Math.floor((e.at - first) / tf.ms)));
                const list = byCandle.get(i);
                if (list) list.push(e);
                else byCandle.set(i, [e]);
              }
              return [...byCandle.entries()].map(([i, group]) => {
                const from = group[0].prevMrr;
                const to = group[group.length - 1].mrr;
                const net = from > 0 ? to / from - 1 : 0;
                const flat = Math.abs(net) < 0.0005;
                const up = net >= 0;
                const color = flat ? MUTED : up ? UP : DOWN;
                const x = geo.x(i);
                const y = geo.h - geo.padB - 4;
                // sized to the news: one small customer is a tick, a whale is
                // a flag you can see from across the room
                const size = Math.abs(net);
                const r = size >= 0.02 ? 5 : size >= 0.005 ? 4 : 2.5;
                const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
                const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
                const label = flat
                  ? `Revenue unchanged over this bar`
                  : `${up ? "Revenue up" : "Revenue down"} ${pct(net)} MRR: ${money(from)} → ${money(to)}`;
                const detail =
                  group.length > 1
                    ? `\n${group.length} changes in this bar:\n` +
                      group
                        .map((e) => `  ${money(e.prevMrr)} → ${money(e.mrr)} (${pct(e.prevMrr > 0 ? e.mrr / e.prevMrr - 1 : 0)})`)
                        .join("\n")
                    : "";
                return (
                  <g key={`re${i}`} opacity="0.9">
                    <line
                      x1={x}
                      x2={x}
                      y1={geo.padT}
                      y2={geo.h - geo.padB}
                      stroke={color}
                      strokeWidth="1"
                      strokeDasharray="1 4"
                      opacity="0.45"
                    />
                    {flat ? (
                      <circle cx={x} cy={y - 3} r={2.5} fill={color} />
                    ) : (
                      <path
                        d={
                          up
                            ? `M ${x} ${y - r * 1.75} L ${x + r} ${y} L ${x - r} ${y} Z`
                            : `M ${x} ${y} L ${x + r} ${y - r * 1.75} L ${x - r} ${y - r * 1.75} Z`
                        }
                        fill={color}
                      />
                    )}
                    <rect x={x - 6} y={geo.padT} width={12} height={geo.h - geo.padB - geo.padT} fill="transparent">
                      <title>{label + detail}</title>
                    </rect>
                  </g>
                );
              });
            })()}

            {/* the founder spoke — a call is marked where it was made */}
            {calls.map((c) => {
              if (candles.length < 2) return null;
              const first = candles[0].t;
              const last = candles[candles.length - 1].t + tf.ms;
              if (c.at < first || c.at > last) return null;
              const i = Math.min(candles.length - 1, Math.max(0, Math.floor((c.at - first) / tf.ms)));
              const x = geo.x(i);
              const y = geo.padT + 10;
              const tone = c.guidance > 0 ? UP : c.guidance < 0 ? DOWN : MUTED;
              return (
                <g key={`call${c.at}`} opacity="0.95">
                  <line x1={x} x2={x} y1={geo.padT} y2={geo.h - geo.padB} stroke={tone} strokeWidth="1" strokeDasharray="2 4" opacity="0.4" />
                  <rect x={x - 12} y={y - 7} width="24" height="13" rx="3" fill={tone} opacity="0.9" />
                  <text x={x} y={y + 3} textAnchor="middle" fill="#0b0f19" fontSize="8" fontWeight="700" fontFamily="ui-monospace, monospace">
                    CALL
                  </text>
                  <title>{`Earnings call — guiding ${c.guidance >= 0 ? "+" : ""}${Math.round(c.guidance * 100)}% next month`}</title>
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
                  {labelFor(candles[scrub].t, tf, hour12)}
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
                {axisLabelClear(t.x, t.label) && (
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
                )}
              </g>
            ))}
            {showEdgeLabel && (
              <text
                x={geo.plotW - 2}
                y={geo.h - 6}
                textAnchor="end"
                fill={MUTED}
                fontSize="10"
                fontFamily="ui-monospace, monospace"
              >
                {edgeLabel}
              </text>
            )}
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
          {wickOnly && mode === "candle" ? " (dense)" : ""} · play
          money
        </span>
        {events.length > 0 && (
          <span
            className="flex items-center gap-1.5"
            title="Revenue news, not price. A bar can close green on a day revenue fell — the crowd is the other half of the price."
          >
            <svg width="9" height="8" aria-hidden="true">
              <path d="M 4.5 0 L 9 8 L 0 8 Z" fill={UP} />
            </svg>
            <svg width="9" height="8" aria-hidden="true">
              <path d="M 4.5 8 L 9 0 L 0 0 Z" fill={DOWN} />
            </svg>
            revenue moved
          </span>
        )}
        <span className="ml-auto hidden text-terminal-muted/70 md:block">
          scroll to zoom · drag to pan
          {zoomed ? " · double-click to reset" : ""}
        </span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart, ChevronDown, LineChart } from "lucide-react";
import type { ChartPoint } from "@/lib/types";
import { fmtPct, fmtPrice } from "@/lib/format";
import {
  buildCandles,
  DEFAULT_TIMEFRAME,
  labelFor,
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
  trades = [],
  earliest,
  heightClass = "h-[300px] sm:h-[380px]",
}: {
  symbol: string;
  mrr: number;
  sentiment: number;
  series: ChartPoint[];
  fairPrice: number;
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

  const tf = timeframeFor(tfKey);

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
    () => makePriceAt(symbol, mrr, sentiment, series),
    [symbol, mrr, sentiment, series]
  );

  const candles = useMemo<Candle[]>(() => {
    if (now === null) return [];
    return buildCandles({ priceAt, tf, now, earliest, trades });
  }, [priceAt, tf, now, earliest, trades]);

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
    const step = plotW / candles.length;
    const x = (i: number) => step * (i + 0.5);
    const y = (v: number) =>
      padT + (1 - (v - vMin) / (vMax - vMin || 1)) * plotH;

    const maxVol = Math.max(1, ...candles.map((c) => c.v));
    const vy = (v: number) => (v / maxVol) * (volH - 6);

    return { w, h, padR, padT, padB, plotW, plotH, volH, step, x, y, vy, vMin, vMax };
  }, [dims, candles, fairPrice, hasVolume]);

  const pf = useMemo(
    () => makePriceFmt(geo ? geo.vMax - geo.vMin : 1),
    [geo]
  );

  const active =
    scrub !== null && scrub >= 0 && scrub < candles.length
      ? candles[scrub]
      : candles[candles.length - 1];
  const first = candles[0];
  const change =
    first && active && first.o > 0 ? (active.c - first.o) / first.o : 0;
  const up = change >= 0;
  const color = up ? UP : DOWN;

  function onPointer(e: React.PointerEvent) {
    if (!geo) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor((e.clientX - rect.left) / geo.step);
    setScrub(Math.max(0, Math.min(candles.length - 1, i)));
  }

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
        className={`relative w-full ${heightClass}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setScrub(null)}
      >
        {geo && candles.length > 1 ? (
          <svg
            width={geo.w}
            height={geo.h}
            className="block touch-none select-none"
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

            {mode === "line" ? (
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

            {/* time axis ends */}
            <text
              x={4}
              y={geo.h - 6}
              fill={MUTED}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              {labelFor(candles[0].t, tf)}
            </text>
            <text
              x={geo.plotW - 4}
              y={geo.h - 6}
              textAnchor="end"
              fill={MUTED}
              fontSize="10"
              fontFamily="ui-monospace, monospace"
            >
              now
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
          {tf.label} {mode === "candle" ? "candles" : "line"} · play money
        </span>
        <span className="flex items-center gap-1.5 text-terminal-amber">
          <span className="inline-block h-0 w-4 border-t border-dashed border-terminal-amber" />
          fair value · 3× ARR ÷ 10k
        </span>
      </div>
    </div>
  );
}

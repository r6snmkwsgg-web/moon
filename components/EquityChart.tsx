"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMoney, fmtPct } from "@/lib/format";
import {
  EQUITY_RANGES,
  makeEquityAt,
  sampleEquity,
  type EquityHolding,
  type EquityRangeKey,
  type EquityTrade,
} from "@/lib/equity";
import Tri from "@/components/Tri";

const UP = "#22c55e";
const DOWN = "#f43f5e";
const MUTED = "#8494ab";

/** Live edge re-ticks fast on a day view, slowly on a month. */
function tickMs(range: EquityRangeKey): number {
  return range === "1D" ? 1_000 : range === "1W" ? 5_000 : 30_000;
}

const RANGE_WORDS: Record<EquityRangeKey, string> = {
  "1D": "today",
  "1W": "past week",
  "1M": "past month",
  ALL: "all time",
};

function stamp(t: number, range: EquityRangeKey): string {
  const d = new Date(t);
  if (range === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The portfolio's own tape. Every point is cash plus what the holdings were
 * worth at that instant, so the line moves the way the market moved — the
 * spikes are real price movement, and the steps are the moments you traded.
 */
export default function EquityChart({
  cash,
  holdings,
  trades,
  startedAt,
  startingCash,
  totalValue,
}: {
  cash: number;
  holdings: EquityHolding[];
  trades: EquityTrade[];
  startedAt: number;
  startingCash: number;
  totalValue: number;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [range, setRange] = useState<EquityRangeKey>("1D");
  const [now, setNow] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      if (r.width > 0 && r.height > 0) setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, tickMs(range));
    return () => clearInterval(id);
  }, [range]);

  const valueAt = useMemo(
    () => makeEquityAt({ cash, holdings, trades, startedAt, startingCash }),
    [cash, holdings, trades, startedAt, startingCash]
  );

  const series = useMemo(() => {
    if (now === null) return [];
    const span = EQUITY_RANGES.find((r) => r.key === range)!.ms;
    // Hours of flat cash before the first trade say nothing and eat the whole
    // chart, so the curve opens just before the account did something.
    const firstMove = trades.length ? trades[0].t : startedAt;
    const lead = Math.max(60_000, (now - firstMove) * 0.06);
    const earliest = Math.max(startedAt, firstMove - lead);
    const from =
      span === Infinity ? earliest : Math.max(earliest, now - span);
    return sampleEquity(valueAt, from, now, 220);
  }, [valueAt, range, now, startedAt, trades]);

  const geo = useMemo(() => {
    if (!dims || series.length < 2) return null;
    const { w, h } = dims;
    const padT = 16;
    const padB = 18;
    let min = Infinity;
    let max = -Infinity;
    for (const p of series) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    // the stake line belongs on the chart when it is anywhere near the range
    const span = max - min || max || 1;
    if (startingCash > min - span * 0.6 && startingCash < max + span * 0.6) {
      min = Math.min(min, startingCash);
      max = Math.max(max, startingCash);
    }
    const pad = (max - min || max || 1) * 0.12;
    min -= pad;
    max += pad;
    const t0 = series[0].t;
    const t1 = series[series.length - 1].t;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
    return { w, h, x, y, t0, t1, min, max };
  }, [dims, series, startingCash]);

  const first = series[0]?.price ?? startingCash;
  const last = series[series.length - 1]?.price ?? totalValue;
  const active = scrub !== null && series[scrub] ? series[scrub] : null;
  const shown = active ? active.price : last;
  const change = first > 0 ? (shown - first) / first : 0;
  const up = shown >= first;
  const color = up ? UP : DOWN;

  function onMove(e: React.PointerEvent) {
    if (!geo || series.length < 2) return;
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    setScrub(
      Math.max(0, Math.min(series.length - 1, Math.round(frac * (series.length - 1))))
    );
  }

  const line = geo
    ? series.map((p, i) => `${i === 0 ? "M" : "L"} ${geo.x(p.t).toFixed(1)} ${geo.y(p.price).toFixed(1)}`).join(" ")
    : "";

  return (
    <section className="panel flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pt-3">
        <div>
          <div className="num font-mono text-3xl font-bold tracking-tight">
            {fmtMoney(shown)}
          </div>
          <div
            className="num flex items-center gap-1.5 font-mono text-sm font-semibold"
            style={{ color }}
          >
            <Tri dir={up ? "up" : "down"} size={7} />
            {fmtMoney(Math.abs(shown - first))} ({fmtPct(change)})
            <span className="text-terminal-muted">
              {active ? stamp(active.t, range) : RANGE_WORDS[range]}
            </span>
          </div>
        </div>
        <div className="flex gap-0.5">
          {EQUITY_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                setRange(r.key);
                setScrub(null);
              }}
              className={`rounded px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                range === r.key
                  ? "bg-terminal-raise text-terminal-text"
                  : "text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={wrap}
        className="relative mt-1 h-[220px] w-full touch-pan-y select-none sm:h-[320px] xl:h-[420px]"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setScrub(null)}
      >
        {geo && series.length > 1 ? (
          <svg width={geo.w} height={geo.h} className="block" role="img" aria-label="Portfolio value over time">
            <defs>
              <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {startingCash > geo.min && startingCash < geo.max && (
              <>
                <line
                  x1={0}
                  x2={geo.w}
                  y1={geo.y(startingCash)}
                  y2={geo.y(startingCash)}
                  stroke={MUTED}
                  strokeWidth="1"
                  strokeDasharray="3 5"
                  opacity="0.55"
                />
                <text
                  x={4}
                  y={geo.y(startingCash) + 11}
                  fill={MUTED}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  opacity="0.8"
                >
                  {fmtMoney(startingCash)} stake
                </text>
              </>
            )}

            <path d={`${line} L ${geo.w} ${geo.h} L 0 ${geo.h} Z`} fill="url(#equity-fill)" />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* every trade is a mark on your own curve */}
            {trades
              .filter((tr) => tr.t >= geo.t0 && tr.t <= geo.t1)
              .map((tr) => (
                <circle
                  key={`${tr.t}-${tr.symbol}`}
                  cx={geo.x(tr.t)}
                  cy={geo.y(valueAt(tr.t))}
                  r="2.5"
                  fill={tr.side === "buy" ? UP : DOWN}
                  stroke="#0b111d"
                  strokeWidth="1"
                >
                  <title>{`${tr.side} ${tr.shares} $${tr.symbol}`}</title>
                </circle>
              ))}

            {active && (
              <>
                <line
                  x1={geo.x(active.t)}
                  x2={geo.x(active.t)}
                  y1={0}
                  y2={geo.h}
                  stroke={MUTED}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <circle cx={geo.x(active.t)} cy={geo.y(active.price)} r="3.5" fill={color} />
              </>
            )}

            {!active && (
              <circle
                cx={geo.x(series[series.length - 1].t)}
                cy={geo.y(last)}
                r="3.5"
                fill={color}
              >
                <animate attributeName="r" values="3.5;5.5;3.5" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            building your tape…
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-terminal-line px-4 py-1.5 font-mono text-[10px] text-terminal-muted">
        <span>{series.length > 1 ? stamp(series[0].t, range) : ""}</span>
        <span>cash {fmtMoney(cash)} · {holdings.filter((h) => h.shares > 0).length} position(s)</span>
        <span>now</span>
      </div>
    </section>
  );
}

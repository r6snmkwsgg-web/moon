"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMoney, fmtPct } from "@/lib/format";
import { fairPrice } from "@/lib/pricing";
import Link from "next/link";
import LogoTile from "@/components/LogoTile";
import ChangePct from "@/components/ChangePct";
import Sparkline from "@/components/Sparkline";
import { fmtPrice } from "@/lib/format";
import {
  EQUITY_RANGES,
  makeEquityAt,
  makePricesAt,
  makeStateAt,
  realizedPnl,
  sampleEquity,
  type EquityHolding,
  type EquityRangeKey,
  type EquityTrade,
} from "@/lib/equity";
import Tri from "@/components/Tri";

const UP = "#22c55e";
const DOWN = "#f43f5e";
const MUTED = "#8494ab";
const AMBER = "#fbbf24";
const LAST_SEEN = "sx.portfolio.lastSeen";

/** Live edge re-ticks by the second on a day view, slower on a month. */
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

function Stat({
  label,
  value,
  tone = "plain",
  sub,
}: {
  label: string;
  value: string;
  tone?: "plain" | "signed";
  sub?: string;
}) {
  const color =
    tone === "signed"
      ? value.startsWith("-")
        ? "text-terminal-down"
        : "text-terminal-up"
      : "text-terminal-text";
  return (
    <div className="px-3 py-2">
      <div className="microlabel">{label}</div>
      <div className={`num mt-0.5 font-mono text-sm font-semibold ${color}`}>
        {value}
      </div>
      {sub && <div className="num font-mono text-[10px] text-terminal-muted">{sub}</div>}
    </div>
  );
}

/**
 * The portfolio's header: one number, one clock, one curve.
 *
 * Everything here — the hero, the change, every stat below the chart — is
 * derived from the same value function on the same tick, so no two figures
 * on the page can disagree with each other. The curve itself is computed,
 * not recorded: cash plus what the holdings were worth at that instant.
 */
export default function PortfolioHeader({
  cash,
  holdings,
  trades,
  startedAt,
  startingCash,
  rank,
  playerCount,
}: {
  cash: number;
  holdings: EquityHolding[];
  trades: EquityTrade[];
  startedAt: number;
  startingCash: number;
  rank: number;
  playerCount: number;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [range, setRange] = useState<EquityRangeKey>("1D");
  const [now, setNow] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [lastSeen, setLastSeen] = useState<number | null>(null);

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

  // read the previous visit once, then stamp this one — the band stays put
  useEffect(() => {
    try {
      const prior = Number(localStorage.getItem(LAST_SEEN));
      if (Number.isFinite(prior) && prior > 0) setLastSeen(prior);
      localStorage.setItem(LAST_SEEN, String(Date.now()));
    } catch {
      // private mode — no band, no harm
    }
  }, []);

  const inputs = useMemo(
    () => ({ cash, holdings, trades, startedAt, startingCash }),
    [cash, holdings, trades, startedAt, startingCash]
  );
  const valueAt = useMemo(() => makeEquityAt(inputs), [inputs]);
  const stateAt = useMemo(() => makeStateAt(inputs), [inputs]);
  const pricesAt = useMemo(() => makePricesAt(holdings), [holdings]);
  const realized = useMemo(() => realizedPnl(trades), [trades]);

  // The positions read off the same price functions at the same instant as
  // the curve above them, so no two numbers on this page can disagree.
  const positions = useMemo(() => {
    const at = now ?? Date.now();
    return holdings
      .filter((h) => h.shares > 0)
      .map((h) => {
        const price = pricesAt.get(h.symbol)?.(at) ?? 0;
        const value = h.shares * price;
        return { h, price, value, pnl: value - h.shares * h.avgCost };
      })
      .sort((a, b) => b.value - a.value);
  }, [holdings, pricesAt, now]);
  const bookValue = positions.reduce((s, p) => s + p.value, 0) + cash;

  const series = useMemo(() => {
    if (now === null) return [];
    const span = EQUITY_RANGES.find((r) => r.key === range)!.ms;
    // Hours of flat cash before the first trade say nothing and eat the whole
    // chart, so the curve opens just before the account did something.
    const firstMove = trades.length ? trades[0].t : startedAt;
    const lead = Math.max(60_000, (now - firstMove) * 0.06);
    const earliest = Math.max(startedAt, firstMove - lead);
    const from = span === Infinity ? earliest : Math.max(earliest, now - span);
    return sampleEquity(valueAt, from, now, 220);
  }, [valueAt, range, now, startedAt, trades]);

  const geo = useMemo(() => {
    if (!dims || series.length < 2) return null;
    const { w, h } = dims;
    const padT = 14;
    const padB = 14;
    let min = Infinity;
    let max = -Infinity;
    for (const p of series) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    const spread = max - min || max || 1;
    if (startingCash > min - spread * 0.6 && startingCash < max + spread * 0.6) {
      min = Math.min(min, startingCash);
      max = Math.max(max, startingCash);
    }
    const pad = (max - min || max || 1) * 0.14;
    min -= pad;
    max += pad;
    const t0 = series[0].t;
    const t1 = series[series.length - 1].t;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v: number) =>
      padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
    return { w, h, x, y, t0, t1, min, max };
  }, [dims, series, startingCash]);

  /** Revenue changes that actually moved this account's money. */
  const revenueMarks = useMemo(() => {
    if (!geo || now === null) return [];
    const marks: {
      x: number;
      y: number;
      up: boolean;
      title: string;
    }[] = [];
    for (const h of holdings) {
      for (const e of h.events) {
        if (e.at < geo.t0 || e.at > geo.t1) continue;
        const held = stateAt(e.at).shares.get(h.symbol) ?? 0;
        if (held <= 0) continue; // it moved the market, not your money
        const impact =
          held *
          (fairPrice(e.mrr, h.multiple, h.outstanding) -
            fairPrice(e.prevMrr, h.multiple, h.outstanding));
        marks.push({
          x: geo.x(e.at),
          y: geo.y(valueAt(e.at)),
          up: e.mrr >= e.prevMrr,
          title: `$${h.symbol} revenue ${fmtMoney(e.prevMrr)} → ${fmtMoney(e.mrr)}/mo · ${impact >= 0 ? "+" : "−"}${fmtMoney(Math.abs(impact))} to you`,
        });
      }
    }
    return marks;
  }, [geo, holdings, stateAt, valueAt, now]);

  const first = series[0]?.price ?? startingCash;
  const live = series[series.length - 1]?.price ?? startingCash;
  const active = scrub !== null && series[scrub] ? series[scrub] : null;
  const shown = active ? active.price : live;
  const change = first > 0 ? (shown - first) / first : 0;
  const up = shown >= first;
  const color = up ? UP : DOWN;

  // today, all-time and realized all read off the same function and the same tick
  const dayAgo = now === null ? startedAt : Math.max(startedAt, now - 86_400_000);
  const dayOpen = now === null ? startingCash : valueAt(dayAgo);
  // an account younger than a day has no "yesterday" to compare against
  const dayIsAll = now !== null && dayAgo <= startedAt;
  const dayChange = live - dayOpen;
  const allTime = live - startingCash;

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
    ? series
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"} ${geo.x(p.t).toFixed(1)} ${geo.y(p.price).toFixed(1)}`
        )
        .join(" ")
    : "";
  const bandFrom =
    geo && lastSeen && lastSeen > geo.t0 && now !== null && now - lastSeen > 300_000
      ? geo.x(lastSeen)
      : null;

  return (
    <>
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4">
        <div>
          <div className="num font-mono text-4xl font-bold tracking-tight">
            {fmtMoney(shown)}
          </div>
          <div
            className="num mt-0.5 flex items-center gap-1.5 font-mono text-sm font-semibold"
            style={{ color }}
          >
            <Tri dir={up ? "up" : "down"} size={7} />
            {fmtMoney(Math.abs(shown - first))} ({fmtPct(change)})
            <span className="font-normal text-terminal-muted">
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
        className="relative mt-2 h-[210px] w-full touch-pan-y select-none sm:h-[300px] xl:h-[380px]"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setScrub(null)}
      >
        {geo && series.length > 1 ? (
          <svg
            width={geo.w}
            height={geo.h}
            className="block"
            role="img"
            aria-label="Portfolio value over time"
          >
            <defs>
              <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {bandFrom !== null && (
              <>
                <rect
                  x={bandFrom}
                  y={0}
                  width={geo.w - bandFrom}
                  height={geo.h}
                  fill="#38bdf8"
                  opacity="0.04"
                />
                <line
                  x1={bandFrom}
                  x2={bandFrom}
                  y1={0}
                  y2={geo.h}
                  stroke="#38bdf8"
                  strokeWidth="1"
                  opacity="0.3"
                />
                <text
                  x={bandFrom + 5}
                  y={12}
                  fill="#38bdf8"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                  opacity="0.75"
                >
                  since you last looked
                </text>
              </>
            )}

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
                  opacity="0.5"
                />
                <text
                  x={4}
                  y={
                    geo.y(startingCash) > geo.h - 18
                      ? geo.y(startingCash) - 5
                      : geo.y(startingCash) + 11
                  }
                  fill={MUTED}
                  fontSize="9"
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
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* what you did */}
            {trades
              .filter((tr) => tr.t >= geo.t0 && tr.t <= geo.t1)
              .map((tr) => (
                <circle
                  key={`t${tr.t}-${tr.symbol}`}
                  cx={geo.x(tr.t)}
                  cy={geo.y(valueAt(tr.t))}
                  r="2.5"
                  fill={tr.side === "buy" ? UP : DOWN}
                  stroke="#0b111d"
                  strokeWidth="1"
                >
                  <title>{`${tr.side} ${tr.shares.toLocaleString("en-US")} $${tr.symbol} @ ${fmtMoney(tr.price)}`}</title>
                </circle>
              ))}

            {/* what the businesses did to you */}
            {revenueMarks.map((m, i) => (
              <g key={`r${i}`}>
                <line
                  x1={m.x}
                  x2={m.x}
                  y1={m.y}
                  y2={geo.h - 6}
                  stroke={AMBER}
                  strokeWidth="1"
                  strokeDasharray="1 3"
                  opacity="0.5"
                />
                <rect
                  x={m.x - 3}
                  y={m.y - 3}
                  width="6"
                  height="6"
                  transform={`rotate(45 ${m.x} ${m.y})`}
                  fill={AMBER}
                  stroke="#0b111d"
                  strokeWidth="1"
                >
                  <title>{m.title}</title>
                </rect>
              </g>
            ))}

            {active ? (
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
            ) : (
              <circle cx={geo.x(series[series.length - 1].t)} cy={geo.y(live)} r="3.5" fill={color}>
                <animate attributeName="r" values="3.5;6;3.5" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="1;0.35;1" dur="2.2s" repeatCount="indefinite" />
              </circle>
            )}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">
            building your tape…
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-terminal-line/60 px-4 py-1 font-mono text-[10px] text-terminal-muted">
        <span>{series.length > 1 ? stamp(series[0].t, range) : ""}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: UP }} />
            your trades
          </span>
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5"
              style={{ background: AMBER, transform: "rotate(45deg)" }}
            />
            revenue moves
          </span>
        </span>
        <span>now</span>
      </div>

      {/* every figure below reads off the same function on the same tick */}
      <div className="grid grid-cols-2 divide-x divide-y divide-terminal-line/60 border-t border-terminal-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        <Stat
          label="Today"
          tone="signed"
          value={`${dayChange >= 0 ? "+" : "−"}${fmtMoney(Math.abs(dayChange))}`}
          sub={
            dayIsAll
              ? "since you started"
              : dayOpen > 0
                ? fmtPct(dayChange / dayOpen)
                : undefined
          }
        />
        <Stat
          label="All-time"
          tone="signed"
          value={`${allTime >= 0 ? "+" : "−"}${fmtMoney(Math.abs(allTime))}`}
          sub={fmtPct(allTime / startingCash)}
        />
        <Stat
          label="Realized"
          tone={realized === 0 ? "plain" : "signed"}
          value={
            realized === 0
              ? "—"
              : `${realized >= 0 ? "+" : "−"}${fmtMoney(Math.abs(realized))}`
          }
          sub={realized === 0 ? "nothing sold yet" : "booked on sales"}
        />
        <Stat label="Cash" value={fmtMoney(cash)} sub="buying power" />
        <Stat label="Rank" value={`#${rank}`} sub={`of ${playerCount}`} />
      </div>
    </section>

    <section className="panel overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-terminal-line text-left font-mono text-[11px] uppercase tracking-wider text-terminal-muted">
            <th className="px-3 py-2.5">Position</th>
            <th className="px-3 py-2.5 text-right">Shares</th>
            <th className="hidden px-3 py-2.5 text-right sm:table-cell">Avg cost</th>
            <th className="px-3 py-2.5 text-right">Price</th>
            <th className="px-3 py-2.5 text-right">Today</th>
            <th className="hidden px-3 py-2.5 text-right lg:table-cell">30d</th>
            <th className="px-3 py-2.5 text-right">Value</th>
            <th className="px-3 py-2.5 text-right">PnL</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr
              key={p.h.symbol}
              className="row-hover cursor-pointer border-b border-terminal-line/50 last:border-0"
            >
              <td className="px-3 py-2.5">
                <Link
                  href={`/t/${p.h.symbol}`}
                  aria-label={`${p.h.symbol} — ${p.h.name}`}
                  className="row-link flex items-center gap-2.5"
                >
                  <LogoTile symbol={p.h.symbol} logoUrl={p.h.logoUrl} size={26} />
                  <span className="min-w-0">
                    <span className="block font-mono font-bold">${p.h.symbol}</span>
                    <span className="block max-w-[180px] truncate text-[11px] text-terminal-muted">
                      {p.h.name}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="num px-3 py-2.5 text-right font-mono">
                {p.h.shares.toLocaleString("en-US")}
                <span className="block text-[10px] text-terminal-muted">
                  {Math.round((p.value / bookValue) * 100)}% of book
                </span>
              </td>
              <td className="num hidden px-3 py-2.5 text-right font-mono text-terminal-muted sm:table-cell">
                {fmtPrice(p.h.avgCost)}
              </td>
              <td className="num px-3 py-2.5 text-right font-mono">
                {fmtPrice(p.price)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <ChangePct value={p.h.dayChange} chip />
              </td>
              <td className="hidden px-3 py-2.5 lg:table-cell">
                <div className="flex justify-end">
                  <Sparkline
                    values={p.h.spark}
                    up={p.h.weekChange >= 0}
                    width={80}
                    height={24}
                  />
                </div>
              </td>
              <td className="num px-3 py-2.5 text-right font-mono">
                {fmtMoney(p.value)}
              </td>
              <td
                className={`num px-3 py-2.5 text-right font-mono ${
                  p.pnl >= 0 ? "text-terminal-up" : "text-terminal-down"
                }`}
              >
                {p.pnl >= 0 ? "+" : "−"}
                {fmtMoney(Math.abs(p.pnl))}
              </td>
            </tr>
          ))}
          {positions.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-10 text-center text-terminal-muted">
                No positions yet — you have {fmtMoney(cash)} of the{" "}
                {fmtMoney(startingCash)} starting stake.{" "}
                <Link href="/" className="text-terminal-accent">
                  Hit the exchange →
                </Link>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
    </>
  );
}

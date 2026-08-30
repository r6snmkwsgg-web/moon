"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fmtPct, fmtPrice } from "@/lib/format";
import Tri from "@/components/Tri";
import type { ChartEvent, ChartPoint } from "@/lib/types";

export type ChartRange = "1D" | "7D" | "30D" | "ALL";

const RANGE_MS: Record<ChartRange, number> = {
  "1D": 86400_000,
  "7D": 7 * 86400_000,
  "30D": 30 * 86400_000,
  ALL: Number.POSITIVE_INFINITY,
};

const UP = "#22c55e";
const DOWN = "#f43f5e";
const AMBER = "#fbbf24";
const ACCENT = "#38bdf8";
const MUTED = "#8494ab";

/** Fritsch–Carlson monotone cubic — smooth without inventing overshoots. */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2)
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6);
    dy.push(pts[i + 1].y - pts[i].y);
    m.push(dy[i] / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i]));
    }
  }
  t.push(m[n - 2]);

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${(pts[i].x + h).toFixed(2)} ${(pts[i].y + t[i] * h).toFixed(2)}, ${(pts[i + 1].x - h).toFixed(2)} ${(pts[i + 1].y - t[i + 1] * h).toFixed(2)}, ${pts[i + 1].x.toFixed(2)} ${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

function niceTicks(min: number, max: number, count = 3): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (count * step) / span;
  const mult = err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1;
  const s = step * mult;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max; v += s) ticks.push(v);
  return ticks.slice(0, 5);
}

function fmtWhen(t: number, range: ChartRange): string {
  const d = new Date(t);
  if (range === "1D") {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(range === "ALL" ? { year: "2-digit" as const } : {}),
  });
}

/**
 * The one chart. Smoothed monotone curve, gradient floor, draw-in on mount,
 * and the scrub: pointer down/over moves a crosshair, the readout re-prices
 * to wherever you're pointing, change re-computes from the window's open.
 *
 * variant="hero"  — naked, edge-to-edge, docked readout card (the landing fold)
 * variant="panel" — panel chrome, axes, fair-value overlay, event markers
 */
export default function InteractiveChart({
  series,
  fair,
  events = [],
  symbol,
  href,
  variant,
  defaultRange = "30D",
  heightClass,
  baseline,
  baselineLabel,
}: {
  series: ChartPoint[];
  fair?: ChartPoint[];
  events?: ChartEvent[];
  symbol: string;
  href?: string;
  variant: "hero" | "panel";
  defaultRange?: ChartRange;
  heightClass?: string;
  baseline?: number; // reference line (e.g. the $10,000 starting stake)
  baselineLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [scrub, setScrub] = useState<number | null>(null); // index into windowed pts

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0)
        setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // window the series; carry the last pre-window price to the left edge
  const windowed = useMemo(() => {
    const now = series.length ? series[series.length - 1].t : Date.now();
    const cutoff = now - RANGE_MS[range];
    const inWin = series.filter((p) => p.t >= cutoff);
    const before = series.filter((p) => p.t < cutoff);
    const pts =
      before.length > 0
        ? [{ t: cutoff, price: before[before.length - 1].price }, ...inWin]
        : inWin;
    const fairWin = (fair ?? []).filter((p) => p.t >= cutoff);
    return { pts, fairWin, cutoff, now };
  }, [series, fair, range]);

  const { pts } = windowed;
  const idle = scrub === null || scrub >= pts.length;
  const active = idle ? pts.length - 1 : scrub!;

  const openPrice = pts.length ? pts[0].price : 0;
  const shownPrice = pts.length ? pts[active].price : 0;
  const change =
    openPrice > 0 ? (shownPrice - openPrice) / openPrice : 0;
  // the line keeps the WINDOW's color while scrubbing — only the readout
  // tracks the point under the pointer
  const windowChange =
    openPrice > 0 && pts.length
      ? (pts[pts.length - 1].price - openPrice) / openPrice
      : 0;
  const up = windowChange >= 0;
  const color = up ? UP : DOWN;
  const readoutColor = change >= 0 ? UP : DOWN;

  // geometry
  const geo = useMemo(() => {
    if (!dims || pts.length < 2) return null;
    const { w, h } = dims;
    const isHero = variant === "hero";
    const padL = isHero ? 0 : 8;
    const padR = isHero ? 0 : 8;
    const padT = isHero ? Math.max(28, h * 0.22) : 16;
    const padB = isHero ? 6 : 22;
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t || t0 + 1;
    const span = t1 - t0 || 1;

    const values = [
      ...pts.map((p) => p.price),
      ...windowed.fairWin.map((p) => p.price),
      ...(baseline !== undefined ? [baseline] : []),
    ].filter((v) => Number.isFinite(v));
    let vMin = Math.min(...values);
    let vMax = Math.max(...values);
    const pad = (vMax - vMin || vMax || 1) * 0.07;
    vMin = Math.max(0, vMin - pad);
    vMax = vMax + pad;

    const x = (t: number) => padL + ((t - t0) / span) * (w - padL - padR);
    const y = (v: number) =>
      padT + (1 - (v - vMin) / (vMax - vMin || 1)) * (h - padT - padB);
    return { w, h, padL, padR, padT, padB, x, y, vMin, vMax, t0, t1 };
  }, [dims, pts, windowed.fairWin, variant]);

  const onPointer = useCallback(
    (e: React.PointerEvent) => {
      if (!geo || pts.length < 2) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(geo.x(pts[i].t) - px);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      setScrub(best);
    },
    [geo, pts]
  );

  const ranges: ChartRange[] = ["1D", "7D", "30D", "ALL"];
  const tabs = (
    <div
      className={`flex gap-1 ${variant === "hero" ? "justify-center" : ""}`}
      role="tablist"
      aria-label="Chart range"
    >
      {ranges.map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={range === r}
          onClick={() => {
            setRange(r);
            setScrub(null);
          }}
          className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors ${
            range === r
              ? "bg-terminal-raise text-terminal-text"
              : "text-terminal-muted hover:text-terminal-text"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );

  if (series.length < 2) {
    return variant === "hero" ? null : (
      <div className="panel flex h-52 items-center justify-center text-sm text-terminal-muted">
        The chart appears after the first day of trading.
      </div>
    );
  }

  // shared SVG body
  const chartBody =
    geo &&
    (() => {
      const linePts = pts.map((p) => ({ x: geo.x(p.t), y: geo.y(p.price) }));
      const d = monotonePath(linePts);
      const areaD = `${d} L ${geo.x(pts[pts.length - 1].t).toFixed(2)} ${geo.h} L ${geo.x(pts[0].t).toFixed(2)} ${geo.h} Z`;
      const last = linePts[linePts.length - 1];
      const scrubPt = idle ? null : linePts[active];
      const isHero = variant === "hero";

      const yTicks =
        !isHero && geo ? niceTicks(geo.vMin, geo.vMax) : [];

      const winEvents = events.filter(
        (ev) => ev.t >= pts[0].t && ev.t <= pts[pts.length - 1].t
      );

      return (
        <>
          <svg
            width={geo.w}
            height={geo.h}
            className="block touch-none select-none"
            role="img"
            aria-label={`${symbol} price chart`}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setScrub(null)}
          >
            <defs>
              <linearGradient
                id={`grad-${symbol}-${variant}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {yTicks.map((v) => (
              <line
                key={v}
                x1={geo.padL}
                x2={geo.w - geo.padR}
                y1={geo.y(v)}
                y2={geo.y(v)}
                stroke="#182236"
                strokeDasharray="3 5"
              />
            ))}

            <path d={areaD} fill={`url(#grad-${symbol}-${variant})`} />

            {baseline !== undefined && (
              <line
                x1={geo.padL}
                x2={geo.w - geo.padR}
                y1={geo.y(baseline)}
                y2={geo.y(baseline)}
                stroke={MUTED}
                strokeWidth="1"
                strokeDasharray="3 4"
                opacity="0.55"
              />
            )}

            {windowed.fairWin.length > 1 && (
              <path
                d={monotonePath(
                  windowed.fairWin.map((p) => ({
                    x: geo.x(p.t),
                    y: geo.y(p.price),
                  }))
                )}
                fill="none"
                stroke={AMBER}
                strokeWidth="1.5"
                strokeDasharray="5 4"
                opacity="0.7"
              />
            )}

            <path
              key={`line-${range}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isHero ? 3 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="chart-draw"
            />

            {/* dim the future side while scrubbing, Robinhood-style */}
            {scrubPt && (
              <rect
                x={scrubPt.x}
                y={0}
                width={Math.max(geo.w - scrubPt.x, 0)}
                height={geo.h}
                fill="#070b12"
                opacity="0.55"
              />
            )}

            {winEvents.map((ev, i) => (
              <circle
                key={i}
                cx={geo.x(ev.t)}
                cy={geo.y(ev.price)}
                r="4.5"
                fill={
                  ev.tone === "revenue"
                    ? AMBER
                    : ev.tone === "trade"
                      ? ACCENT
                      : UP
                }
                stroke="#070b12"
                strokeWidth="2"
              />
            ))}

            {scrubPt ? (
              <g>
                <line
                  x1={scrubPt.x}
                  x2={scrubPt.x}
                  y1={isHero ? geo.padT * 0.4 : geo.padT}
                  y2={geo.h - geo.padB}
                  stroke={MUTED}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <circle
                  cx={scrubPt.x}
                  cy={scrubPt.y}
                  r="5"
                  fill={color}
                  stroke="#070b12"
                  strokeWidth="2.5"
                />
              </g>
            ) : (
              <circle cx={last.x} cy={last.y} r={isHero ? 6 : 4} fill={color}>
                {!isHero && <title>now</title>}
              </circle>
            )}
          </svg>

          {/* HTML overlays (never stretched): axis labels + event pills */}
          {!isHero &&
            yTicks.map((v) => (
              <span
                key={v}
                className="pointer-events-none absolute right-2 -translate-y-1/2 font-mono text-[10px] text-terminal-muted/80"
                style={{ top: geo.y(v) }}
              >
                {fmtPrice(v)}
              </span>
            ))}
          {!isHero && (
            <>
              <span className="pointer-events-none absolute bottom-1 left-2 font-mono text-[10px] text-terminal-muted/80">
                {fmtWhen(pts[0].t, range)}
              </span>
              <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-[10px] text-terminal-muted/80">
                now
              </span>
            </>
          )}
          {baseline !== undefined && baselineLabel && (
            <span
              className="pointer-events-none absolute left-2 -translate-y-full font-mono text-[10px] text-terminal-muted/80"
              style={{ top: geo.y(baseline) - 2 }}
            >
              {baselineLabel}
            </span>
          )}

          {winEvents.map((ev, i) => {
            const ex = geo.x(ev.t);
            const ey = geo.y(ev.price);
            // the hero docks its readout card top-right — labels stay clear
            if (isHero && ex > geo.w * 0.55 && ey < geo.h * 0.38) return null;
            const flipX = ex > geo.w * 0.62;
            const toneClass =
              ev.tone === "revenue"
                ? "border-terminal-amber/40 text-terminal-amber"
                : ev.tone === "trade"
                  ? "border-terminal-accent/40 text-terminal-accent"
                  : "border-terminal-up/40 text-terminal-up";
            return (
              <span
                key={i}
                className={`pointer-events-none absolute z-10 whitespace-nowrap rounded border bg-terminal-bg/95 px-2 py-1 font-mono text-[10px] font-semibold backdrop-blur ${toneClass}`}
                style={{
                  left: flipX ? undefined : ex + 10,
                  right: flipX ? geo.w - ex + 10 : undefined,
                  top: Math.max(ey - 30 - (i % 2) * 26, 4),
                }}
              >
                {ev.label}
              </span>
            );
          })}
        </>
      );
    })();

  const readout = (
    <div className="flex items-baseline gap-2.5">
      {symbol && (
        <span className="font-mono text-sm font-bold text-terminal-text">
          ${symbol}
        </span>
      )}
      <span className="num font-mono text-xl font-bold text-terminal-text">
        {fmtPrice(shownPrice)}
      </span>
      <span
        className="num flex items-center gap-1 font-mono text-xs font-semibold"
        style={{ color: readoutColor }}
      >
        <Tri dir={change >= 0 ? "up" : "down"} size={7} />
        {fmtPct(change)}
      </span>
      <span className="font-mono text-[11px] text-terminal-muted">
        {idle
          ? range === "ALL"
            ? "all time"
            : range.toLowerCase()
          : fmtWhen(pts[active].t, range)}
      </span>
    </div>
  );

  if (variant === "hero") {
    return (
      <div className="-mx-4 mt-2">
        <div
          ref={wrapRef}
          className={`relative w-full ${heightClass ?? "h-[240px] sm:h-[320px] lg:h-[380px]"}`}
        >
          {chartBody}
          {/* docked readout card */}
          {href ? (
            <Link
              href={href}
              className={`absolute right-4 top-2 rounded-md border bg-terminal-bg/90 px-3.5 py-2 backdrop-blur transition-colors hover:bg-terminal-raise sm:right-8 ${
                up ? "border-terminal-up/40" : "border-terminal-down/40"
              }`}
            >
              {readout}
            </Link>
          ) : (
            <div className="absolute right-4 top-2 rounded-md border border-terminal-line bg-terminal-bg/90 px-3.5 py-2 backdrop-blur sm:right-8">
              {readout}
            </div>
          )}
        </div>
        <div className="mt-2">{tabs}</div>
      </div>
    );
  }

  return (
    <div className="panel p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        {readout}
        {tabs}
      </div>
      <div
        ref={wrapRef}
        className={`relative w-full ${heightClass ?? "h-[260px]"}`}
      >
        {chartBody}
      </div>
      {fair && fair.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-4 px-1 text-[11px] text-terminal-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: color }}
            />
            price (play money)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-full border-t border-dashed border-terminal-amber bg-transparent" />
            <span className="text-terminal-amber">
              fair value · 3× ARR ÷ 10k shares
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

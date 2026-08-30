"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtMoney } from "@/lib/format";
import {
  allocationSlices,
  makePricesAt,
  type EquityHolding,
} from "@/lib/equity";

/**
 * Where the money sits. Slices are shades of one hue rather than a rainbow:
 * this answers "how is the book split", not "how am I doing" — performance
 * has its own colours everywhere else, and reusing green/red here would say
 * something the chart isn't measuring.
 */
// deliberately a step down from the accent: this is a reference chart in a
// side rail, and it should not out-shout the equity curve next to it
const SHADES = ["#4f9ed4", "#3f83b4", "#326b95", "#275577", "#1e425c", "#173347"];
const CASH = "#232f45";

/** Positions shown by name; anything past this is bucketed. */
const NAMED = SHADES.length - 1;

export default function AllocationDonut({
  holdings,
  cash,
  renderedAt,
}: {
  holdings: EquityHolding[];
  cash: number;
  /** The server's instant, so the first client render prices the same book. */
  renderedAt: number;
}) {
  const [now, setNow] = useState(renderedAt);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  const pricesAt = useMemo(() => makePricesAt(holdings), [holdings]);

  const slices = useMemo(() => {
    const at = now;
    const positions = holdings
      .filter((h) => h.shares > 0)
      .map((h) => ({
        label: `$${h.symbol}`,
        name: h.name,
        value: h.shares * (pricesAt.get(h.symbol)?.(at) ?? 0),
      }));
    return allocationSlices(positions, cash, NAMED).map((x, i) => ({
      ...x,
      color: x.isCash ? CASH : SHADES[i],
    }));
  }, [holdings, pricesAt, cash, now]);

  if (slices.length === 0) return null;

  const R = 52;
  const C = 2 * Math.PI * R;
  const active = hover !== null ? slices[hover] : null;

  return (
    <section className="panel">
      <div className="border-b border-terminal-line px-3 py-2">
        <span className="microlabel font-bold !text-terminal-text">
          Allocation
        </span>
      </div>
      <div className="flex items-center gap-4 px-3 py-3">
        <svg width="128" height="128" viewBox="0 0 128 128" className="shrink-0">
          <g transform="rotate(-90 64 64)">
            {slices.map((s, i) => (
              <circle
                key={s.label}
                cx="64"
                cy="64"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? 22 : 17}
                strokeDasharray={`${s.share * C} ${C - s.share * C}`}
                strokeDashoffset={-s.offset * C}
                opacity={hover === null || hover === i ? 1 : 0.35}
                className="cursor-pointer transition-[stroke-width,opacity] duration-150"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${s.label} — ${fmtMoney(s.value)}`}</title>
              </circle>
            ))}
          </g>
          {/* your biggest position by default, whatever you point at otherwise:
              cash is usually the largest slice and is the least interesting
              thing the chart has to say */}
          <text
            x="64"
            y="60"
            textAnchor="middle"
            className="fill-terminal-text font-mono text-[15px] font-bold"
          >
            {Math.round((active ?? slices[0]).share * 100)}%
          </text>
          <text
            x="64"
            y="74"
            textAnchor="middle"
            className="fill-terminal-muted font-mono text-[9px]"
          >
            {(active ?? slices[0]).label}
          </text>
        </svg>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {slices.map((s, i) => (
            <li
              key={s.label}
              title={`${s.name} — ${fmtMoney(s.value)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={`flex items-baseline gap-2 font-mono text-[11px] transition-opacity ${
                hover === null || hover === i ? "opacity-100" : "opacity-45"
              }`}
            >
              <span
                className="mt-0.5 h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate font-bold">{s.label}</span>
              <span className="num ml-auto shrink-0 text-terminal-muted">
                {(s.share * 100).toFixed(s.share < 0.1 ? 1 : 0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

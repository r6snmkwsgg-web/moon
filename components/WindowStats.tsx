"use client";

import { useState } from "react";
import { fmtCompact, fmtPct } from "@/lib/format";

export interface WindowChange {
  label: string;
  ms: number;
  change: number | null;
}

/** One print, as the window stats need it. */
export interface FlowPrint {
  side: "buy" | "sell";
  total: number;
  userId: string;
  at: number;
}

function Split({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const total = left + right;
  const share = total > 0 ? left / total : 0.5;
  return (
    <div className="space-y-0.5">
      <div className="num flex items-baseline justify-between font-mono text-[11px]">
        <span className="text-terminal-up">{leftLabel}</span>
        <span className="text-terminal-down">{rightLabel}</span>
      </div>
      <div className="flex h-1 gap-0.5 overflow-hidden rounded-full">
        <div className="bg-terminal-up" style={{ width: `${share * 100}%` }} />
        <div className="flex-1 bg-terminal-down" />
      </div>
    </div>
  );
}

/**
 * The window chips, and the order flow inside whichever one is selected:
 * prints, notional and distinct traders on each side. Click 1H and every
 * number below is the last hour's.
 */
export default function WindowStats({
  changes,
  flow,
  now,
  initial = "1D",
}: {
  changes: WindowChange[];
  /** Every print of the last day, newest first or not — it is filtered. */
  flow: FlowPrint[];
  now: number;
  initial?: string;
}) {
  const [selected, setSelected] = useState(
    changes.some((c) => c.label === initial) ? initial : changes[0]?.label
  );
  const win = changes.find((c) => c.label === selected) ?? changes[0];
  const since = now - (win?.ms ?? 0);
  const inWindow = flow.filter((p) => p.at >= since);
  const buys = inWindow.filter((p) => p.side === "buy");
  const sells = inWindow.filter((p) => p.side === "sell");
  const sum = (xs: FlowPrint[]) => xs.reduce((s, p) => s + p.total, 0);
  const who = (xs: FlowPrint[]) => new Set(xs.map((p) => p.userId)).size;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-4 gap-1">
        {changes.map((c) => {
          const active = c.label === selected;
          const dir =
            c.change === null
              ? "flat"
              : c.change > 0.0005
                ? "up"
                : c.change < -0.0005
                  ? "down"
                  : "flat";
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => setSelected(c.label)}
              aria-pressed={active}
              className={`rounded-md border px-1 py-1 text-center transition-colors ${
                active
                  ? dir === "up"
                    ? "border-terminal-up/60 bg-terminal-up/[0.14]"
                    : dir === "down"
                      ? "border-terminal-down/60 bg-terminal-down/[0.14]"
                      : "border-terminal-muted bg-terminal-raise"
                  : "border-terminal-line bg-terminal-bg hover:border-terminal-muted"
              }`}
            >
              <div className="microlabel !tracking-[0.12em]">{c.label}</div>
              <div
                className={`num font-mono text-[11px] font-semibold ${
                  dir === "up"
                    ? "text-terminal-up"
                    : dir === "down"
                      ? "text-terminal-down"
                      : "text-terminal-muted"
                }`}
              >
                {c.change === null ? "—" : fmtPct(c.change)}
              </div>
            </button>
          );
        })}
      </div>

      {inWindow.length > 0 ? (
        <div className="space-y-1.5">
          <Split
            left={buys.length}
            right={sells.length}
            leftLabel={`${buys.length.toLocaleString("en-US")} buys`}
            rightLabel={`${sells.length.toLocaleString("en-US")} sells`}
          />
          <Split
            left={sum(buys)}
            right={sum(sells)}
            leftLabel={`${fmtCompact(sum(buys))} vol.`}
            rightLabel={`${fmtCompact(sum(sells))} vol.`}
          />
          <Split
            left={who(buys)}
            right={who(sells)}
            leftLabel={`${who(buys).toLocaleString("en-US")} buyers`}
            rightLabel={`${who(sells).toLocaleString("en-US")} sellers`}
          />
        </div>
      ) : (
        <p className="font-mono text-[11px] text-terminal-muted">
          No prints in the last {win?.label.toLowerCase() ?? "window"}.
        </p>
      )}
    </div>
  );
}

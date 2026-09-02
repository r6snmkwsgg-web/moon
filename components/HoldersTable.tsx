"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import type { HolderRow } from "@/lib/data";
import AiChip from "@/components/AiChip";
import {
  fmtCompact,
  fmtDuration,
  fmtMoney,
  fmtPct,
  fmtPrice,
} from "@/lib/format";

const FIRST_PAGE = 25;

function timeAgo(ms: number, now: number): string {
  const s = Math.max(1, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Who holds the name, biggest position first, every number off the ledger:
 * shares and average cost from holdings, P&L against the live price, the
 * clock from the buy that opened the position, and the trader's latest
 * written thesis with the print it rode in on. Positions are already public
 * beside every discussion post; this is the same fact, sorted.
 */
export default function HoldersTable({
  rows,
  total,
  symbol,
  followedIds,
  viewerId,
  signedIn,
  now,
}: {
  rows: HolderRow[];
  /** Every holder, not just the rows shipped. */
  total: number;
  symbol: string;
  followedIds: string[];
  viewerId: string | null;
  signedIn: boolean;
  /** The server's clock at render, so durations hydrate identically. */
  now: number;
}) {
  const [thesisOnly, setThesisOnly] = useState(false);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const following = useMemo(() => new Set(followedIds), [followedIds]);

  const filtered = rows.filter(
    (r) =>
      (!thesisOnly || r.thesis !== null) &&
      (!followingOnly || following.has(r.userId))
  );
  const shown = showAll ? filtered : filtered.slice(0, FIRST_PAGE);
  const inMoney = rows.filter((r) => r.pnl > 0).length;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-terminal-line px-3 py-2">
        <Users size={12} className="text-terminal-muted" />
        <h2 className="microlabel font-bold !text-terminal-text">
          Holders{" "}
          <span className="num font-normal text-terminal-muted">
            ({total.toLocaleString("en-US")})
          </span>
        </h2>
        {rows.length > 0 && (
          <span className="microlabel">
            {inMoney} of {rows.length} in the money
          </span>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-terminal-muted hover:text-terminal-text">
          <input
            type="checkbox"
            checked={thesisOnly}
            onChange={(e) => setThesisOnly(e.target.checked)}
            className="h-3 w-3 accent-[#38bdf8]"
          />
          Thesis only
        </label>
        {signedIn && (
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-terminal-muted hover:text-terminal-text">
            <input
              type="checkbox"
              checked={followingOnly}
              onChange={(e) => setFollowingOnly(e.target.checked)}
              className="h-3 w-3 accent-[#38bdf8]"
            />
            Following only
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-terminal-muted">
          Nobody holds ${symbol} yet — the first buy starts the list.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-terminal-muted">
          {followingOnly
            ? "Nobody you follow holds this one."
            : "No holder has written a thesis yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="microlabel border-b border-terminal-line text-left">
                <th className="px-3 py-1.5 font-normal">Trader</th>
                <th className="px-3 py-2 text-right font-normal">Position</th>
                <th className="px-3 py-2 text-right font-normal">PnL</th>
                <th className="hidden px-3 py-2 text-right font-normal md:table-cell">
                  Avg. entry
                </th>
                <th className="hidden px-3 py-2 font-normal lg:table-cell">
                  Thesis
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const mine = viewerId !== null && r.userId === viewerId;
                const up = r.pnl >= 0;
                return (
                  <tr
                    key={r.userId}
                    className={`border-b border-terminal-line/50 align-top last:border-0 ${
                      mine ? "bg-terminal-accent/[0.06]" : "row-hover"
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-baseline gap-1.5">
                        {r.username ? (
                          <Link
                            href={`/u/${r.username}`}
                            className="font-mono font-bold text-terminal-text hover:text-terminal-accent"
                          >
                            {r.trader}
                          </Link>
                        ) : (
                          <span className="font-mono font-bold">{r.trader}</span>
                        )}
                        <AiChip username={r.username} />
                        {mine && (
                          <span className="rounded bg-terminal-accent/15 px-1 font-mono text-[10px] text-terminal-accent">
                            you
                          </span>
                        )}
                        {following.has(r.userId) && !mine && (
                          <span className="font-mono text-[10px] text-terminal-muted">
                            following
                          </span>
                        )}
                      </div>
                      <div className="num font-mono text-[11px] text-terminal-muted">
                        {r.heldSince !== null
                          ? `held ${fmtDuration(now - r.heldSince)}`
                          : "held —"}
                      </div>
                    </td>
                    <td className="num px-3 py-1.5 text-right font-mono">
                      <div>{fmtMoney(r.value)}</div>
                      <div className="text-[11px] text-terminal-muted">
                        {r.shares.toLocaleString("en-US")} shs
                      </div>
                    </td>
                    <td
                      className={`num px-3 py-1.5 text-right font-mono ${
                        up ? "text-terminal-up" : "text-terminal-down"
                      }`}
                    >
                      <div>
                        {up ? "+" : "−"}
                        {fmtMoney(Math.abs(r.pnl))}
                      </div>
                      <div className="text-[11px]">{fmtPct(r.pnlPct)}</div>
                    </td>
                    <td className="num hidden px-3 py-1.5 text-right font-mono md:table-cell">
                      <div>{fmtCompact(r.entryMarketCap)} MC</div>
                      <div className="text-[11px] text-terminal-muted">
                        {fmtPrice(r.avgCost)}
                      </div>
                    </td>
                    <td className="hidden max-w-[22rem] px-3 py-1.5 lg:table-cell">
                      {r.thesis ? (
                        <>
                          <p className="line-clamp-2 text-[13px] leading-snug text-terminal-text">
                            {r.thesis}
                          </p>
                          {r.thesisAt !== null && (
                            <span className="font-mono text-[10px] text-terminal-muted">
                              {timeAgo(r.thesisAt, now)} ago
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[12px] text-terminal-muted/60">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > FIRST_PAGE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full border-t border-terminal-line px-3 py-2 font-mono text-[11px] text-terminal-accent hover:bg-terminal-raise/60"
        >
          {showAll
            ? "show fewer"
            : `show all ${filtered.length.toLocaleString("en-US")}`}
        </button>
      )}
      {total > rows.length && (
        <p className="border-t border-terminal-line px-3 py-1.5 font-mono text-[10px] text-terminal-muted">
          top {rows.length.toLocaleString("en-US")} positions shown of{" "}
          {total.toLocaleString("en-US")} holders
        </p>
      )}
    </section>
  );
}

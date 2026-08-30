"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import type { TickerQuote } from "@/lib/types";
import { fmtCompact, fmtPrice } from "@/lib/format";
import ChangePct from "@/components/ChangePct";
import LivePrice from "@/components/LivePrice";
import LogoTile from "@/components/LogoTile";
import Sparkline from "@/components/Sparkline";
import TickerBadges from "@/components/TickerBadges";
import Tri from "@/components/Tri";

type SortKey = "symbol" | "price" | "day" | "week" | "mrr" | "cap";

const SORTS: Record<SortKey, (a: TickerQuote, b: TickerQuote) => number> = {
  symbol: (a, b) => a.ticker.symbol.localeCompare(b.ticker.symbol),
  price: (a, b) => b.price - a.price,
  day: (a, b) => b.dayChange - a.dayChange,
  week: (a, b) => b.weekChange - a.weekChange,
  mrr: (a, b) => b.latestMrr - a.latestMrr,
  cap: (a, b) => b.marketCap - a.marketCap,
};

/**
 * The board: every listing, sortable, prices flashing on live refreshes.
 * Client component so sort state and LivePrice cells work; the data still
 * arrives fully server-rendered.
 */
export default function Board({ quotes }: { quotes: TickerQuote[] }) {
  const [sort, setSort] = useState<{ key: SortKey; flip: boolean }>({
    key: "cap",
    flip: false,
  });

  const sorted = useMemo(() => {
    const s = [...quotes].sort(SORTS[sort.key]);
    return sort.flip ? s.reverse() : s;
  }, [quotes, sort]);

  const totalCap = quotes.reduce((s, q) => s + q.marketCap, 0);

  function clickSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key ? { key, flip: !cur.flip } : { key, flip: false }
    );
  }

  const headers: { key: SortKey | null; label: string; hideSm?: boolean }[] = [
    { key: "symbol", label: "Ticker" },
    { key: "price", label: "Price" },
    { key: "day", label: "24h" },
    { key: "week", label: "7d", hideSm: true },
    { key: "mrr", label: "MRR", hideSm: true },
    { key: "cap", label: "Mkt cap" },
    { key: null, label: "30d" },
  ];

  return (
    <section className="panel self-start overflow-x-auto">
      <div className="flex items-baseline gap-3 border-b border-terminal-line px-3 py-2.5">
        <span className="microlabel font-bold !text-terminal-text">
          The board
        </span>
        <span className="microlabel">
          {quotes.length} listed · {fmtCompact(totalCap)} cap
        </span>
        <Link
          href="/list"
          className="ml-auto flex items-center gap-1 whitespace-nowrap rounded-md border border-terminal-accent/50 bg-terminal-accent/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-terminal-accent hover:bg-terminal-accent/20"
        >
          <Plus size={11} strokeWidth={2.5} />
          List yours
        </Link>
      </div>
      <table className="w-full min-w-[600px] text-[13px]">
        <thead>
          <tr className="border-b border-terminal-line text-left">
            {headers.map((h, i) => (
              <th
                key={h.label}
                className={`px-3 py-2 font-normal ${
                  i === 0 ? "" : "text-right"
                } ${h.hideSm ? "hidden sm:table-cell" : ""}`}
              >
                {h.key ? (
                  <button
                    type="button"
                    onClick={() => clickSort(h.key!)}
                    className={`microlabel inline-flex items-center gap-1 transition-colors hover:!text-terminal-text ${
                      sort.key === h.key ? "!text-terminal-text" : ""
                    }`}
                  >
                    {h.label}
                    {sort.key === h.key && (
                      <Tri dir={sort.flip ? "up" : "down"} size={5} />
                    )}
                  </button>
                ) : (
                  <span className="microlabel">{h.label}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((q) => (
            <tr
              key={q.ticker.id}
              className="row-hover border-b border-terminal-line/40 last:border-0"
            >
              <td className="px-3 py-2">
                <Link
                  href={`/t/${q.ticker.symbol}`}
                  className="flex items-center gap-2.5"
                >
                  <LogoTile
                    symbol={q.ticker.symbol}
                    logoUrl={q.ticker.logo_url}
                    size={28}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-mono font-bold">
                      ${q.ticker.symbol}
                      <TickerBadges ticker={q.ticker} compact />
                    </span>
                    <span className="block max-w-[150px] truncate text-xs text-terminal-muted sm:max-w-[190px]">
                      {q.ticker.name}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="px-3 py-2 text-right font-mono font-semibold">
                <LivePrice value={q.price} formatted={fmtPrice(q.price)} />
              </td>
              <td className="px-3 py-2 text-right">
                <ChangePct value={q.dayChange} chip />
              </td>
              <td className="hidden px-3 py-2 text-right sm:table-cell">
                <ChangePct value={q.weekChange} className="text-xs" />
              </td>
              <td className="num hidden px-3 py-2 text-right font-mono text-terminal-amber sm:table-cell">
                {fmtCompact(q.latestMrr)}
              </td>
              <td className="num px-3 py-2 text-right font-mono text-terminal-muted">
                {fmtCompact(q.marketCap)}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end">
                  <Sparkline values={q.spark} up={q.weekChange >= 0} />
                </div>
              </td>
            </tr>
          ))}
          {quotes.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-3 py-10 text-center text-terminal-muted"
              >
                No tickers listed yet.{" "}
                <Link href="/list" className="text-terminal-accent">
                  Be the first →
                </Link>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

import Link from "next/link";
import type { TickerQuote } from "@/lib/types";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import { nextEarningsDate } from "@/lib/xp";
import CountdownChip from "@/components/CountdownChip";

/**
 * The hero's featured card: today's top mover with a big area chart —
 * the first thing a visitor sees moving.
 */
export default function FeaturedTickerCard({
  quote,
  holdersCount,
  watchersCount,
}: {
  quote: TickerQuote;
  holdersCount?: number;
  watchersCount?: number;
}) {
  const t = quote.ticker;
  const up = quote.dayChange >= 0;
  const color = up ? "#22c55e" : "#f43f5e";
  const spark = quote.spark;

  const W = 620;
  const H = 96;
  const min = Math.min(...spark);
  const max = Math.max(...spark);
  const range = max - min || 1;
  const pts = spark.map((v, i) => {
    const x = (i / Math.max(spark.length - 1, 1)) * W;
    const y = 6 + (1 - (v - min) / range) * (H - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `${line} ${W},${H} 0,${H}`;

  return (
    <Link
      href={`/t/${t.symbol}`}
      className="panel flex flex-col gap-2 rounded-2xl border-terminal-line bg-terminal-panel p-4 transition-colors hover:bg-terminal-raise sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-terminal-line bg-terminal-bg font-mono text-xs font-bold text-terminal-accent">
          {t.symbol.slice(0, 2)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[15px] font-bold">${t.symbol}</span>
            {t.stripe_verified && (
              <span className="rounded bg-terminal-amber/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-terminal-amber">
                ⚡ Stripe-verified
              </span>
            )}
          </div>
          <div className="truncate text-xs text-terminal-muted">
            {t.name} — today&apos;s top mover
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="num font-mono text-2xl font-bold">
            {fmtPrice(quote.price)}
          </div>
          <div
            className="num font-mono text-xs font-semibold"
            style={{ color }}
          >
            {up ? "▲" : "▼"} {fmtPct(quote.dayChange)} today
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`feat-${t.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#feat-${t.id})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-terminal-muted">
        <span>
          MRR{" "}
          <b className="num font-mono text-terminal-amber">
            {fmtCompact(quote.latestMrr)}
          </b>
        </span>
        {typeof holdersCount === "number" && holdersCount > 0 && (
          <span>
            Holders{" "}
            <b className="num font-mono text-terminal-text">{holdersCount}</b>
          </span>
        )}
        {typeof watchersCount === "number" && watchersCount > 0 && (
          <span>
            👀 <b className="num font-mono text-terminal-text">{watchersCount}</b>{" "}
            watching
          </span>
        )}
        <CountdownChip
          target={nextEarningsDate().toISOString()}
          prefix="earnings in"
        />
        <span className="ml-auto font-semibold text-terminal-up">Trade →</span>
      </div>
    </Link>
  );
}

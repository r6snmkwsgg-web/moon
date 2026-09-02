import Link from "next/link";
import { AtSign, Globe, Search, Zap } from "lucide-react";
import type { ChartPoint, Ticker } from "@/lib/types";
import type { RevenueEvent } from "@/lib/pricing";
import { makePriceAt } from "@/lib/candles";
import { fmtCompact, fmtMoney, fmtPct } from "@/lib/format";
import CountdownChip from "@/components/CountdownChip";
import WindowStats, { type FlowPrint, type WindowChange } from "@/components/WindowStats";

const WINDOWS: [string, number][] = [
  ["5M", 5 * 60_000],
  ["1H", 3_600_000],
  ["4H", 4 * 3_600_000],
  ["1D", 86_400_000],
];

/** Change over each window, read off the same price function the chart draws. */
export function windowChanges(
  priceAt: (t: number) => number,
  now: number,
  earliest: number
): WindowChange[] {
  const nowPrice = priceAt(now);
  return WINDOWS.map(([label, ms]) => {
    const from = now - ms;
    if (from < earliest || nowPrice <= 0) return { label, ms, change: null };
    const then = priceAt(from);
    return { label, ms, change: then > 0 ? nowPrice / then - 1 : null };
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[2px] text-[12px]">
      <span className="shrink-0 text-terminal-muted">{label}</span>
      <span className="flex-1 border-b border-dotted border-terminal-line/70" />
      <span className="num shrink-0 text-right font-mono text-terminal-text">
        {children}
      </span>
    </div>
  );
}

/**
 * The stock, on one card: what it is, how it has moved over each window and
 * who was buying and selling inside it (click a window, the flow follows),
 * and the numbers the price is built from.
 */
export default function AboutCard({
  ticker,
  series,
  events,
  liveMrr,
  sentiment,
  multiple,
  shares,
  drift,
  arr,
  revenueSource,
  latestReport,
  mom,
  flow,
  floatHeld,
  earliest,
  renderedAt,
  nextEarningsAt,
}: {
  ticker: Ticker;
  series: ChartPoint[];
  events: RevenueEvent[];
  liveMrr: number;
  sentiment: number;
  multiple: number;
  shares: number;
  drift: number;
  arr: number;
  revenueSource: "payments" | "subscriptions" | "reported";
  latestReport: { month: string; mrr: number; source: string } | null;
  mom: number | null;
  /** Every print of the last day. */
  flow: FlowPrint[];
  floatHeld: number;
  earliest: number;
  renderedAt: number;
  /** ISO instant of the next Stripe re-sync, or null for a manual reporter. */
  nextEarningsAt: string | null;
}) {
  const priceAt = makePriceAt(
    ticker.symbol,
    liveMrr,
    sentiment,
    series,
    multiple,
    shares,
    events,
    drift
  );
  const changes = windowChanges(priceAt, renderedAt, earliest);
  const isDemo = Boolean(ticker.fixture);
  const revenueLabel =
    revenueSource === "payments"
      ? "Revenue / mo"
      : isDemo
        ? "MRR (demo pulse)"
        : revenueSource === "subscriptions"
          ? "MRR (live)"
          : "MRR (reported)";
  const listed = new Date(ticker.listed_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const nextMonth = latestReport
    ? new Date(
        new Date(latestReport.month).setUTCMonth(
          new Date(latestReport.month).getUTCMonth() + 1
        )
      ).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
    : null;

  return (
    <section className="panel space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="font-mono text-sm font-bold">About ${ticker.symbol}</h2>
        {ticker.founder_handle && (
          <a
            href={`https://x.com/${ticker.founder_handle.replace(/^@/, "")}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] text-terminal-accent hover:underline"
          >
            @{ticker.founder_handle.replace(/^@/, "")} ↗
          </a>
        )}
      </div>

      <WindowStats changes={changes} flow={flow} now={renderedAt} />

      {/* where to go next — the point of listing is being found */}
      <div className="flex flex-wrap gap-1.5">
        {ticker.website && (
          <a
            href={ticker.website}
            target="_blank"
            rel="noreferrer nofollow"
            className="btn-ghost flex items-center gap-1 px-2 py-1 text-[11px]"
          >
            <Globe size={11} />
            {ticker.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        )}
        <a
          href={`https://x.com/search?q=%24${encodeURIComponent(ticker.symbol)}&src=typed_query&f=live`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost flex items-center gap-1 px-2 py-1 text-[11px]"
        >
          <Search size={11} />
          Search on X
        </a>
      </div>

      <div className="border-t border-terminal-line pt-1">
        <Row label={revenueLabel}>
          {liveMrr > 0 ? fmtMoney(liveMrr, liveMrr < 10_000 ? 2 : 0) : "—"}
          {ticker.stripe_verified && (
            <Zap
              size={10}
              fill="currentColor"
              strokeWidth={0}
              className="ml-1 inline text-terminal-amber"
              aria-label="Stripe-verified"
            />
          )}
        </Row>
        <Row label={revenueSource === "payments" ? "Revenue / yr" : "ARR"}>
          {fmtCompact(arr)}
        </Row>
        <Row label="Multiple">
          {multiple.toFixed(1)}× {revenueSource === "payments" ? "rev" : "ARR"}
          {mom !== null && (
            <span className={mom >= 0 ? "ml-1 text-terminal-up" : "ml-1 text-terminal-down"}>
              {fmtPct(mom)} MoM
            </span>
          )}
        </Row>
        {latestReport && (
          <Row label="Last report">
            {new Date(latestReport.month).toLocaleDateString("en-US", {
              month: "short",
              timeZone: "UTC",
            })}{" "}
            {fmtCompact(Number(latestReport.mrr))}{" "}
            <span className="text-terminal-muted">
              {latestReport.source === "stripe"
                ? "Stripe"
                : latestReport.source === "self-reported"
                  ? "self-reported"
                  : "curated"}
            </span>
          </Row>
        )}
        <Row label="Float">
          {shares.toLocaleString("en-US")} shs ·{" "}
          {Math.min(100, Math.round((floatHeld / shares) * 100))}% held
        </Row>
        <Row label="Next earnings">
          {nextEarningsAt ? (
            <CountdownChip target={nextEarningsAt} prefix="" />
          ) : nextMonth ? (
            `~${nextMonth}`
          ) : (
            "—"
          )}
          <span className="ml-2 text-terminal-muted">listed {listed}</span>
        </Row>
      </div>
      <p className="flex items-baseline justify-between gap-2 font-mono text-[10px] text-terminal-muted/70">
        <span>
          {isDemo ? "demo listing · simulated revenue pulse and AI traders" : "play money · real revenue"}
        </span>
        <Link href="/how" className="shrink-0 text-terminal-accent hover:underline">
          how the price is built →
        </Link>
      </p>
    </section>
  );
}

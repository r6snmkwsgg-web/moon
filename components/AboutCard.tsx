import Link from "next/link";
import { Zap } from "lucide-react";
import type { ChartPoint, Ticker } from "@/lib/types";
import type { DayStats } from "@/lib/data";
import type { RevenueEvent } from "@/lib/pricing";
import { makePriceAt } from "@/lib/candles";
import { fmtCompact, fmtMoney, fmtPct } from "@/lib/format";
import CountdownChip from "@/components/CountdownChip";

/** Change over a window, read off the same price function the chart draws. */
export function windowChanges(
  priceAt: (t: number) => number,
  now: number,
  earliest: number
): { label: string; change: number | null }[] {
  const windows: [string, number][] = [
    ["5M", 5 * 60_000],
    ["1H", 3_600_000],
    ["4H", 4 * 3_600_000],
    ["1D", 86_400_000],
  ];
  const nowPrice = priceAt(now);
  return windows.map(([label, ms]) => {
    const from = now - ms;
    if (from < earliest || nowPrice <= 0) return { label, change: null };
    const then = priceAt(from);
    return { label, change: then > 0 ? nowPrice / then - 1 : null };
  });
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
    <div className="space-y-1">
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
      <span className="shrink-0 text-terminal-muted">{label}</span>
      <span className="flex-1 border-b border-dotted border-terminal-line/70" />
      <span className="num shrink-0 text-right font-mono text-terminal-text">
        {children}
      </span>
    </div>
  );
}

/**
 * The stock, on one card: what it is, how it has moved, who has been buying
 * and selling today, and the numbers the price is built from. Replaces the
 * row of tiles under the chart and the three lines of revenue commentary
 * that used to follow it.
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
  price,
  arr,
  revenueSource,
  latestReport,
  mom,
  dayStats,
  floatHeld,
  holders,
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
  price: number;
  arr: number;
  revenueSource: "payments" | "subscriptions" | "reported";
  latestReport: { month: string; mrr: number; source: string } | null;
  mom: number | null;
  dayStats: DayStats;
  floatHeld: number;
  holders: number;
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
    year: "numeric",
  });

  return (
    <section className="panel space-y-3 p-3">
      <div>
        <h2 className="font-mono text-sm font-bold">About ${ticker.symbol}</h2>
        <p className="text-sm text-terminal-text">{ticker.name}</p>
        <p className="text-xs leading-snug text-terminal-muted">{ticker.pitch}</p>
        {ticker.founder_handle && (
          <a
            href={`https://x.com/${ticker.founder_handle.replace(/^@/, "")}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block font-mono text-[11px] text-terminal-accent hover:underline"
          >
            @{ticker.founder_handle.replace(/^@/, "")} on X ↗
          </a>
        )}
      </div>

      {/* how it has moved */}
      <div className="grid grid-cols-4 gap-1">
        {changes.map((c) => {
          const dir =
            c.change === null ? "flat" : c.change > 0.0005 ? "up" : c.change < -0.0005 ? "down" : "flat";
          return (
            <div
              key={c.label}
              className={`rounded-md border px-1.5 py-1.5 text-center ${
                dir === "up"
                  ? "border-terminal-up/30 bg-terminal-up/[0.07]"
                  : dir === "down"
                    ? "border-terminal-down/30 bg-terminal-down/[0.07]"
                    : "border-terminal-line bg-terminal-bg"
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
            </div>
          );
        })}
      </div>

      {/* who was buying and selling today */}
      {dayStats.trades > 0 ? (
        <div className="space-y-2 border-t border-terminal-line pt-3">
          <Split
            left={dayStats.buys}
            right={dayStats.sells}
            leftLabel={`${dayStats.buys.toLocaleString("en-US")} buys`}
            rightLabel={`${dayStats.sells.toLocaleString("en-US")} sells`}
          />
          <Split
            left={dayStats.buyNotional}
            right={dayStats.sellNotional}
            leftLabel={`${fmtCompact(dayStats.buyNotional)} vol.`}
            rightLabel={`${fmtCompact(dayStats.sellNotional)} vol.`}
          />
          <Split
            left={dayStats.buyers}
            right={dayStats.sellers}
            leftLabel={`${dayStats.buyers.toLocaleString("en-US")} buyers`}
            rightLabel={`${dayStats.sellers.toLocaleString("en-US")} sellers`}
          />
        </div>
      ) : (
        <p className="border-t border-terminal-line pt-3 font-mono text-[11px] text-terminal-muted">
          No prints yet today.
        </p>
      )}

      {/* the numbers under the price */}
      <div className="border-t border-terminal-line pt-2">
        <Row label="Market cap">{fmtCompact(price * shares)}</Row>
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
              year: "numeric",
              timeZone: "UTC",
            })}{" "}
            · {fmtCompact(Number(latestReport.mrr))}
            <span className="ml-1 text-terminal-muted">
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
        <Row label="Volume today">
          {dayStats.volumeShares > 0
            ? `${dayStats.volumeShares.toLocaleString("en-US")} shs · ${fmtCompact(dayStats.volumeNotional)}`
            : "0"}
        </Row>
        <Row label="Holders">{holders.toLocaleString("en-US")}</Row>
        <Row label="Listed">{listed}</Row>
        <Row label="Next earnings">
          {nextEarningsAt ? (
            <CountdownChip target={nextEarningsAt} prefix="" />
          ) : latestReport ? (
            `~${new Date(new Date(latestReport.month).setUTCMonth(new Date(latestReport.month).getUTCMonth() + 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`
          ) : (
            "—"
          )}
        </Row>
      </div>
      {isDemo && (
        <p className="text-[10px] leading-snug text-terminal-muted/70">
          A demo listing: its revenue pulse and the AI traders on it are
          simulated. Prices, prints and positions are real play money.
        </p>
      )}
      <Link href="/how" className="block font-mono text-[11px] text-terminal-accent hover:underline">
        how the price is built →
      </Link>
    </section>
  );
}

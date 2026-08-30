import Link from "next/link";
import type { Metadata } from "next";
import { getRecapStats } from "@/lib/data";
import { changeFraction } from "@/lib/pricing";
import { fmtCompact, fmtPrice } from "@/lib/format";
import { APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { Bell, Flame, Trophy, Zap } from "lucide-react";
import ChangePct from "@/components/ChangePct";
import ShareButton from "@/components/ShareButton";
import TickerBadges from "@/components/TickerBadges";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "This week",
  description: `The week on ${APP_NAME}: top movers, MRR beats, and new listings. ${GUARDRAIL_TEXT}`,
};

export default async function RecapPage() {
  const stats = await getRecapStats();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-mono text-lg font-bold">This week on the exchange</h1>
          <p className="text-sm text-terminal-muted">
            Trailing 7 days · auto-generated, updated live
          </p>
        </div>
        <ShareButton url={`${siteUrl()}/recap`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {stats.topGainer && (
          <Link
            href={`/t/${stats.topGainer.ticker.symbol}`}
            className="panel space-y-1 border-terminal-up/30 p-4 hover:bg-terminal-raise"
          >
            <div className="microlabel flex items-center gap-1"><Trophy size={11} className="text-terminal-up" />Gainer of the week</div>
            <div className="font-mono text-lg font-bold">
              ${stats.topGainer.ticker.symbol}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="num font-mono">{fmtPrice(stats.topGainer.price)}</span>
              <ChangePct value={stats.topGainer.weekChange} chip />
            </div>
          </Link>
        )}
        {stats.topLoser && (
          <Link
            href={`/t/${stats.topLoser.ticker.symbol}`}
            className="panel space-y-1 border-terminal-down/30 p-4 hover:bg-terminal-raise"
          >
            <div className="microlabel">Rough week</div>
            <div className="font-mono text-lg font-bold">
              ${stats.topLoser.ticker.symbol}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="num font-mono">{fmtPrice(stats.topLoser.price)}</span>
              <ChangePct value={stats.topLoser.weekChange} chip />
            </div>
          </Link>
        )}
      </div>

      {stats.mrrMoves.length > 0 && (
        <section className="panel">
          <h2 className="microlabel flex items-center gap-1 border-b border-terminal-line px-3 py-2">
            <Zap size={11} className="text-terminal-amber" fill="currentColor" strokeWidth={0} />
            Earnings of the week
          </h2>
          <ul className="divide-y divide-terminal-line/40">
            {stats.mrrMoves.map(({ quote, from, to }) => (
              <li
                key={quote.ticker.id}
                className="row-hover flex cursor-pointer items-baseline gap-2 px-3 py-2.5 text-sm"
              >
                <Link
                  href={`/t/${quote.ticker.symbol}`}
                  aria-label={`$${quote.ticker.symbol}`}
                  className="row-link font-mono font-bold"
                >
                  ${quote.ticker.symbol}
                </Link>
                <span className="num font-mono text-xs text-terminal-muted">
                  {fmtCompact(from)} → <span className="text-terminal-amber">{fmtCompact(to)}</span> MRR
                </span>
                <span className="ml-auto">
                  <ChangePct value={changeFraction(from, to)} chip />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.newListings.length > 0 && (
        <section className="panel">
          <h2 className="microlabel flex items-center gap-1 border-b border-terminal-line px-3 py-2">
            <Bell size={11} className="text-terminal-up" />
            New listings
          </h2>
          <ul className="divide-y divide-terminal-line/40">
            {stats.newListings.map((q) => (
              <li
                key={q.ticker.id}
                className="row-hover flex cursor-pointer items-baseline gap-2 px-3 py-2.5 text-sm"
              >
                <Link
                  href={`/t/${q.ticker.symbol}`}
                  aria-label={`$${q.ticker.symbol}`}
                  className="row-link font-mono font-bold"
                >
                  ${q.ticker.symbol}
                </Link>
                <TickerBadges ticker={q.ticker} compact />
                <span className="min-w-0 flex-1 truncate text-xs text-terminal-muted">
                  {q.ticker.name}
                </span>
                <span className="num font-mono">{fmtPrice(q.price)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.mostTraded.length > 0 && (
        <section className="panel">
          <h2 className="microlabel flex items-center gap-1 border-b border-terminal-line px-3 py-2">
            <Flame size={11} className="text-terminal-accent" />
            Most traded
          </h2>
          <ul className="divide-y divide-terminal-line/40">
            {stats.mostTraded.map(({ quote, volume, trades }) => (
              <li
                key={quote.ticker.id}
                className="row-hover flex cursor-pointer items-baseline gap-2 px-3 py-2.5 text-sm"
              >
                <Link
                  href={`/t/${quote.ticker.symbol}`}
                  aria-label={`$${quote.ticker.symbol}`}
                  className="row-link font-mono font-bold"
                >
                  ${quote.ticker.symbol}
                </Link>
                <span className="text-xs text-terminal-muted">
                  {trades} trade{trades === 1 ? "" : "s"}
                </span>
                <span className="num ml-auto font-mono">{fmtCompact(volume)} volume</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-terminal-muted">
        Share it — the link unfurls into a weekly card.{" "}
        <Link href="/" className="text-terminal-accent">
          Back to the floor →
        </Link>
      </p>
    </div>
  );
}

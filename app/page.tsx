import Link from "next/link";
import { Bell, Zap } from "lucide-react";
import {
  getEarningsWire,
  getHeroStory,
  getMarket,
  getMissedToday,
  getPriceSeries,
  getRecentTrades,
  getTradeCountFor,
} from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { fmtCompact, fmtPrice } from "@/lib/format";
import Board from "@/components/Board";
import DayStrip from "@/components/DayStrip";
import InteractiveChart from "@/components/InteractiveChart";
import LivePrice from "@/components/LivePrice";
import WireBanner from "@/components/WireBanner";

export const dynamic = "force-dynamic";

const IPO_WINDOW_MS = 24 * 3600_000;

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default async function ExchangePage() {
  const [market, user] = await Promise.all([getMarket(), getUser()]);

  const [wire, tapeTrades, missed, tradeCount] = await Promise.all([
    getEarningsWire(3),
    user ? getRecentTrades(6) : Promise.resolve([]),
    user ? getMissedToday(market, user.id) : Promise.resolve(null),
    user ? getTradeCountFor(user.id) : Promise.resolve(0),
  ]);

  // The landing hero leads with the top GAINER so first impressions aren't a
  // cliff-dive (unless the whole board is red — then honesty wins).
  const movers = [...market]
    .filter((q) => q.spark.length > 2)
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange));
  const topGainer = [...movers].sort((a, b) => b.dayChange - a.dayChange)[0];
  const featured =
    topGainer && topGainer.dayChange > 0 ? topGainer : movers[0];

  // Dense series + real story dots for the hero (signed-out only).
  const [heroSeries, heroEvents] = !user && featured
    ? await (async () => {
        const series = await getPriceSeries(
          featured.ticker.id,
          featured.ticker.symbol,
          featured.latestMrr,
          Number(featured.ticker.sentiment)
        );
        const events = await getHeroStory(featured.ticker.id, series);
        return [series, events] as const;
      })()
    : [[], []];

  // ONE banner slot: the newest IPO wins, else fresh earnings news, else nothing.
  const freshIpo = market
    .filter(
      (q) =>
        !q.ticker.fixture &&
        Date.now() - new Date(q.ticker.listed_at).getTime() < IPO_WINDOW_MS
    )
    .sort((a, b) => b.ticker.listed_at.localeCompare(a.ticker.listed_at))[0];

  return (
    <div className="space-y-5">
      {/* one banner, max */}
      {freshIpo ? (
        <Link
          href={`/t/${freshIpo.ticker.symbol}`}
          className="panel flex flex-wrap items-center gap-x-3 gap-y-1 border-terminal-up/40 bg-terminal-up/10 px-4 py-2.5 hover:bg-terminal-up/15"
        >
          <span className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            <Bell size={12} />
            New listing
          </span>
          <span className="font-mono font-bold">${freshIpo.ticker.symbol}</span>
          <span className="min-w-0 truncate text-sm text-terminal-muted">
            {freshIpo.ticker.name} — {freshIpo.ticker.pitch}
          </span>
          <span className="num ml-auto font-mono text-sm">
            <LivePrice
              value={freshIpo.price}
              formatted={fmtPrice(freshIpo.price)}
            />
          </span>
        </Link>
      ) : (
        <WireBanner events={wire} />
      )}

      {user ? (
        <>
          {tradeCount === 0 ? (
            <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 border-terminal-up/30 bg-gradient-to-r from-terminal-up/10 to-transparent px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">
                  You&apos;re in — $10,000 of play money is loaded.
                </div>
                <div className="text-xs text-terminal-muted">
                  Pick any startup below and buy your first shares — your
                  first print puts you on the leaderboard.
                </div>
              </div>
              {featured && (
                <Link
                  href={`/t/${featured.ticker.symbol}`}
                  className="whitespace-nowrap rounded-md bg-terminal-up px-3.5 py-2 text-sm font-bold text-black hover:bg-terminal-up/85"
                >
                  Start with ${featured.ticker.symbol} →
                </Link>
              )}
            </div>
          ) : (
            <DayStrip missed={missed} />
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_290px]">
            <Board quotes={market} />
            <section className="panel self-start">
              <div className="flex items-center gap-2 border-b border-terminal-line px-3 py-2">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terminal-up" />
                <span className="microlabel font-bold !text-terminal-text">
                  Live tape
                </span>
                <Link
                  href="/tape"
                  className="ml-auto text-[11px] text-terminal-accent"
                >
                  full feed →
                </Link>
              </div>
              {tapeTrades.length === 0 ? (
                <p className="px-3 py-4 text-xs text-terminal-muted">
                  Quiet tape. The first print today gets seen.
                </p>
              ) : (
                <ul className="divide-y divide-terminal-line/40">
                  {tapeTrades.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-baseline gap-1.5 px-3 py-1.5 font-mono text-[11px]"
                    >
                      <span
                        className={`font-bold uppercase ${
                          t.side === "buy"
                            ? "text-terminal-up"
                            : "text-terminal-down"
                        }`}
                      >
                        {t.side}
                      </span>
                      <span className="truncate text-terminal-text">
                        {t.trader}
                      </span>
                      <span className="num text-terminal-muted">
                        {t.shares.toLocaleString("en-US")}
                      </span>
                      <Link
                        href={`/t/${t.symbol}`}
                        className="font-bold hover:text-terminal-accent"
                      >
                        ${t.symbol}
                      </Link>
                      <span className="num ml-auto text-terminal-muted">
                        {timeAgo(t.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          {/* fold: the centered monument (V2) */}
          <div className="fade-up flex flex-col items-center gap-4 pt-8 text-center sm:pt-12">
            <div className="microlabel flex items-center gap-2 rounded-full border border-terminal-up/40 px-4 py-1.5 !text-terminal-up">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terminal-up" />
              {market.length} startups listed ·{" "}
              {fmtCompact(market.reduce((s, q) => s + q.marketCap, 0))}{" "}
              play-money cap
            </div>
            <h1 className="max-w-3xl text-5xl font-bold leading-[1.05] tracking-[-0.03em] [text-wrap:balance] sm:text-6xl">
              Indie SaaS, trading like the S&amp;P.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-terminal-muted">
              Real startups. Real Stripe-verified revenue. Completely fake
              money — you get $10,000 of it.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="rounded-lg bg-terminal-up px-6 py-3 text-[15px] font-bold text-black transition-transform hover:bg-terminal-up/85 active:translate-y-px"
              >
                Claim your $10,000
              </Link>
              <Link
                href="/list"
                className="flex items-center gap-1.5 rounded-lg border border-terminal-line px-6 py-3 text-[15px] font-semibold transition-colors hover:border-terminal-muted"
              >
                <Zap size={15} className="text-terminal-amber" />
                List your startup
              </Link>
            </div>
            <p className="text-xs text-terminal-muted/80">
              Play money. Not real securities — nothing cashes out, ever.
            </p>
          </div>

          {featured && heroSeries.length > 1 && (
            <InteractiveChart
              series={heroSeries}
              events={heroEvents}
              symbol={featured.ticker.symbol}
              href={`/t/${featured.ticker.symbol}`}
              variant="hero"
            />
          )}

          {/* how it works, in three beats */}
          <div className="grid gap-3.5 pt-6 sm:grid-cols-3">
            {[
              [
                "01",
                "Founders list in 60 seconds",
                "A read-only Stripe key computes their MRR on the spot — verified from day one, re-synced monthly. The verified badge means the number is real.",
              ],
              [
                "02",
                "Revenue sets the anchor",
                "One open formula: fair value = 3× MRR over 10,000 shares. Monthly reports are earnings day — beats rip, misses dump.",
              ],
              [
                "03",
                "You trade the hype",
                "$10,000 of play money. Buys push prices up, hype decays 10% nightly, revenue is gravity. The leaderboard is forever.",
              ],
            ].map(([num, title, body]) => (
              <div key={num} className="panel space-y-1.5 p-5">
                <div className="font-mono text-xl font-bold text-terminal-accent">
                  {num}
                </div>
                <div className="text-[15px] font-bold">{title}</div>
                <p className="text-[13px] leading-relaxed text-terminal-muted">
                  {body}
                </p>
              </div>
            ))}
          </div>

          <Board quotes={market} />

          {/* closing CTA */}
          <div className="flex flex-col items-center gap-4 rounded-lg bg-gradient-to-b from-transparent to-terminal-up/[0.07] py-10">
            <div className="text-2xl font-bold tracking-tight">
              The market is open.
            </div>
            <Link
              href="/login"
              className="rounded-lg bg-terminal-up px-6 py-3 text-[15px] font-bold text-black transition-transform hover:bg-terminal-up/85 active:translate-y-px"
            >
              Claim your $10,000 →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

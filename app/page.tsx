import Link from "next/link";
import {
  getEarningsWire,
  getMarket,
  getMissedToday,
  getRecentTrades,
  getStreakFor,
} from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { fmtCompact, fmtPrice } from "@/lib/format";
import Sparkline from "@/components/Sparkline";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import TickerBadges from "@/components/TickerBadges";
import FeaturedTickerCard from "@/components/FeaturedTickerCard";
import WireBanner from "@/components/WireBanner";
import DayStrip from "@/components/DayStrip";

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

  const [wire, tapeTrades, streak, missed] = await Promise.all([
    getEarningsWire(3),
    user ? getRecentTrades(6) : Promise.resolve([]),
    user ? getStreakFor(user.id) : Promise.resolve(null),
    user ? getMissedToday(market, user.id) : Promise.resolve(null),
  ]);

  const featured = [...market]
    .filter((q) => q.spark.length > 2)
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))[0];

  // ONE banner slot: the newest IPO wins, else fresh earnings news, else nothing.
  const freshIpo = market
    .filter(
      (q) =>
        !q.ticker.fixture &&
        Date.now() - new Date(q.ticker.listed_at).getTime() < IPO_WINDOW_MS
    )
    .sort((a, b) => b.ticker.listed_at.localeCompare(a.ticker.listed_at))[0];

  const board = (
    <section className="panel self-start overflow-x-auto">
      <div className="flex items-baseline gap-3 border-b border-terminal-line px-3 py-2.5">
        <span className="microlabel font-bold text-terminal-text">
          The board
        </span>
        <span className="microlabel">
          {market.length} listed ·{" "}
          {fmtCompact(market.reduce((s, q) => s + q.marketCap, 0))} cap
        </span>
        <Link
          href="/list"
          className="ml-auto whitespace-nowrap rounded-md border border-terminal-amber/50 bg-terminal-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-terminal-amber hover:bg-terminal-amber/20"
        >
          ⚡ List yours
        </Link>
      </div>
      <table className="w-full min-w-[600px] text-[13px]">
        <thead>
          <tr className="border-b border-terminal-line text-left">
            {["Ticker", "Price", "24h", "7d", "MRR", "Mkt cap", "30d"].map(
              (h, i) => (
                <th
                  key={h}
                  className={`microlabel px-3 py-2 font-normal ${
                    i === 0 ? "" : "text-right"
                  } ${i === 3 || i === 4 ? "hidden sm:table-cell" : ""}`}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {market.map((q) => (
            <tr
              key={q.ticker.id}
              className="border-b border-terminal-line/40 transition-colors last:border-0 hover:bg-terminal-raise/60"
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
              <td className="num px-3 py-2 text-right font-mono font-semibold">
                {fmtPrice(q.price)}
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
          {market.length === 0 && (
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

  return (
    <div className="space-y-5">
      {/* one banner, max */}
      {freshIpo ? (
        <Link
          href={`/t/${freshIpo.ticker.symbol}`}
          className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 border-terminal-up/40 bg-terminal-up/10 px-4 py-2.5 hover:bg-terminal-up/15"
        >
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            🔔 New listing
          </span>
          <span className="font-mono font-bold">${freshIpo.ticker.symbol}</span>
          <span className="min-w-0 truncate text-sm text-terminal-muted">
            {freshIpo.ticker.name} — {freshIpo.ticker.pitch}
          </span>
          <span className="num ml-auto font-mono text-sm">
            {fmtPrice(freshIpo.price)}
          </span>
        </Link>
      ) : (
        <WireBanner events={wire} />
      )}

      {user ? (
        <>
          {streak && <DayStrip streak={streak} missed={missed} />}
          <div className="grid gap-4 lg:grid-cols-[1fr_290px]">
            {board}
            <section className="panel self-start">
              <div className="flex items-center gap-2 border-b border-terminal-line px-3 py-2">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terminal-up" />
                <span className="microlabel font-bold text-terminal-text">
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
                  Quiet tape. First print wins bragging rights.
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
          <div className="grid gap-4 lg:grid-cols-[440px_1fr]">
            <div className="flex flex-col justify-center gap-3.5">
              <h1 className="text-4xl font-bold leading-[1.08] tracking-tight [text-wrap:balance]">
                The stock market for indie SaaS.
              </h1>
              <p className="text-sm leading-relaxed text-terminal-muted">
                Real startups, revenue verified through Stripe, $10,000 of play
                money. Hype moves prices — MRR is gravity.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href="/login"
                  className="rounded-lg bg-terminal-up px-4 py-2.5 text-sm font-bold text-black hover:bg-terminal-up/85"
                >
                  Start trading — it&apos;s free
                </Link>
                <Link
                  href="/how"
                  className="rounded-lg border border-terminal-line px-4 py-2.5 text-sm font-semibold hover:border-terminal-muted"
                >
                  How pricing works
                </Link>
              </div>
            </div>
            {featured && <FeaturedTickerCard quote={featured} />}
          </div>
          {board}
        </>
      )}
    </div>
  );
}

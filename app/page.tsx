import Link from "next/link";
import {
  getAllValuations,
  getEarningsWire,
  getMarket,
  getMarketPulse,
  getMissedToday,
  getRecentTrades,
  getStreakFor,
  getXpMap,
} from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { changeFraction } from "@/lib/pricing";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import { nextEarningsDate } from "@/lib/xp";
import Sparkline from "@/components/Sparkline";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import TickerBadges from "@/components/TickerBadges";
import FeaturedTickerCard from "@/components/FeaturedTickerCard";
import WireBanner from "@/components/WireBanner";
import StreakCard from "@/components/StreakCard";
import MissedCard from "@/components/MissedCard";
import TierBadge from "@/components/TierBadge";

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

  const [pulse, wire, tapeTrades, valuations, xpMap, streak, missed] =
    await Promise.all([
      getMarketPulse(market),
      getEarningsWire(6),
      getRecentTrades(5),
      getAllValuations(),
      getXpMap(),
      user ? getStreakFor(user.id) : Promise.resolve(null),
      user ? getMissedToday(market, user.id) : Promise.resolve(null),
    ]);

  const featured = [...market]
    .filter((q) => q.spark.length > 2)
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))[0];

  const freshIpos = market.filter(
    (q) =>
      !q.ticker.fixture &&
      Date.now() - new Date(q.ticker.listed_at).getTime() < IPO_WINDOW_MS
  );

  const topTraders = valuations.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* the wire + IPO banners */}
      <WireBanner events={wire} />
      {freshIpos.map((q) => (
        <Link
          key={q.ticker.id}
          href={`/t/${q.ticker.symbol}`}
          className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 border-terminal-up/40 bg-terminal-up/10 px-4 py-2.5 hover:bg-terminal-up/15"
        >
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            🔔 New listing
          </span>
          <span className="font-mono font-bold">${q.ticker.symbol}</span>
          <span className="min-w-0 truncate text-sm text-terminal-muted">
            {q.ticker.name} — {q.ticker.pitch}
          </span>
          <span className="num ml-auto font-mono text-sm">{fmtPrice(q.price)}</span>
        </Link>
      ))}

      {/* hero band */}
      <div className="grid gap-4 lg:grid-cols-[440px_1fr]">
        {user ? (
          <div className="flex flex-col gap-4">
            {streak && <StreakCard streak={streak} />}
            {missed ? (
              <MissedCard missed={missed} />
            ) : (
              <div className="panel flex flex-1 flex-col justify-center gap-1.5 p-4">
                <div className="microlabel">Nothing missed</div>
                <p className="text-sm text-terminal-muted">
                  No runner got away from you today. Dangerous words, but: nice.
                </p>
              </div>
            )}
          </div>
        ) : (
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
        )}
        {featured && <FeaturedTickerCard quote={featured} />}
      </div>

      {/* stat band */}
      <div className="panel grid grid-cols-2 divide-y divide-terminal-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        {[
          ["Play-money cap", fmtCompact(pulse.totalCap)],
          ["24h volume", fmtCompact(pulse.volume24h)],
          [
            "Gainers / losers",
            <span key="gl" className="num font-mono">
              <span className="text-terminal-up">{pulse.gainers}▲</span>
              <span className="text-terminal-muted"> / </span>
              <span className="text-terminal-down">{pulse.losers}▼</span>
            </span>,
          ],
          ["Trades today", String(pulse.trades24h)],
          [
            "Next earnings",
            <span key="ne" className="num font-mono text-terminal-amber">
              {nextEarningsDate().toLocaleDateString("en-US", {
                month: "short",
                day: "2-digit",
                timeZone: "UTC",
              })}
            </span>,
          ],
        ].map(([label, value], i) => (
          <div key={i} className="px-4 py-2.5">
            <div className="microlabel">{label}</div>
            <div className="num mt-0.5 font-mono text-lg font-semibold">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* board + rail */}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="panel self-start overflow-x-auto">
          <div className="flex items-baseline gap-3 border-b border-terminal-line px-3 py-2.5">
            <span className="microlabel font-bold text-terminal-text">
              All listings
            </span>
            <span className="microlabel">{market.length} tickers</span>
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

        {/* right rail */}
        <div className="flex flex-col gap-4">
          <section className="panel">
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
                        t.side === "buy" ? "text-terminal-up" : "text-terminal-down"
                      }`}
                    >
                      {t.side}
                    </span>
                    <span className="truncate text-terminal-text">{t.trader}</span>
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

          <section className="panel">
            <div className="border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold text-terminal-text">
                Earnings feed
              </span>
            </div>
            <ul className="divide-y divide-terminal-line/40">
              {wire.slice(0, 3).map((e, i) => {
                const mom =
                  e.prevMrr && e.prevMrr > 0
                    ? changeFraction(e.prevMrr, e.mrr)
                    : null;
                return (
                  <li key={i} className="space-y-0.5 px-3 py-2">
                    <div className="font-mono text-[11px]">
                      <span className="text-terminal-amber">
                        {e.source === "stripe" ? "⚡" : "·"}{" "}
                        <Link
                          href={`/t/${e.symbol}`}
                          className="font-bold hover:underline"
                        >
                          ${e.symbol}
                        </Link>
                      </span>{" "}
                      <span className="text-terminal-text">
                        reported {fmtCompact(e.mrr)} MRR
                      </span>
                    </div>
                    {mom !== null && (
                      <div
                        className={`num font-mono text-[10px] ${
                          mom >= 0 ? "text-terminal-up" : "text-terminal-down"
                        }`}
                      >
                        {fmtPct(mom)} MoM {mom >= 0 ? "beat" : "miss"}
                        {e.source === "stripe" && " · Stripe-verified"}
                      </div>
                    )}
                  </li>
                );
              })}
              {wire.length === 0 && (
                <li className="px-3 py-4 text-xs text-terminal-muted">
                  No reports yet this cycle.
                </li>
              )}
            </ul>
          </section>

          <section className="panel">
            <div className="border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold text-terminal-text">
                Top traders
              </span>
              <Link
                href="/leaderboard"
                className="float-right text-[11px] text-terminal-accent"
              >
                ladder →
              </Link>
            </div>
            <ul className="divide-y divide-terminal-line/40">
              {topTraders.map((v, i) => (
                <li
                  key={v.profile.id}
                  className="flex items-center gap-2 px-3 py-1.5 font-mono text-[12px]"
                >
                  <span
                    className={i === 0 ? "text-terminal-amber" : "text-terminal-muted"}
                  >
                    {i + 1}
                  </span>
                  {v.profile.username ? (
                    <Link
                      href={`/u/${v.profile.username}`}
                      className="truncate hover:text-terminal-accent"
                    >
                      {v.profile.display_name}
                    </Link>
                  ) : (
                    <span className="truncate">{v.profile.display_name}</span>
                  )}
                  <TierBadge xp={xpMap.get(v.profile.id) ?? 0} />
                  <span
                    className={`num ml-auto ${
                      v.totalPnl >= 0 ? "text-terminal-up" : "text-terminal-down"
                    }`}
                  >
                    {v.totalPnl >= 0 ? "+" : "-"}
                    {fmtCompact(Math.abs(v.totalPnl))}
                  </span>
                </li>
              ))}
              {topTraders.length === 0 && (
                <li className="px-3 py-4 text-xs text-terminal-muted">
                  The ladder is empty. Free real estate.
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

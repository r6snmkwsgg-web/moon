import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import {
  getEquityInputs,
  getPortfolio,
  getXpMap,
  TRADE_HISTORY_LIMIT,
} from "@/lib/data";
import { fmtMoney, fmtPrice, fmtShares } from "@/lib/format";
import { fmtMarketDateTime, MARKET_TZ_LABEL } from "@/lib/market-time";
import { tierFor } from "@/lib/xp";
import ChangePct from "@/components/ChangePct";
import AllocationDonut from "@/components/AllocationDonut";
import EquityPanel from "@/components/EquityPanel";
import InviteBox from "@/components/InviteBox";
import TierBadge from "@/components/TierBadge";
import { STARTING_CASH, siteUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  // one instant for every time-dependent number this render produces
  const renderedAt = Date.now();
  const user = await getUser();
  if (!user) redirect("/login?next=/portfolio");

  const [data, equity, xpMap] = await Promise.all([
    getPortfolio(user.id),
    getEquityInputs(user.id),
    getXpMap(),
  ]);
  const standing = tierFor(xpMap.get(user.id) ?? 0);
  if (!data) {
    return (
      <p className="py-10 text-center text-sm text-terminal-muted">
        Your account is still being set up — refresh in a moment.
      </p>
    );
  }

  const { valuation, rank, playerCount } = data;
  const username = valuation.profile.username;
  const inviteCode = valuation.profile.invite_code;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold">Portfolio</h1>
        <span className="flex items-center gap-3 text-xs">
          <Link
            href="/welcome"
            className="text-terminal-muted hover:text-terminal-text"
          >
            edit handle
          </Link>
          {username && (
            <Link
              href={`/u/${username}`}
              className="text-terminal-accent hover:underline"
            >
              view public profile →
            </Link>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-4">
      <EquityPanel
        dividends={equity.dividends}
        cash={Number(valuation.profile.cash)}
        holdings={equity.holdings}
        trades={equity.trades}
        startedAt={equity.startedAt}
        startingCash={STARTING_CASH}
        renderedAt={renderedAt}
        rank={rank}
        playerCount={playerCount}
      />

        </div>

        <div className="space-y-4 xl:sticky xl:top-[68px]">
        {valuation.positions.length > 0 && (
          <section className="panel">
            <div className="border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold !text-terminal-text">
                Movers in your book
              </span>
            </div>
            <ul className="divide-y divide-terminal-line/40">
              {[...valuation.positions]
                .sort(
                  (a, b) =>
                    Math.abs(b.quote.dayChange) - Math.abs(a.quote.dayChange)
                )
                .slice(0, 5)
                .map((p) => (
                  <li key={p.holding.ticker_id} className="row-hover cursor-pointer">
                    <Link
                      href={`/t/${p.quote.ticker.symbol}`}
                      aria-label={`$${p.quote.ticker.symbol}`}
                      className="row-link flex items-center gap-2 px-3 py-1.5"
                    >
                      <span className="font-mono text-[12px] font-bold">
                        ${p.quote.ticker.symbol}
                      </span>
                      <span className="min-w-0 truncate text-[11px] text-terminal-muted">
                        {p.quote.ticker.name}
                      </span>
                      <span className="ml-auto">
                        <ChangePct value={p.quote.dayChange} className="text-[11px]" />
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        )}

        <div className="panel space-y-2 p-4">
          <div className="flex items-center justify-between">
            <span className="microlabel">Ranked tier</span>
            <TierBadge xp={standing.xp} showXp />
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-terminal-line">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.round(standing.progress * 100)}%`,
                backgroundColor: standing.tier.color,
              }}
            />
          </div>
          <p className="text-[11px] leading-snug text-terminal-muted">
            {standing.next
              ? `${(standing.next.min - standing.xp).toLocaleString("en-US")} XP to ${standing.next.name}. Earn XP by trading (+50), voting (+25), listing a startup (+500) and inviting friends (+250).`
              : "Diamond. There is nothing above this — only maintaining the aura."}
          </p>
        </div>
        {inviteCode && (
          <InviteBox inviteUrl={`${siteUrl()}/?ref=${inviteCode}`} />
        )}

        {equity.trades.length > 0 && (
          <section className="panel">
            <div className="flex items-baseline gap-2 border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold !text-terminal-text">
                Order history
              </span>
              <span className="num microlabel">
                {equity.trades.length}
                {equity.trades.length === TRADE_HISTORY_LIMIT ? "+" : ""} order
                {equity.trades.length === 1 ? "" : "s"}
              </span>
            </div>
            {/* scrolls instead of growing the page without limit */}
            <ul className="max-h-[320px] divide-y divide-terminal-line/40 overflow-y-auto">
              {[...equity.trades]
                .reverse()
                .map((t) => (
                  <li key={`${t.t}-${t.symbol}-${t.shares}`} className="row-hover">
                    <Link
                      href={`/t/${t.symbol}`}
                      aria-label={`${t.side} ${t.shares} $${t.symbol}`}
                      className="row-link block px-3 py-2"
                    >
                      <div className="flex items-baseline gap-2 font-mono text-[11px]">
                        <span
                          className={`font-bold uppercase ${
                            t.side === "buy"
                              ? "text-terminal-up"
                              : "text-terminal-down"
                          }`}
                        >
                          {t.side}
                        </span>
                        <span className="num">
                          {fmtShares(t.shares)}
                        </span>
                        <span className="font-bold">${t.symbol}</span>
                        <span className="text-terminal-muted">@</span>
                        <span className="num">{fmtPrice(t.price)}</span>
                        <span className="num ml-auto text-terminal-muted">
                          {fmtMoney(t.total)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-2 text-[10px] text-terminal-muted">
                        <span className="num font-mono">
                          {fmtMarketDateTime(t.t)}
                        </span>
                        {t.note && (
                          <span className="min-w-0 flex-1 truncate italic">
                            “{t.note}”
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        )}

          <AllocationDonut
            holdings={equity.holdings}
            cash={Number(valuation.profile.cash)}
            renderedAt={renderedAt}
          />
        </div>
      </div>

      <p className="text-xs text-terminal-muted">
        PnL is vs. your average cost; rank is by total portfolio value. The
        trading day runs midnight to midnight {MARKET_TZ_LABEL}, so everyone
        reads the same day wherever they are.
      </p>
    </div>
  );
}

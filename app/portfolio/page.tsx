import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getEquityInputs, getPortfolio, getXpMap } from "@/lib/data";
import { fmtMoney, fmtPrice } from "@/lib/format";
import { tierFor } from "@/lib/xp";
import ChangePct from "@/components/ChangePct";
import EquityChart from "@/components/EquityChart";
import LivePrice from "@/components/LivePrice";
import InviteBox from "@/components/InviteBox";
import TierBadge from "@/components/TierBadge";
import { STARTING_CASH, siteUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="panel px-3 py-2">
          <div className="microlabel">Total value</div>
          <div className="font-mono text-sm font-semibold">
            <LivePrice
              value={valuation.totalValue}
              formatted={fmtMoney(valuation.totalValue)}
              format="money"
            />
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="microlabel">PnL (all-time)</div>
          <div
            className={`num font-mono text-sm font-semibold ${
              valuation.totalPnl >= 0 ? "text-terminal-up" : "text-terminal-down"
            }`}
          >
            {valuation.totalPnl >= 0 ? "+" : ""}
            {fmtMoney(valuation.totalPnl)}
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="microlabel">Cash</div>
          <div className="num font-mono text-sm font-semibold">
            {fmtMoney(Number(valuation.profile.cash))}
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="microlabel">Rank</div>
          <div className="num font-mono text-sm font-semibold">
            #{rank}{" "}
            <span className="text-xs font-normal text-terminal-muted">
              of {playerCount}
            </span>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-4">
      <EquityChart
        cash={Number(valuation.profile.cash)}
        holdings={equity.holdings}
        trades={equity.trades}
        startedAt={equity.startedAt}
        startingCash={STARTING_CASH}
        totalValue={valuation.totalValue}
      />

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-terminal-line text-left font-mono text-[11px] uppercase tracking-wider text-terminal-muted">
              <th className="px-3 py-2.5">Ticker</th>
              <th className="px-3 py-2.5 text-right">Shares</th>
              <th className="px-3 py-2.5 text-right">Avg cost</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5 text-right">Value</th>
              <th className="px-3 py-2.5 text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {valuation.positions.map((p) => (
              <tr
                key={p.holding.ticker_id}
                className="row-hover cursor-pointer border-b border-terminal-line/50 last:border-0"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/t/${p.quote.ticker.symbol}`}
                    aria-label={`${p.quote.ticker.symbol} — ${p.quote.ticker.name}`}
                    className="row-link font-mono font-bold"
                  >
                    ${p.quote.ticker.symbol}
                  </Link>
                </td>
                <td className="num px-3 py-2.5 text-right font-mono">
                  {Number(p.holding.shares).toLocaleString("en-US")}
                </td>
                <td className="num px-3 py-2.5 text-right font-mono text-terminal-muted">
                  {fmtPrice(Number(p.holding.avg_cost))}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  <LivePrice
                    value={p.quote.price}
                    formatted={fmtPrice(p.quote.price)}
                  />
                </td>
                <td className="num px-3 py-2.5 text-right font-mono">
                  {fmtMoney(p.value)}
                </td>
                <td
                  className={`num px-3 py-2.5 text-right font-mono ${
                    p.pnl >= 0 ? "text-terminal-up" : "text-terminal-down"
                  }`}
                >
                  {p.pnl >= 0 ? "+" : ""}
                  {fmtMoney(p.pnl)}
                </td>
              </tr>
            ))}
            {valuation.positions.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-terminal-muted"
                >
                  No positions yet — you have{" "}
                  {fmtMoney(Number(valuation.profile.cash))} of the{" "}
                  {fmtMoney(STARTING_CASH)} starting stake.{" "}
                  <Link href="/" className="text-terminal-accent">
                    Hit the exchange →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

        </div>

        <div className="space-y-4 xl:sticky xl:top-[68px]">
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
            <div className="border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold !text-terminal-text">
                Your activity
              </span>
            </div>
            <ul className="divide-y divide-terminal-line/40">
              {[...equity.trades]
                .reverse()
                .slice(0, 8)
                .map((t) => (
                  <li key={`${t.t}-${t.symbol}-${t.shares}`}>
                    <Link
                      href={`/t/${t.symbol}`}
                      className="flex items-baseline gap-2 px-3 py-1.5 font-mono text-[11px] hover:bg-terminal-raise/60"
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
                      <span className="num text-terminal-muted">
                        {t.shares.toLocaleString("en-US")}
                      </span>
                      <span className="font-bold">${t.symbol}</span>
                      <span className="num ml-auto text-terminal-muted">
                        {fmtMoney(t.total)}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-terminal-muted">
        <span>PnL is vs. your average cost; rank is by total portfolio value.</span>
        <ChangePct
          value={valuation.totalPnl / STARTING_CASH}
          className="text-xs"
        />
      </div>
    </div>
  );
}

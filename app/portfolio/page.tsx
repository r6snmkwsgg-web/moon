import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/data";
import { fmtMoney, fmtPrice } from "@/lib/format";
import ChangePct from "@/components/ChangePct";
import { STARTING_CASH } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/portfolio");

  const data = await getPortfolio(user.id);
  if (!data) {
    return (
      <p className="py-10 text-center text-sm text-terminal-muted">
        Your account is still being set up — refresh in a moment.
      </p>
    );
  }

  const { valuation, rank, playerCount } = data;

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-lg font-bold">Portfolio</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="panel px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-terminal-muted">
            Total value
          </div>
          <div className="num font-mono text-sm font-semibold">
            {fmtMoney(valuation.totalValue)}
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-terminal-muted">
            PnL (all-time)
          </div>
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
          <div className="text-[10px] uppercase tracking-wider text-terminal-muted">
            Cash
          </div>
          <div className="num font-mono text-sm font-semibold">
            {fmtMoney(Number(valuation.profile.cash))}
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-terminal-muted">
            Rank
          </div>
          <div className="num font-mono text-sm font-semibold">
            #{rank}{" "}
            <span className="text-xs font-normal text-terminal-muted">
              of {playerCount}
            </span>
          </div>
        </div>
      </div>

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
                className="border-b border-terminal-line/50 last:border-0"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/t/${p.quote.ticker.symbol}`}
                    className="font-mono font-bold hover:text-terminal-accent"
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
                <td className="num px-3 py-2.5 text-right font-mono">
                  {fmtPrice(p.quote.price)}
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

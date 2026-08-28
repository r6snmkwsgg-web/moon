import { getAllValuations } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { fmtMoney } from "@/lib/format";
import { STARTING_CASH } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leaderboard" };

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const [valuations, user] = await Promise.all([getAllValuations(), getUser()]);
  const top = valuations.slice(0, 25);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg font-bold">Leaderboard</h1>
        <p className="text-sm text-terminal-muted">
          Top portfolios by play-money PnL. Everyone starts with{" "}
          {fmtMoney(STARTING_CASH, 0)}.
        </p>
      </div>

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-terminal-line text-left font-mono text-[11px] uppercase tracking-wider text-terminal-muted">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Trader</th>
              <th className="px-3 py-2.5 text-right">Total value</th>
              <th className="px-3 py-2.5 text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {top.map((v, i) => {
              const isMe = user !== null && v.profile.id === user.id;
              return (
                <tr
                  key={v.profile.id}
                  className={`border-b border-terminal-line/50 last:border-0 ${
                    isMe ? "bg-terminal-accent/5" : ""
                  }`}
                >
                  <td className="num px-3 py-2.5 font-mono text-terminal-muted">
                    {MEDALS[i] ?? i + 1}
                  </td>
                  <td className="px-3 py-2.5 font-mono">
                    {v.profile.display_name}
                    {isMe && (
                      <span className="ml-1.5 text-[10px] text-terminal-accent">
                        you
                      </span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right font-mono">
                    {fmtMoney(v.totalValue)}
                  </td>
                  <td
                    className={`num px-3 py-2.5 text-right font-mono ${
                      v.totalPnl >= 0 ? "text-terminal-up" : "text-terminal-down"
                    }`}
                  >
                    {v.totalPnl >= 0 ? "+" : ""}
                    {fmtMoney(v.totalPnl)}
                  </td>
                </tr>
              );
            })}
            {top.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-10 text-center text-terminal-muted"
                >
                  Nobody is trading yet. Be first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

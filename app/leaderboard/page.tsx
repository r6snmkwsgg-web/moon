import Link from "next/link";
import { getLeaderboard, getXpMap, type LeaderboardRange } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { fmtMoney } from "@/lib/format";
import { STARTING_CASH } from "@/lib/config";
import TierBadge from "@/components/TierBadge";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leaderboard" };

// podium ranks get metal colors instead of medal emojis
const MEDAL_COLORS = ["#fbbf24", "#b9c2cf", "#cd8a4b"];
const RANGES: { key: LeaderboardRange; label: string }[] = [
  { key: "all", label: "All-time" },
  { key: "30d", label: "30d" },
  { key: "7d", label: "7d" },
];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range: LeaderboardRange =
    rangeParam === "7d" || rangeParam === "30d" ? rangeParam : "all";

  const [rows, user, xpMap] = await Promise.all([
    getLeaderboard(range),
    getUser(),
    getXpMap(),
  ]);
  const top = rows.slice(0, 25);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-bold">Leaderboard</h1>
          <p className="text-sm text-terminal-muted">
            Top portfolios by play-money PnL. Everyone starts with{" "}
            {fmtMoney(STARTING_CASH, 0)}.
          </p>
        </div>
        <nav className="flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={r.key === "all" ? "/leaderboard" : `/leaderboard?range=${r.key}`}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                range === r.key
                  ? "border-terminal-up/50 bg-terminal-up/10 text-terminal-up"
                  : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-terminal-line text-left">
              <th className="microlabel px-3 py-2.5 font-normal">#</th>
              <th className="microlabel px-3 py-2.5 font-normal">Trader</th>
              <th className="microlabel px-3 py-2.5 text-right font-normal">
                Total value
              </th>
              <th className="microlabel px-3 py-2.5 text-right font-normal">
                {range === "all" ? "PnL" : `PnL · ${range}`}
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => {
              const v = row.valuation;
              const isMe = user !== null && v.profile.id === user.id;
              return (
                <tr
                  key={v.profile.id}
                  className={`border-b border-terminal-line/50 last:border-0 ${
                    isMe ? "bg-terminal-accent/5" : ""
                  }`}
                >
                  <td
                    className="num px-3 py-2.5 font-mono text-terminal-muted"
                    style={
                      i < 3
                        ? { color: MEDAL_COLORS[i], fontWeight: 700 }
                        : undefined
                    }
                  >
                    {i + 1}
                  </td>
                  <td className="px-3 py-2.5 font-mono">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {v.profile.username ? (
                        <Link
                          href={`/u/${v.profile.username}`}
                          className="hover:text-terminal-accent"
                        >
                          {v.profile.display_name}
                        </Link>
                      ) : (
                        v.profile.display_name
                      )}
                      <TierBadge xp={xpMap.get(v.profile.id) ?? 0} />
                      {isMe && (
                        <span className="text-[10px] text-terminal-accent">
                          you
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="num px-3 py-2.5 text-right font-mono">
                    {fmtMoney(v.totalValue)}
                  </td>
                  <td
                    className={`num px-3 py-2.5 text-right font-mono ${
                      row.rangePnl >= 0 ? "text-terminal-up" : "text-terminal-down"
                    }`}
                  >
                    {row.rangePnl >= 0 ? "+" : ""}
                    {fmtMoney(row.rangePnl)}
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

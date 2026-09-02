import Link from "next/link";
import { getLeaderboard, getXpMap, type LeaderboardRange } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { fmtMoney } from "@/lib/format";
import { STARTING_CASH } from "@/lib/config";
import TierBadge from "@/components/TierBadge";
import AiChip from "@/components/AiChip";
import { isBotProfile } from "@/lib/bot-roster";

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
  searchParams: Promise<{ range?: string; humans?: string }>;
}) {
  const { range: rangeParam, humans: humansParam } = await searchParams;
  const range: LeaderboardRange =
    rangeParam === "7d" || rangeParam === "30d" ? rangeParam : "all";
  // the AI traders rank by default, labeled; ?humans=1 hides them
  const humansOnly = humansParam === "1";
  const href = (r: LeaderboardRange, h: boolean) => {
    const q = new URLSearchParams();
    if (r !== "all") q.set("range", r);
    if (h) q.set("humans", "1");
    const qs = q.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };

  const [rows, user, xpMap] = await Promise.all([
    getLeaderboard(range),
    getUser(),
    getXpMap(),
  ]);
  const top = rows
    .filter((row) => !humansOnly || !isBotProfile(row.valuation.profile))
    .slice(0, 25);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg font-bold">Leaderboard</h1>
          <p className="text-sm text-terminal-muted">
            Top portfolios by play-money PnL. People start with{" "}
            {fmtMoney(STARTING_CASH, 0)}; the AI traders are measured from
            their own stake.
          </p>
        </div>
        <nav className="flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={href(r.key, humansOnly)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${
                range === r.key
                  ? "border-terminal-up/50 bg-terminal-up/10 text-terminal-up"
                  : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
              }`}
            >
              {r.label}
            </Link>
          ))}
          <Link
            href={href(range, !humansOnly)}
            className={`ml-2 rounded-md border px-2.5 py-1 font-mono text-xs ${
              humansOnly
                ? "border-terminal-accent/50 bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
            }`}
            title="Hide the AI traders"
          >
            humans only
          </Link>
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
                    v.profile.username ? "row-hover cursor-pointer" : ""
                  } ${isMe ? "bg-terminal-accent/5" : ""}`}
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
                          aria-label={`${v.profile.display_name}'s portfolio`}
                          className="row-link"
                        >
                          {v.profile.display_name}
                        </Link>
                      ) : (
                        v.profile.display_name
                      )}
                      <AiChip username={v.profile.username} bot={v.profile.is_bot} />
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

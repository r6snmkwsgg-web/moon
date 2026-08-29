import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicProfile, getStreakFor, getXpMap } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { fmtMoney, fmtPct } from "@/lib/format";
import { STREAK_FLAME_AT } from "@/lib/xp";
import { STARTING_CASH, APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import ValueChart from "@/components/ValueChart";
import ShareButton from "@/components/ShareButton";
import ChangePct from "@/components/ChangePct";
import TierBadge from "@/components/TierBadge";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `@${username}'s play-money portfolio on ${APP_NAME}. ${GUARDRAIL_TEXT}`,
  };
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
  const data = await getPublicProfile(username);
  if (!data) notFound();

  const { profile, valuation, rank, playerCount, history } = data;
  const [viewer, streak, xpMap] = await Promise.all([
    getUser(),
    getStreakFor(profile.id),
    getXpMap(),
  ]);
  const isMe = viewer?.id === profile.id;
  const pnlPct = valuation.totalPnl / STARTING_CASH;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-terminal-line bg-terminal-panel font-mono text-lg font-bold text-terminal-accent">
          {profile.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-bold">
            {profile.display_name}
            <TierBadge xp={xpMap.get(profile.id) ?? 0} />
            {streak.days >= STREAK_FLAME_AT && (
              <span
                title={`${streak.days}-day trade streak`}
                className="rounded bg-terminal-amber/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-terminal-amber"
              >
                🔥 {streak.days}
              </span>
            )}
            {isMe && (
              <span className="text-xs font-normal text-terminal-accent">
                you
              </span>
            )}
          </h1>
          <p className="text-xs text-terminal-muted">
            @{profile.username} · trading since{" "}
            {new Date(profile.created_at).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="num font-mono text-2xl font-bold">
            {fmtMoney(valuation.totalValue)}
          </span>
          <ChangePct value={pnlPct} chip className="text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="panel px-3 py-2">
          <div className="microlabel">Rank</div>
          <div className="num mt-0.5 font-mono text-sm font-semibold">
            {MEDALS[rank - 1] ?? `#${rank}`}{" "}
            <span className="text-xs font-normal text-terminal-muted">
              of {playerCount}
            </span>
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="microlabel">All-time PnL</div>
          <div
            className={`num mt-0.5 font-mono text-sm font-semibold ${
              valuation.totalPnl >= 0 ? "text-terminal-up" : "text-terminal-down"
            }`}
          >
            {valuation.totalPnl >= 0 ? "+" : ""}
            {fmtMoney(valuation.totalPnl)}
          </div>
        </div>
        <div className="panel px-3 py-2">
          <div className="microlabel">Positions</div>
          <div className="num mt-0.5 font-mono text-sm font-semibold">
            {valuation.positions.length}
          </div>
        </div>
      </div>

      <ValueChart history={history} liveValue={valuation.totalValue} />

      <section className="panel">
        <h2 className="microlabel border-b border-terminal-line px-3 py-2">
          Top positions
        </h2>
        {valuation.positions.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-terminal-muted">
            All cash, no conviction — yet.
          </p>
        ) : (
          <ul className="divide-y divide-terminal-line/40">
            {valuation.positions.slice(0, 5).map((p) => (
              <li
                key={p.holding.ticker_id}
                className="flex items-baseline gap-2 px-3 py-2 text-sm"
              >
                <Link
                  href={`/t/${p.quote.ticker.symbol}`}
                  className="font-mono font-bold hover:text-terminal-accent"
                >
                  ${p.quote.ticker.symbol}
                </Link>
                <span className="num font-mono text-xs text-terminal-muted">
                  {Number(p.holding.shares).toLocaleString("en-US")} sh
                </span>
                <span className="num ml-auto font-mono">{fmtMoney(p.value)}</span>
                <span
                  className={`num w-20 text-right font-mono text-xs ${
                    p.pnl >= 0 ? "text-terminal-up" : "text-terminal-down"
                  }`}
                >
                  {p.pnl >= 0 ? "+" : ""}
                  {fmtMoney(p.pnl)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between">
        <ShareButton url={`${siteUrl()}/u/${profile.username}`} />
        <span className="text-[11px] text-terminal-muted">
          {fmtPct(pnlPct)} on {fmtMoney(STARTING_CASH, 0)} of play money
        </span>
      </div>
    </div>
  );
}

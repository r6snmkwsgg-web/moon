import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getEquityInputs,
  getFollowStats,
  getIsFollowing,
  getPublicProfile,
  getRecentTrades,
  getXpMap,
} from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { profileExists } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import { STARTING_CASH, APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { MARKET_TZ_LABEL } from "@/lib/market-time";
import EquityPanel from "@/components/EquityPanel";
import AllocationDonut from "@/components/AllocationDonut";
import FollowButton from "@/components/FollowButton";
import ShareButton from "@/components/ShareButton";
import TierBadge from "@/components/TierBadge";
import TradesList from "@/components/TradesList";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  // as on the ticker page: the last point at which a 404 status can be set
  if (!(await profileExists(username))) notFound();
  return {
    title: `@${username}`,
    description: `@${username}'s play-money portfolio on ${APP_NAME}. ${GUARDRAIL_TEXT}`,
  };
}

const MEDAL_COLORS = ["#fbbf24", "#b9c2cf", "#cd8a4b"];

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
  const data = await getPublicProfile(username);
  if (!data) notFound();

  const { profile, valuation, rank, playerCount } = data;
  const [viewer, xpMap, followStats, theirTrades, equity, following] = await Promise.all([
    getUser(),
    getXpMap(),
    getFollowStats(profile.id),
    getRecentTrades(8, undefined, [profile.id]),
    // the same inputs the owner's own page uses — a public curve is
    // reconstructed from prices and the trade log, not from daily dots
    getEquityInputs(profile.id),
    // getUser is deduplicated per request, so this rides the same lookup
    getUser().then((v) => (v ? getIsFollowing(v.id, profile.id) : false)),
  ]);
  const isMe = viewer?.id === profile.id;
  // one instant for every time-dependent number this render produces
  const renderedAt = Date.now();

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
            {" · "}
            <span className="num font-mono">{followStats.followers}</span>{" "}
            follower{followStats.followers === 1 ? "" : "s"} ·{" "}
            <span className="num font-mono">{followStats.following}</span>{" "}
            following
          </p>
          {!isMe && (
            <div className="mt-2">
              <FollowButton
                profileId={profile.id}
                username={profile.username ?? ""}
                following={following}
                signedIn={viewer !== null}
              />
            </div>
          )}
        </div>

      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-4">
          <EquityPanel
            cash={Number(valuation.profile.cash)}
            holdings={equity.holdings}
            trades={equity.trades}
            startedAt={equity.startedAt}
            startingCash={STARTING_CASH}
            renderedAt={renderedAt}
            rank={rank}
            playerCount={playerCount}
            own={isMe}
          />
        </div>

        <div className="space-y-4 xl:sticky xl:top-[68px]">
          <section className="panel">
            <div className="border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold !text-terminal-text">
                Standing
              </span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-terminal-line/60">
              <div className="px-3 py-2">
                <div className="microlabel">Rank</div>
                <div className="num mt-0.5 font-mono text-sm font-semibold">
                  <span
                    style={rank <= 3 ? { color: MEDAL_COLORS[rank - 1] } : undefined}
                  >
                    #{rank}
                  </span>{" "}
                  <span className="text-xs font-normal text-terminal-muted">
                    of {playerCount}
                  </span>
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="microlabel">Positions</div>
                <div className="num mt-0.5 font-mono text-sm font-semibold">
                  {valuation.positions.length}
                </div>
              </div>
            </div>
          </section>

          <AllocationDonut
            holdings={equity.holdings}
            cash={Number(valuation.profile.cash)}
            renderedAt={renderedAt}
          />

          <section className="panel">
            <h2 className="microlabel border-b border-terminal-line px-3 py-2">
              Recent trades
            </h2>
            <TradesList
              trades={theirTrades}
              showSymbol
              showTrader={false}
              signedIn={viewer !== null}
            />
          </section>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ShareButton url={`${siteUrl()}/u/${profile.username}`} />
        <span className="text-[11px] text-terminal-muted">
          {/* the PnL lives in the stat strip, on the live clock — repeating it
              here off the server's snapshot only ever disagreed with it */}
          Everyone starts with {fmtMoney(STARTING_CASH, 0)} of play money · the
          day resets midnight {MARKET_TZ_LABEL}
        </span>
      </div>
    </div>
  );
}

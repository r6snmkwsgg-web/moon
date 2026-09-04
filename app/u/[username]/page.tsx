import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getEquityInputs,
  getFollowStats,
  getIsFollowing,
  getProfileRow,
  getPublicProfile,
  getRecentTrades,
  getXpMap,
} from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { profileExists } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import { STARTING_CASH, APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { startingCashFor } from "@/lib/bot-roster";
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
  // the row is shared with the metadata lookup — already in hand — and the
  // viewer verifies locally, so neither is a round trip
  const row = await getProfileRow(username);
  if (!row) notFound();
  const viewer = await getUser();
  // the standing, the curve and the rest all go out together — the standing
  // used to go first, and the curve waited for it
  const [data, xpMap, followStats, theirTrades, equity, following] = await Promise.all([
    getPublicProfile(username),
    getXpMap(),
    getFollowStats(row.id),
    getRecentTrades(8, undefined, [row.id]),
    // the same inputs the owner's own page uses — a public curve is
    // reconstructed from prices and the trade log, not from daily dots
    getEquityInputs(row.id),
    viewer ? getIsFollowing(viewer.id, row.id) : Promise.resolve(false),
  ]);
  if (!data) notFound();
  const { profile, valuation, rank, playerCount } = data;
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

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-4">
          <EquityPanel
            dividends={equity.dividends}
            cash={Number(valuation.profile.cash)}
            holdings={equity.holdings}
            trades={equity.trades}
            startedAt={equity.startedAt}
            startingCash={startingCashFor(profile.username, STARTING_CASH, profile.persona)}
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
            <h2 className="microlabel flex items-center justify-between border-b border-terminal-line px-3 py-2">
              Recent trades
              <Link
                href={`/u/${profile.username}/trades`}
                className="font-mono text-[11px] font-normal normal-case tracking-normal text-terminal-accent hover:underline"
              >
                see all →
              </Link>
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

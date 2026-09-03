import { getFollowedIds, getHolders, getRecentTrades, getTickerPosts } from "@/lib/data";
import type { RevenueEvent } from "@/lib/pricing";
import HoldersTable from "@/components/HoldersTable";
import FloorTabs from "@/components/FloorTabs";
import { SkeletonBlock, SkeletonRows } from "@/components/Skeleton";

/**
 * The floor under the chart — who holds the name, the tape, the theses.
 * Rendered inside a Suspense boundary so the chart and the ticket do not
 * wait on it: its four round trips run while the rest of the page is
 * already on screen.
 */
export default async function Floor({
  tickerId,
  symbol,
  price,
  shares,
  viewerId,
  renderedAt,
  pricing,
}: {
  tickerId: string;
  symbol: string;
  price: number;
  shares: number;
  viewerId: string | null;
  renderedAt: number;
  pricing: {
    mrr: number;
    sentiment: number;
    multiple: number;
    shares: number;
    events: RevenueEvent[];
    drift: number;
  };
}) {
  const [recentTrades, posts, theses, holders, followedIds] = await Promise.all([
    // enough of the floor that a size filter still leaves something to read
    getRecentTrades(60, tickerId),
    getTickerPosts(tickerId, price, 40, viewerId),
    getRecentTrades(60, tickerId, undefined, true, viewerId),
    getHolders(tickerId, price, shares, 100, viewerId),
    viewerId ? getFollowedIds(viewerId) : Promise.resolve([] as string[]),
  ]);
  return (
    <div className="grid items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <HoldersTable
        rows={holders.rows}
        total={holders.total}
        symbol={symbol}
        followedIds={followedIds}
        viewerId={viewerId}
        signedIn={viewerId !== null}
        now={renderedAt}
        pricing={pricing}
      />
      <FloorTabs
        trades={recentTrades}
        posts={posts}
        theses={theses}
        symbol={symbol}
        signedIn={viewerId !== null}
        viewerId={viewerId}
      />
    </div>
  );
}

/** What the floor looks like while it loads. */
export function FloorSkeleton() {
  return (
    <div className="grid items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true">
      <div className="panel">
        <SkeletonBlock className="m-3 h-4 w-40" />
        <SkeletonRows rows={6} />
      </div>
      <div className="panel">
        <SkeletonBlock className="m-3 h-4 w-32" />
        <SkeletonRows rows={6} />
      </div>
    </div>
  );
}

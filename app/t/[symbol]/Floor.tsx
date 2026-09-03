import { getFloorCounts, getFollowedIds, getHolders, getRecentTrades, getTickerPosts } from "@/lib/data";
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
  min = null,
}: {
  tickerId: string;
  symbol: string;
  price: number;
  shares: number;
  viewerId: string | null;
  renderedAt: number;
  /** The size filter from the URL: prints and positions of at least this much. */
  min?: number | null;
  pricing: {
    mrr: number;
    sentiment: number;
    multiple: number;
    shares: number;
    events: RevenueEvent[];
    drift: number;
  };
}) {
  // With a size filter on, the rows are filtered in the query and the
  // window widens: a $10K print from three hours ago is exactly what the
  // filter is for, and it was the 110th most recent — outside the sixty.
  const filtered = min !== null && min > 0;
  // the newest page of each; the floor pages the rest in as you scroll
  const [recentTrades, allPosts, theses, holders, followedIds, counts] = await Promise.all([
    getRecentTrades(filtered ? 200 : 60, tickerId, undefined, false, viewerId, min),
    getTickerPosts(tickerId, price, filtered ? 120 : 60, viewerId),
    getRecentTrades(filtered ? 200 : 60, tickerId, undefined, true, viewerId, min),
    getHolders(tickerId, price, shares, 100, viewerId),
    viewerId ? getFollowedIds(viewerId) : Promise.resolve([] as string[]),
    getFloorCounts(tickerId),
  ]);
  const posts = filtered ? allPosts.filter((p) => p.positionValue >= (min ?? 0)) : allPosts;
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
        tickerId={tickerId}
        price={price}
        counts={counts}
        signedIn={viewerId !== null}
        viewerId={viewerId}
        serverMin={min}
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

import { SkeletonBlock, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading leaderboard">
      <div className="flex items-end justify-between">
        <SkeletonBlock className="h-6 w-40" />
        <SkeletonBlock className="h-7 w-40" />
      </div>
      <div className="panel">
        <SkeletonRows rows={10} />
      </div>
    </div>
  );
}

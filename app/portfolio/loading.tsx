import { SkeletonBlock, SkeletonChart, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading portfolio">
      <SkeletonBlock className="h-6 w-36" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-14" />
        ))}
      </div>
      <div className="panel">
        <SkeletonRows rows={5} />
      </div>
      <SkeletonChart height="h-[200px]" />
    </div>
  );
}

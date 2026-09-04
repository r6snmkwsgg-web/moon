import { SkeletonBlock, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the feed">
      <SkeletonBlock className="h-6 w-32" />
      <SkeletonBlock className="h-8 w-72" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-14 w-full" />
          ))}
        </div>
        <div className="panel self-start">
          <SkeletonRows rows={5} />
        </div>
      </div>
    </div>
  );
}

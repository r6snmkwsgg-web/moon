import { SkeletonBlock, SkeletonChart, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the ticker">
      <div className="flex items-start gap-3">
        <SkeletonBlock className="h-11 w-11" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-3.5 w-64" />
        </div>
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-24" />
          <SkeletonBlock className="ml-auto h-4 w-14" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-14" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <SkeletonChart height="h-[300px]" />
        <div className="space-y-3">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-28" />
        </div>
      </div>
      <div className="panel">
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}

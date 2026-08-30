import { SkeletonBlock, SkeletonChart, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading profile">
      <div className="flex items-start gap-3">
        <SkeletonBlock className="h-11 w-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-5 w-48" />
          <SkeletonBlock className="h-3.5 w-56" />
        </div>
        <SkeletonBlock className="h-7 w-28" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-14" />
        ))}
      </div>
      <SkeletonChart height="h-[200px]" />
      <div className="panel">
        <SkeletonRows rows={4} />
      </div>
    </div>
  );
}

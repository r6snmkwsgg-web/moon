import { SkeletonBoard, SkeletonBlock } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading the board">
      <SkeletonBlock className="h-11 w-full" />
      <SkeletonBoard />
    </div>
  );
}

/** Shimmer placeholders — the shapes of the page before the data lands. */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-0" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-terminal-line/40 px-3 py-2.5 last:border-0"
        >
          <div className="skeleton h-7 w-7" />
          <div className="space-y-1.5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-2.5 w-36" />
          </div>
          <div className="skeleton ml-auto h-3 w-16" />
          <div className="skeleton hidden h-3 w-12 sm:block" />
          <div className="skeleton hidden h-6 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonBoard() {
  return (
    <div className="panel">
      <div className="flex items-center gap-3 border-b border-terminal-line px-3 py-3">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-3 w-32" />
      </div>
      <SkeletonRows rows={10} />
    </div>
  );
}

export function SkeletonChart({ height = "h-56" }: { height?: string }) {
  return (
    <div className={`panel flex ${height} items-end gap-1 overflow-hidden p-4`}>
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={i}
          className="skeleton w-full"
          style={{ height: `${18 + ((i * 37) % 60)}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-10 w-full" />
      <SkeletonBoard />
    </div>
  );
}

"use client";

/** Route-level error boundary — trading-halt styling, one retry button. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div className="microlabel rounded border border-terminal-down/40 bg-terminal-down/10 px-3 py-1 !text-terminal-down">
        Trading halted
      </div>
      <h1 className="text-lg font-bold">Something broke on our side.</h1>
      <p className="text-sm text-terminal-muted">
        Your play money is fine — this page just failed to load.
        {error.digest && (
          <span className="mt-1 block font-mono text-[11px] text-terminal-muted/70">
            ref {error.digest}
          </span>
        )}
      </p>
      <button onClick={reset} className="btn-ghost text-sm" type="button">
        Try again
      </button>
    </div>
  );
}

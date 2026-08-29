import { GUARDRAIL_TEXT } from "@/lib/config";

/** Guardrail footer — rendered on every page via the root layout. */
export default function Footer() {
  return (
    <footer className="mt-12 border-t border-terminal-line bg-terminal-panel/40 px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-2 text-xs text-terminal-muted">
        <p className="font-mono font-semibold text-terminal-amber/90">
          ⚠ {GUARDRAIL_TEXT}
        </p>
        <p>
          This is a game. Tickers list only startups whose founders already
          share MRR publicly, and any founder can request delisting from their
          ticker page — delisting removes all of the ticker&apos;s data.
        </p>
      </div>
    </footer>
  );
}

import Link from "next/link";
import { GUARDRAIL_TEXT } from "@/lib/config";

/** Guardrail footer — rendered on every page via the root layout. */
export default function Footer() {
  return (
    <footer className="mt-12 border-t border-terminal-line bg-terminal-panel/40 px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-3 text-xs text-terminal-muted">
        <nav className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
          <Link href="/how" className="hover:text-terminal-text">
            how pricing works
          </Link>
          <Link href="/list" className="hover:text-terminal-text">
            list your startup
          </Link>
          <Link href="/tape" className="hover:text-terminal-text">
            the tape
          </Link>
          <Link href="/recap" className="hover:text-terminal-text">
            weekly recap
          </Link>
          <Link href="/leaderboard" className="hover:text-terminal-text">
            leaderboard
          </Link>
        </nav>
        <p className="font-mono font-semibold text-terminal-amber/90">
          ⚠ {GUARDRAIL_TEXT}
        </p>
        <p>
          This is a game. Verified listings connect a read-only Stripe key
          that can see revenue totals and nothing else; founders can
          disconnect it or request delisting at any time — delisting removes
          all of the ticker&apos;s data.
        </p>
      </div>
    </footer>
  );
}

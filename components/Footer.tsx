import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { GUARDRAIL_TEXT } from "@/lib/config";
import Wordmark from "@/components/Wordmark";

/** Guardrail footer — rendered on every page via the root layout. */
export default function Footer() {
  return (
    <footer className="mt-12 border-t border-terminal-line bg-terminal-panel/40 py-6 pb-24 sm:pb-6">
      <div className="shell space-y-4 text-xs text-terminal-muted">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Wordmark compact />
          <nav className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <Link href="/how" className="hover:text-terminal-text">
              how the market works
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
        </div>
        <p className="flex items-start gap-1.5 font-mono font-semibold text-terminal-amber/90">
          <TriangleAlert size={13} className="mt-px shrink-0" />
          {GUARDRAIL_TEXT}
        </p>
        <p>
          This is a game. Verified listings connect a read-only Stripe key
          that can see revenue totals and nothing else; founders can
          disconnect it or request delisting at any time — delisting removes
          all of the ticker&apos;s data.
        </p>
        {/* Which build this actually is. Baked in at build time by Vercel, so
            "am I on the new version?" stops being an argument and becomes a
            thing anyone can read off the bottom of any page or screenshot. */}
        <p className="font-mono text-[10px] opacity-60">
          build{" "}
          {(process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7)}
          {process.env.VERCEL_GIT_COMMIT_MESSAGE
            ? ` · ${process.env.VERCEL_GIT_COMMIT_MESSAGE.split("\n")[0].slice(0, 60)}`
            : ""}
        </p>
      </div>
    </footer>
  );
}

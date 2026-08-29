import Link from "next/link";
import type { EarningsEvent } from "@/lib/data";
import { changeFraction } from "@/lib/pricing";
import { fmtCompact, fmtPct } from "@/lib/format";

const FRESH_MS = 48 * 3600_000;

/**
 * The wire: a slim broadcast-style strip that fires only on real news —
 * the freshest MRR report of the last 48h. Renders nothing on quiet days.
 */
export default function WireBanner({ events }: { events: EarningsEvent[] }) {
  const fresh = events.find(
    (e) => Date.now() - new Date(e.at).getTime() < FRESH_MS
  );
  if (!fresh) return null;

  const mom =
    fresh.prevMrr && fresh.prevMrr > 0
      ? changeFraction(fresh.prevMrr, fresh.mrr)
      : null;
  const beat = mom !== null && mom >= 0;

  return (
    <Link
      href={`/t/${fresh.symbol}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-terminal-amber/35 bg-terminal-amber/[0.07] px-4 py-2.5 hover:bg-terminal-amber/[0.12]"
    >
      <span className="rounded bg-terminal-amber px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-black">
        ⚡ Earnings
      </span>
      <span className="min-w-0 text-sm">
        <b className="font-mono">${fresh.symbol}</b> reported{" "}
        <b className="num font-mono text-terminal-amber">
          {fmtCompact(fresh.mrr)}
        </b>{" "}
        MRR
        {mom !== null && (
          <>
            {" "}
            —{" "}
            <b
              className={`num font-mono ${beat ? "text-terminal-up" : "text-terminal-down"}`}
            >
              {fmtPct(mom)} MoM {beat ? "beat" : "miss"}
            </b>
          </>
        )}
        {fresh.source === "stripe" && (
          <span className="text-terminal-muted"> · Stripe-verified</span>
        )}
      </span>
      <span className="ml-auto whitespace-nowrap font-mono text-[11px] font-semibold text-terminal-amber">
        the anchor just moved →
      </span>
    </Link>
  );
}

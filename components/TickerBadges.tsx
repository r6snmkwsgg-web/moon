import { BadgeCheck, Zap } from "lucide-react";
import type { Ticker } from "@/lib/types";

const NEW_WINDOW_MS = 7 * 86400_000;

/** The trust ladder + freshness, rendered as compact chips. */
export default function TickerBadges({
  ticker,
  compact = false,
}: {
  ticker: Ticker;
  compact?: boolean;
}) {
  const isNew =
    Date.now() - new Date(ticker.listed_at).getTime() < NEW_WINDOW_MS;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {ticker.stripe_verified && (
        <span
          title="MRR computed via a read-only Stripe connection, refreshed monthly"
          className="inline-flex items-center gap-0.5 rounded bg-terminal-amber/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-terminal-amber"
        >
          <Zap size={10} fill="currentColor" strokeWidth={0} />
          {compact ? "" : "verified"}
        </span>
      )}
      {ticker.handle_verified && (
        <span
          title="Founder handle verified via a public post"
          className="inline-flex items-center gap-0.5 rounded bg-terminal-accent/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-terminal-accent"
        >
          <BadgeCheck size={10} />
          {compact ? "" : "founder"}
        </span>
      )}
      {!ticker.stripe_verified && !ticker.handle_verified && ticker.claimed && (
        <span
          title="Claimed by the founder"
          className="rounded bg-terminal-accent/10 px-1 py-0.5 font-mono text-[10px] text-terminal-accent"
        >
          claimed
        </span>
      )}
      {ticker.fixture && (
        <span
          title="Demo data — not a real listing"
          className="rounded bg-terminal-line/60 px-1 py-0.5 font-mono text-[10px] text-terminal-muted"
        >
          demo
        </span>
      )}
      {isNew && !ticker.fixture && (
        <span
          title="Listed this week"
          className="rounded bg-terminal-up/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-terminal-up"
        >
          NEW
        </span>
      )}
    </span>
  );
}

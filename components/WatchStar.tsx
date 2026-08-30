"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toggleWatch } from "@/app/t/[symbol]/actions";

/** Watchlist star. Watchers get in-app alerts on big moves + MRR reports. */
export default function WatchStar({
  tickerId,
  symbol,
  watching,
  signedIn,
}: {
  tickerId: string;
  symbol: string;
  watching: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!signedIn) {
      router.push(`/login?next=/t/${symbol}`);
      return;
    }
    startTransition(async () => {
      await toggleWatch(tickerId, symbol);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={watching ? "On your watchlist — alerts on" : "Watch: get alerts on big moves + MRR reports"}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs transition-colors disabled:opacity-50 ${
        watching
          ? "border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent"
          : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
      }`}
    >
      <Star
        size={11}
        fill={watching ? "currentColor" : "none"}
        className="shrink-0"
      />
      {watching ? "watching" : "watch"}
    </button>
  );
}

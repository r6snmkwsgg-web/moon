"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
      className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors disabled:opacity-50 ${
        watching
          ? "border-terminal-amber/60 bg-terminal-amber/10 text-terminal-amber"
          : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
      }`}
    >
      {watching ? "★ watching" : "☆ watch"}
    </button>
  );
}

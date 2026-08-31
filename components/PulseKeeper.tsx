"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a ticker live while someone is looking at it — both its revenue and
 * the market's own heartbeat.
 *
 * The five-minute beat normally comes from a scheduler; this is the fallback
 * that makes a watched page work without one. It matters more than it used
 * to: the drift walk is a record now, not a formula, so if nothing advances
 * it the tape genuinely stops. The server ignores anything inside its own
 * five-minute window, so this cannot cost more than one Stripe read and one
 * tick per ticker per interval no matter how many tabs are open.
 */
export default function PulseKeeper({
  symbol,
  everyMs = 5 * 60_000,
}: {
  symbol: string;
  everyMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const beat = async () => {
      try {
        const res = await fetch("/api/pulse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        const json = (await res.json()) as {
          changed?: number;
          advanced?: number;
        };
        // re-render when revenue moved OR the walk took a step — the price
        // on screen is stale either way
        if (alive && (json.changed || json.advanced)) router.refresh();
      } catch {
        // offline or rate-limited — the next beat tries again
      }
    };
    beat();
    const id = setInterval(() => {
      if (!document.hidden) beat();
    }, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, everyMs, router]);

  return null;
}

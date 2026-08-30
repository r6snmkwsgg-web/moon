"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps one ticker's revenue live while someone is looking at it.
 *
 * The five-minute Stripe poll normally comes from a scheduler; this is the
 * fallback that makes a watched page work without one. The server ignores
 * anything inside its own five-minute window, so this can't cost more than
 * one Stripe read per ticker per interval no matter how many tabs are open.
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
        const json = (await res.json()) as { changed?: number };
        // only re-render when revenue actually moved
        if (alive && json.changed) router.refresh();
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

"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 30_000;

/**
 * The market breathes: re-fetch server data every half minute while the
 * tab is visible, so the tape, the holders and the theses catch up (the
 * prices themselves tick on the client every second and do not need this).
 * A refresh re-renders the whole route on the server, and a click that
 * lands while one is in flight waits behind it — so one at a time, never
 * stacked, and the click's own transition goes first. Paused in hidden tabs.
 */
export default function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    const tick = () => {
      if (document.hidden || pendingRef.current) return;
      startTransition(() => router.refresh());
    };
    const id = setInterval(tick, INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  return null;
}

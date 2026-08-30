"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 15_000;

/**
 * The market breathes: re-fetch server data every 15s while the tab is
 * visible. Server components re-render with fresh prices; LivePrice cells
 * flash where a number actually moved. Paused in hidden tabs.
 */
export default function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}

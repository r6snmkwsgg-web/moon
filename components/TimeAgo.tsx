"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp that stays true.
 *
 * Six copies of a `timeAgo(iso)` helper used to read the clock during render.
 * Two problems with that. On a client component the server writes "59s ago"
 * and the browser hydrates "1m ago" a heartbeat later, and React throws out
 * the whole tree over the mismatch — which is exactly what the ticker page
 * was doing on every load. And on the pages where it did not throw, the
 * stamp was frozen: a tape row said "3s ago" for as long as you left the
 * page open.
 *
 * One clock ticks for the whole page, every stamp subscribes to it, and the
 * first paint is allowed to disagree with the server for the one frame it
 * takes the effect to run.
 */

const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  if (timer === null) {
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      for (const f of subscribers) f();
    }, 1_000);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** "5s", "3m", "2h", "4d" — the market's own shorthand. */
export function ago(ms: number): string {
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function TimeAgo({
  at,
  suffix = "",
  className,
  title,
}: {
  /** An ISO string or an epoch milliseconds value. */
  at: string | number;
  /** " ago", usually — or nothing where the column header already says it. */
  suffix?: string;
  className?: string;
  title?: string;
}) {
  const t = typeof at === "number" ? at : Date.parse(at);
  const [, bump] = useState(0);
  useEffect(() => {
    bump((n) => n + 1); // correct the server's stamp on the first frame
    return subscribe(() => bump((n) => n + 1));
  }, []);
  if (!Number.isFinite(t)) return null;
  return (
    <span className={className} title={title} suppressHydrationWarning>
      {ago(Date.now() - t)}
      {suffix}
    </span>
  );
}

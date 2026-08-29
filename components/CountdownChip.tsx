"use client";

import { useEffect, useState } from "react";

function fmt(msLeft: number): string {
  if (msLeft <= 0) return "any moment";
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Live earnings countdown. Renders a static placeholder until mounted (no
 * hydration mismatch), then ticks every second.
 */
export default function CountdownChip({
  target,
  prefix = "reports in",
}: {
  target: string; // ISO datetime
  prefix?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const msLeft = now === null ? null : new Date(target).getTime() - now;

  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-terminal-amber/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-terminal-amber">
      ⏱ {prefix}{" "}
      <span className="num">{msLeft === null ? "…" : fmt(msLeft)}</span>
    </span>
  );
}

"use client";

import { useState, type ReactNode } from "react";

/** A panel with tabs along its top edge; the panes are whatever you hand it. */
export default function Tabs({
  tabs,
  initial = 0,
  className = "",
}: {
  tabs: { label: ReactNode; pane: ReactNode; key: string }[];
  initial?: number;
  className?: string;
}) {
  const [active, setActive] = useState(initial);
  return (
    <section className={`panel ${className}`}>
      <div className="flex items-center gap-1 border-b border-terminal-line px-2 pt-1">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(i)}
            className={`-mb-px border-b-2 px-2 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
              i === active
                ? "border-terminal-accent text-terminal-text"
                : "border-transparent text-terminal-muted hover:text-terminal-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tabs[active]?.pane}</div>
    </section>
  );
}

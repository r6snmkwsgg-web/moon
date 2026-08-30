"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const KEY = (id: string) => `sx.dismissed.${id}`;

/**
 * A banner you can close. The id is content-scoped (a symbol, a month), so
 * dismissing today's earnings strip doesn't hide tomorrow's; it sticks in
 * this browser only — no account state, nothing to sync.
 */
export default function Dismissible({
  id,
  label = "Dismiss",
  children,
}: {
  id: string;
  label?: string;
  children: React.ReactNode;
}) {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY(id))) setGone(true);
    } catch {
      // private mode / storage disabled — the banner just stays
    }
  }, [id]);

  if (gone) return null;

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          setGone(true);
          try {
            localStorage.setItem(KEY(id), "1");
          } catch {
            // nothing to persist to — it reappears next load
          }
        }}
        className="absolute right-1.5 top-1.5 rounded p-1 text-terminal-muted transition-colors hover:bg-terminal-raise hover:text-terminal-text"
      >
        <X size={13} />
      </button>
    </div>
  );
}

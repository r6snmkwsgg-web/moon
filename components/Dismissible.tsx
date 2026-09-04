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
  // `undefined` until the effect has read storage. Starting at `false`
  // painted the banner you had already dismissed on every single visit,
  // for the length of a round trip, before hiding it again.
  const [gone, setGone] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    try {
      setGone(Boolean(localStorage.getItem(KEY(id))));
    } catch {
      setGone(false); // private mode / storage disabled — the banner stays
    }
  }, [id]);

  if (gone !== false) return null;

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

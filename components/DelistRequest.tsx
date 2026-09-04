"use client";

import { useState } from "react";

/**
 * Delisting removes the ticker and every trade, thesis and position on it.
 * That was one unguarded click on a link-styled button — no dialog, no undo.
 * Now the founder has to say the symbol out loud.
 */
export default function DelistRequest({
  action,
  tickerId,
  symbol,
}: {
  action: (formData: FormData) => void | Promise<void>;
  tickerId: string;
  symbol: string;
}) {
  const [arming, setArming] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toUpperCase() === symbol.toUpperCase();

  if (!arming) {
    return (
      <button
        type="button"
        onClick={() => setArming(true)}
        className="text-xs text-terminal-down underline-offset-2 hover:underline"
      >
        Request delisting (removes this ticker and all its data)
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="ticker_id" value={tickerId} />
      <p className="text-xs text-terminal-down">
        This removes ${symbol} and every trade, thesis and position on it.
        Holders are refunded, and it cannot be undone. Type{" "}
        <span className="font-mono font-bold">{symbol}</span> to confirm.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={`Type ${symbol} to confirm delisting`}
          placeholder={symbol}
          className="input w-28 font-mono text-xs uppercase"
        />
        <button
          type="submit"
          disabled={!matches}
          className="rounded-md border border-terminal-down/50 px-2 py-1 font-mono text-xs text-terminal-down transition-colors hover:bg-terminal-down/10 disabled:opacity-40"
        >
          Delist ${symbol}
        </button>
        <button
          type="button"
          onClick={() => {
            setArming(false);
            setTyped("");
          }}
          className="font-mono text-xs text-terminal-muted hover:text-terminal-text"
        >
          cancel
        </button>
      </div>
    </form>
  );
}

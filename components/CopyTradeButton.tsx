"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";

/**
 * One-tap copy trade: replays someone's print with your own play money —
 * same side, same size, filled at the CURRENT price by the same engine.
 * The copy is auto-annotated so the tape shows the chain.
 */
export default function CopyTradeButton({
  symbol,
  side,
  shares,
  traderUsername,
  signedIn,
}: {
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  traderUsername: string | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  async function copy() {
    if (!signedIn) {
      router.push(`/login?next=/tape`);
      return;
    }
    setState("pending");
    setMessage(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          side,
          shares,
          note: traderUsername ? `copied @${traderUsername}` : "copied a print",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setState("error");
        setMessage(json.error ?? "Copy failed.");
        setTimeout(() => setState("idle"), 2500);
      } else {
        setState("done");
        router.refresh();
        setTimeout(() => setState("idle"), 2000);
      }
    } catch {
      setState("error");
      setMessage("Network error.");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={copy}
        disabled={state === "pending"}
        title={`Copy: ${side} ${shares.toLocaleString("en-US")} $${symbol} at the current price`}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors disabled:opacity-50 ${
          state === "done"
            ? "border-terminal-up/50 bg-terminal-up/10 text-terminal-up"
            : "border-terminal-line text-terminal-muted hover:border-terminal-accent/60 hover:text-terminal-accent"
        }`}
      >
        {state === "done" ? <Check size={10} /> : <Copy size={10} />}
        {state === "pending" ? "…" : state === "done" ? "copied" : "copy"}
      </button>
      {state === "error" && message && (
        <span className="font-mono text-[10px] text-terminal-down">
          {message}
        </span>
      )}
    </span>
  );
}

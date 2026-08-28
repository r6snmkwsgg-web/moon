"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtMoney, fmtPrice } from "@/lib/format";

/**
 * Buy/sell panel. The server is the source of truth for price — this panel
 * shows an estimate and the /api/trade route re-computes at execution time.
 */
export default function TradePanel({
  symbol,
  price,
  signedIn,
  cash,
  sharesHeld,
}: {
  symbol: string;
  price: number;
  signedIn: boolean;
  cash: number | null;
  sharesHeld: number;
}) {
  const router = useRouter();
  const [shares, setShares] = useState(10);
  const [pending, setPending] = useState<"buy" | "sell" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className="panel p-4 text-sm">
        <p className="text-terminal-muted">
          Sign in to trade <span className="font-mono">${symbol}</span> with
          $10,000 of play money.
        </p>
        <Link href={`/login?next=/t/${symbol}`} className="btn-ghost mt-3">
          Sign in →
        </Link>
      </div>
    );
  }

  const estimate = shares * price;

  async function trade(side: "buy" | "sell") {
    setPending(side);
    setMessage(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side, shares }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Trade failed.");
      } else {
        setMessage(
          `${side === "buy" ? "Bought" : "Sold"} ${shares} × $${symbol} @ ${fmtPrice(json.price)}`
        );
        router.refresh();
      }
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-baseline justify-between text-xs text-terminal-muted">
        <span>
          Cash:{" "}
          <span className="num font-mono text-terminal-text">
            {cash !== null ? fmtMoney(cash) : "—"}
          </span>
        </span>
        <span>
          Held:{" "}
          <span className="num font-mono text-terminal-text">{sharesHeld}</span>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          step={1}
          value={shares}
          onChange={(e) =>
            setShares(Math.max(1, Math.floor(Number(e.target.value) || 1)))
          }
          className="input num w-24 font-mono"
          aria-label="Shares"
        />
        <span className="text-xs text-terminal-muted">
          shares ≈{" "}
          <span className="num font-mono text-terminal-text">
            {fmtMoney(estimate)}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => trade("buy")}
          disabled={pending !== null}
          className="btn-buy"
        >
          {pending === "buy" ? "…" : "Buy"}
        </button>
        <button
          onClick={() => trade("sell")}
          disabled={pending !== null || sharesHeld < 1}
          className="btn-sell"
        >
          {pending === "sell" ? "…" : "Sell"}
        </button>
      </div>

      {message && (
        <p className="font-mono text-xs text-terminal-muted">{message}</p>
      )}
      <p className="text-[11px] leading-snug text-terminal-muted/70">
        Play money only. Buys push sentiment up, sells push it down (±40% cap,
        decays daily) — MRR sets the anchor.
      </p>
    </div>
  );
}

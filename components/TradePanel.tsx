"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { executionFill, SHARES_OUTSTANDING } from "@/lib/pricing";
import { fmtMoney, fmtPrice } from "@/lib/format";

/**
 * Buy/sell panel. Estimates use the same executionFill the server fills
 * with, so the quote already includes slippage: big buys cost more per
 * share, big sells return less. The server re-computes at execution time.
 */
export default function TradePanel({
  symbol,
  price,
  mrr,
  sentiment,
  signedIn,
  cash,
  sharesHeld,
}: {
  symbol: string;
  price: number;
  mrr: number;
  sentiment: number;
  signedIn: boolean;
  cash: number | null;
  sharesHeld: number;
}) {
  const router = useRouter();
  // stored as text so the field can be cleared and retyped freely —
  // forcing it back to a number on every keystroke is what makes inputs
  // "impossible to edit"
  const [sharesText, setSharesText] = useState("10");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"buy" | "sell" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  const shares = Math.floor(Number(sharesText) || 0);

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

  const buyEst = shares >= 1 ? executionFill(mrr, sentiment, "buy", shares) : null;
  const sellEst = shares >= 1 ? executionFill(mrr, sentiment, "sell", shares) : null;
  const buyImpact =
    buyEst && price > 0 ? buyEst.avgPrice / price - 1 : 0;
  const unitBuy = executionFill(mrr, sentiment, "buy", 1);
  const unitSell = executionFill(mrr, sentiment, "sell", 1);

  // the biggest buy the cash covers, walking the same fill curve
  function maxAffordable(): number {
    if (cash === null || cash <= 0 || mrr <= 0) return 0;
    let lo = 0;
    let hi = SHARES_OUTSTANDING;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (executionFill(mrr, sentiment, "buy", mid).total <= cash) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  async function trade(side: "buy" | "sell") {
    // selling clamps to what's actually held — matches the button label
    const qty = side === "sell" ? Math.min(shares, sharesHeld) : shares;
    if (qty < 1) return;
    setPending(side);
    setMessage(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side, shares: qty, note: note.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Trade failed.");
      } else {
        setMessage(
          `${side === "buy" ? "Bought" : "Sold"} ${qty.toLocaleString("en-US")} × $${symbol} @ avg ${fmtPrice(json.price)}`
        );
        setNote("");
        setFilled(true);
        setTimeout(() => setFilled(false), 1200);
        router.refresh();
      }
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className={`panel space-y-3 p-4 transition-shadow duration-500 ${
        filled ? "shadow-[0_0_0_1.5px_rgba(34,197,94,0.6)]" : ""
      }`}
    >
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

      {/* the spread — straight out of the fill curve, no market-maker theater */}
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-terminal-line font-mono text-xs">
        <div className="border-r border-terminal-line bg-terminal-up/[0.06] px-2.5 py-1.5">
          <div className="microlabel !tracking-[0.12em]">Buy at</div>
          <div className="num mt-0.5 font-semibold text-terminal-up">
            {fmtPrice(unitBuy.avgPrice)}
          </div>
        </div>
        <div className="bg-terminal-down/[0.06] px-2.5 py-1.5 text-right">
          <div className="microlabel !tracking-[0.12em]">Sell at</div>
          <div className="num mt-0.5 font-semibold text-terminal-down">
            {fmtPrice(unitSell.avgPrice)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={sharesText}
          onChange={(e) =>
            setSharesText(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
          }
          placeholder="shares"
          className="input num w-24 font-mono"
          aria-label="Shares"
        />
        <span className="text-xs leading-snug text-terminal-muted">
          <span className="num block font-mono">
            buy ≈ {buyEst ? fmtMoney(buyEst.total) : "—"}
          </span>
          <span className="num block font-mono">
            sell ≈ {sellEst ? fmtMoney(sellEst.total) : "—"}
          </span>
        </span>
      </div>

      {/* size chips — nobody should be arrow-clicking share counts */}
      <div className="flex flex-wrap gap-1.5">
        {[10, 100, 1000].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setSharesText(String(n))}
            className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
              shares === n
                ? "border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
            }`}
          >
            {n >= 1000 ? `${n / 1000}k` : n}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const max = maxAffordable();
            if (max > 0) setSharesText(String(max));
          }}
          title="The most your cash covers, slippage included"
          className="rounded border border-terminal-line px-2 py-0.5 font-mono text-[11px] text-terminal-muted transition-colors hover:border-terminal-up/60 hover:text-terminal-up"
        >
          max buy
        </button>
        {sharesHeld > 0 && (
          <button
            type="button"
            onClick={() => setSharesText(String(sharesHeld))}
            title="Everything you hold"
            className="rounded border border-terminal-line px-2 py-0.5 font-mono text-[11px] text-terminal-muted transition-colors hover:border-terminal-down/60 hover:text-terminal-down"
          >
            all {sharesHeld.toLocaleString("en-US")}
          </button>
        )}
      </div>

      {buyEst && buyImpact > 0.005 && (
        <p className="font-mono text-[11px] text-terminal-muted">
          size impact: this order moves your avg fill{" "}
          {(buyImpact * 100).toFixed(1)}% above the quote
        </p>
      )}

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={140}
        placeholder="your thesis (optional — goes on the record)"
        className="input text-xs"
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => trade("buy")}
          disabled={pending !== null || shares < 1}
          className="btn-buy"
        >
          {pending === "buy"
            ? "…"
            : shares >= 1
              ? `Buy ${shares.toLocaleString("en-US")}`
              : "Buy"}
        </button>
        <button
          onClick={() => trade("sell")}
          disabled={pending !== null || sharesHeld < 1 || shares < 1}
          className="btn-sell"
        >
          {pending === "sell"
            ? "…"
            : shares >= 1 && sharesHeld >= 1
              ? `Sell ${Math.min(shares, sharesHeld).toLocaleString("en-US")}`
              : "Sell"}
        </button>
      </div>

      {message && (
        <p className="flex items-center gap-1 font-mono text-xs text-terminal-muted">
          {filled && <Check size={12} className="text-terminal-up" />}
          {message}
        </p>
      )}
      <p className="text-[11px] leading-snug text-terminal-muted/70">
        Play money only. Orders fill along the hype curve (±40% cap, decays
        daily) — MRR is the anchor, and pumping your own bag round-trips to
        zero.
      </p>
    </div>
  );
}

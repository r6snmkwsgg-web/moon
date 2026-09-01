"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import type { RevenueEvent } from "@/lib/pricing";
import {
  executionFillAt,
  MAX_POSITION_FRACTION,
  positionLimit,
  settledPrice,
  SHARES_OUTSTANDING,
} from "@/lib/pricing";
import { fmtMoney, fmtPct, fmtPrice } from "@/lib/format";

/** Signed money — on a P&L line the sign is the whole point. */
function fmtSigned(value: number): string {
  const abs = fmtMoney(Math.abs(value));
  if (value > 0.005) return `+${abs}`;
  if (value < -0.005) return `−${abs}`;
  return abs;
}

function tone(value: number): string {
  if (value > 0.005) return "text-terminal-up";
  if (value < -0.005) return "text-terminal-down";
  return "text-terminal-muted";
}

/**
 * Buy/sell panel. Estimates use the same executionFillAt the server fills
 * with — anchor × hype × weather × news, walked share by share along the hype
 * curve — so the quote already includes slippage, and BUY AT is a price you
 * actually get. The server re-computes at execution time.
 *
 * Above the order ticket sits the book: cash, and if you hold the name, the
 * position marked to the settled price with its P&L against your average
 * cost. Same price function as the ticket, same instant, so the two can
 * never disagree.
 */
export default function TradePanel({
  symbol,
  mrr,
  sentiment,
  multiple,
  outstanding = SHARES_OUTSTANDING,
  floatHeld = 0,
  events = [],
  drift = 0,
  dayBasePrice = 0,
  quotedAt,
  signedIn,
  cash,
  sharesHeld,
  avgCost = 0,
  realized = 0,
}: {
  symbol: string;
  /** The server's price at render; unused for maths, kept for callers. */
  price?: number;
  mrr: number;
  sentiment: number;
  multiple: number;
  /** This ticker's float, set at IPO. */
  outstanding?: number;
  /** Shares of it already held across every account. */
  floatHeld?: number;
  /** Live Stripe revenue changes — quotes and fills price off these too. */
  events?: RevenueEvent[];
  /** The recorded weather the fill prices off. */
  drift?: number;
  /** Yesterday's close — what "today" on the position is measured from. */
  dayBasePrice?: number;
  /** Server's clock at render — first paint matches, then we go live. */
  quotedAt: number;
  signedIn: boolean;
  cash: number | null;
  sharesHeld: number;
  /** Average cost of the shares held, from the ledger. */
  avgCost?: number;
  /** Booked P&L on this name from shares already sold. */
  realized?: number;
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
  // A fill is instant; the server re-render behind it is not (~2.5s). Without
  // this the panel still reads "Cash $10,000 · Held 0" after a successful buy,
  // which is exactly what makes people click Buy a second time.
  const [fill, setFill] = useState<{
    cash: number;
    held: number;
    avg: number;
    realized: number;
  } | null>(null);
  // a short lock after a fill: the accidental second click is how one order
  // became two identical prints
  const [cooling, setCooling] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    // server numbers have landed — drop the optimistic ones
    setFill(null);
  }, [cash, sharesHeld, avgCost, realized]);
  const shownCash = fill ? fill.cash : cash;
  const shownHeld = fill ? fill.held : sharesHeld;
  const shownAvg = fill ? fill.avg : avgCost;
  const shownRealized = fill ? fill.realized : realized;
  // the quote re-prices every second, like the chart — a stale buy price is
  // the fastest way to make a market feel fake
  const [nowT, setNowT] = useState<number | null>(null);
  useEffect(() => {
    setNowT(Date.now());
    const id = setInterval(() => {
      if (!document.hidden) setNowT(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

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

  const quoteT = nowT ?? quotedAt;
  const est = (side: "buy" | "sell", n: number) =>
    executionFillAt(
      symbol,
      mrr,
      sentiment,
      side,
      n,
      quoteT,
      multiple,
      outstanding,
      events,
      drift
    );
  // the mark: the settled price this instant — what the ticket is built on
  const mark = settledPrice(
    mrr,
    sentiment,
    quoteT,
    multiple,
    outstanding,
    events,
    drift
  );
  const buyEst = shares >= 1 ? est("buy", shares) : null;
  const sellEst = shares >= 1 ? est("sell", shares) : null;
  const buyImpact = buyEst && mark > 0 ? buyEst.avgPrice / mark - 1 : 0;
  // quote the spread for the SIZE being traded — a 1-share spread rounds to
  // the same cent on both sides and reads as broken
  const quoteSize = Math.max(1, shares);
  const unitBuy = est("buy", quoteSize);
  const unitSell = est("sell", quoteSize);

  // Two limits, both enforced server-side too: the float is finite, and no
  // single account may hold more than MAX_POSITION_FRACTION of it.
  const limit = positionLimit(outstanding);
  const roomInLimit = Math.max(0, limit - shownHeld);
  const roomInFloat = Math.max(0, outstanding - floatHeld);
  const buyCeiling = Math.min(roomInLimit, roomInFloat);
  // what the buttons will actually send — the label says the same number
  const buyQty = Math.min(shares, buyCeiling);
  const sellQty = Math.min(shares, shownHeld);

  // the position, marked
  const value = shownHeld * mark;
  const cost = shownHeld * shownAvg;
  const unrealized = value - cost;
  const unrealizedPct = cost > 0 ? unrealized / cost : 0;
  const todayMove = dayBasePrice > 0 ? shownHeld * (mark - dayBasePrice) : 0;
  const todayPct = dayBasePrice > 0 ? mark / dayBasePrice - 1 : 0;

  function maxAffordable(): number {
    const purse = shownCash;
    if (purse === null || purse <= 0 || mrr <= 0 || buyCeiling < 1) return 0;
    let lo = 0;
    let hi = buyCeiling;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (est("buy", mid).total <= purse) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  async function trade(side: "buy" | "sell") {
    // both sides clamp to what's actually possible — matching the labels
    const qty = side === "sell" ? sellQty : buyQty;
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
        setCooling(true);
        setTimeout(() => setCooling(false), 1200);
        // show the new position immediately, then let the server confirm it.
        // The ledger's own rule: a buy blends into the average cost, a sell
        // books the difference against it and leaves the average alone.
        const nextHeld = shownHeld + (side === "buy" ? qty : -qty);
        const nextAvg =
          side === "buy"
            ? (shownHeld * shownAvg + Number(json.total)) / Math.max(1, nextHeld)
            : nextHeld > 0
              ? shownAvg
              : 0;
        setFill({
          cash:
            (shownCash ?? 0) +
            (side === "buy" ? -Number(json.total) : Number(json.total)),
          held: nextHeld,
          avg: nextAvg,
          realized:
            shownRealized +
            (side === "sell" ? Number(json.total) - qty * shownAvg : 0),
        });
        startRefresh(() => router.refresh());
      }
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null || refreshing || cooling;
  const buyLabel =
    pending === "buy" || (refreshing && filled)
      ? "…"
      : buyCeiling < 1
        ? roomInLimit < 1
          ? "At limit"
          : "Float held"
        : shares >= 1
          ? `Buy ${buyQty.toLocaleString("en-US")}`
          : "Buy";
  const sellLabel =
    pending === "sell"
      ? "…"
      : shares >= 1 && shownHeld >= 1
        ? `Sell ${sellQty.toLocaleString("en-US")}`
        : "Sell";

  return (
    <div
      className={`panel space-y-3 p-4 transition-shadow duration-500 ${
        filled ? "shadow-[0_0_0_1.5px_rgba(34,197,94,0.6)]" : ""
      }`}
    >
      {/* ── the book ─────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between">
        <span className="microlabel">Cash</span>
        <span className="num font-mono text-sm font-semibold">
          {shownCash !== null ? fmtMoney(shownCash) : "—"}
        </span>
      </div>

      {shownHeld > 0 ? (
        <div
          className={`rounded-md border border-terminal-line border-l-2 bg-terminal-raise/40 px-3 py-2.5 ${
            unrealized >= 0 ? "border-l-terminal-up" : "border-l-terminal-down"
          }`}
        >
          <div className="flex items-baseline justify-between">
            <span className="microlabel !text-terminal-text">Your position</span>
            <span className="num font-mono text-[11px] text-terminal-muted">
              {shownHeld.toLocaleString("en-US")} shs · avg {fmtPrice(shownAvg)}
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3">
            <div>
              <div className="microlabel">Value</div>
              <div className="num font-mono text-base font-bold">
                {fmtMoney(value)}
              </div>
            </div>
            <div className="text-right">
              <div className="microlabel">P&amp;L</div>
              <div
                className={`num font-mono text-base font-bold ${tone(unrealized)}`}
              >
                {fmtSigned(unrealized)}
              </div>
              <div className={`num font-mono text-[11px] ${tone(unrealized)}`}>
                {fmtPct(unrealizedPct)} on cost
              </div>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[11px] text-terminal-muted">
            <span className="num">mark {fmtPrice(mark)}</span>
            {dayBasePrice > 0 && (
              <span className="num">
                today{" "}
                <span className={tone(todayMove)}>
                  {fmtSigned(todayMove)} ({fmtPct(todayPct)})
                </span>
              </span>
            )}
          </div>
          {Math.abs(shownRealized) > 0.005 && (
            <div className="num mt-0.5 font-mono text-[11px] text-terminal-muted">
              realized{" "}
              <span className={tone(shownRealized)}>
                {fmtSigned(shownRealized)}
              </span>{" "}
              on shares already sold
            </div>
          )}
        </div>
      ) : Math.abs(shownRealized) > 0.005 ? (
        <p className="num font-mono text-[11px] text-terminal-muted">
          No position · realized{" "}
          <span className={tone(shownRealized)}>{fmtSigned(shownRealized)}</span>{" "}
          on ${symbol} so far
        </p>
      ) : null}

      {/* ── the ticket ───────────────────────────────────────────────── */}
      {/* the spread — straight out of the fill curve, no market-maker theater */}
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-terminal-line font-mono text-xs">
        <div className="border-r border-terminal-line bg-terminal-down/[0.06] px-2.5 py-1.5">
          <div className="microlabel !tracking-[0.12em]">Sell at</div>
          <div className="num mt-0.5 font-semibold text-terminal-down">
            {fmtPrice(unitSell.avgPrice)}
          </div>
        </div>
        <div className="border-r border-terminal-line px-2.5 py-1.5 text-center">
          <div className="microlabel !tracking-[0.12em]">Mark</div>
          <div className="num mt-0.5 font-semibold text-terminal-text">
            {fmtPrice(mark)}
          </div>
        </div>
        <div className="bg-terminal-up/[0.06] px-2.5 py-1.5 text-right">
          <div className="microlabel !tracking-[0.12em]">Buy at</div>
          <div className="num mt-0.5 font-semibold text-terminal-up">
            {fmtPrice(unitBuy.avgPrice)}
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
        {shownHeld > 0 && (
          <button
            type="button"
            onClick={() => setSharesText(String(shownHeld))}
            title="Everything you hold"
            className="rounded border border-terminal-line px-2 py-0.5 font-mono text-[11px] text-terminal-muted transition-colors hover:border-terminal-down/60 hover:text-terminal-down"
          >
            all {shownHeld.toLocaleString("en-US")}
          </button>
        )}
      </div>

      {buyEst && buyImpact > 0.005 && (
        <p className="font-mono text-[11px] text-terminal-muted">
          size impact: this order moves your avg fill{" "}
          {(buyImpact * 100).toFixed(1)}% above the mark
        </p>
      )}
      {shares >= 1 && buyCeiling >= 1 && shares > buyCeiling && (
        <p className="font-mono text-[11px] text-terminal-amber">
          {roomInLimit < roomInFloat
            ? `position limit: ${buyCeiling.toLocaleString("en-US")} more is all this account may hold`
            : `float: only ${buyCeiling.toLocaleString("en-US")} shares are left to buy`}
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
          disabled={busy || buyQty < 1}
          className="btn-buy"
        >
          {buyLabel}
        </button>
        <button
          onClick={() => trade("sell")}
          disabled={busy || sellQty < 1}
          className="btn-sell"
        >
          {sellLabel}
        </button>
      </div>

      <p className="font-mono text-[11px] text-terminal-muted">
        Float {outstanding.toLocaleString("en-US")} shs · one account may hold{" "}
        {Math.round(MAX_POSITION_FRACTION * 100)}% of it (
        {limit.toLocaleString("en-US")} shs)
        {shownHeld > 0
          ? roomInLimit < 1
            ? " — you are at the limit"
            : ` — you hold ${shownHeld.toLocaleString("en-US")}, room for ${roomInLimit.toLocaleString("en-US")} more`
          : ""}
      </p>

      {message && (
        <p className="flex items-center gap-1 font-mono text-xs text-terminal-muted">
          {filled && <Check size={12} className="text-terminal-up" />}
          {message}
        </p>
      )}
      <p className="text-[11px] leading-snug text-terminal-muted/70">
        Play money only. Orders fill along the hype curve (no cap — hype decays
        daily) — revenue is the anchor, and pumping your own bag round-trips to
        zero.
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import type { RevenueEvent } from "@/lib/pricing";
import {
  executionFillAt,
  FLOW_TICK_MS,
  flowPrice,
  MAX_POSITION_FRACTION,
  positionLimit,
  settledPrice,
  SHARES_OUTSTANDING,
} from "@/lib/pricing";
import { fmtCountdown, fmtMoney, fmtPct, fmtPrice } from "@/lib/format";
import LivePrice from "@/components/LivePrice";

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

function timeAgo(ms: number, now: number): string {
  const s = Math.max(1, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export interface OwnPrint {
  side: "buy" | "sell";
  shares: number;
  price: number;
  total: number;
  at: number;
}

const USD_CHIPS = [10, 100, 500, 1000];
const SHARE_CHIPS = [10, 100, 1000];
const PCT_CHIPS = [25, 50, 75, 100];

/**
 * The ticket. One tab for each side, one number, one button.
 *
 * A buy is entered in dollars and turned into whole shares by walking the
 * same fill curve the server fills with — so the shares you see are the
 * shares you get, slippage included. A sell is entered in shares, or as a
 * slice of what you hold. Under the button: your position marked to the
 * settled price with its P&L, and your own prints on this name.
 *
 * Why the quote holds still while the header moves: the header rides the
 * shimmer, a sub-percent texture that is a function of the clock. Anything a
 * client can compute ahead of time cannot be a fill price — timing it would
 * be free money — so the ticket prices off the settled tape, which steps
 * when the walk does, every five minutes, and on every print and revenue
 * event. The footer counts down to the next step.
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
  driftAt = null,
  dayBasePrice = 0,
  quotedAt,
  signedIn,
  cash,
  sharesHeld,
  avgCost = 0,
  realized = 0,
  history = [],
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
  /** Live revenue changes — quotes and fills price off these too. */
  events?: RevenueEvent[];
  /** The recorded weather the fill prices off. */
  drift?: number;
  /** When the walk last stepped — the next step is one tick after it. */
  driftAt?: string | null;
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
  /** Your own prints on this name, newest first. */
  history?: OwnPrint[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  // buys are entered in dollars by default; the toggle switches to shares
  const [unit, setUnit] = useState<"usd" | "shares">("usd");
  // stored as text so the field can be cleared and retyped freely
  const [amountText, setAmountText] = useState("100");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [showPrints, setShowPrints] = useState(false);
  const [showNote, setShowNote] = useState(false);
  // A fill is instant; the server re-render behind it is not (~2.5s). Without
  // this the panel still reads the old cash after a successful buy, which is
  // exactly what makes people click Buy a second time.
  const [fill, setFill] = useState<{
    cash: number;
    held: number;
    avg: number;
    realized: number;
  } | null>(null);
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
  // the quote re-prices every second, like the chart
  const [nowT, setNowT] = useState<number | null>(null);
  useEffect(() => {
    setNowT(Date.now());
    const id = setInterval(() => {
      if (!document.hidden) setNowT(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
  // Two prices, on purpose. The SETTLED price is what an order fills at —
  // the anchor, the weather and the news, without the shimmer, since the
  // shimmer is computable and timing it would be free money. The TAPE price
  // is settled × shimmer: what the chart draws and the header shows, moving
  // every second. Fills quote off the first; the position is marked at the
  // second, so your P&L moves with the chart instead of sitting still for
  // five minutes while the candle under it wiggles.
  const settled = settledPrice(
    mrr,
    sentiment,
    quoteT,
    multiple,
    outstanding,
    events,
    drift
  );
  const mark = flowPrice(
    symbol,
    mrr,
    sentiment,
    quoteT,
    multiple,
    outstanding,
    events,
    drift
  );

  // Two limits, both enforced server-side too: the float is finite, and no
  // single account may hold more than MAX_POSITION_FRACTION of it.
  const limit = positionLimit(outstanding);
  const roomInLimit = Math.max(0, limit - shownHeld);
  const roomInFloat = Math.max(0, outstanding - floatHeld);
  const buyCeiling = Math.min(roomInLimit, roomInFloat);

  /** The most shares a sum of money buys, walking the fill curve. */
  function sharesFor(dollars: number): number {
    if (!(dollars > 0) || mrr <= 0 || buyCeiling < 1) return 0;
    let lo = 0;
    let hi = buyCeiling;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (est("buy", mid).total <= dollars) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  const amount = Number(amountText) || 0;
  const purse = shownCash ?? 0;
  const shares =
    tab === "sell"
      ? Math.min(Math.floor(amount), shownHeld)
      : unit === "usd"
        ? sharesFor(Math.min(amount, purse))
        : Math.min(Math.floor(amount), buyCeiling, sharesFor(purse));
  const quote = shares >= 1 ? est(tab, shares) : null;
  // size impact is measured against the settled price, the one it fills off
  const impact = quote && settled > 0 ? quote.avgPrice / settled - 1 : 0;
  const overCash = tab === "buy" && unit === "usd" && amount > purse + 0.005;

  // the position, marked
  const value = shownHeld * mark;
  const cost = shownHeld * shownAvg;
  const unrealized = value - cost;
  const unrealizedPct = cost > 0 ? unrealized / cost : 0;
  const todayMove = dayBasePrice > 0 ? shownHeld * (mark - dayBasePrice) : 0;
  // What selling the whole position RIGHT NOW would actually return: the
  // sell fill for every share, walked down the hype curve. The mark above
  // includes your own impact — a fresh 10%-of-float buy reads +10% before
  // anyone else has traded — and this is the number that does not.
  const exit = shownHeld > 0 ? est("sell", shownHeld) : null;
  const exitPnl = exit ? exit.total - cost : 0;

  // the next step of the walk: one tick after the last recorded one
  const nextTickAt = driftAt ? Date.parse(driftAt) + FLOW_TICK_MS : null;
  const untilTick = nextTickAt !== null ? nextTickAt - quoteT : null;

  async function trade() {
    if (shares < 1) return;
    const side = tab;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side, shares, note: note.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Trade failed.");
      } else {
        setMessage(
          `${side === "buy" ? "Bought" : "Sold"} ${shares.toLocaleString("en-US")} × $${symbol} @ avg ${fmtPrice(json.price)}`
        );
        setNote("");
        setFilled(true);
        setTimeout(() => setFilled(false), 1200);
        setCooling(true);
        setTimeout(() => setCooling(false), 1200);
        // the ledger's own rule: a buy blends into the average cost, a sell
        // books the difference against it and leaves the average alone
        const nextHeld = shownHeld + (side === "buy" ? shares : -shares);
        const nextAvg =
          side === "buy"
            ? (shownHeld * shownAvg + Number(json.total)) / Math.max(1, nextHeld)
            : nextHeld > 0
              ? shownAvg
              : 0;
        setFill({
          cash: purse + (side === "buy" ? -Number(json.total) : Number(json.total)),
          held: nextHeld,
          avg: nextAvg,
          realized:
            shownRealized +
            (side === "sell" ? Number(json.total) - shares * shownAvg : 0),
        });
        startRefresh(() => router.refresh());
      }
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setPending(false);
    }
  }

  const busy = pending || refreshing || cooling;
  const label = pending
    ? "…"
    : tab === "buy"
      ? buyCeiling < 1
        ? roomInLimit < 1
          ? "At the position limit"
          : "Float fully held"
        : `Buy $${symbol}`
      : shownHeld < 1
        ? "Nothing to sell"
        : `Sell $${symbol}`;

  const chipClass = (active: boolean) =>
    `rounded-md border px-1 py-1.5 text-center font-mono text-[11px] transition-colors ${
      active
        ? "border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent"
        : "border-terminal-line bg-terminal-bg text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
    }`;

  return (
    <div
      className={`panel space-y-2.5 p-2.5 transition-shadow duration-500 ${
        filled ? "shadow-[0_0_0_1.5px_rgba(34,197,94,0.6)]" : ""
      }`}
    >
      {/* ── side ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-1 rounded-md bg-terminal-bg p-1">
        <button
          type="button"
          onClick={() => setTab("buy")}
          className={`rounded py-1.5 text-sm font-semibold transition-colors ${
            tab === "buy"
              ? "bg-terminal-up/20 text-terminal-up"
              : "text-terminal-muted hover:text-terminal-text"
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setTab("sell")}
          className={`rounded py-1.5 text-sm font-semibold transition-colors ${
            tab === "sell"
              ? "bg-terminal-down/20 text-terminal-down"
              : "text-terminal-muted hover:text-terminal-text"
          }`}
        >
          Sell
        </button>
      </div>

      {/* ── amount ───────────────────────────────────────────────────── */}
      <div
        className={`rounded-md border bg-terminal-bg px-3 py-2 ${
          overCash ? "border-terminal-amber/60" : "border-terminal-line focus-within:border-terminal-accent"
        }`}
      >
        <div className="flex items-center gap-2">
          {tab === "buy" && unit === "usd" && (
            <span className="font-mono text-xl text-terminal-muted">$</span>
          )}
          <input
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(e) =>
              setAmountText(
                e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 9)
              )
            }
            placeholder="0"
            aria-label={tab === "sell" || unit === "shares" ? "Shares" : "Amount"}
            className="num w-full bg-transparent font-mono text-2xl font-semibold text-terminal-text outline-none placeholder:text-terminal-muted/50"
          />
          {tab === "buy" ? (
            <button
              type="button"
              onClick={() => {
                setUnit((u) => (u === "usd" ? "shares" : "usd"));
                setAmountText("");
              }}
              className="shrink-0 rounded border border-terminal-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-terminal-muted hover:text-terminal-text"
              title="Enter the order in dollars or in shares"
            >
              {unit === "usd" ? "usd ⇄ shs" : "shs ⇄ usd"}
            </button>
          ) : (
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-terminal-muted">
              shs
            </span>
          )}
        </div>
        <div className="num mt-0.5 flex items-baseline justify-between font-mono text-[11px] text-terminal-muted">
          <span>
            {tab === "buy" && unit === "usd"
              ? shares >= 1
                ? `≈ ${shares.toLocaleString("en-US")} shs @ ${fmtPrice(quote!.avgPrice)} avg`
                : "—"
              : quote
                ? `≈ ${fmtMoney(quote.total)} @ ${fmtPrice(quote.avgPrice)} avg`
                : "—"}
          </span>
          {quote && Math.abs(impact) > 0.005 && (
            <span className={tab === "buy" ? "text-terminal-amber" : "text-terminal-amber"}>
              {(Math.abs(impact) * 100).toFixed(1)}% {impact > 0 ? "above" : "below"} mark
            </span>
          )}
        </div>
      </div>

      {/* ── quick sizes ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-1">
        {tab === "sell"
          ? PCT_CHIPS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={shownHeld < 1}
                onClick={() =>
                  setAmountText(String(Math.max(1, Math.floor((shownHeld * p) / 100))))
                }
                className={chipClass(shownHeld > 0 && shares === Math.max(1, Math.floor((shownHeld * p) / 100)))}
              >
                {p}%
              </button>
            ))
          : unit === "usd"
            ? USD_CHIPS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setAmountText(String(d))}
                  className={chipClass(amount === d)}
                >
                  ${d.toLocaleString("en-US")}
                </button>
              ))
            : SHARE_CHIPS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAmountText(String(n))}
                  className={chipClass(amount === n)}
                >
                  {n >= 1000 ? `${n / 1000}k` : n}
                </button>
              ))}
        {tab === "buy" ? (
          <button
            type="button"
            onClick={() =>
              setAmountText(
                unit === "usd" ? String(Math.floor(purse)) : String(sharesFor(purse))
              )
            }
            title="The most your cash covers, slippage included"
            className={chipClass(false)}
          >
            max
          </button>
        ) : (
          <button
            type="button"
            disabled={shownHeld < 1}
            onClick={() => setAmountText(String(shownHeld))}
            title="Everything you hold"
            className={chipClass(shownHeld > 0 && shares === shownHeld && amount === shownHeld)}
          >
            all
          </button>
        )}
      </div>

      <div className="num flex items-baseline justify-between font-mono text-[11px] text-terminal-muted">
        <span>
          {tab === "buy"
            ? `${shownCash !== null ? fmtMoney(shownCash) : "—"} available`
            : `${shownHeld.toLocaleString("en-US")} shs · ${fmtMoney(value)} available`}
        </span>
        <span>
          mark <LivePrice value={mark} formatted={fmtPrice(mark)} />
        </span>
      </div>
      {overCash && (
        <p className="font-mono text-[11px] text-terminal-amber">
          that is more than your cash — sized to {fmtMoney(purse)}
        </p>
      )}

      {showNote ? (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={140}
          autoFocus
          placeholder="your thesis — goes on the record with the print"
          className="input text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="font-mono text-[11px] text-terminal-muted hover:text-terminal-accent"
        >
          + attach a thesis
        </button>
      )}

      <button
        onClick={trade}
        disabled={busy || shares < 1}
        className={`${tab === "buy" ? "btn-buy" : "btn-sell"} w-full py-3 text-base`}
      >
        {label}
      </button>

      {message && (
        <p className="flex items-center gap-1 font-mono text-xs text-terminal-muted">
          {filled && <Check size={12} className="text-terminal-up" />}
          {message}
        </p>
      )}

      {/* ── the book ─────────────────────────────────────────────────── */}
      {shownHeld > 0 && (
        <div
          className={`rounded-md border border-terminal-line border-l-2 bg-terminal-raise/40 px-3 py-2 ${
            unrealized >= 0 ? "border-l-terminal-up" : "border-l-terminal-down"
          }`}
        >
          <div className="flex items-baseline justify-between">
            <span className="microlabel !text-terminal-text">Your position</span>
            <span className={`num font-mono text-sm font-bold ${tone(unrealized)}`}>
              {fmtSigned(unrealized)}{" "}
              <span className="text-[11px] font-semibold">({fmtPct(unrealizedPct)})</span>
            </span>
          </div>
          <div className="num mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[11px] text-terminal-muted">
            <span>
              {shownHeld.toLocaleString("en-US")} shs · {fmtMoney(value)} · avg{" "}
              {fmtPrice(shownAvg)}
            </span>
            {dayBasePrice > 0 && (
              <span>
                today <span className={tone(todayMove)}>{fmtSigned(todayMove)}</span>
              </span>
            )}
          </div>
          {exit && (
            <div
              className="num mt-1 flex flex-wrap items-baseline justify-between gap-x-3 border-t border-terminal-line/60 pt-1 font-mono text-[11px] text-terminal-muted"
              title="The sell fill for every share you hold, walked down the hype curve — the mark above includes your own buying"
            >
              <span>sell all now → {fmtMoney(exit.total)}</span>
              <span className={tone(exitPnl)}>
                {fmtSigned(exitPnl)} ({fmtPct(cost > 0 ? exitPnl / cost : 0)})
              </span>
            </div>
          )}
        </div>
      )}

      {(history.length > 0 || Math.abs(shownRealized) > 0.005) && (
        <div className="rounded-md border border-terminal-line">
          <button
            type="button"
            onClick={() => setShowPrints((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left font-mono text-[11px] text-terminal-muted hover:text-terminal-text"
          >
            <span>
              Your trades ({history.length}) · realized{" "}
              <span className={tone(shownRealized)}>{fmtSigned(shownRealized)}</span>
            </span>
            <ChevronDown
              size={12}
              className={`transition-transform ${showPrints ? "rotate-180" : ""}`}
            />
          </button>
          {showPrints && history.length > 0 && (
            <ul className="max-h-40 divide-y divide-terminal-line/40 overflow-y-auto border-t border-terminal-line">
              {history.map((h, i) => (
                <li
                  key={`${h.at}-${i}`}
                  className="num flex items-baseline justify-between px-3 py-1 font-mono text-[11px]"
                >
                  <span>
                    <span
                      className={`font-bold uppercase ${
                        h.side === "buy" ? "text-terminal-up" : "text-terminal-down"
                      }`}
                    >
                      {h.side}
                    </span>{" "}
                    {h.shares.toLocaleString("en-US")} @ {fmtPrice(h.price)}
                  </span>
                  <span className="text-terminal-muted">
                    {fmtMoney(h.total)} · {timeAgo(h.at, quoteT)} ago
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── footer ───────────────────────────────────────────────────── */}
      <p className="num flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[10px] text-terminal-muted">
        <span>settled price · steps every 5 min</span>
        {untilTick !== null && (
          <span>
            {untilTick > 0
              ? `next tick ${fmtCountdown(untilTick)}`
              : "next tick any second"}
          </span>
        )}
      </p>
      <p className="num font-mono text-[10px] text-terminal-muted/70">
        play money · float {outstanding.toLocaleString("en-US")} shs ·{" "}
        {Math.round(MAX_POSITION_FRACTION * 100)}% per account
        {shownHeld > 0 && roomInLimit < 1 ? " · you are at the limit" : ""}
      </p>
    </div>
  );
}

import type { ChartPoint } from "@/lib/types";
import { makePriceAt } from "@/lib/candles";
import type { RevenueEvent } from "@/lib/pricing";

/**
 * The equity curve, reconstructed rather than recorded.
 *
 * A daily snapshot draws a straight line between two dots. But every ticker
 * already has a continuous price — the flow, the revenue steps, the recorded
 * history — so a portfolio's value at any instant is computable exactly:
 *
 *     value(t) = cash(t) + Σ shares_i(t) × price_i(t)
 *
 * Holdings and cash at t come from replaying the trade log backwards from
 * today. Nothing here is invented: the spikes are the same price movements
 * the ticker charts show, and the steps are the moments you actually traded.
 */

export interface EquityHolding {
  symbol: string;
  shares: number; // held right now
  mrr: number; // live MRR
  sentiment: number;
  multiple: number;
  outstanding: number;
  series: ChartPoint[];
  events: RevenueEvent[];
}

export interface EquityTrade {
  t: number;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  total: number;
}

export interface EquityInputs {
  cash: number; // right now
  holdings: EquityHolding[];
  trades: EquityTrade[]; // ascending
  startedAt: number; // account creation — the curve begins here
  startingCash: number;
}

/**
 * A function from instant → portfolio value. Trade replay is precomputed, so
 * sampling a few hundred points across a window stays cheap.
 */
export function makeEquityAt(inputs: EquityInputs): (t: number) => number {
  const priceAt = new Map<string, (t: number) => number>();
  for (const h of inputs.holdings) {
    priceAt.set(
      h.symbol,
      makePriceAt(
        h.symbol,
        h.mrr,
        h.sentiment,
        h.series,
        h.multiple,
        h.outstanding,
        h.events
      )
    );
  }

  // Walk the trades newest → oldest, recording the state BEFORE each one.
  // states[i] is what cash and shares were just before trades[i] executed.
  const trades = [...inputs.trades].sort((a, b) => a.t - b.t);
  const now = { cash: inputs.cash, shares: new Map<string, number>() };
  for (const h of inputs.holdings) now.shares.set(h.symbol, h.shares);

  const states: { t: number; cash: number; shares: Map<string, number> }[] = [];
  let cash = now.cash;
  const shares = new Map(now.shares);
  for (let i = trades.length - 1; i >= 0; i--) {
    const tr = trades[i];
    // undo it: a buy spent cash for shares, a sell did the opposite
    if (tr.side === "buy") {
      cash += tr.total;
      shares.set(tr.symbol, (shares.get(tr.symbol) ?? 0) - tr.shares);
    } else {
      cash -= tr.total;
      shares.set(tr.symbol, (shares.get(tr.symbol) ?? 0) + tr.shares);
    }
    states[i] = { t: tr.t, cash, shares: new Map(shares) };
  }

  return (t: number): number => {
    // the first trade at or after t defines the state at t
    let lo = 0;
    let hi = states.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (states[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    const state = lo < states.length ? states[lo] : now;

    let total = state.cash;
    for (const [symbol, qty] of state.shares) {
      if (qty <= 0) continue;
      const price = priceAt.get(symbol);
      if (price) total += qty * price(t);
    }
    return total;
  };
}

/** Sample the curve evenly across a window — the series a chart draws. */
export function sampleEquity(
  valueAt: (t: number) => number,
  from: number,
  to: number,
  points = 180
): ChartPoint[] {
  if (!(to > from)) return [{ t: to, price: valueAt(to) }];
  const out: ChartPoint[] = [];
  for (let i = 0; i <= points; i++) {
    const t = from + ((to - from) * i) / points;
    out.push({ t, price: valueAt(t) });
  }
  return out;
}

export const EQUITY_RANGES = [
  { key: "1D", label: "1D", ms: 86_400_000 },
  { key: "1W", label: "1W", ms: 7 * 86_400_000 },
  { key: "1M", label: "1M", ms: 30 * 86_400_000 },
  { key: "ALL", label: "ALL", ms: Infinity },
] as const;

export type EquityRangeKey = (typeof EQUITY_RANGES)[number]["key"];

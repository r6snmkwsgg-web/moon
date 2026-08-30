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
  // display, so the positions table can price off the same clock as the curve
  name: string;
  logoUrl: string | null;
  avgCost: number;
  dayChange: number;
  weekChange: number;
  spark: number[];
}

/** Price functions per symbol — the same ones the curve is built from. */
export function makePricesAt(
  holdings: EquityHolding[]
): Map<string, (t: number) => number> {
  const out = new Map<string, (t: number) => number>();
  for (const h of holdings) {
    out.set(
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
  return out;
}

export interface EquityTrade {
  t: number;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  total: number;
  note: string | null; // the thesis, if one was attached
}

export interface EquityInputs {
  cash: number; // right now
  holdings: EquityHolding[];
  trades: EquityTrade[]; // ascending
  startedAt: number; // account creation — the curve begins here
  startingCash: number;
}

export interface PortfolioState {
  cash: number;
  shares: Map<string, number>;
}

/**
 * What the account held at any instant, by replaying the trade log backwards
 * from today. Used by the value curve, and by anything that needs to know
 * whether a revenue event actually touched this person's money.
 */
export function makeStateAt(inputs: EquityInputs): (t: number) => PortfolioState {
  const now: PortfolioState = {
    cash: inputs.cash,
    shares: new Map<string, number>(),
  };
  for (const h of inputs.holdings) now.shares.set(h.symbol, h.shares);

  const trades = [...inputs.trades].sort((a, b) => a.t - b.t);
  const states: (PortfolioState & { t: number })[] = [];
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

  return (t: number): PortfolioState => {
    let lo = 0;
    let hi = states.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (states[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo < states.length ? states[lo] : now;
  };
}

/**
 * Realized PnL, average-cost accounting: every sale books the difference
 * between what it fetched and what those shares cost on average. Without
 * this, selling a winner makes the gain vanish from the page — the open
 * position it was measured against is gone.
 */
export function realizedPnl(trades: EquityTrade[]): number {
  const book = new Map<string, { shares: number; avg: number }>();
  let realized = 0;
  for (const tr of [...trades].sort((a, b) => a.t - b.t)) {
    const pos = book.get(tr.symbol) ?? { shares: 0, avg: 0 };
    if (tr.side === "buy") {
      const cost = pos.shares * pos.avg + tr.total;
      pos.shares += tr.shares;
      pos.avg = pos.shares > 0 ? cost / pos.shares : 0;
    } else {
      const sold = Math.min(tr.shares, pos.shares);
      realized += tr.total - sold * pos.avg;
      pos.shares = Math.max(0, pos.shares - tr.shares);
      if (pos.shares === 0) pos.avg = 0;
    }
    book.set(tr.symbol, pos);
  }
  return realized;
}

/**
 * A function from instant → portfolio value. Trade replay is precomputed, so
 * sampling a few hundred points across a window stays cheap.
 */
export function makeEquityAt(inputs: EquityInputs): (t: number) => number {
  const priceAt = makePricesAt(inputs.holdings);
  const stateAt = makeStateAt(inputs);

  return (t: number): number => {
    const state = stateAt(t);
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

/**
 * How the book is split, as drawable arcs. Pure so it can be tested without a
 * DOM: the donut only turns these into strokes.
 *
 * Cash is always its own slice and always last — it is the one part of the
 * book that isn't a bet, so it reads as the remainder rather than a position.
 */
export interface AllocationSlice {
  label: string;
  name: string;
  value: number;
  share: number;
  offset: number; // fraction of the circle already used, for dasharray
  isCash: boolean;
}

export function allocationSlices(
  positions: { label: string; name: string; value: number }[],
  cash: number,
  named: number
): AllocationSlice[] {
  const held = positions
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  // A wide book would otherwise run the legend down the whole rail and start
  // reusing shades. Past the top few, the tail is one bucket — the detail
  // that matters at 2% a name is in the positions table, not here.
  const shown = held.slice(0, named);
  const tail = held.slice(named);
  if (tail.length > 0) {
    shown.push({
      label: `+${tail.length} more`,
      name: tail.map((x) => x.label).join(", "),
      value: tail.reduce((s, x) => s + x.value, 0),
    });
  }

  const all = [
    ...shown,
    { label: "Cash", name: "unspent buying power", value: cash },
  ].filter((x) => x.value > 0);
  const total = all.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return [];

  let offset = 0;
  return all.map((x) => {
    const share = x.value / total;
    const slice = { ...x, share, offset, isCash: x.label === "Cash" };
    offset += share;
    return slice;
  });
}

export const EQUITY_RANGES = [
  { key: "1D", label: "1D", ms: 86_400_000 },
  { key: "1W", label: "1W", ms: 7 * 86_400_000 },
  { key: "1M", label: "1M", ms: 30 * 86_400_000 },
  { key: "ALL", label: "ALL", ms: Infinity },
] as const;

export type EquityRangeKey = (typeof EQUITY_RANGES)[number]["key"];

/**
 * lib/reference.ts — what a name is worth to someone who cannot see the
 * formula.
 *
 * Nobody on the floor is shown the anchor, the AI traders included. What
 * everyone can see is the tape and the revenue, so a value read is built
 * from those alone: where the price has closed over the last week, moved
 * by however much the revenue has changed since each close. That is a
 * trailing price-to-revenue read — the way a value trader reads a stock in
 * a market with no published fair value — and it lags, which is the point.
 * A pump looks expensive for days and a dump looks cheap for days, so the
 * crowd that trades on it is late, split, and arguing, which is what a
 * floor sounds like. The anchor still pulls the price, through the weather
 * and the decay; it just does it without telling anyone where it is.
 */

/** One daily close, with the revenue the market was pricing that day. */
export interface DailyClose {
  price: number;
  mrr: number;
}

/** How far a revenue change is allowed to move a close: a demo pulse's
 *  wave, or a first-ever report, must not turn one day into a 5× read. */
const REVENUE_ADJUST_CAP = 2;

/**
 * The trailing read: the geometric mean of the last week's closes, each
 * restated at today's revenue. With no history (a fresh listing) it is
 * whatever the caller falls back to — the price a day ago, or the price
 * itself, which is to say "no opinion".
 */
export function referencePrice(closes: DailyClose[], mrrNow: number, fallback: number): number {
  let sum = 0;
  let n = 0;
  for (const c of closes) {
    if (!(c.price > 0)) continue;
    const ratio = c.mrr > 0 && mrrNow > 0 ? Math.min(REVENUE_ADJUST_CAP, Math.max(1 / REVENUE_ADJUST_CAP, mrrNow / c.mrr)) : 1;
    sum += Math.log(c.price * ratio);
    n++;
  }
  if (n === 0) return fallback > 0 ? fallback : 0;
  return Math.exp(sum / n);
}

/**
 * Pricing a business that has no MRR.
 *
 * A subscription company can be valued off a number that barely moves — MRR
 * is next month's revenue, near enough. A business selling one-time or by
 * usage has no such number: it has a stream of payments that is lumpy by
 * nature. Valuing it on "money received today" would price it at zero every
 * quiet Tuesday.
 *
 * So it is priced the way the market prices an earnings report, every day:
 *
 *   EXPECTATION  what a normal day looks like for this business, as a decaying
 *                average of the days it has actually had.
 *   SURPRISE     how far today is from that — measured in standard deviations
 *                of its OWN history, not in percent, because a 50% miss means
 *                nothing for a business that sells twice a week and everything
 *                for one that sells forty times a day.
 *   RESPONSE     convex. Landing on expectation does nothing. A small beat
 *                drifts up. A big beat rips, and a big miss drops harder than
 *                the same beat rises, because that is how markets treat
 *                disappointment.
 *
 * The expectation moves the LEVEL, slowly and permanently. The surprise moves
 * the MULTIPLE, sharply and temporarily. That split is the whole point: a
 * great day both nudges what the business is worth and — much louder — changes
 * what the market thinks is coming next.
 */

/** One completed day of net revenue. */
export interface DailyRevenue {
  day: string; // ISO date, market timezone
  amount: number;
}

/** How fast the expectation forgets. Two weeks is one sales cycle-ish. */
export const EXPECTATION_HALF_LIFE_DAYS = 14;

/** Minimum spread, as a fraction of the expectation. */
const MIN_SPREAD_FRACTION = 0.2;

/**
 * A single day may count for at most this multiple of the business's own
 * upper-normal day. One $5,000 invoice against a $100/day baseline would
 * otherwise carry the expectation — and the valuation — for a month, which
 * is both wrong and trivially gameable by timing one big sale. A genuine
 * step change survives it, because a step change shows up on many days and
 * drags the ceiling up with it; a lone whale does not.
 */
const OUTLIER_CEILING = 3;

/** Surprises past this many standard deviations stop counting for more. */
const Z_CAP = 3.5;

/** A one-sigma day is worth this much multiple. */
const Z_UNIT_RESPONSE = 0.08;

/**
 * Convexity. Above 1, a small surprise moves less than proportionally and a
 * large one moves more — which is what makes "slightly ahead" a drift and
 * "way ahead" an event.
 */
const RESPONSE_EXPONENT = 1.5;

/** Misses hurt more than beats help. Markets are not even-handed. */
const MISS_WEIGHT = 1.3;

/** Ceiling on what one day can do to the multiple, either way. */
export const SURPRISE_CAP = 0.6;

/**
 * What a normal day looks like, as an exponentially weighted mean of completed
 * days. Weighted rather than a flat window so a big day fades instead of
 * dropping off a cliff 30 days later and cratering the price for no reason.
 */
export function expectedDaily(
  history: DailyRevenue[],
  halfLifeDays = EXPECTATION_HALF_LIFE_DAYS
): number {
  if (history.length === 0) return 0;
  const ceiling = outlierCeiling(history);
  const decay = Math.pow(0.5, 1 / halfLifeDays);
  let weighted = 0;
  let weight = 0;
  // newest first, so index 0 carries full weight
  const newestFirst = [...history].sort((a, b) => b.day.localeCompare(a.day));
  for (let i = 0; i < newestFirst.length; i++) {
    const w = Math.pow(decay, i);
    weighted += Math.min(newestFirst[i].amount, ceiling) * w;
    weight += w;
  }
  return weight > 0 ? weighted / weight : 0;
}

/** The most a single day is allowed to contribute: 3× an upper-normal day. */
function outlierCeiling(history: DailyRevenue[]): number {
  const sorted = history.map((d) => d.amount).sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.max(p90, 0) * OUTLIER_CEILING || Infinity;
}

/**
 * How much this business's days normally differ from each other.
 *
 * This is what turns a percentage into news. A shop that takes $200 like
 * clockwork has a tiny spread, so $140 is a genuine shock. A shop that swings
 * between $0 and $900 has a huge one, and $140 is Tuesday. Floored relative to
 * the expectation so a company with a short or suspiciously smooth record
 * cannot produce enormous z-scores from rounding.
 */
export function dailySpread(history: DailyRevenue[], expected: number): number {
  const floor = Math.max(expected * MIN_SPREAD_FRACTION, 1e-9);
  if (history.length < 3) return floor;
  const mean = history.reduce((s, d) => s + d.amount, 0) / history.length;
  const variance =
    history.reduce((s, d) => s + (d.amount - mean) ** 2, 0) /
    (history.length - 1);
  return Math.max(Math.sqrt(variance), floor);
}

/**
 * How far through the trading day we are, 0 at the open and 1 at the close.
 * `dayStart` and `dayEnd` come from the market clock, so this respects the
 * 23- and 25-hour days too.
 */
export function dayProgress(now: number, dayStart: number, dayEnd: number): number {
  const span = dayEnd - dayStart;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (now - dayStart) / span));
}

export interface Surprise {
  /** Standard deviations from a normal day, pro-rated for the time elapsed. */
  z: number;
  /** How much of the day has happened — how seriously to take `z`. */
  confidence: number;
  /** The plain-language version: fraction above or below a full normal day. */
  fraction: number;
  expected: number;
  spread: number;
}

/**
 * Today, judged against a normal day — at whatever hour it currently is.
 *
 * The comparison is against the revenue expected BY NOW, not by midnight,
 * otherwise every morning reads as a catastrophe. And the result is damped by
 * how much of the day has actually happened, so a quiet 9am is a shrug and a
 * quiet 9pm is a verdict.
 */
export function revenueSurprise(
  history: DailyRevenue[],
  todaySoFar: number,
  progress: number
): Surprise {
  const expected = expectedDaily(history);
  const spread = dailySpread(history, expected);
  if (!(expected > 0)) {
    return { z: 0, confidence: 0, fraction: 0, expected, spread };
  }
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const expectedByNow = expected * clampedProgress;
  const shortfall = todaySoFar - expectedByNow;
  // the spread is a whole-day figure, so scale it to the elapsed slice — a
  // partial day has proportionally less room to deviate
  const spreadByNow = spread * Math.sqrt(Math.max(clampedProgress, 1e-6));
  return {
    z: shortfall / spreadByNow,
    confidence: clampedProgress,
    fraction: shortfall / expected,
    expected,
    spread,
  };
}

/**
 * What a surprise does to the multiple.
 *
 * Convex and asymmetric: on expectation is flat, a one-sigma beat is a nudge,
 * three sigma is an event, and the same miss is worse than the beat was good.
 */
export function surpriseResponse(s: Surprise): number {
  if (!Number.isFinite(s.z) || s.z === 0) return 0;
  const capped = Math.min(Z_CAP, Math.abs(s.z));
  const shaped = Math.pow(capped, RESPONSE_EXPONENT) * Z_UNIT_RESPONSE;
  const signed = (s.z < 0 ? -shaped * MISS_WEIGHT : shaped) * s.confidence;
  return Math.max(-SURPRISE_CAP, Math.min(SURPRISE_CAP, signed));
}

/** Annualised revenue for a business measured in days rather than months. */
export function annualisedFromDaily(expectedDailyRevenue: number): number {
  return Math.max(0, expectedDailyRevenue) * 365;
}

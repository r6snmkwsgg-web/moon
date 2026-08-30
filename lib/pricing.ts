/**
 * lib/pricing.ts — THE price formula. The entire market mechanic lives in
 * this one module; nothing else in the app may compute a price.
 *
 * Model:
 *   - Every ticker has a fixed float of 10,000 fake shares.
 *   - fair_price = (ARR × 3) / 10,000, where ARR = latest MRR × 12 —
 *     the multiple applies to ANNUAL revenue, the way SaaS is actually
 *     valued (indie SaaS changes hands around 2–4× ARR).
 *   - live price = fair_price × (1 + sentiment).
 *   - sentiment rises with net play-money buying and falls with selling,
 *     is clamped to ±40%, and decays 10% toward zero once per day (cron).
 *
 * So hype moves the price short-term, but MRR is gravity: an MRR update
 * reprices the fair-price anchor immediately — the "earnings report" moment.
 */

/** Fixed float per ticker. Every ticker has exactly this many fake shares. */
export const SHARES_OUTSTANDING = 10_000;

/**
 * A new listing sizes its float so the first print lands near this price.
 * The float is a unit choice, not a supply of ownership — market cap is
 * ARR × multiple no matter how many slices it is cut into — but a board
 * where everything opens around the same price is a board you can compare.
 */
export const TARGET_OPENING_PRICE = 25;

/**
 * The most of one ticker's float a single account may hold. Without it a
 * $10,000 stake buys a micro-cap outright and the market ends for everyone
 * else — the float reads "fully held" and nobody can buy in.
 */
export const MAX_POSITION_FRACTION = 0.1;

/** Round numbers a real cap table would use. */
const FLOAT_STEPS = [
  1_000, 2_000, 5_000, 10_000, 20_000, 25_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000,
];

/**
 * Baseline multiple on ANNUAL recurring revenue, before quality. Small SaaS
 * changes hands around 2–4× ARR; this is the middle of the road for a
 * business with no track record yet, and valuationMultiple() moves it.
 * (Applying a multiple to MONTHLY revenue — the old bug — valued a
 * $27k/mo business at $80k, i.e. 0.25× ARR: twelve times too cheap.)
 */
export const ARR_MULTIPLE = 2.5;

export const MONTHS_PER_YEAR = 12;

/** Quality-adjusted multiples never leave this band. */
export const MULTIPLE_FLOOR = 1.5;
export const MULTIPLE_CEILING = 8;

/** Months of history at which the track-record premium saturates. */
export const TRACK_RECORD_MONTHS = 24;

/** One month of reported revenue. */
export interface RevenuePoint {
  month: string; // "2026-08-01"
  mrr: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * How much the market pays per dollar of ARR, from the revenue record alone.
 * Three things move it, the same three that move real SaaS valuations:
 *
 *   · track record — durable revenue is worth more than a single month.
 *     A brand-new listing prices at 0.75× the base; two years of history
 *     earns 1.30×.
 *   · growth — trailing monthly compounding, the dominant driver in real
 *     markets. Flat is neutral; +10%/mo roughly doubles the multiple;
 *     shrinking revenue is discounted hard.
 *   · steadiness — the volatility of those monthly moves. Boringly
 *     consistent earns a premium; spiky earns a discount, because a spike
 *     is not a business.
 *
 * So $25k/mo held for three years prices far above $25k/mo reached last
 * month on a spike — which is the whole point.
 */
export function valuationMultiple(history: RevenuePoint[]): number {
  const points = [...(history ?? [])]
    .filter((p) => Number.isFinite(Number(p.mrr)) && Number(p.mrr) > 0)
    .sort((a, b) => a.month.localeCompare(b.month));

  if (points.length === 0) return ARR_MULTIPLE;

  // ── track record ────────────────────────────────────────────────────────
  const months = points.length;
  const trackRecord =
    0.75 + 0.55 * Math.min(1, months / TRACK_RECORD_MONTHS);

  if (months === 1) {
    return clampMultiple(ARR_MULTIPLE * trackRecord);
  }

  // ── growth: compound monthly rate over the trailing window ──────────────
  const window = points.slice(-Math.min(7, months)); // up to 6 transitions
  const periods = window.length - 1;
  const first = Number(window[0].mrr);
  const last = Number(window[window.length - 1].mrr);
  const monthlyGrowth = Math.pow(last / first, 1 / periods) - 1;
  const growth = Math.min(2.2, Math.max(0.6, 1 + monthlyGrowth * 8));

  // ── steadiness: spread of the month-over-month moves ────────────────────
  const moves: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = Number(window[i - 1].mrr);
    moves.push(prev > 0 ? Number(window[i].mrr) / prev - 1 : 0);
  }
  const avg = mean(moves);
  const variance = mean(moves.map((m) => (m - avg) ** 2));
  const stdev = Math.sqrt(variance);
  const steadiness = Math.min(1.25, Math.max(0.8, 1.25 - stdev * 3));

  return clampMultiple(ARR_MULTIPLE * trackRecord * growth * steadiness);
}

function clampMultiple(m: number): number {
  if (!Number.isFinite(m)) return ARR_MULTIPLE;
  return Math.min(MULTIPLE_CEILING, Math.max(MULTIPLE_FLOOR, m));
}

/** Sentiment is clamped to ±40% around fair price. */
export const SENTIMENT_CAP = 0.4;

/** Fraction of sentiment that decays toward zero each day. */
export const SENTIMENT_DAILY_DECAY = 0.1;

/**
 * How hard one traded share pushes sentiment.
 * Trading the whole float (10,000 shares) would swing sentiment by
 * TRADE_IMPACT_FACTOR × 100% before clamping; e.g. buying 1,000 shares
 * (10% of the float) pushes sentiment up 0.10 × 2 = +20%.
 */
export const TRADE_IMPACT_FACTOR = 2;

export type TradeSide = "buy" | "sell";

/** Clamp sentiment into [-SENTIMENT_CAP, +SENTIMENT_CAP]. */
export function clampSentiment(sentiment: number): number {
  if (!Number.isFinite(sentiment)) return 0;
  return Math.min(SENTIMENT_CAP, Math.max(-SENTIMENT_CAP, sentiment));
}

/** Annual recurring revenue from the latest monthly number. */
export function annualRevenue(mrr: number): number {
  if (!Number.isFinite(mrr) || mrr <= 0) return 0;
  return mrr * MONTHS_PER_YEAR;
}

/**
 * The anchor: ARR × the ticker's multiple, spread over the float. Callers
 * that know the revenue record pass its multiple (valuationMultiple); the
 * default is the no-track-record baseline. MRR at or below zero anchors the
 * price at zero — no negative prices.
 */
export function fairPrice(
  mrr: number,
  multiple = ARR_MULTIPLE,
  shares = SHARES_OUTSTANDING
): number {
  if (!Number.isFinite(mrr) || mrr <= 0) return 0;
  return (annualRevenue(mrr) * multiple) / floatOf(shares);
}

/** A float is a positive integer; anything else falls back to the default. */
export function floatOf(shares: number | null | undefined): number {
  const n = Number(shares);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : SHARES_OUTSTANDING;
}

/**
 * The float a listing gets at IPO: enough shares to open near
 * TARGET_OPENING_PRICE, rounded to a number that reads like a cap table.
 * Changing it never changes what the company is worth.
 */
export function shareCountFor(mrr: number, multiple = ARR_MULTIPLE): number {
  const cap = annualRevenue(mrr) * multiple;
  if (!(cap > 0)) return SHARES_OUTSTANDING;
  const want = cap / TARGET_OPENING_PRICE;
  // nearest on a ratio scale — 5k is "closer" to 4k than 10k is
  return FLOAT_STEPS.reduce((best, step) =>
    Math.abs(Math.log(step / want)) < Math.abs(Math.log(best / want))
      ? step
      : best
  );
}

/** The most one account may hold of a ticker: no cornering the float. */
export function positionLimit(shares = SHARES_OUTSTANDING): number {
  return Math.max(1, Math.floor(floatOf(shares) * MAX_POSITION_FRACTION));
}

/** What the ticker trades at right now: fair price stretched by sentiment. */
export function livePrice(
  mrr: number,
  sentiment: number,
  multiple = ARR_MULTIPLE,
  shares = SHARES_OUTSTANDING
): number {
  return fairPrice(mrr, multiple, shares) * (1 + clampSentiment(sentiment));
}

/** Play-money market cap: live price × the full float. */
export function marketCap(
  mrr: number,
  sentiment: number,
  multiple = ARR_MULTIPLE,
  shares = SHARES_OUTSTANDING
): number {
  // invariant to the float by construction — price × float cancels it out
  return livePrice(mrr, sentiment, multiple, shares) * floatOf(shares);
}

/**
 * Signed sentiment delta caused by one trade. Buys push up, sells push down,
 * proportional to how much of the float changed hands.
 */
export function tradeImpact(
  side: TradeSide,
  shares: number,
  outstanding = SHARES_OUTSTANDING
): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  const direction = side === "buy" ? 1 : -1;
  // impact is a fraction of THIS ticker's float — 100 shares of a 1,000-share
  // company is a tenth of it and has to move like one
  return direction * (shares / floatOf(outstanding)) * TRADE_IMPACT_FACTOR;
}

/** Sentiment after a trade lands, clamped to the ±40% band. */
export function applyTrade(
  sentiment: number,
  side: TradeSide,
  shares: number,
  outstanding = SHARES_OUTSTANDING
): number {
  return clampSentiment(
    clampSentiment(sentiment) + tradeImpact(side, shares, outstanding)
  );
}

/**
 * One daily decay step: sentiment shrinks 10% toward zero, so hype fades
 * and price drifts back to the MRR anchor. Values that decay below a hair's
 * width of zero snap to zero so sentiment doesn't linger forever.
 */
export function decaySentiment(sentiment: number): number {
  const decayed = clampSentiment(sentiment) * (1 - SENTIMENT_DAILY_DECAY);
  return Math.abs(decayed) < 1e-6 ? 0 : decayed;
}

/** Percent change from `from` to `to`, as a fraction (0.05 = +5%). */
export function changeFraction(from: number, to: number): number {
  if (!Number.isFinite(from) || from <= 0) return 0;
  return (to - from) / from;
}

export interface Fill {
  /** Volume-weighted average price actually paid/received per share. */
  avgPrice: number;
  /** avgPrice × shares — cash out (buy) or in (sell). */
  total: number;
  /** Sentiment after the order finishes filling. */
  newSentiment: number;
}

// ── the flow: simulated volatility ──────────────────────────────────────────
//
// Between real events (trades, earnings, decay) nothing moves, and a market
// where nothing moves is a spreadsheet. The flow is DISCLOSED game physics:
// a deterministic, per-ticker volatility field around the anchor — multi-day
// runs, squeezes, crashes, sleepy stretches — computed as a pure function of
// (symbol, time). No randomness at request time, no database writes: every
// client and the server agree on the price at any instant, and charts can
// reconstruct any past moment. Facts stay real: MRR, trades, and events are
// never fabricated. Only the weather is simulated, and it always blows back
// toward fair value.

/** Hard cap on simulated deviation from the sentiment-adjusted price. */
export const FLOW_CAP = 0.55;

/** Deterministic 32-bit hash → [0, 1). Pure math — identical everywhere. */
function hash01(seed: string, n: number): number {
  const s = `${seed}#${n}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1] with the given period (ms). */
function valueNoise(seed: string, t: number, period: number): number {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep between lattice values
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  return a + (b - a) * u;
}

/**
 * Per-ticker volatility multiplier: small caps rip and dump harder.
 * MRR $500 ≈ 1.5×, MRR $50k ≈ 0.8×. Deliberately independent of sentiment:
 * if hype changed the amplitude, a buy could inflate a positive flow and
 * sell straight into it — a guaranteed self-pump skim.
 */
export function volatilityFactor(mrr: number): number {
  return Math.max(
    0.7,
    Math.min(1.7, 1.9 - 0.28 * Math.log10(Math.max(mrr, 1) + 100))
  );
}

/**
 * The flow at an instant: signed fraction in (−FLOW_CAP, +FLOW_CAP).
 * Octaves: multi-day swings, intraday runs, hourly moves, minute chop, and
 * tape shimmer — summed, scaled by the ticker's volatility, then squashed
 * through tanh so extremes flatten instead of exploding.
 */
export function marketFlow(symbol: string, t: number, mrr = 0): number {
  const H = 3600_000;
  const raw =
    0.2 * valueNoise(`${symbol}/a`, t, 72 * H) + // the regime: runs & slumps
    0.13 * valueNoise(`${symbol}/b`, t, 18 * H) + // intraday trends
    0.055 * valueNoise(`${symbol}/c`, t, 4 * H) + // hourly waves
    0.022 * valueNoise(`${symbol}/d`, t, (2 / 3) * H) + // 40-min chop
    0.009 * valueNoise(`${symbol}/e`, t, H / 20) + // 3-min shimmer
    // tick-scale octaves: invisible on a 30-day line, but they're what makes
    // 1s/15s/30s candles a living tape instead of flat bars
    0.0045 * valueNoise(`${symbol}/f`, t, 25_000) + // ~25s
    0.0016 * valueNoise(`${symbol}/g`, t, 2_500); // ~2.5s ticks
  const scaled = raw * volatilityFactor(mrr);
  return FLOW_CAP * Math.tanh(scaled / 0.32);
}

/**
 * The fast octaves alone — texture for the gaps BETWEEN recorded prices.
 * The slow ones are deliberately absent: recorded history already carries
 * the regime (that ramp really happened), this only stops the minutes in
 * between from being drawn as straight lines.
 */
export function microFlow(symbol: string, t: number, mrr = 0): number {
  const raw =
    0.011 * valueNoise(`${symbol}/d`, t, (2 / 3) * 3600_000) + // 40-min chop
    0.009 * valueNoise(`${symbol}/e`, t, 3600_000 / 20) + // 3-min shimmer
    0.0045 * valueNoise(`${symbol}/f`, t, 25_000) +
    0.0016 * valueNoise(`${symbol}/g`, t, 2_500);
  return raw * volatilityFactor(mrr);
}

/**
 * What the ticker trades at, flow included — the ONLY price the app should
 * show or fill at. Anchor × hype × weather.
 */
export function flowPrice(
  symbol: string,
  mrr: number,
  sentiment: number,
  t = Date.now(),
  multiple = ARR_MULTIPLE,
  shares = SHARES_OUTSTANDING
): number {
  return (
    livePrice(mrr, sentiment, multiple, shares) *
    (1 + marketFlow(symbol, t, mrr))
  );
}

/**
 * Slippage: an order fills SHARE BY SHARE along the sentiment curve, so big
 * buys pay progressively more and big sells receive progressively less.
 * Sentiment moves linearly with shares (tradeImpact), so the average price
 * over the moving stretch is fair × (1 + mean sentiment); any shares filled
 * after sentiment pins at the ±40% cap fill flat at the cap price.
 * NOTE: callers fill at the flow-adjusted price — scale avgPrice/total by
 * (1 + marketFlow(...)) at execution time (see executionFillAt).
 */
export function executionFill(
  mrr: number,
  sentiment: number,
  side: TradeSide,
  shares: number,
  multiple = ARR_MULTIPLE,
  outstanding = SHARES_OUTSTANDING
): Fill {
  const fair = fairPrice(mrr, multiple, outstanding);
  const s0 = clampSentiment(sentiment);
  if (!Number.isFinite(shares) || shares <= 0 || fair <= 0) {
    return {
      avgPrice: livePrice(mrr, s0, multiple, outstanding),
      total: 0,
      newSentiment: s0,
    };
  }

  const perShare = TRADE_IMPACT_FACTOR / floatOf(outstanding);
  const sEnd = applyTrade(s0, side, shares, outstanding);
  const movingShares = Math.min(shares, Math.abs(sEnd - s0) / perShare);
  const cappedShares = shares - movingShares;

  const total =
    fair *
    (movingShares * (1 + (s0 + sEnd) / 2) + cappedShares * (1 + sEnd));

  return { avgPrice: total / shares, total, newSentiment: sEnd };
}

/**
 * executionFill at a moment in time: the sentiment-curve fill scaled by the
 * flow, so orders execute at the same price the tape is showing. Round trips
 * at the same instant stay a wash; profiting off the flow means actually
 * timing it.
 */
export function executionFillAt(
  symbol: string,
  mrr: number,
  sentiment: number,
  side: TradeSide,
  shares: number,
  t = Date.now(),
  multiple = ARR_MULTIPLE,
  outstanding = SHARES_OUTSTANDING
): Fill {
  const base = executionFill(
    mrr,
    sentiment,
    side,
    shares,
    multiple,
    outstanding
  );
  const drift = 1 + marketFlow(symbol, t, mrr);
  return {
    avgPrice: base.avgPrice * drift,
    total: base.total * drift,
    newSentiment: base.newSentiment,
  };
}

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
/**
 * Sentiment is a LOG deviation from fair value: price = fair × e^sentiment.
 *
 * It used to be a plain fraction clamped to ±0.4, and the clamp was the
 * problem. Two accounts dumping their maximum position pinned it at the floor
 * and every seller after that was silently discarded — a crowd ran out of road
 * after two people, which is not a market, it is a wall. Real prices go to a
 * tenth of fair value and fifty times it; a panic has to be able to express
 * itself.
 *
 * In log space it never needs a clamp. Each seller moves the price by the same
 * PERCENTAGE, so pressure accumulates forever while the price only approaches
 * zero and never arrives: −18%, −33%, −45%, −63%, −80%, −95%, always further
 * down and always further to go. It is symmetric too — a doubling and a halving
 * are the same size move, which is why price charts are drawn on log axes.
 *
 * The bound below is arithmetic hygiene, not a market rule. e^−6 is a 99.75%
 * drawdown and e^4 is a 55-bagger; nothing should ever reach either, and the
 * only job is to keep an absurd input from producing Infinity.
 */
export const SENTIMENT_FLOOR = -6;
export const SENTIMENT_CEILING = 4;

/** Kept for the explainer page: the move a one-sigma-ish crowd produces. */
export const SENTIMENT_CAP = 0.4;

/** Fraction of sentiment that decays toward zero each day. */
/**
 * Hype fades faster than fear. A pump is forgotten in about a week; a crash
 * takes a fortnight to shake off, because that is how confidence works and
 * because a crash that heals as fast as it happened never mattered.
 */
export const SENTIMENT_DAILY_DECAY = 0.12; // upward hype
export const SENTIMENT_DAILY_DECAY_DOWN = 0.05; // a scar, not a bruise

/**
 * How hard one traded share pushes sentiment.
 * Trading the whole float (10,000 shares) would swing sentiment by
 * TRADE_IMPACT_FACTOR × 100% before clamping; e.g. buying 1,000 shares
 * (10% of the float) pushes sentiment up 0.10 × 2 = +20%.
 */
export const TRADE_IMPACT_FACTOR = 2;

export type TradeSide = "buy" | "sell";

/** Keep sentiment finite. Not a market rule — see SENTIMENT_FLOOR. */
export function clampSentiment(sentiment: number): number {
  if (!Number.isFinite(sentiment)) return 0;
  return Math.min(SENTIMENT_CEILING, Math.max(SENTIMENT_FLOOR, sentiment));
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

/** How finely a share divides: four decimal places, the way brokerages sell fractions. */
export const SHARE_PRECISION = 4;

/** A share count kept to SHARE_PRECISION places. */
export function roundShares(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const k = 10 ** SHARE_PRECISION;
  return Math.round(n * k) / k;
}

/**
 * How many shares a sum of money buys, walking the same fill curve an
 * order fills on, in fractions: the largest amount whose cost stays within
 * the money, to the fourth decimal. Capped by `ceiling` — the room left in
 * the float and the position limit.
 */
export function sharesForDollars(
  dollars: number,
  mrr: number,
  sentiment: number,
  ceiling: number,
  t = Date.now(),
  multiple = ARR_MULTIPLE,
  outstanding = SHARES_OUTSTANDING,
  events: RevenueEvent[] = [],
  drift = 0
): number {
  if (!(dollars > 0) || !(ceiling > 0) || !(mrr > 0)) return 0;
  const cost = (n: number) =>
    executionFillAt("", mrr, sentiment, "buy", n, t, multiple, outstanding, events, drift).total;
  let lo = 0;
  let hi = ceiling;
  // DOWN to the precision, never up: rounding the ceiling up asks for more
  // than the position limit or the float allows, and the order comes back
  // rejected — which made "max" a dead end exactly when it matters
  const k = 10 ** SHARE_PRECISION;
  if (cost(hi) <= dollars) return Math.floor(hi * k) / k;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (cost(mid) <= dollars) lo = mid;
    else hi = mid;
  }
  // down to the precision, never up past the money
  return Math.floor(lo * k) / k;
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
  return fairPrice(mrr, multiple, shares) * Math.exp(clampSentiment(sentiment));
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
  // no market cap to apply — pressure just accumulates, and the price
  // approaches zero (or the moon) without ever getting there
  return clampSentiment(
    clampSentiment(sentiment) + tradeImpact(side, shares, outstanding)
  );
}

/**
 * One daily decay step toward the revenue anchor — slower on the way back up
 * from a crash than on the way down from a pump. Values that decay below a
 * hair's width of zero snap to it so sentiment doesn't linger forever.
 */
export function decaySentiment(sentiment: number): number {
  const s = clampSentiment(sentiment);
  const rate = s < 0 ? SENTIMENT_DAILY_DECAY_DOWN : SENTIMENT_DAILY_DECAY;
  const decayed = s * (1 - rate);
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

// ── the flow: simulated volatility ────────────────────────────────────
//
// Between real events (trades, earnings, decay) nothing moves, and a market
// where nothing moves is a spreadsheet. So there is weather: a per-ticker
// deviation around the anchor — multi-day runs, squeezes, crashes, sleepy
// stretches — that always blows back toward fair value.
//
// The weather used to be a pure function of (symbol, time). That was a hole,
// not a feature. This module ships to the browser — every page with a live
// price imports it — so the whole future of every ticker was one console line
// away: evaluate the field at Date.now() + a day, buy every trough, sell every
// peak. Elaborating the maths would have changed nothing. The attack was never
// to reverse-engineer the function, only to CALL it.
//
// So the weather is no longer computed here. It is drawn from real entropy by
// the five-minute poller, written down (lib/flow.ts, public.flow_ticks) and
// passed into these functions as `drift`. The past is a record anyone can
// replay; the future does not exist yet.
//
// What IS still a function of time is tapeJitter — a sub-percent shimmer so
// the tape between two five-minute ticks reads as a living market rather than
// a staircase. Being precomputable, it is deliberately tiny AND excluded from
// every fill, so there is nothing in it to skim.
//
// Facts stay real either way: MRR, trades and revenue events are never
// fabricated. Only the weather is simulated, and /how says so.

/**
 * One tick of the drift walk — the five-minute poller's beat. Defined here,
 * in the module that ships to the browser, because the trade ticket counts
 * down to the next one; lib/flow re-exports it. (Importing lib/flow from a
 * client component drags the Stripe reader and node:crypto into the bundle.)
 */
export const FLOW_TICK_MS = 5 * 60_000;

/**
 * Bound on the weather, in LOG space: e^±0.9 is 0.4x to 2.5x fair value.
 *
 * This is a hard wall, not the working range — the walk's own spread is
 * about ±14% (lib/flow DRIFT_STEP_SD), so the wall is six sigma out and only
 * a violent regime plus a jump ever touches it. It is NOT what keeps the
 * price honest: that is the 21-day pull. An earlier version tried to do the
 * job with a tight band and a three-day pull, and got an oscillator (lag-1
 * autocorrelation -0.14, variance ratio 0.58). Then it swung to ±1.4 — 0.25x
 * to 4x — which the walk, at its old amplitude, actually reached.
 */
export const FLOW_CAP = 0.9;

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
 * Peak shimmer, before the ticker's volatility factor. Two jobs pull against
 * each other here: big enough that second-scale candles have wicks, small
 * enough that the tape never visibly disagrees with the price you fill at.
 * 0.36% × up to 1.7 ≈ 0.6% worst case, and typically a fifth of that.
 */
export const TAPE_JITTER_PEAK = 0.0036;

/**
 * The shimmer: tape texture between two recorded drift ticks. Weighted toward
 * the fast octaves, because that is exactly the part a five-minute walk cannot
 * supply and a 1s chart needs. Excluded from every fill (see executionFillAt),
 * so predicting it is worth precisely nothing.
 */
export function tapeJitter(symbol: string, t: number, mrr = 0): number {
  const raw =
    0.0012 * valueNoise(`${symbol}/d`, t, (2 / 3) * 3600_000) + // 40-min chop
    0.0011 * valueNoise(`${symbol}/e`, t, 3600_000 / 20) + // 3-min shimmer
    0.0008 * valueNoise(`${symbol}/f`, t, 25_000) + // ~25s
    0.0005 * valueNoise(`${symbol}/g`, t, 2_500); // ~2.5s ticks
  return raw * volatilityFactor(mrr);
}

/**
 * A deterministic fractional Brownian BRIDGE on [0, 1], pinned to zero at both
 * ends: the shape of a price path between two prices you already know.
 *
 * This replaces a sum of smooth noise octaves, and the difference is the whole
 * reason the charts looked fake. Value noise makes round symmetric humps —
 * measured over the old gap-fill: Hurst 0.27, excess kurtosis -0.07 (thinner
 * tailed than a bell curve), lag-1 autocorrelation -0.18. Multiply a straight
 * line by that and you get exactly what was on screen: long clean diagonals
 * with a gentle wobble, which is nothing any human ever traded.
 *
 * A Brownian bridge is not a decoration on a straight line, it IS the
 * distribution a random walk takes given both endpoints — jagged, self-similar
 * at every zoom, no preferred scale. Same numbers measured: Hurst 0.63,
 * kurtosis 4.7, autocorrelation -0.01.
 *
 * Built by midpoint displacement, evaluated by walking down the binary
 * subdivision to `u`, so it stays a pure function of (seed, u) — every viewer
 * draws the identical past, and it costs one loop of `levels` steps.
 */
export function bridgeNoise(
  seed: string,
  u: number,
  levels = 11,
  hurst = 0.42
): number {
  let lo = 0;
  let hi = 1;
  let vLo = 0;
  let vHi = 0;
  let amp = 1;
  const decay = Math.pow(2, -hurst); // fBm: displacement shrinks by 2^-H
  const x = Math.min(1, Math.max(0, u));
  for (let level = 1; level <= levels; level++) {
    const mid = (lo + hi) / 2;
    // the midpoint's index at this depth identifies it uniquely
    const idx = Math.round(mid * (1 << level));
    const vMid = (vLo + vHi) / 2 + amp * (hash01(seed, level * 1048576 + idx) * 2 - 1);
    if (x < mid) {
      hi = mid;
      vHi = vMid;
    } else {
      lo = mid;
      vLo = vMid;
    }
    amp *= decay;
  }
  return vLo + ((vHi - vLo) * (x - lo)) / (hi - lo || 1);
}

/**
 * Typical daily log-return of a ticker's weather, used to size a bridge to the
 * gap it spans. Matches the drift walk at neutral volatility (lib/flow:
 * DRIFT_STEP_SD · sqrt(288) ≈ 3.6%), so a gap filled in by a bridge is as
 * rough as the tape either side of it — no rougher.
 */
export const DAILY_LOG_VOL = 0.04;

/**
 * How far a gap-filling bridge should wander, in log price.
 *
 * A Brownian bridge over T days has standard deviation sigma*sqrt(T)/2 at its
 * midpoint; the 0.866 converts that to the amplitude of the first uniform
 * displacement (a uniform on [-1,1] has sd 1/sqrt(3)).
 *
 * `logMove` is how far the price actually travelled across the gap, and it is
 * what buys volatility CLUSTERING. A textbook bridge ignores its endpoints
 * when choosing its scale, so every day gets the same chop and the chart is
 * evenly frantic from end to end — which is the other half of why the old
 * charts read as fake. Real tapes are quiet for a fortnight and then come
 * apart. A day that went nowhere is calm inside; a day that moved 40% is
 * turbulent inside.
 */
export function bridgeAmplitude(
  gapMs: number,
  mrr = 0,
  logMove = 0
): number {
  const days = Math.max(gapMs, 0) / 86_400_000;
  const realised = Math.abs(logMove) / Math.sqrt(Math.max(days, 1e-6));
  const sigma = 0.55 * DAILY_LOG_VOL + 0.5 * realised;
  return 0.866 * sigma * Math.sqrt(days) * volatilityFactor(mrr);
}

/* ── the revenue pulse: real Stripe changes between monthly reports ──────── */

/** A revenue change Stripe reported between two monthly earnings. */
export interface RevenueEvent {
  at: number; // epoch ms
  mrr: number; // MRR after the change
  prevMrr: number; // MRR before it
  /**
   * True when this is the first reading after a connection — the gap between
   * a month-old report and today's reality, discovered all at once. The price
   * steps to the truth, but it is not news, so it gets no overshoot.
   */
  catchUp?: boolean;
}

/**
 * How far past the fundamental move the tape overshoots on fresh news. A
 * single customer on a three-hundred-customer book is a third of a percent
 * of MRR; at 1.6x the print was invisible on the chart, and a market that
 * does not visibly react to a churn is not reacting. 2.4x gaps it.
 */
export const SHOCK_OVERSHOOT = 2.4;
/**
 * The overshoot is for SMALL news. It saturates: a move of this size gets
 * half the multiple, a move three times it a quarter. A +20% wave used to
 * gap the tape +74% — the fundamental step plus a 45% needle — and then
 * bleed the needle away in an hour of red candles, which read as "a payment
 * sent the stock plummeting". Now it gaps about +28% and gives back 8% over
 * the afternoon.
 */
export const SHOCK_SATURATION = 0.04;
/** The overshoot halves every 90 minutes — post-news drift, not a spike. */
export const SHOCK_HALFLIFE_MS = 90 * 60_000;
/** No single burst of news may move a price more than this on its own. */
export const SHOCK_CAP = 0.2;

/**
 * MRR as Stripe knew it at instant t. Revenue steps — a customer signs up or
 * cancels at a moment — so this walks the known changes backwards from the
 * live number rather than interpolating between them.
 */
export function mrrAt(
  events: RevenueEvent[],
  liveMrr: number,
  t: number
): number {
  let mrr = liveMrr;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].at <= t) break;
    mrr = events[i].prevMrr;
  }
  return mrr;
}

/**
 * The tape's reaction to fresh revenue news, on top of the permanent step:
 * an overshoot that decays away. A churn gapping the price down harder than
 * the revenue justifies, then recovering, is what a real print looks like —
 * and it is the only part of a revenue move that is market reaction rather
 * than arithmetic.
 */
export function revenueShock(events: RevenueEvent[], t: number): number {
  let shock = 0;
  for (const e of events) {
    if (e.at > t || e.prevMrr <= 0 || e.catchUp) continue;
    const age = t - e.at;
    if (age > SHOCK_HALFLIFE_MS * 8) continue; // decayed to nothing
    const move = (e.mrr - e.prevMrr) / e.prevMrr;
    const overshoot = SHOCK_OVERSHOOT / (1 + Math.abs(move) / SHOCK_SATURATION);
    shock += move * overshoot * Math.pow(0.5, age / SHOCK_HALFLIFE_MS);
  }
  return Math.max(-SHOCK_CAP, Math.min(SHOCK_CAP, shock));
}

/**
 * What the ticker trades at — the ONLY price the app should show.
 * Anchor × hype × weather × news × shimmer.
 *
 * `drift` is the recorded weather at instant `t`, read from the walk
 * (tickers.drift for now, public.flow_ticks for the past). It is a parameter
 * rather than a computation on purpose: see the section note above.
 */
export function flowPrice(
  symbol: string,
  mrr: number,
  sentiment: number,
  t = Date.now(),
  multiple = ARR_MULTIPLE,
  shares = SHARES_OUTSTANDING,
  events: RevenueEvent[] = [],
  drift = 0
): number {
  return settledPrice(mrr, sentiment, t, multiple, shares, events, drift) *
    (1 + tapeJitter(symbol, t, mrr));
}

/**
 * The price without the shimmer: what an order actually fills at, and what
 * gets written into the permanent record when a snapshot is taken.
 *
 * The shimmer is a function of time, so a client could predict it; keeping it
 * out of fills is what makes predicting it worthless. The gap it opens
 * between the tape and your fill is under a percent, and it is the same gap
 * every real exchange has between last-trade and your actual print.
 */
export function settledPrice(
  mrr: number,
  sentiment: number,
  t = Date.now(),
  multiple = ARR_MULTIPLE,
  shares = SHARES_OUTSTANDING,
  events: RevenueEvent[] = [],
  drift = 0
): number {
  // with events, `mrr` is the LIVE number and the past is reconstructed from
  // the changes — so a chart drawn now shows the step where it happened
  const known = events.length ? mrrAt(events, mrr, t) : mrr;
  const shock = events.length ? revenueShock(events, t) : 0;
  // LOG SPACE, like sentiment. (1 + drift) is a linear factor that dies at
  // drift <= -1, which is the only reason the weather had to be clamped into
  // a narrow band in the first place — and a narrow band with a short pull is
  // an oscillator, not a market. exp(drift) cannot go negative however far it
  // wanders, and it makes -50% and +100% the same size of move, which is how
  // prices actually behave.
  return (
    livePrice(known, sentiment, multiple, shares) * Math.exp(drift) * (1 + shock)
  );
}

/**
 * Slippage: an order fills SHARE BY SHARE along the sentiment curve, so big
 * buys pay progressively more and big sells receive progressively less.
 * Sentiment moves linearly with shares (tradeImpact), so the average price
 * over the moving stretch is fair × (1 + mean sentiment); any shares filled
 * after sentiment pins at the ±40% cap fill flat at the cap price.
 * NOTE: callers fill at the weather-adjusted price — scale avgPrice/total by
 * exp(drift) at execution time (see executionFillAt), the same factor the
 * tape uses in settledPrice.
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

  /*
   * Every share fills at the price its own arrival creates, so the order is
   * the integral of the price curve across the pressure it adds:
   *
   *     ∫₀ⁿ fair · e^(s₀ + kδ) dk  =  fair · e^s₀ · (e^(nδ) − 1) / δ
   *
   * which is exact, needs no sampling, and has no cap branch — there is no
   * cap any more, so every share of a big order moves the price a little
   * further and pays a little more for it.
   *
   * It also makes a same-instant round trip cancel EXACTLY: buying n shares
   * costs fair·e^s₀·(A−1)/δ with A = e^(nδ), and selling them straight back
   * from s₀+nδ returns fair·e^(s₀+nδ)·(1−A⁻¹)/δ, which is the same number.
   * Pumping your own bag is not merely unprofitable, it is arithmetically a
   * wash before the flow moves.
   */
  const delta = tradeImpact(side, shares, outstanding); // total pressure added
  const sEnd = applyTrade(s0, side, shares, outstanding);
  const perShare = delta / shares;

  const total =
    Math.abs(perShare) < 1e-12
      ? // an impact too small to matter: flat fill at the current price
        shares * fair * Math.exp(s0)
      : (fair * Math.exp(s0) * (Math.exp(delta) - 1)) / perShare;

  return { avgPrice: total / shares, total, newSentiment: sEnd };
}

/**
 * executionFill at a moment in time: the sentiment-curve fill scaled by the
 * recorded weather and any live news, so orders execute at the settled price.
 * Round trips at the same instant stay a wash; profiting off the weather
 * means actually being right about where it goes next — and since the next
 * tick is drawn from entropy the poller has not drawn yet, nobody can be
 * right about it in advance.
 *
 * `symbol` is kept in the signature (unused) so every call site reads the
 * same way as flowPrice; the shimmer is deliberately NOT applied here.
 */
export function executionFillAt(
  _symbol: string,
  mrr: number,
  sentiment: number,
  side: TradeSide,
  shares: number,
  t = Date.now(),
  multiple = ARR_MULTIPLE,
  outstanding = SHARES_OUTSTANDING,
  events: RevenueEvent[] = [],
  drift = 0
): Fill {
  const base = executionFill(
    events.length ? mrrAt(events, mrr, t) : mrr,
    sentiment,
    side,
    shares,
    multiple,
    outstanding
  );
  // fills price off the same weather everyone is watching, news included.
  // exp(drift), NOT (1 + drift): the tape (settledPrice) is in log space, so
  // a linear factor here would fill every buy below the quote whenever the
  // weather is negative — a free discount the panel would have to lie about.
  const scale =
    Math.exp(drift) * (1 + (events.length ? revenueShock(events, t) : 0));
  return {
    avgPrice: base.avgPrice * scale,
    total: base.total * scale,
    newSentiment: base.newSentiment,
  };
}

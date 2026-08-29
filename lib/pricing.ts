/**
 * lib/pricing.ts — THE price formula. The entire market mechanic lives in
 * this one module; nothing else in the app may compute a price.
 *
 * Model:
 *   - Every ticker has a fixed float of 10,000 fake shares.
 *   - fair_price = (latest MRR × 3) / 10,000 — a toy "3x revenue" multiple.
 *   - live price = fair_price × (1 + sentiment).
 *   - sentiment rises with net play-money buying and falls with selling,
 *     is clamped to ±40%, and decays 10% toward zero once per day (cron).
 *
 * So hype moves the price short-term, but MRR is gravity: an MRR update
 * reprices the fair-price anchor immediately — the "earnings report" moment.
 */

/** Fixed float per ticker. Every ticker has exactly this many fake shares. */
export const SHARES_OUTSTANDING = 10_000;

/** Toy valuation multiple applied to monthly recurring revenue. */
export const REVENUE_MULTIPLE = 3;

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

/**
 * The anchor: what the ticker is "worth" per share at a 3x revenue multiple.
 * MRR at or below zero anchors the price at zero — no negative prices.
 */
export function fairPrice(mrr: number): number {
  if (!Number.isFinite(mrr) || mrr <= 0) return 0;
  return (mrr * REVENUE_MULTIPLE) / SHARES_OUTSTANDING;
}

/** What the ticker trades at right now: fair price stretched by sentiment. */
export function livePrice(mrr: number, sentiment: number): number {
  return fairPrice(mrr) * (1 + clampSentiment(sentiment));
}

/** Play-money market cap: live price × the full float. */
export function marketCap(mrr: number, sentiment: number): number {
  return livePrice(mrr, sentiment) * SHARES_OUTSTANDING;
}

/**
 * Signed sentiment delta caused by one trade. Buys push up, sells push down,
 * proportional to how much of the float changed hands.
 */
export function tradeImpact(side: TradeSide, shares: number): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  const direction = side === "buy" ? 1 : -1;
  return direction * (shares / SHARES_OUTSTANDING) * TRADE_IMPACT_FACTOR;
}

/** Sentiment after a trade lands, clamped to the ±40% band. */
export function applyTrade(
  sentiment: number,
  side: TradeSide,
  shares: number
): number {
  return clampSentiment(clampSentiment(sentiment) + tradeImpact(side, shares));
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

/**
 * Slippage: an order fills SHARE BY SHARE along the sentiment curve, so big
 * buys pay progressively more and big sells receive progressively less.
 * Sentiment moves linearly with shares (tradeImpact), so the average price
 * over the moving stretch is fair × (1 + mean sentiment); any shares filled
 * after sentiment pins at the ±40% cap fill flat at the cap price.
 */
export function executionFill(
  mrr: number,
  sentiment: number,
  side: TradeSide,
  shares: number
): Fill {
  const fair = fairPrice(mrr);
  const s0 = clampSentiment(sentiment);
  if (!Number.isFinite(shares) || shares <= 0 || fair <= 0) {
    return { avgPrice: livePrice(mrr, s0), total: 0, newSentiment: s0 };
  }

  const perShare = TRADE_IMPACT_FACTOR / SHARES_OUTSTANDING;
  const sEnd = applyTrade(s0, side, shares);
  const movingShares = Math.min(shares, Math.abs(sEnd - s0) / perShare);
  const cappedShares = shares - movingShares;

  const total =
    fair *
    (movingShares * (1 + (s0 + sEnd) / 2) + cappedShares * (1 + sEnd));

  return { avgPrice: total / shares, total, newSentiment: sEnd };
}

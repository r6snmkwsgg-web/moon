import type { ChartPoint } from "@/lib/types";
import { flowPrice, tapeJitter, type RevenueEvent } from "@/lib/pricing";
import {
  fmtMarketClock,
  fmtMarketDate,
  marketOffset,
} from "@/lib/market-time";

/** One OHLC bar. Volume is trade-derived and may be 0 on quiet buckets. */
export interface Candle {
  t: number; // bucket start, epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // shares traded inside the bucket (real prints only)
}

export interface Timeframe {
  key: string;
  label: string;
  ms: number;
  /** Bars to draw by default at this granularity. */
  bars: number;
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

/**
 * The full ladder, tick to weekly. Sub-minute frames exist because the price
 * function is continuous — recorded ticks joined by the shimmer — so the tape
 * can be zoomed to any granularity without inventing data.
 */
export const TIMEFRAMES: Timeframe[] = [
  { key: "1s", label: "1s", ms: S, bars: 90 },
  { key: "15s", label: "15s", ms: 15 * S, bars: 80 },
  { key: "30s", label: "30s", ms: 30 * S, bars: 80 },
  { key: "1m", label: "1m", ms: M, bars: 80 },
  { key: "5m", label: "5m", ms: 5 * M, bars: 72 },
  { key: "15m", label: "15m", ms: 15 * M, bars: 64 },
  { key: "30m", label: "30m", ms: 30 * M, bars: 64 },
  { key: "1h", label: "1h", ms: H, bars: 60 },
  { key: "4h", label: "4h", ms: 4 * H, bars: 56 },
  { key: "12h", label: "12h", ms: 12 * H, bars: 48 },
  { key: "1d", label: "1D", ms: D, bars: 40 },
  { key: "3d", label: "3D", ms: 3 * D, bars: 30 },
  { key: "1w", label: "1W", ms: 7 * D, bars: 26 },
];

export const DEFAULT_TIMEFRAME = "15m";

export function timeframeFor(key: string): Timeframe {
  return TIMEFRAMES.find((t) => t.key === key) ?? TIMEFRAMES[5];
}

/** How often a chart at this granularity should re-tick (ms). */
export function refreshIntervalFor(tf: Timeframe): number {
  if (tf.ms <= S) return 1000;
  if (tf.ms <= 30 * S) return 2000;
  if (tf.ms <= 5 * M) return 5000;
  return 20_000;
}

/** Zoomed-in floor and ceiling on how many buckets a frame may show. */
export const MIN_BARS = 12;
export const MAX_BARS = 1000;

export interface ZoomPlan {
  bars: number;
  offset: number;
}

export interface ZoomInput {
  /** Buckets in view now. */
  bars: number;
  /** Buckets between the right edge and the live edge. */
  offset: number;
  /** >1 zooms out, <1 zooms in. */
  factor: number;
  /** Anchor: 0 pins the left edge, 1 the right. */
  fx: number;
  /** The most buckets this frame may show — the plot's drawable width. */
  maxBars: number;
  /** How many buckets of this frame the ticker's history covers. */
  totalBars: number;
}

/**
 * Where a zoom gesture lands, in buckets of the CURRENT frame.
 *
 * It does not change the frame, and that is the point. It used to: zooming
 * out on 1s climbed to 15s, then 30s, then 1m, so you could cross the whole
 * history in one gesture — and could not simply look at more seconds, which
 * is the thing anyone zooming out on a 1s chart is trying to do. Granularity
 * is the timeframe selector's job; zoom just moves the window, and stops when
 * the frame runs out of room.
 */
export function planZoom(input: ZoomInput): ZoomPlan {
  const { bars, offset, factor, fx, maxBars, totalBars } = input;
  const fromNow = offset + (bars - 1) * (1 - fx);
  const b = Math.round(
    Math.min(Math.max(maxBars, MIN_BARS), Math.max(MIN_BARS, bars * factor))
  );
  return {
    bars: b,
    offset: Math.max(
      0,
      Math.min(
        Math.round(fromNow - (b - 1) * (1 - fx)),
        Math.max(0, totalBars - b)
      )
    ),
  };
}

/**
 * A continuous price function for one ticker: the recorded history behind the
 * newest anchor, and the current weather in front of it. One curve, no seam.
 *
 * This used to run the live FORMULA for anything in the last twelve hours,
 * which is precisely what made the market predictable — the same call worked
 * just as well with a timestamp in the future. There is no formula to run any
 * more. Everything up to the newest recorded tick is history; everything at or
 * after it holds the last drawn drift, because the next draw has not happened.
 */
export function makePriceAt(
  symbol: string,
  mrr: number,
  sentiment: number,
  series: ChartPoint[],
  multiple?: number,
  shares?: number,
  events: RevenueEvent[] = [],
  drift = 0
): (t: number) => number {
  const sorted = series.length > 1 ? series : [];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return (t: number): number => {
    if (!first || !last || t >= last.t) {
      return flowPrice(symbol, mrr, sentiment, t, multiple, shares, events, drift);
    }
    if (t <= first.t) return first.price;
    // binary search the bracketing recorded points
    let lo = 0;
    let hi = sorted.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = sorted[lo];
    const b = sorted[hi];
    const span = b.t - a.t || 1;
    const w = (t - a.t) / span;
    const lerp = a.price + (b.price - a.price) * w;
    // texture between two real prices, faded to nothing AT them — every
    // recorded value still lands exactly where it happened, but the ten
    // minutes in between get wicks instead of a ruler line.
    return lerp * (1 + Math.sin(Math.PI * w) * tapeJitter(symbol, t, mrr));
  };
}

/**
 * Build OHLC bars by sampling the price function inside each bucket. Sampling
 * (rather than storing ticks) is what makes every granularity available for
 * free and identical for every viewer.
 */
/** Price samples per bucket, tapering as buckets get thinner than a pixel. */
export function sampleCountFor(tf: Timeframe, bars: number): number {
  const base = tf.ms >= H ? 24 : tf.ms >= M ? 16 : 10;
  const FULL = 240; // up to here, sample as richly as before
  return bars <= FULL ? base : Math.max(3, Math.round((base * FULL) / bars));
}

export function buildCandles({
  priceAt,
  tf,
  now,
  earliest,
  trades = [],
  bars,
  offset = 0,
}: {
  priceAt: (t: number) => number;
  tf: Timeframe;
  now: number;
  earliest?: number;
  trades?: { t: number; shares: number }[];
  /** How many buckets to draw — the zoom level. Defaults to the frame's own. */
  bars?: number;
  /** How many buckets back from now the right edge sits — the pan. */
  offset?: number;
}): Candle[] {
  const width = Math.max(2, Math.round(bars ?? tf.bars));
  const bucketOf = (t: number) => Math.floor(t / tf.ms) * tf.ms;
  const lastBucket = bucketOf(now) - Math.max(0, Math.round(offset)) * tf.ms;
  let firstBucket = lastBucket - (width - 1) * tf.ms;
  if (earliest !== undefined) {
    firstBucket = Math.max(firstBucket, bucketOf(earliest));
  }

  const volume = new Map<number, number>();
  for (const tr of trades) {
    const b = bucketOf(tr.t);
    volume.set(b, (volume.get(b) ?? 0) + tr.shares);
  }

  // More samples on wide buckets so wicks reach the real extremes — but the
  // count has to fall away as you zoom out, or the work grows with the view:
  // 4,000 buckets at 24 samples is ~96k price evaluations per repaint. Past a
  // few hundred buckets each one is under a pixel wide, so the wick it would
  // buy is invisible. This keeps the total roughly flat however far out you go.
  const samples = sampleCountFor(tf, width);
  const out: Candle[] = [];

  for (let b = firstBucket; b <= lastBucket; b += tf.ms) {
    const end = Math.min(b + tf.ms, now);
    if (end <= b) {
      const p = priceAt(b);
      out.push({ t: b, o: p, h: p, l: p, c: p, v: volume.get(b) ?? 0 });
      continue;
    }
    const o = priceAt(b);
    let h = o;
    let l = o;
    let c = o;
    for (let k = 1; k <= samples; k++) {
      const p = priceAt(b + ((end - b) * k) / samples);
      if (p > h) h = p;
      if (p < l) l = p;
      c = p;
    }
    out.push({ t: b, o, h, l, c, v: volume.get(b) ?? 0 });
  }
  return out;
}

/** Candles → a line series (closes), for the line/area rendering mode. */
export function candlesToLine(candles: Candle[]): ChartPoint[] {
  return candles.map((c) => ({ t: c.t + 0, price: c.c }));
}

const SECOND = S;
/** Round intervals a human reads as "every N" — the x-axis tick candidates. */
const NICE_STEPS = [
  SECOND, 2 * S, 5 * S, 10 * S, 15 * S, 30 * S,
  M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M,
  H, 2 * H, 3 * H, 6 * H, 12 * H,
  D, 2 * D, 7 * D, 14 * D, 30 * D, 90 * D, 180 * D, 365 * D,
];

/**
 * The smallest round interval that keeps the axis under `count` labels — and
 * never finer than the bars themselves, so ticks always land on a bucket.
 */
export function niceTimeStep(spanMs: number, count: number, floorMs = 0): number {
  const want = Math.max(spanMs / Math.max(1, count), floorMs);
  return NICE_STEPS.find((s) => s >= want) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

/**
 * How far to shift an instant so round tick boundaries land on round times
 * on the market's clock rather than the viewer's. Everyone reads the same
 * axis wherever they are, which is the point of having a house clock.
 */
export function tzOffsetMs(at: number = Date.now()): number {
  return -marketOffset(at);
}

/**
 * Axis label sized to the TICK interval, not the bar: hourly ticks read
 * "14:00", daily ticks read "Aug 30", and the first tick of a new day always
 * shows the date so a multi-day window stays readable.
 */
export function axisTimeLabel(t: number, stepMs: number, dayMark = false): string {
  if (stepMs >= D || dayMark) return fmtMarketDate(t);
  return stepMs < M ? fmtMarketClock(t, true) : fmtMarketClock(t);
}

/** Axis label for a bucket at this granularity. */
export function labelFor(t: number, tf: Timeframe): string {
  if (tf.ms < M) return fmtMarketClock(t, true);
  if (tf.ms < D) return fmtMarketClock(t);
  return fmtMarketDate(t);
}

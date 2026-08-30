import type { ChartPoint } from "@/lib/types";
import { flowPrice } from "@/lib/pricing";

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
 * The full ladder, tick to weekly. Sub-minute frames exist because the flow
 * is defined continuously — there is a real price at every instant, so the
 * tape can be zoomed to any granularity without inventing data.
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

/**
 * A continuous price function for one ticker: the live flow for anything at
 * or after the newest recorded anchor, and the real recorded history (server
 * series: snapshots + prints, flow-modulated) before it. One curve, no seam.
 */
export function makePriceAt(
  symbol: string,
  mrr: number,
  sentiment: number,
  series: ChartPoint[],
  multiple?: number,
  liveWindowMs = 12 * 60 * 60 * 1000
): (t: number) => number {
  const sorted = series.length > 1 ? series : [];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // The recorded series is 10-minute resolution — too coarse to be the source
  // for intraday candles. Anything inside the live window comes straight from
  // the flow (which is what produced those recordings anyway); older history
  // interpolates the real record.
  const liveFrom = Date.now() - liveWindowMs;

  return (t: number): number => {
    if (!first || !last || t >= liveFrom || t >= last.t) {
      return flowPrice(symbol, mrr, sentiment, t, multiple);
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
    return a.price + ((b.price - a.price) * (t - a.t)) / span;
  };
}

/**
 * Build OHLC bars by sampling the price function inside each bucket. Sampling
 * (rather than storing ticks) is what makes every granularity available for
 * free and identical for every viewer.
 */
export function buildCandles({
  priceAt,
  tf,
  now,
  earliest,
  trades = [],
}: {
  priceAt: (t: number) => number;
  tf: Timeframe;
  now: number;
  earliest?: number;
  trades?: { t: number; shares: number }[];
}): Candle[] {
  const bucketOf = (t: number) => Math.floor(t / tf.ms) * tf.ms;
  const lastBucket = bucketOf(now);
  let firstBucket = lastBucket - (tf.bars - 1) * tf.ms;
  if (earliest !== undefined) {
    firstBucket = Math.max(firstBucket, bucketOf(earliest));
  }

  const volume = new Map<number, number>();
  for (const tr of trades) {
    const b = bucketOf(tr.t);
    volume.set(b, (volume.get(b) ?? 0) + tr.shares);
  }

  // more samples on wide buckets so wicks reach the real extremes
  const samples = tf.ms >= H ? 24 : tf.ms >= M ? 16 : 10;
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

/** Axis label for a bucket at this granularity. */
export function labelFor(t: number, tf: Timeframe): string {
  const d = new Date(t);
  if (tf.ms < M) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  if (tf.ms < D) {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

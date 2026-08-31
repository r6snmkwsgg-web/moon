import { describe, expect, it } from "vitest";
import {
  axisTimeLabel,
  buildCandles,
  makePriceAt,
  MAX_BARS,
  MIN_BARS,
  niceTimeStep,
  planZoom,
  TIMEFRAMES,
  timeframeFor,
  type Timeframe,
} from "@/lib/candles";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const tf = timeframeFor("15m");
const priceAt = (t: number) => 100 + Math.sin(t / 1e6);

describe("buildCandles view window", () => {
  const now = 1_700_000_000_000;

  it("draws the frame's own bar count by default", () => {
    expect(buildCandles({ priceAt, tf, now })).toHaveLength(tf.bars);
  });

  it("zooms out to as many bars as asked for", () => {
    expect(buildCandles({ priceAt, tf, now, bars: 240 })).toHaveLength(240);
    expect(buildCandles({ priceAt, tf, now, bars: 20 })).toHaveLength(20);
  });

  it("pans back in whole buckets, keeping the width", () => {
    const live = buildCandles({ priceAt, tf, now, bars: 40 });
    const back = buildCandles({ priceAt, tf, now, bars: 40, offset: 10 });
    expect(back).toHaveLength(40);
    expect(back[back.length - 1].t).toBe(live[live.length - 1].t - 10 * tf.ms);
  });

  it("never draws further back than the ticker exists", () => {
    const earliest = now - 5 * HOUR;
    const bars = buildCandles({ priceAt, tf, now, bars: 500, earliest });
    expect(bars.length).toBeLessThanOrEqual(21); // 5h of 15m buckets
    expect(bars[0].t).toBeGreaterThanOrEqual(earliest - tf.ms);
  });
});

describe("makePriceAt", () => {
  const now = Date.now();
  // recorded anchors, well outside the live window (where the flow takes over)
  const series = [
    { t: now - 40 * HOUR, price: 10 },
    { t: now - 39 * HOUR, price: 20 },
    { t: now - 38 * HOUR, price: 30 },
  ];
  const at = makePriceAt("TEST", 5_000, 0, series);

  it("lands exactly on recorded prices", () => {
    expect(at(series[0].t)).toBeCloseTo(10, 6);
    expect(at(series[1].t)).toBeCloseTo(20, 6);
  });

  it("textures the gap between them without wandering off", () => {
    const mid = at((series[0].t + series[1].t) / 2);
    expect(mid).toBeGreaterThan(13);
    expect(mid).toBeLessThan(17);
    const quarter = at(series[0].t + 15 * MIN);
    expect(quarter).not.toBe(12.5); // not a straight line any more
    expect(Math.abs(quarter - 12.5)).toBeLessThan(0.6);
  });
});

describe("time axis", () => {
  it("picks round steps that fit the label count", () => {
    expect(niceTimeStep(12 * HOUR, 6)).toBe(2 * HOUR);
    expect(niceTimeStep(30 * DAY, 6)).toBe(7 * DAY);
    expect(niceTimeStep(90 * MIN, 6)).toBe(15 * MIN);
  });

  it("never ticks finer than the bars themselves", () => {
    expect(niceTimeStep(HOUR, 60, 15 * MIN)).toBe(15 * MIN);
  });

  it("sizes the label to the tick, not the bar", () => {
    const t = Date.UTC(2026, 7, 30, 14, 30);
    expect(axisTimeLabel(t, DAY)).toMatch(/Aug 30/);
    expect(axisTimeLabel(t, 30 * MIN)).toMatch(/^\d\d:\d\d$/);
    expect(axisTimeLabel(t, 5_000)).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(axisTimeLabel(t, 30 * MIN, true)).toMatch(/Aug 30/);
  });
});

/* ── zoom: the ladder walk ────────────────────────────────────────────────── */

/** A 720px plot at the comfort step — what a desktop chart can draw. */
const DESKTOP_LEGIBLE = 144;
/** A 338px phone plot. */
const PHONE_LEGIBLE = 67;

function frame(key: string): Timeframe {
  return timeframeFor(key);
}

describe("planZoom", () => {
  const base = {
    offset: 0,
    fx: 1,
    legibleBars: DESKTOP_LEGIBLE,
    historyMs: 123 * DAY,
  };

  it("REGRESSION: never leaves the buckets illegible while a coarser frame has room", () => {
    // The bug: handover happened at MAX_BARS (1000 buckets in a 720px plot),
    // so zooming out on 15m spent six steps drawing a bare line. Walk the
    // whole ladder out and assert every landing is drawable.
    let tf = frame("15m");
    let bars = tf.bars;
    let offset = 0;
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const plan = planZoom({ ...base, tf, bars, offset, factor: 1.35 });
      tf = plan.tf;
      bars = plan.bars;
      offset = plan.offset;
      seen.push(tf.key);
      const roomToClimb =
        TIMEFRAMES.indexOf(tf) < TIMEFRAMES.length - 1 &&
        base.historyMs / TIMEFRAMES[TIMEFRAMES.indexOf(tf) + 1].ms >= MIN_BARS;
      if (roomToClimb) {
        expect(
          bars,
          `step ${i} on ${tf.key} left ${bars} buckets — illegible with room to climb`
        ).toBeLessThanOrEqual(DESKTOP_LEGIBLE);
      }
    }
    // and it climbed rather than sat still
    expect(seen).toContain("1h");
    expect(seen[seen.length - 1]).toBe("1w");
  });

  it("REGRESSION: one big gesture climbs more than one rung", () => {
    // A pinch can ask for triple the span; 30m→1h only halves the bucket
    // count, so a single-rung step used to land back in line mode.
    const plan = planZoom({ ...base, tf: frame("15m"), bars: 140, factor: 4 });
    expect(plan.tf.key).not.toBe("15m");
    expect(plan.tf.key).not.toBe("30m"); // one rung would not have been enough
    expect(plan.bars).toBeLessThanOrEqual(DESKTOP_LEGIBLE);
  });

  it("carries the visible span across a handover, so the picture doesn't jump", () => {
    const tf = frame("15m");
    const bars = 200;
    const plan = planZoom({ ...base, tf, bars, factor: 1.35 });
    const before = bars * 1.35 * tf.ms;
    const after = plan.bars * plan.tf.ms;
    expect(after / before).toBeGreaterThan(0.9);
    expect(after / before).toBeLessThan(1.1);
  });

  it("a phone hands over sooner, because less fits", () => {
    const onPhone = planZoom({
      ...base,
      legibleBars: PHONE_LEGIBLE,
      tf: frame("15m"),
      bars: 60,
      factor: 1.35,
    });
    const onDesktop = planZoom({ ...base, tf: frame("15m"), bars: 60, factor: 1.35 });
    expect(onPhone.tf.key).toBe("30m");
    expect(onDesktop.tf.key).toBe("15m"); // still room on a wide plot
    expect(onPhone.bars).toBeLessThanOrEqual(PHONE_LEGIBLE);
  });

  it("zooming in walks back down and keeps the buckets above the floor", () => {
    let tf = frame("1w");
    let bars = 20;
    for (let i = 0; i < 40; i++) {
      const plan = planZoom({ ...base, tf, bars, offset: 0, factor: 1 / 1.35 });
      tf = plan.tf;
      bars = plan.bars;
      expect(bars).toBeGreaterThanOrEqual(MIN_BARS);
    }
    expect(tf.key).toBe("1s"); // all the way to the tape
  });

  it("stops climbing when the granularity outruns the history", () => {
    // two days old: a weekly bucket is one bar and an empty axis
    let tf = frame("15m");
    let bars = tf.bars;
    for (let i = 0; i < 40; i++) {
      const plan = planZoom({
        ...base,
        historyMs: 2 * DAY,
        tf,
        bars,
        offset: 0,
        factor: 1.35,
      });
      tf = plan.tf;
      bars = plan.bars;
    }
    expect(2 * DAY / tf.ms).toBeGreaterThanOrEqual(MIN_BARS);
    expect(["1h", "4h"]).toContain(tf.key);
  });

  it("is stable: zooming out then back in returns to the same frame", () => {
    const start = { ...base, tf: frame("1h"), bars: 60, offset: 0 };
    const out = planZoom({ ...start, factor: 1.35 });
    const back = planZoom({ ...base, tf: out.tf, bars: out.bars, offset: out.offset, factor: 1 / 1.35 });
    expect(back.tf.key).toBe(start.tf.key);
    expect(back.bars).toBeGreaterThan(start.bars * 0.9);
    expect(back.bars).toBeLessThan(start.bars * 1.1);
  });

  it("never returns a negative offset or a bar count below the floor", () => {
    for (const key of TIMEFRAMES.map((t) => t.key)) {
      for (const factor of [0.1, 0.5, 1, 2, 10, 100]) {
        const plan = planZoom({ ...base, tf: frame(key), bars: 40, offset: 5, factor });
        expect(plan.bars).toBeGreaterThanOrEqual(MIN_BARS);
        expect(plan.bars).toBeLessThanOrEqual(MAX_BARS);
        expect(plan.offset).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(plan.offset)).toBe(true);
      }
    }
  });

  it("copes with an unknown reach", () => {
    const plan = planZoom({ ...base, historyMs: null, tf: frame("15m"), bars: 300, factor: 1.35 });
    expect(plan.bars).toBeGreaterThanOrEqual(MIN_BARS);
    expect(Number.isFinite(plan.bars)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  axisTimeLabel,
  buildCandles,
  makePriceAt,
  niceTimeStep,
  timeframeFor,
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

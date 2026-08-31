import { describe, expect, it } from "vitest";
import {
  axisTimeLabel,
  buildCandles,
  makePriceAt,
  mergeAnchors,
  MIN_BARS,
  niceTimeStep,
  planZoom,
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

/* ── zoom: a window on the frame you chose ───────────────────────────────── */

/** A 720px plot at CANDLE_MIN_STEP — what a desktop chart can draw. */
const DESKTOP_MAX = 240;
/** A 338px phone plot. */
const PHONE_MAX = 112;

describe("planZoom", () => {
  const base = { offset: 0, fx: 1, maxBars: DESKTOP_MAX, totalBars: 100_000 };

  it("REGRESSION: zooming out never changes the frame you picked", () => {
    // It used to climb the ladder — 1s became 15s became 30s — so you could
    // not simply look at more seconds. planZoom has no timeframe to return
    // any more; this test is the contract, and the type is the enforcement.
    const plan = planZoom({ ...base, bars: 90, factor: 1.35 });
    expect(Object.keys(plan).sort()).toEqual(["bars", "offset"]);
    expect(plan.bars).toBeGreaterThan(90);
  });

  it("keeps zooming out until the frame runs out of room, then stops", () => {
    let bars = timeframeFor("1s").bars;
    let offset = 0;
    const steps: number[] = [];
    for (let i = 0; i < 30; i++) {
      const plan = planZoom({ ...base, bars, offset, factor: 1.35 });
      bars = plan.bars;
      offset = plan.offset;
      steps.push(bars);
    }
    expect(Math.max(...steps)).toBe(DESKTOP_MAX);
    expect(bars).toBe(DESKTOP_MAX); // parks at the limit rather than oscillating
  });

  it("the limit follows the plot: a phone stops sooner", () => {
    let bars = 90;
    for (let i = 0; i < 30; i++) {
      bars = planZoom({ ...base, maxBars: PHONE_MAX, bars, factor: 1.35 }).bars;
    }
    expect(bars).toBe(PHONE_MAX);
  });

  it("history caps it too — a young ticker cannot zoom past its own life", () => {
    let bars = 20;
    for (let i = 0; i < 30; i++) {
      bars = planZoom({ ...base, maxBars: 40, totalBars: 40, bars, factor: 1.35 }).bars;
    }
    expect(bars).toBe(40);
  });

  it("zooms back in to the floor and no further", () => {
    let bars = DESKTOP_MAX;
    for (let i = 0; i < 40; i++) {
      bars = planZoom({ ...base, bars, factor: 1 / 1.35 }).bars;
    }
    expect(bars).toBe(MIN_BARS);
  });

  it("is reversible: out then in returns to where it started", () => {
    const out = planZoom({ ...base, bars: 64, factor: 1.35 });
    const back = planZoom({ ...base, bars: out.bars, offset: out.offset, factor: 1 / 1.35 });
    expect(back.bars).toBe(64);
  });

  it("pins the anchor: fx=1 holds the live edge, fx=0 holds the left", () => {
    const right = planZoom({ ...base, bars: 60, offset: 0, factor: 2, fx: 1 });
    expect(right.offset).toBe(0); // still against the live edge

    const left = planZoom({ ...base, bars: 60, offset: 100, factor: 2, fx: 0 });
    // the left edge sat 159 buckets back; doubling the window keeps it there
    expect(left.offset).toBe(100 - 60);
  });

  it("never returns a negative offset or a bar count outside the bounds", () => {
    for (const factor of [0.01, 0.5, 1, 2, 10, 1000]) {
      for (const offset of [0, 5, 900]) {
        const plan = planZoom({ ...base, bars: 40, offset, factor });
        expect(plan.bars).toBeGreaterThanOrEqual(MIN_BARS);
        expect(plan.bars).toBeLessThanOrEqual(DESKTOP_MAX);
        expect(plan.offset).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(plan.offset)).toBe(true);
      }
    }
  });

  it("survives a frame narrower than the floor", () => {
    const plan = planZoom({ ...base, maxBars: 4, totalBars: 4, bars: 12, factor: 2 });
    expect(plan.bars).toBe(MIN_BARS);
    expect(plan.offset).toBe(0);
  });
});

/* ── anchors: which points are real, and in what order ───────────────────── */

describe("mergeAnchors", () => {
  const NOW = Date.parse("2026-08-31T05:26:00Z"); // before 06:00, the bad window
  const base = { snapshots: [], trades: [], ticks: [], now: NOW, live: 27.8 };

  it("REGRESSION: today's snapshot never lands in the future", () => {
    // The bug, exactly as it shipped: at 05:26 UTC today's row was pinned to
    // 06:00 — 34 minutes ahead of now — at $30.16 against a live tape of
    // $27.80. It sorted last, so makePriceAt treated it as the newest real
    // price and interpolated the whole right edge toward it. Every one of 21
    // tickers had it; the worst was 44% out.
    const out = mergeAnchors({
      ...base,
      snapshots: [
        { day: "2026-08-30", price: 29.55 },
        { day: "2026-08-31", price: 30.16 },
      ],
    });
    expect(out.every((a) => a.t <= NOW)).toBe(true);
    expect(out.map((a) => a.price)).not.toContain(30.16);
    expect(out[out.length - 1]).toEqual({ t: NOW, price: 27.8 });
  });

  it("drops today's row even in the afternoon, when the pin is hours stale", () => {
    const afternoon = Date.parse("2026-08-31T20:00:00Z");
    const out = mergeAnchors({
      ...base,
      now: afternoon,
      snapshots: [{ day: "2026-08-31", price: 30.16 }],
    });
    // the 06:00 pin is in the past now, but the price is from 20:00 — placing
    // it fourteen hours early is its own lie
    expect(out).toHaveLength(1);
    expect(out[0].t).toBe(afternoon);
  });

  it("keeps every finished day, pinned to its own 06:00", () => {
    const out = mergeAnchors({
      ...base,
      snapshots: [
        { day: "2026-08-29", price: 17.9 },
        { day: "2026-08-30", price: 29.55 },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[0].t).toBe(Date.parse("2026-08-29T06:00:00Z"));
    expect(out[1].t).toBe(Date.parse("2026-08-30T06:00:00Z"));
  });

  it("nothing outlives the live point, whatever the row says", () => {
    const out = mergeAnchors({
      ...base,
      trades: [
        { at: NOW - 60_000, price: 27.5 },
        { at: NOW + 60_000, price: 99 }, // a clock that ran ahead
        { at: NOW, price: 88 }, // exactly now is still not after now
      ],
      ticks: [{ at: NOW + 600_000, price: 77 }],
    });
    expect(out.map((a) => a.price)).toEqual([27.5, 27.8]);
  });

  it("interleaves prints and ticks in time order", () => {
    const out = mergeAnchors({
      ...base,
      snapshots: [{ day: "2026-08-30", price: 29.55 }],
      trades: [{ at: Date.parse("2026-08-30T19:28:00Z"), price: 29.23 }],
      ticks: [
        { at: Date.parse("2026-08-31T04:30:00Z"), price: 27.5 },
        { at: Date.parse("2026-08-31T05:22:00Z"), price: 27.8 },
      ],
    });
    expect(out.map((a) => a.price)).toEqual([29.55, 29.23, 27.5, 27.8, 27.8]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].t).toBeGreaterThanOrEqual(out[i - 1].t);
    }
  });

  it("throws away junk rather than drawing it", () => {
    const out = mergeAnchors({
      ...base,
      trades: [
        { at: NOW - 1000, price: NaN },
        { at: NOW - 2000, price: 0 },
        { at: NOW - 3000, price: -5 },
        { at: NaN, price: 20 },
        { at: NOW - 4000, price: 26 },
      ],
    });
    expect(out.map((a) => a.price)).toEqual([26, 27.8]);
  });

  it("REGRESSION: nothing is drawn from before the ticker existed", () => {
    // A backfill once laid seven hours of tape ahead of a ticker's own
    // listing timestamp. That is the same lie as a snapshot dated in the
    // future, pointed the other way, and it made a two-day-old listing look
    // like it had been trading before anyone could buy it.
    const listed = NOW - 2 * 86_400_000;
    const out = mergeAnchors({
      ...base,
      notBefore: listed,
      snapshots: [
        { day: "2026-08-25", price: 40 }, // before the listing
        { day: "2026-08-30", price: 29.55 },
      ],
      ticks: [
        { at: listed - 3_600_000, price: 99 }, // an hour too early
        { at: listed, price: 18.1 }, // the listing instant itself counts
        { at: listed + 3_600_000, price: 17.9 },
      ],
    });
    expect(out.map((a) => a.price)).toEqual([18.1, 17.9, 29.55, 27.8]);
  });

  it("without a listing time nothing is filtered out", () => {
    const out = mergeAnchors({
      ...base,
      ticks: [{ at: NOW - 10 * 86_400_000, price: 5 }],
    });
    expect(out).toHaveLength(2);
  });

  it("an empty board is still a one-point series, not a crash", () => {
    expect(mergeAnchors(base)).toEqual([{ t: NOW, price: 27.8 }]);
  });
});

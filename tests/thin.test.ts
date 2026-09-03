import { describe, expect, it } from "vitest";
import { thinSeries } from "@/lib/equity";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function walk(from: number, to: number, step: number) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ t, price: 10 + Math.sin(t / HOUR) });
  return out;
}

describe("thinSeries — the curve's resolution, not the chart's", () => {
  const now = Date.UTC(2026, 8, 3, 12);

  it("keeps every point of the last day", () => {
    const s = walk(now - DAY + 5 * 60_000, now, 5 * 60_000);
    expect(thinSeries(s, now)).toEqual(s);
  });

  it("keeps one point per half hour over the week, and it is a recorded one", () => {
    const s = walk(now - 3 * DAY, now - 2 * DAY, 5 * 60_000);
    const thin = thinSeries(s, now);
    // 48 half-hour buckets, the first point, and a boundary
    expect(thin.length).toBeLessThanOrEqual(51);
    expect(thin.length).toBeGreaterThanOrEqual(47);
    for (const p of thin) expect(s).toContainEqual(p);
    // the last point of the input survives — the curve's right edge is real
    expect(thin[thin.length - 1]).toEqual(s[s.length - 1]);
  });

  it("thins a forty-five-day book from thousands of points to a few hundred", () => {
    const s = walk(now - 45 * DAY, now, 10 * 60_000);
    const thin = thinSeries(s, now);
    expect(s.length).toBeGreaterThan(6000);
    expect(thin.length).toBeLessThan(800);
    expect(thin[0]).toEqual(s[0]);
    expect(thin[thin.length - 1]).toEqual(s[s.length - 1]);
  });

  it("is a no-op on the empty series", () => {
    expect(thinSeries([], now)).toEqual([]);
  });
});

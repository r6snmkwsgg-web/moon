import { describe, expect, it } from "vitest";
import { dividendPool, DIVIDEND_YEARS } from "@/lib/dividends";
import { credibility, judgeCall, MET_BAND } from "@/lib/calls";

describe("dividends", () => {
  it("pays a year of the growth, and nothing for a flat or shrinking month", () => {
    expect(dividendPool(14_200, 15_000)).toBeCloseTo(800 * 12 * DIVIDEND_YEARS, 6);
    expect(dividendPool(14_200, 14_200)).toBe(0);
    expect(dividendPool(14_200, 13_000)).toBe(0);
    expect(dividendPool(0, 500)).toBe(0);
  });
});

describe("earnings calls", () => {
  it("judges a call against the print within a band", () => {
    expect(judgeCall(0.15, 0.22)).toBe("beat");
    expect(judgeCall(0.15, 0.15 + MET_BAND / 2)).toBe("met");
    expect(judgeCall(0.15, 0.02)).toBe("missed");
  });

  it("credibility starts partial, rises on beats, falls on misses, and is bounded", () => {
    expect(credibility([])).toBeCloseTo(0.7, 10);
    expect(credibility(["beat", "beat", "met"])).toBeGreaterThan(0.9);
    expect(credibility(["missed", "missed", "missed", "missed"])).toBeLessThan(0.45);
    expect(credibility(Array(20).fill("missed"))).toBeGreaterThanOrEqual(0.3);
    expect(credibility(Array(20).fill("beat"))).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import { referencePrice } from "@/lib/reference";

describe("referencePrice — a value read with no formula in it", () => {
  it("is where the tape has closed, not where any formula says", () => {
    const closes = [10, 12, 11, 13, 12, 12, 14].map((price) => ({ price, mrr: 1000 }));
    const ref = referencePrice(closes, 1000, 99);
    expect(ref).toBeGreaterThan(11.5);
    expect(ref).toBeLessThan(12.5);
  });

  it("restates every close at today's revenue — a business that grew 20% is worth 20% more of the same tape", () => {
    const closes = [10, 10, 10].map((price) => ({ price, mrr: 1000 }));
    expect(referencePrice(closes, 1200, 0)).toBeCloseTo(12, 6);
    expect(referencePrice(closes, 800, 0)).toBeCloseTo(8, 6);
  });

  it("caps what a revenue swing can do to one close, so a demo wave is not a 5× read", () => {
    const closes = [{ price: 10, mrr: 100 }];
    expect(referencePrice(closes, 1000, 0)).toBeCloseTo(20, 6);
    expect(referencePrice(closes, 1, 0)).toBeCloseTo(5, 6);
  });

  it("lags a pump: after a fast run the read is still back where the closes were", () => {
    const closes = [10, 10, 10, 10, 10, 10, 10].map((price) => ({ price, mrr: 1000 }));
    // the price is 15 today; the read says 10, so a value account sells into it
    expect(referencePrice(closes, 1000, 15)).toBeCloseTo(10, 6);
  });

  it("has no opinion on a fresh listing — the fallback, and nothing else", () => {
    expect(referencePrice([], 1000, 7.5)).toBe(7.5);
    expect(referencePrice([{ price: 0, mrr: 100 }], 1000, 7.5)).toBe(7.5);
    expect(referencePrice([], 1000, 0)).toBe(0);
  });

  it("ignores a close with no revenue behind it rather than dividing by zero", () => {
    expect(referencePrice([{ price: 10, mrr: 0 }], 1000, 0)).toBeCloseTo(10, 6);
  });
});

import { describe, expect, it } from "vitest";
import { makeEquityAt, sampleEquity, type EquityInputs } from "@/lib/equity";

const HOUR = 3_600_000;
const NOW = Date.now();

/** A ticker whose recorded history is flat $10, so the math is checkable. */
function holding(symbol: string, shares: number) {
  return {
    symbol,
    shares,
    mrr: 10_000,
    sentiment: 0,
    multiple: 2.5,
    outstanding: 10_000,
    // two anchors well outside the live window, both at $10
    series: [
      { t: NOW - 40 * HOUR, price: 10 },
      { t: NOW - 20 * HOUR, price: 10 },
      { t: NOW - 13 * HOUR, price: 10 },
    ],
    events: [],
  };
}

describe("the equity curve", () => {
  it("is just cash before the first trade", () => {
    const inputs: EquityInputs = {
      cash: 8_000,
      holdings: [holding("AAA", 200)],
      trades: [
        { t: NOW - 30 * HOUR, symbol: "AAA", side: "buy", shares: 200, total: 2_000 },
      ],
      startedAt: NOW - 40 * HOUR,
      startingCash: 10_000,
    };
    const at = makeEquityAt(inputs);
    // before the buy: no shares, all $10,000 in cash
    expect(at(NOW - 35 * HOUR)).toBeCloseTo(10_000, 6);
  });

  it("does not create or destroy value at the moment of a trade", () => {
    const buyAt = NOW - 30 * HOUR;
    const held = holding("AAA", 200);
    // getPriceSeries records every print as an anchor, so the reconstructed
    // curve passes exactly through the price the trade actually filled at
    held.series = [...held.series, { t: buyAt, price: 10 }].sort((a, b) => a.t - b.t);
    const inputs: EquityInputs = {
      cash: 8_000,
      holdings: [held],
      trades: [
        { t: buyAt, symbol: "AAA", side: "buy", shares: 200, total: 2_000 },
      ],
      startedAt: NOW - 40 * HOUR,
      startingCash: 10_000,
    };
    const at = makeEquityAt(inputs);
    // either side of the fill instant: cash became shares, nothing else. (A
    // wider window would also catch the price moving, which is not the point.)
    const before = at(buyAt - 1);
    const after = at(buyAt + 1);
    expect(Math.abs(after - before) / before).toBeLessThan(1e-6);
  });

  it("tracks the price of what is held", () => {
    const inputs: EquityInputs = {
      cash: 0,
      holdings: [holding("AAA", 1_000)],
      trades: [
        { t: NOW - 30 * HOUR, symbol: "AAA", side: "buy", shares: 1_000, total: 10_000 },
      ],
      startedAt: NOW - 40 * HOUR,
      startingCash: 10_000,
    };
    const at = makeEquityAt(inputs);
    // 1,000 shares anchored at $10 — the texture between anchors moves it a
    // little, which is the whole point, but it stays on the anchor
    const v = at(NOW - 25 * HOUR);
    expect(v).toBeGreaterThan(9_700);
    expect(v).toBeLessThan(10_300);
  });

  it("puts a sold position back when you look at the past", () => {
    const inputs: EquityInputs = {
      cash: 10_400,
      holdings: [],
      trades: [
        { t: NOW - 30 * HOUR, symbol: "AAA", side: "buy", shares: 200, total: 2_000 },
        { t: NOW - 22 * HOUR, symbol: "AAA", side: "sell", shares: 200, total: 2_400 },
      ],
      startedAt: NOW - 40 * HOUR,
      startingCash: 10_000,
    };
    const at = makeEquityAt(inputs);
    expect(at(NOW - 35 * HOUR)).toBeCloseTo(10_000, 6); // before buying
    expect(at(NOW - 21 * HOUR)).toBeCloseTo(10_400, 6); // after selling
  });

  it("moves between samples — a real curve, not a ruler", () => {
    const inputs: EquityInputs = {
      cash: 100,
      holdings: [
        {
          ...holding("AAA", 500),
          // no recorded history, so every point comes from the live flow
          series: [],
        },
      ],
      trades: [],
      startedAt: NOW - 6 * HOUR,
      startingCash: 10_000,
    };
    const at = makeEquityAt(inputs);
    const series = sampleEquity(at, NOW - 3 * HOUR, NOW, 60);
    const values = series.map((p) => p.price);
    const distinct = new Set(values.map((v) => v.toFixed(4)));
    expect(distinct.size).toBeGreaterThan(40); // it wiggles at every sample
    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values) * 1.001);
  });

  it("samples the window it is asked for", () => {
    const at = () => 42;
    const s = sampleEquity(at, NOW - HOUR, NOW, 10);
    expect(s).toHaveLength(11);
    expect(s[0].t).toBe(NOW - HOUR);
    expect(s[s.length - 1].t).toBe(NOW);
  });
});

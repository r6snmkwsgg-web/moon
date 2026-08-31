import { describe, expect, it } from "vitest";
import {
  allocationSlices,
  makeEquityAt,
  makeStateAt,
  realizedPnl,
  sampleEquity,
  type EquityInputs,
} from "@/lib/equity";

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
    drift: 0,
    name: symbol,
    logoUrl: null,
    avgCost: 10,
    dayChange: 0,
    weekChange: 0,
    spark: [],
  };
}

describe("the equity curve", () => {
  it("is just cash before the first trade", () => {
    const inputs: EquityInputs = {
      cash: 8_000,
      holdings: [holding("AAA", 200)],
      trades: [
        { t: NOW - 30 * HOUR, symbol: "AAA", side: "buy", shares: 200, price: 2_000 / 200, total: 2_000, note: null },
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
        { t: buyAt, symbol: "AAA", side: "buy", shares: 200, price: 2_000 / 200, total: 2_000, note: null },
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
        { t: NOW - 30 * HOUR, symbol: "AAA", side: "buy", shares: 1_000, price: 10_000 / 1_000, total: 10_000, note: null },
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
        { t: NOW - 30 * HOUR, symbol: "AAA", side: "buy", shares: 200, price: 2_000 / 200, total: 2_000, note: null },
        { t: NOW - 22 * HOUR, symbol: "AAA", side: "sell", shares: 200, price: 2_400 / 200, total: 2_400, note: null },
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

describe("realized PnL", () => {
  const t = (n: number) => NOW - (10 - n) * HOUR;
  const trade = (
    i: number,
    side: "buy" | "sell",
    shares: number,
    price: number
  ) => ({
    t: t(i),
    symbol: "AAA",
    side,
    shares,
    price,
    total: shares * price,
    note: null,
  });

  it("books nothing until something is sold", () => {
    expect(realizedPnl([trade(1, "buy", 100, 10)])).toBe(0);
  });

  it("books the gain when a winner is closed", () => {
    // bought 100 at $10, sold 100 at $12
    expect(realizedPnl([trade(1, "buy", 100, 10), trade(2, "sell", 100, 12)])).toBeCloseTo(200, 6);
  });

  it("books a loss the same way", () => {
    expect(realizedPnl([trade(1, "buy", 100, 10), trade(2, "sell", 100, 7)])).toBeCloseTo(-300, 6);
  });

  it("averages the cost of several buys", () => {
    // 100 at $10 then 100 at $20 → average $15; selling 200 at $18 books $600
    const pnl = realizedPnl([
      trade(1, "buy", 100, 10),
      trade(2, "buy", 100, 20),
      trade(3, "sell", 200, 18),
    ]);
    expect(pnl).toBeCloseTo(600, 6);
  });

  it("only books the part that was sold", () => {
    const pnl = realizedPnl([
      trade(1, "buy", 100, 10),
      trade(2, "sell", 40, 15),
    ]);
    expect(pnl).toBeCloseTo(200, 6); // 40 × $5
  });

  it("survives a sell with nothing on the book", () => {
    expect(realizedPnl([trade(1, "sell", 10, 5)])).toBeCloseTo(50, 6);
  });
});

describe("holdings at a moment", () => {
  it("knows what was held before and after a trade", () => {
    const buyAt = NOW - 5 * HOUR;
    const inputs: EquityInputs = {
      cash: 5_000,
      holdings: [holding("AAA", 100)],
      trades: [
        { t: buyAt, symbol: "AAA", side: "buy", shares: 100, price: 50, total: 5_000, note: null },
      ],
      startedAt: NOW - 10 * HOUR,
      startingCash: 10_000,
    };
    const stateAt = makeStateAt(inputs);
    expect(stateAt(buyAt - 1).shares.get("AAA") ?? 0).toBe(0);
    expect(stateAt(buyAt - 1).cash).toBe(10_000);
    expect(stateAt(buyAt + 1).shares.get("AAA")).toBe(100);
    expect(stateAt(buyAt + 1).cash).toBe(5_000);
  });
});

describe("allocationSlices", () => {
  const pos = (label: string, value: number) => ({ label, name: label, value });

  it("sorts by value, appends cash last, and sums to one", () => {
    const s = allocationSlices(
      [pos("$B", 200), pos("$A", 500), pos("$C", 300)],
      1000,
      5
    );
    expect(s.map((x) => x.label)).toEqual(["$A", "$C", "$B", "Cash"]);
    expect(s.at(-1)!.isCash).toBe(true);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 12);
  });

  it("lays arcs end to end with no gap or overlap", () => {
    const s = allocationSlices([pos("$A", 3), pos("$B", 1)], 4, 5);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].offset).toBeCloseTo(s[i - 1].offset + s[i - 1].share, 12);
    }
    expect(s[0].offset).toBe(0);
    expect(s.at(-1)!.offset + s.at(-1)!.share).toBeCloseTo(1, 12);
  });

  it("buckets the tail so a wide book cannot outrun the palette", () => {
    const many = Array.from({ length: 9 }, (_, i) => pos(`$T${i}`, 100 - i));
    const s = allocationSlices(many, 50, 5);
    // 5 named + one bucket + cash — never more, however many positions
    expect(s).toHaveLength(7);
    const bucket = s[5];
    expect(bucket.label).toBe("+4 more");
    expect(bucket.name).toBe("$T5, $T6, $T7, $T8");
    expect(bucket.value).toBe(95 + 94 + 93 + 92);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 12);
  });

  it("does not bucket when the book fits exactly", () => {
    const five = Array.from({ length: 5 }, (_, i) => pos(`$T${i}`, 10));
    expect(allocationSlices(five, 0, 5).map((x) => x.label)).toEqual([
      "$T0",
      "$T1",
      "$T2",
      "$T3",
      "$T4",
    ]);
  });

  it("drops empty positions and an empty cash balance", () => {
    const s = allocationSlices([pos("$A", 100), pos("$B", 0)], 0, 5);
    expect(s.map((x) => x.label)).toEqual(["$A"]);
    expect(s[0].share).toBe(1);
  });

  it("returns nothing for an empty book rather than dividing by zero", () => {
    expect(allocationSlices([], 0, 5)).toEqual([]);
    expect(allocationSlices([pos("$A", 0)], 0, 5)).toEqual([]);
  });
});

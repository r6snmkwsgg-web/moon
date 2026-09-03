import { describe, expect, it } from "vitest";
import { closedPositions } from "@/lib/positions";
import type { EquityTrade } from "@/lib/equity";

const T = Date.parse("2026-09-01T12:00:00Z");
const tr = (mins: number, symbol: string, side: "buy" | "sell", shares: number, price: number): EquityTrade => ({
  t: T + mins * 60_000,
  symbol,
  side,
  shares,
  price,
  total: shares * price,
  note: null,
});

describe("closed positions", () => {
  it("a buy and a sell back to flat is one round trip with a result", () => {
    const closed = closedPositions([tr(0, "PRL", "buy", 100, 20), tr(60, "PRL", "sell", 100, 25)]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ symbol: "PRL", peakShares: 100, bought: 2000, sold: 2500, pnl: 500, trades: 2 });
    expect(closed[0].pnlPct).toBeCloseTo(0.25, 10);
    expect(closed[0].closedAt - closed[0].openedAt).toBe(3_600_000);
  });

  it("scaling in and out counts as one trip until flat; a re-entry is a new one", () => {
    const closed = closedPositions([
      tr(0, "VOCL", "buy", 50, 10),
      tr(10, "VOCL", "buy", 50, 12),
      tr(20, "VOCL", "sell", 30, 15),
      tr(30, "VOCL", "sell", 70, 9),
      tr(90, "VOCL", "buy", 10, 9), // still open — not in the list
    ]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ peakShares: 100, bought: 1100, sold: 1080, pnl: -20, trades: 4 });
  });

  it("ignores names that are still open, newest closed first", () => {
    const closed = closedPositions([
      tr(0, "A", "buy", 1, 1),
      tr(5, "B", "buy", 1, 1),
      tr(10, "B", "sell", 1, 2),
      tr(20, "A", "sell", 1, 3),
      tr(30, "C", "buy", 1, 1),
    ]);
    expect(closed.map((c) => c.symbol)).toEqual(["A", "B"]);
  });
});

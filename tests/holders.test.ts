import { describe, expect, it } from "vitest";
import { summariseHolderTrades, type HolderTrade } from "@/lib/holders";
import { fmtCountdown, fmtDuration } from "@/lib/format";

const T0 = Date.parse("2026-09-01T12:00:00Z");
const H = 3600_000;
const tr = (
  userId: string,
  side: "buy" | "sell",
  shares: number,
  hoursAfter: number,
  note: string | null = null
): HolderTrade => ({ userId, side, shares, at: T0 + hoursAfter * H, note });

describe("summariseHolderTrades", () => {
  it("dates the position from the buy that opened it", () => {
    const m = summariseHolderTrades([tr("a", "buy", 100, 0), tr("a", "buy", 50, 5)]);
    expect(m.get("a")?.heldSince).toBe(T0);
    expect(m.get("a")?.lastTradeAt).toBe(T0 + 5 * H);
  });

  it("trimming keeps the clock; selling out and buying back restarts it", () => {
    const trimmed = summariseHolderTrades([
      tr("a", "buy", 100, 0),
      tr("a", "sell", 40, 2),
    ]);
    expect(trimmed.get("a")?.heldSince).toBe(T0);

    const rebought = summariseHolderTrades([
      tr("a", "buy", 100, 0),
      tr("a", "sell", 100, 2),
      tr("a", "buy", 10, 9),
    ]);
    expect(rebought.get("a")?.heldSince).toBe(T0 + 9 * H);

    const flat = summariseHolderTrades([tr("a", "buy", 100, 0), tr("a", "sell", 100, 2)]);
    expect(flat.get("a")?.heldSince).toBeNull();
  });

  it("keeps the LATEST thesis and the print it rode in on", () => {
    const m = summariseHolderTrades([
      tr("a", "buy", 10, 0, "first take"),
      tr("a", "buy", 10, 1),
      tr("a", "sell", 5, 3, "  taking profit  "),
    ]);
    expect(m.get("a")?.thesis).toBe("taking profit");
    expect(m.get("a")?.thesisAt).toBe(T0 + 3 * H);
    // a blank note is no thesis
    const blank = summariseHolderTrades([tr("b", "buy", 1, 0, "   ")]);
    expect(blank.get("b")?.thesis).toBeNull();
  });

  it("walks time forward whatever order the rows arrive in", () => {
    const m = summariseHolderTrades([
      tr("a", "buy", 10, 9),
      tr("a", "sell", 100, 2),
      tr("a", "buy", 100, 0),
    ]);
    expect(m.get("a")?.heldSince).toBe(T0 + 9 * H);
  });

  it("keeps traders apart", () => {
    const m = summariseHolderTrades([tr("a", "buy", 10, 0), tr("b", "buy", 10, 4, "b's take")]);
    expect(m.get("a")?.thesis).toBeNull();
    expect(m.get("b")?.heldSince).toBe(T0 + 4 * H);
    expect(m.size).toBe(2);
  });
});

describe("fmtDuration / fmtCountdown", () => {
  it("reads like a trader's clock", () => {
    expect(fmtDuration(30_000)).toBe("<1m");
    expect(fmtDuration(38 * 60_000)).toBe("38m");
    expect(fmtDuration(4 * H + 12 * 60_000)).toBe("4h 12m");
    expect(fmtDuration(43 * H)).toBe("1d 19h");
    expect(fmtDuration(-5)).toBe("<1m");
  });
  it("counts down without going negative", () => {
    expect(fmtCountdown(299_000)).toBe("4:59");
    expect(fmtCountdown(7_000)).toBe("0:07");
    expect(fmtCountdown(-3_000)).toBe("0:00");
  });
});

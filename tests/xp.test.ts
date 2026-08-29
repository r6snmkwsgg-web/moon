import { describe, expect, it } from "vitest";
import {
  computeXp,
  nextEarningsDate,
  streakFromDays,
  tierFor,
  TIERS,
  XP_PER_INVITE,
  XP_PER_LISTING,
  XP_PER_TRADE,
  XP_PER_VOTE,
} from "@/lib/xp";

describe("computeXp — derived, never stored", () => {
  it("sums activity by the published rates", () => {
    expect(computeXp({ trades: 10, votes: 4, listings: 1, invites: 2 })).toBe(
      10 * XP_PER_TRADE + 4 * XP_PER_VOTE + XP_PER_LISTING + 2 * XP_PER_INVITE
    );
  });
  it("missing counts are zero", () => {
    expect(computeXp({})).toBe(0);
    expect(computeXp({ trades: 1 })).toBe(XP_PER_TRADE);
  });
});

describe("tierFor — the ranked ladder", () => {
  it("everyone starts Bronze", () => {
    expect(tierFor(0).tier.name).toBe("Bronze");
    expect(tierFor(-5).tier.name).toBe("Bronze");
    expect(tierFor(NaN).tier.name).toBe("Bronze");
  });
  it("tier boundaries are inclusive", () => {
    for (const t of TIERS) {
      expect(tierFor(t.min).tier.name).toBe(t.name);
      if (t.min > 0) {
        expect(tierFor(t.min - 1).tier.name).not.toBe(t.name);
      }
    }
  });
  it("progress runs 0→1 between floors and pins at 1 for Diamond", () => {
    const mid = tierFor(2_000); // Silver 1000 → Gold 3000
    expect(mid.tier.name).toBe("Silver");
    expect(mid.progress).toBeCloseTo(0.5, 10);
    expect(mid.next?.name).toBe("Gold");
    const top = tierFor(1_000_000);
    expect(top.tier.name).toBe("Diamond");
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
  });
});

describe("streakFromDays — consecutive UTC trading days", () => {
  const now = new Date("2026-08-29T10:00:00Z");

  it("no trades, no streak", () => {
    expect(streakFromDays([], now)).toEqual({ days: 0, tradedToday: false });
  });
  it("counts back from today when today has a trade", () => {
    const s = streakFromDays(["2026-08-29", "2026-08-28", "2026-08-27"], now);
    expect(s).toEqual({ days: 3, tradedToday: true });
  });
  it("survives overnight: streak ending yesterday is alive but at risk", () => {
    const s = streakFromDays(["2026-08-28", "2026-08-27"], now);
    expect(s).toEqual({ days: 2, tradedToday: false });
  });
  it("a gap breaks it", () => {
    const s = streakFromDays(["2026-08-29", "2026-08-27", "2026-08-26"], now);
    expect(s).toEqual({ days: 1, tradedToday: true });
  });
  it("two days ago alone is a dead streak", () => {
    expect(streakFromDays(["2026-08-27"], now)).toEqual({
      days: 0,
      tradedToday: false,
    });
  });
});

describe("nextEarningsDate", () => {
  it("is the 1st of next month at 06:00 UTC (the cron's sync)", () => {
    const d = nextEarningsDate(new Date("2026-08-29T10:00:00Z"));
    expect(d.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    const dec = nextEarningsDate(new Date("2026-12-15T00:00:00Z"));
    expect(dec.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });
});

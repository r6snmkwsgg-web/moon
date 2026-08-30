import { describe, expect, it } from "vitest";
import {
  fmtMarketTime,
  marketDayEnd,
  marketDayStart,
  marketHour,
  marketOffset,
} from "@/lib/market-time";

const H = 3_600_000;
const iso = (s: string) => Date.parse(s);

describe("marketOffset", () => {
  it("is −5h on standard time and −4h on daylight time", () => {
    expect(marketOffset(iso("2026-01-15T12:00:00Z"))).toBe(-5 * H);
    expect(marketOffset(iso("2026-07-15T12:00:00Z"))).toBe(-4 * H);
  });

  it("flips at the changeover instant, not at midnight", () => {
    // 2026 spring forward: 07:00Z on Mar 8
    expect(marketOffset(iso("2026-03-08T06:59:00Z"))).toBe(-5 * H);
    expect(marketOffset(iso("2026-03-08T07:00:00Z"))).toBe(-4 * H);
    // 2026 fall back: 06:00Z on Nov 1
    expect(marketOffset(iso("2026-11-01T05:59:00Z"))).toBe(-4 * H);
    expect(marketOffset(iso("2026-11-01T06:00:00Z"))).toBe(-5 * H);
  });
});

describe("marketDayStart", () => {
  it("is 05:00Z in winter and 04:00Z in summer", () => {
    expect(marketDayStart(iso("2026-01-15T18:30:00Z"))).toBe(
      iso("2026-01-15T05:00:00Z")
    );
    expect(marketDayStart(iso("2026-07-15T18:30:00Z"))).toBe(
      iso("2026-07-15T04:00:00Z")
    );
  });

  it("puts a late-evening ET instant on the day it is in New York", () => {
    // 2026-08-31T02:30Z is Aug 30, 10:30 PM in New York
    expect(marketDayStart(iso("2026-08-31T02:30:00Z"))).toBe(
      iso("2026-08-30T04:00:00Z")
    );
  });

  it("holds midnight on the changeover days, when the offset moves", () => {
    // spring forward: midnight is still EST, the jump happens at 2am
    expect(marketDayStart(iso("2026-03-08T18:00:00Z"))).toBe(
      iso("2026-03-08T05:00:00Z")
    );
    // fall back: midnight is still EDT, the jump happens at 2am
    expect(marketDayStart(iso("2026-11-01T18:00:00Z"))).toBe(
      iso("2026-11-01T04:00:00Z")
    );
  });

  it("is idempotent and never lands in the future", () => {
    for (const t of [
      iso("2026-03-08T05:00:00Z"),
      iso("2026-03-08T06:30:00Z"),
      iso("2026-11-01T04:00:00Z"),
      iso("2026-11-01T05:30:00Z"),
      iso("2026-06-01T00:00:00Z"),
    ]) {
      const start = marketDayStart(t);
      expect(start).toBeLessThanOrEqual(t);
      expect(marketDayStart(start)).toBe(start);
    }
  });

  it("walks one day at a time across a whole year, never skipping or repeating", () => {
    let day = marketDayStart(iso("2026-01-01T12:00:00Z"));
    const seen = new Set<number>();
    for (let i = 0; i < 365; i++) {
      expect(seen.has(day)).toBe(false);
      seen.add(day);
      // every day starts at midnight by definition
      expect(fmtMarketTime(day)).toBe("12:00 AM");
      const next = marketDayEnd(day);
      const length = next - day;
      expect([23 * H, 24 * H, 25 * H]).toContain(length);
      day = next;
    }
    // exactly two odd-length days a year, one short and one long
    expect(seen.size).toBe(365);
  });
});

describe("marketDayEnd", () => {
  it("is 24h out on an ordinary day", () => {
    const start = marketDayStart(iso("2026-06-10T12:00:00Z"));
    expect(marketDayEnd(start) - start).toBe(24 * H);
  });

  it("is 23h on the short day and 25h on the long one", () => {
    const spring = marketDayStart(iso("2026-03-08T12:00:00Z"));
    expect(marketDayEnd(spring) - spring).toBe(23 * H);
    const fall = marketDayStart(iso("2026-11-01T12:00:00Z"));
    expect(marketDayEnd(fall) - fall).toBe(25 * H);
  });
});

describe("marketHour", () => {
  it("reads as that hour on the market clock", () => {
    const start = marketDayStart(iso("2026-06-10T12:00:00Z"));
    expect(fmtMarketTime(marketHour(start, 6))).toBe("6:00 AM");
    expect(fmtMarketTime(marketHour(start, 12))).toBe("12:00 PM");
    expect(fmtMarketTime(marketHour(start, 18))).toBe("6:00 PM");
  });

  it("still reads as that hour on the changeover days", () => {
    for (const d of ["2026-03-08T12:00:00Z", "2026-11-01T12:00:00Z"]) {
      const start = marketDayStart(iso(d));
      expect(fmtMarketTime(marketHour(start, 6))).toBe("6:00 AM");
      expect(fmtMarketTime(marketHour(start, 12))).toBe("12:00 PM");
      expect(fmtMarketTime(marketHour(start, 18))).toBe("6:00 PM");
    }
  });

  it("stays inside its own day", () => {
    for (const d of ["2026-03-08T12:00:00Z", "2026-11-01T12:00:00Z", "2026-06-10T12:00:00Z"]) {
      const start = marketDayStart(iso(d));
      const end = marketDayEnd(start);
      for (const h of [6, 12, 18]) {
        const mark = marketHour(start, h);
        expect(mark).toBeGreaterThan(start);
        expect(mark).toBeLessThan(end);
      }
    }
  });
});

describe("fmtMarketTime", () => {
  it("quotes the market's clock regardless of the machine's", () => {
    // 2026-08-30T22:20Z is 6:20 PM in New York whatever TZ the runner has
    expect(fmtMarketTime(iso("2026-08-30T22:20:00Z"))).toBe("6:20 PM");
  });
});

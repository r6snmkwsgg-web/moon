import { describe, expect, it } from "vitest";
import { summarisePayments } from "@/lib/stripe";
import {
  anchorRevenue,
  monthlyRunRate,
  DAYS_PER_MONTH,
  MIN_DAYS_FOR_RUN_RATE,
} from "@/lib/revenue";
import { marketDayKey } from "@/lib/market-time";
import type { DailyRevenue } from "@/lib/surprise";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const charge = (o: Record<string, unknown>) => ({
  status: "succeeded",
  currency: "usd",
  ...o,
});

describe("summarisePayments", () => {
  it("counts every succeeded charge, not just recurring ones", () => {
    // the whole point: a one-time licence sale is revenue and MRR never sees it
    const { days } = summarisePayments(
      [
        charge({ created: sec("2026-08-31T15:00:00Z"), amount_captured: 500 }),
        charge({ created: sec("2026-08-31T16:00:00Z"), amount_captured: 2_500 }),
      ],
      marketDayKey
    );
    expect(days).toHaveLength(1);
    expect(days[0].grossMinor).toBe(3_000);
    expect(days[0].payments).toBe(2);
  });

  it("REGRESSION: failed and blocked attempts are not revenue", () => {
    // the live account had $805.97 failed against $815.40 succeeded — counting
    // attempts would have almost exactly doubled it
    const { days } = summarisePayments(
      [
        charge({ created: sec("2026-08-31T15:00:00Z"), amount_captured: 1_000 }),
        { status: "failed", created: sec("2026-08-31T15:30:00Z"), amount: 900 },
        charge({ created: sec("2026-08-31T16:00:00Z"), amount: 700, paid: false }),
      ],
      marketDayKey
    );
    expect(days[0].grossMinor).toBe(1_000);
    expect(days[0].payments).toBe(1);
  });

  it("nets refunds out, and a full refund leaves nothing behind", () => {
    const { days } = summarisePayments(
      [
        charge({
          created: sec("2026-08-31T15:00:00Z"),
          amount_captured: 1_000,
          amount_refunded: 250,
        }),
        charge({
          created: sec("2026-08-31T16:00:00Z"),
          amount_captured: 500,
          amount_refunded: 500,
        }),
      ],
      marketDayKey
    );
    expect(days[0].grossMinor).toBe(1_500);
    expect(days[0].netMinor).toBe(750); // 1000-250, then 500 refunded in full
  });

  it("an uncaptured authorisation is not a payment", () => {
    const { days } = summarisePayments(
      [charge({ created: sec("2026-08-31T15:00:00Z"), amount: 1_000, captured: false })],
      marketDayKey
    );
    expect(days).toHaveLength(0);
  });

  it("buckets on the MARKET day, not UTC", () => {
    // 01:00 UTC on Sep 1 is still Aug 31 at 9pm in New York, and the tape's
    // day boundary is the one that has to win
    const { days } = summarisePayments(
      [
        charge({ created: sec("2026-09-01T01:00:00Z"), amount_captured: 100 }),
        charge({ created: sec("2026-09-01T13:00:00Z"), amount_captured: 200 }),
      ],
      marketDayKey
    );
    expect(days.map((d) => d.day)).toEqual(["2026-08-31", "2026-09-01"]);
  });

  it("reports every currency it saw rather than silently adding them", () => {
    const { currencies } = summarisePayments(
      [
        charge({ created: sec("2026-08-31T15:00:00Z"), amount_captured: 100 }),
        charge({ created: sec("2026-08-31T16:00:00Z"), amount_captured: 100, currency: "eur" }),
      ],
      marketDayKey
    );
    expect(currencies.sort()).toEqual(["eur", "usd"]);
  });

  it("survives junk without throwing", () => {
    expect(summarisePayments([], marketDayKey).days).toEqual([]);
    expect(
      summarisePayments(
        [charge({ created: NaN, amount: 5 }), charge({ created: sec("2026-08-31T15:00:00Z") })],
        marketDayKey
      ).days
    ).toEqual([]);
  });
});

describe("monthlyRunRate", () => {
  const flat = (n: number, amount: number): DailyRevenue[] =>
    Array.from({ length: n }, (_, i) => ({
      day: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
      amount,
    }));

  it("turns a steady $30/day into roughly $913/month", () => {
    expect(monthlyRunRate(flat(40, 30))).toBeCloseTo(30 * DAYS_PER_MONTH, 5);
  });

  it("waits for enough tape before pricing on it", () => {
    expect(monthlyRunRate(flat(MIN_DAYS_FOR_RUN_RATE - 1, 30))).toBe(0);
    expect(monthlyRunRate(flat(MIN_DAYS_FOR_RUN_RATE, 30))).toBeGreaterThan(0);
  });

  it("lifts on a one-off sale and fades, instead of dropping it off a cliff", () => {
    // a trailing 30-day sum carries a spike at full weight for exactly thirty
    // days then loses it in one step — a cliff caused by nothing
    const base = flat(30, 30);
    const spiked = [...base];
    spiked[20] = { ...spiked[20], amount: 1_000 };
    const after = monthlyRunRate(spiked);
    expect(after).toBeGreaterThan(monthlyRunRate(base));

    // ten more ordinary days and most of the lift has decayed away smoothly
    const later = [...spiked, ...flat(10, 30).map((d, i) => ({ ...d, day: `2026-09-0${i}` }))];
    const decayed = monthlyRunRate(later);
    expect(decayed).toBeLessThan(after);
    expect(decayed).toBeGreaterThan(monthlyRunRate(base));
  });

  it("never returns a negative rate", () => {
    expect(monthlyRunRate(flat(20, 0))).toBe(0);
    expect(monthlyRunRate([])).toBe(0);
  });
});

describe("anchorRevenue", () => {
  const daily = Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
    amount: 25,
  }));

  it("prefers money actually received", () => {
    const a = anchorRevenue({ daily, stripeMrr: 583.86, reportedMrr: 635.5 });
    expect(a.source).toBe("payments");
    expect(a.monthly).toBeCloseTo(25 * DAYS_PER_MONTH, 5);
  });

  it("falls back to subscriptions until there is enough payment history", () => {
    const a = anchorRevenue({ daily: daily.slice(0, 3), stripeMrr: 583.86, reportedMrr: 635.5 });
    expect(a).toEqual({ monthly: 583.86, source: "subscriptions" });
  });

  it("falls back to the last report when Stripe is not connected at all", () => {
    const a = anchorRevenue({ daily: [], stripeMrr: null, reportedMrr: 635.5 });
    expect(a).toEqual({ monthly: 635.5, source: "reported" });
  });

  it("never hands back a negative anchor", () => {
    expect(anchorRevenue({ daily: [], stripeMrr: null, reportedMrr: -5 }).monthly).toBe(0);
  });
});

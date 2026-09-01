import { describe, expect, it } from "vitest";
import { subscriptionMrrMinor } from "@/lib/stripe";

/** A minimal Stripe subscription payload, in the shape the API returns. */
function sub(
  items: { amount: number; interval?: string; count?: number; qty?: number }[],
  extra: Record<string, unknown> = {}
) {
  return {
    currency: "usd",
    items: {
      data: items.map((i) => ({
        quantity: i.qty ?? 1,
        price: {
          unit_amount: i.amount,
          recurring: { interval: i.interval ?? "month", interval_count: i.count ?? 1 },
        },
      })),
    },
    ...extra,
  };
}

describe("subscriptionMrrMinor", () => {
  it("normalises every billing interval to a month", () => {
    expect(subscriptionMrrMinor(sub([{ amount: 1000 }]))).toBe(1000);
    expect(subscriptionMrrMinor(sub([{ amount: 12_000, interval: "year" }]))).toBe(1000);
    expect(subscriptionMrrMinor(sub([{ amount: 1000, interval: "week" }]))).toBeCloseTo(4333.33, 1);
    expect(subscriptionMrrMinor(sub([{ amount: 100, interval: "day" }]))).toBeCloseTo(3041.67, 1);
    // every three months
    expect(subscriptionMrrMinor(sub([{ amount: 3000, count: 3 }]))).toBe(1000);
  });

  it("multiplies by quantity and adds up multi-item subscriptions", () => {
    expect(subscriptionMrrMinor(sub([{ amount: 500, qty: 3 }]))).toBe(1500);
    expect(subscriptionMrrMinor(sub([{ amount: 500 }, { amount: 250 }]))).toBe(750);
  });

  it("REGRESSION: a percentage coupon comes off the top", () => {
    // The old code read price.unit_amount and stopped there, so a discounted
    // subscription counted at list price. Measured against a live account
    // this read $668 where Stripe's own MRR widget said $583.86.
    const discounted = sub([{ amount: 1000 }], {
      discounts: [{ coupon: { percent_off: 20 } }],
    });
    expect(subscriptionMrrMinor(discounted)).toBe(800);
  });

  it("takes a fixed coupon off too, and both together in order", () => {
    expect(
      subscriptionMrrMinor(sub([{ amount: 1000 }], { discounts: [{ coupon: { amount_off: 250 } }] }))
    ).toBe(750);
    // percent first, then fixed — 1000 → 900 → 700
    expect(
      subscriptionMrrMinor(
        sub([{ amount: 1000 }], {
          discounts: [{ coupon: { percent_off: 10 } }, { coupon: { amount_off: 200 } }],
        })
      )
    ).toBe(700);
  });

  it("still reads the older singular `discount` field", () => {
    expect(
      subscriptionMrrMinor(sub([{ amount: 1000 }], { discount: { coupon: { percent_off: 50 } } }))
    ).toBe(500);
  });

  it("never goes negative on an over-large coupon", () => {
    expect(
      subscriptionMrrMinor(sub([{ amount: 500 }], { discounts: [{ coupon: { amount_off: 9999 } }] }))
    ).toBe(0);
    expect(
      subscriptionMrrMinor(sub([{ amount: 500 }], { discounts: [{ coupon: { percent_off: 150 } }] }))
    ).toBe(0);
  });

  it("REGRESSION: a subscription cancelling at period end still counts", () => {
    // I briefly excluded these on the reasoning that the customer had already
    // left. They have not: they are still subscribed, still paying, and this
    // period's invoice will still be collected. Excluding them cost a real
    // founder NINE subscriptions in one poll — $668 to $549.50, logged as a
    // churn, on a day nobody cancelled anything — and swung the total from
    // 14% over Stripe's own MRR to 6% under it. The churn is real when Stripe
    // drops them from status=active, not a day sooner.
    const leaving = sub([{ amount: 1000 }], { cancel_at_period_end: true });
    expect(subscriptionMrrMinor(leaving)).toBe(1000);
    expect(subscriptionMrrMinor(sub([{ amount: 1000 }], { cancel_at_period_end: false }))).toBe(1000);
  });

  it("skips metered and tiered items rather than guessing", () => {
    const metered = {
      items: { data: [{ quantity: 1, price: { unit_amount: null, recurring: { interval: "month" } } }] },
    };
    expect(subscriptionMrrMinor(metered)).toBe(0);
  });

  it("survives a malformed payload without throwing", () => {
    for (const bad of [{}, { items: {} }, { items: { data: [] } }, { items: { data: [{}] } }]) {
      expect(subscriptionMrrMinor(bad)).toBe(0);
    }
  });
});

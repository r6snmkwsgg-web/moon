import { describe, expect, it } from "vitest";
import {
  ARR_MULTIPLE,
  FLOW_CAP,
  MAX_POSITION_FRACTION,
  MONTHS_PER_YEAR,
  MULTIPLE_CEILING,
  MULTIPLE_FLOOR,
  SENTIMENT_CAP,
  SENTIMENT_DAILY_DECAY,
  SHARES_OUTSTANDING,
  SHOCK_CAP,
  SHOCK_HALFLIFE_MS,
  TARGET_OPENING_PRICE,
  TRADE_IMPACT_FACTOR,
  applyTrade,
  changeFraction,
  clampSentiment,
  decaySentiment,
  executionFill,
  executionFillAt,
  fairPrice,
  floatOf,
  flowPrice,
  livePrice,
  marketCap,
  marketFlow,
  mrrAt,
  positionLimit,
  revenueShock,
  shareCountFor,
  tradeImpact,
  valuationMultiple,
  volatilityFactor,
  type RevenueEvent,
} from "@/lib/pricing";

/** The anchor for a given MRR at the baseline multiple. */
const A = (mrr: number) =>
  (mrr * MONTHS_PER_YEAR * ARR_MULTIPLE) / SHARES_OUTSTANDING;

describe("fairPrice — the 3× ARR anchor", () => {
  it("prices MRR at a 3x multiple spread over 10,000 shares", () => {
    // $10,000 MRR → $30,000 "valuation" → $3.00/share
    expect(fairPrice(10_000)).toBe(A(10_000)); // $10k/mo → $120k ARR → base multiple ÷ 10k shares
    expect(fairPrice(5_000)).toBe(A(5_000));
    expect(fairPrice(100_000)).toBe(A(100_000));
  });

  it("uses the published constants", () => {
    const mrr = 12_345;
    expect(fairPrice(mrr)).toBe(
      (mrr * MONTHS_PER_YEAR * ARR_MULTIPLE) / SHARES_OUTSTANDING
    );
  });

  it("floors at zero: no MRR (or garbage) means no price", () => {
    expect(fairPrice(0)).toBe(0);
    expect(fairPrice(-500)).toBe(0);
    expect(fairPrice(NaN)).toBe(0);
    expect(fairPrice(Infinity)).toBe(0);
  });
});

describe("livePrice — fair price stretched by sentiment", () => {
  it("is fair price when sentiment is zero", () => {
    expect(livePrice(10_000, 0)).toBe(A(10_000));
  });

  it("rises and falls with sentiment", () => {
    expect(livePrice(10_000, 0.2)).toBeCloseTo(A(10_000) * 1.2, 10);
    expect(livePrice(10_000, -0.2)).toBeCloseTo(A(10_000) * 0.8, 10);
  });

  it("never strays past the ±40% cap even if stored sentiment is corrupt", () => {
    expect(livePrice(10_000, 5)).toBeCloseTo(A(10_000) * (1 + SENTIMENT_CAP), 10);
    expect(livePrice(10_000, -5)).toBeCloseTo(A(10_000) * (1 - SENTIMENT_CAP), 10);
  });

  it("an MRR update reprices immediately — the earnings-report moment", () => {
    const sentiment = 0.1;
    const before = livePrice(10_000, sentiment);
    const after = livePrice(20_000, sentiment); // founder posts a big month
    expect(after).toBeCloseTo(before * 2, 10); // anchor doubles, hype unchanged
  });
});

describe("marketCap", () => {
  it("is live price times the full float", () => {
    expect(marketCap(10_000, 0)).toBe(A(10_000) * SHARES_OUTSTANDING);
    expect(marketCap(10_000, 0.4)).toBeCloseTo(A(10_000) * 1.4 * SHARES_OUTSTANDING, 6);
  });
});

describe("clampSentiment", () => {
  it("passes through values inside the band", () => {
    expect(clampSentiment(0.15)).toBe(0.15);
    expect(clampSentiment(-0.39)).toBe(-0.39);
  });

  it("clamps to ±SENTIMENT_CAP", () => {
    expect(clampSentiment(0.41)).toBe(SENTIMENT_CAP);
    expect(clampSentiment(-9)).toBe(-SENTIMENT_CAP);
  });

  it("treats non-finite input as neutral", () => {
    expect(clampSentiment(NaN)).toBe(0);
    expect(clampSentiment(Infinity)).toBe(0);
  });
});

describe("tradeImpact — hype from net buying/selling", () => {
  it("buys push up, sells push down, symmetrically", () => {
    expect(tradeImpact("buy", 500)).toBeCloseTo(
      (500 / SHARES_OUTSTANDING) * TRADE_IMPACT_FACTOR,
      10
    );
    expect(tradeImpact("sell", 500)).toBeCloseTo(-tradeImpact("buy", 500), 10);
  });

  it("scales linearly with size: 10% of the float moves sentiment 20%", () => {
    expect(tradeImpact("buy", 1_000)).toBeCloseTo(0.2, 10);
  });

  it("ignores zero/negative/garbage share counts", () => {
    expect(tradeImpact("buy", 0)).toBe(0);
    expect(tradeImpact("buy", -10)).toBe(0);
    expect(tradeImpact("buy", NaN)).toBe(0);
  });
});

describe("applyTrade — sentiment after a trade", () => {
  it("accumulates trades", () => {
    let s = 0;
    s = applyTrade(s, "buy", 500); // +0.10
    s = applyTrade(s, "buy", 500); // +0.10
    expect(s).toBeCloseTo(0.2, 10);
    s = applyTrade(s, "sell", 1500); // -0.30
    expect(s).toBeCloseTo(-0.1, 10);
  });

  it("caps at +40% no matter how hard the herd buys", () => {
    let s = 0;
    for (let i = 0; i < 20; i++) s = applyTrade(s, "buy", 2_000);
    expect(s).toBe(SENTIMENT_CAP);
  });

  it("caps at -40% on a mass dump", () => {
    expect(applyTrade(0, "sell", 1_000_000)).toBe(-SENTIMENT_CAP);
  });
});

describe("decaySentiment — hype fades, MRR is gravity", () => {
  it("shrinks 10% toward zero from either side", () => {
    expect(decaySentiment(0.4)).toBeCloseTo(0.36, 10);
    expect(decaySentiment(-0.2)).toBeCloseTo(-0.18, 10);
    expect(decaySentiment(0.3)).toBeCloseTo(0.3 * (1 - SENTIMENT_DAILY_DECAY), 10);
  });

  it("leaves neutral sentiment alone", () => {
    expect(decaySentiment(0)).toBe(0);
  });

  it("snaps to exactly zero once decay makes it negligible", () => {
    let s = 0.4;
    for (let i = 0; i < 200; i++) s = decaySentiment(s);
    expect(s).toBe(0);
  });

  it("converges: price drifts back to the anchor over time", () => {
    let s = SENTIMENT_CAP;
    for (let i = 0; i < 30; i++) s = decaySentiment(s); // a month of decay
    expect(livePrice(10_000, s)).toBeLessThan(livePrice(10_000, SENTIMENT_CAP) * 0.97);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(SENTIMENT_CAP * 0.05);
  });

  it("clamps corrupt input before decaying", () => {
    expect(decaySentiment(99)).toBeCloseTo(SENTIMENT_CAP * 0.9, 10);
  });
});

describe("changeFraction", () => {
  it("computes signed fractional change", () => {
    expect(changeFraction(2, 3)).toBeCloseTo(0.5, 10);
    expect(changeFraction(4, 3)).toBeCloseTo(-0.25, 10);
  });

  it("is zero when the baseline is unusable", () => {
    expect(changeFraction(0, 5)).toBe(0);
    expect(changeFraction(NaN, 5)).toBe(0);
  });
});

describe("executionFill — slippage along the sentiment curve", () => {
  const MRR = 10_000; // fair $3.00

  it("a tiny order fills at ~the live price and moves sentiment as one trade", () => {
    const fill = executionFill(MRR, 0, "buy", 1);
    expect(fill.avgPrice).toBeCloseTo(livePrice(MRR, 0), 2);
    expect(fill.newSentiment).toBeCloseTo(applyTrade(0, "buy", 1), 10);
  });

  it("big buys pay MORE than the quoted price, big sells receive LESS", () => {
    const buy = executionFill(MRR, 0, "buy", 1_000); // pushes sentiment 0 → +0.2
    expect(buy.avgPrice).toBeGreaterThan(livePrice(MRR, 0));
    expect(buy.avgPrice).toBeCloseTo(A(10_000) * (1 + 0.1), 10); // mean of 0 and +0.2

    const sell = executionFill(MRR, 0, "sell", 1_000);
    expect(sell.avgPrice).toBeLessThan(livePrice(MRR, 0));
    expect(sell.avgPrice).toBeCloseTo(A(10_000) * (1 - 0.1), 10);
  });

  it("sentiment after the fill matches applyTrade exactly", () => {
    const fill = executionFill(MRR, 0.05, "buy", 700);
    expect(fill.newSentiment).toBeCloseTo(applyTrade(0.05, "buy", 700), 10);
  });

  it("shares past the cap fill flat at the cap price", () => {
    // From 0, +0.4 cap is hit after 2,000 shares; the other 2,000 fill at cap.
    const fill = executionFill(MRR, 0, "buy", 4_000);
    const movingCost = 2_000 * A(10_000) * (1 + 0.2); // mean sentiment 0 → 0.4 is 0.2
    const cappedCost = 2_000 * A(10_000) * (1 + SENTIMENT_CAP);
    expect(fill.total).toBeCloseTo(movingCost + cappedCost, 6);
    expect(fill.newSentiment).toBe(SENTIMENT_CAP);
  });

  it("already at the cap, a buy fills entirely flat", () => {
    const fill = executionFill(MRR, SENTIMENT_CAP, "buy", 500);
    expect(fill.avgPrice).toBeCloseTo(livePrice(MRR, SENTIMENT_CAP), 10);
    expect(fill.newSentiment).toBe(SENTIMENT_CAP);
  });

  it("a round trip is never profitable — pumping your own ticker is a wash", () => {
    // The sell walks back down the same path the buy walked up, so
    // buy→sell nets exactly zero: no self-pump exploit exists.
    const buy = executionFill(MRR, 0, "buy", 1_000);
    const sell = executionFill(MRR, buy.newSentiment, "sell", 1_000);
    expect(sell.total).toBeLessThanOrEqual(buy.total + 1e-9);
    expect(sell.total).toBeCloseTo(buy.total, 8);

    // Naively selling at the post-pump QUOTED price would have been a profit;
    // slippage is what takes it away.
    const quotedAfterPump = livePrice(MRR, buy.newSentiment) * 1_000;
    expect(quotedAfterPump).toBeGreaterThan(buy.total);
  });

  it("total = avgPrice × shares, and zero-ish inputs are safe", () => {
    const fill = executionFill(MRR, 0.1, "sell", 250);
    expect(fill.total).toBeCloseTo(fill.avgPrice * 250, 8);
    expect(executionFill(0, 0, "buy", 100).total).toBe(0);
    expect(executionFill(MRR, 0, "buy", 0).total).toBe(0);
  });
});

describe("the whole mechanic, end to end", () => {
  it("hype spikes the price, decay brings it home, MRR moves the anchor", () => {
    const mrr = 8_000;
    let sentiment = 0;

    const opening = livePrice(mrr, sentiment);
    expect(opening).toBeCloseTo(A(8_000), 10); // $8k/mo → $96k ARR at the base multiple

    // A wave of buying: 3,000 shares (30% of float) → sentiment +0.6 → capped +0.4.
    sentiment = applyTrade(sentiment, "buy", 3_000);
    const pumped = livePrice(mrr, sentiment);
    expect(pumped).toBeCloseTo(opening * 1.4, 10);

    // Two weeks of decay: hype fades toward the anchor.
    for (let i = 0; i < 14; i++) sentiment = decaySentiment(sentiment);
    const cooled = livePrice(mrr, sentiment);
    expect(cooled).toBeGreaterThan(opening);
    expect(cooled).toBeLessThan(pumped * 0.85);

    // Earnings: founder reports MRR up 50% — the anchor jumps instantly.
    const earnings = livePrice(mrr * 1.5, sentiment);
    expect(earnings).toBeCloseTo(cooled * 1.5, 10);
  });
});

describe("the flow (simulated volatility)", () => {
  const DAY = 86_400_000;

  it("is deterministic: same symbol + instant → same value, everywhere", () => {
    const t = Date.parse("2026-08-30T12:00:00Z");
    expect(marketFlow("INBX", t, 8000)).toBe(marketFlow("INBX", t, 8000));
  });

  it("differs across tickers and moves over time", () => {
    const t = Date.parse("2026-08-30T12:00:00Z");
    expect(marketFlow("INBX", t)).not.toBe(marketFlow("PRL", t));
    expect(marketFlow("INBX", t)).not.toBe(marketFlow("INBX", t + 6 * 3_600_000));
  });

  it("stays inside the ±FLOW_CAP squash at every sampled minute", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 5_000; i++) {
      const d = marketFlow("VOLT", t0 + i * 8.64 * 60_000, 300);
      expect(Math.abs(d)).toBeLessThan(FLOW_CAP);
    }
  });

  it("actually swings: daily ranges are trading-worthy, not shimmer", () => {
    const t0 = Date.parse("2026-03-01T00:00:00Z");
    let maxRange = 0;
    for (let day = 0; day < 30; day++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let m = 0; m < 96; m++) {
        const d = marketFlow("SCRP", t0 + day * DAY + m * 15 * 60_000, 2_000);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      maxRange = Math.max(maxRange, hi - lo);
    }
    expect(maxRange).toBeGreaterThan(0.08); // at least one ±4%+ day a month
  });

  it("small caps are wilder than big caps", () => {
    expect(volatilityFactor(300)).toBeGreaterThan(volatilityFactor(50_000));
  });

  it("fills execute at the flow price and round trips stay a wash", () => {
    const t = Date.parse("2026-08-30T15:30:00Z");
    const buy = executionFillAt("INBX", 8_000, 0, "buy", 500, t);
    const drift = 1 + marketFlow("INBX", t, 8_000);
    expect(buy.avgPrice).toBeCloseTo(
      executionFill(8_000, 0, "buy", 500).avgPrice * drift,
      10
    );
    const sell = executionFillAt("INBX", 8_000, buy.newSentiment, "sell", 500, t);
    expect(sell.total).toBeCloseTo(buy.total, 6);
  });

  it("flowPrice is anchor × hype × weather, and never negative", () => {
    const t = Date.parse("2026-08-30T12:00:00Z");
    const p = flowPrice("INBX", 8_000, 0.2, t);
    expect(p).toBeCloseTo(
      livePrice(8_000, 0.2) * (1 + marketFlow("INBX", t, 8_000)),
      10
    );
    expect(p).toBeGreaterThan(0);
    expect(flowPrice("INBX", 0, 0, t)).toBe(0);
  });
});


describe("valuationMultiple — durable revenue is worth more", () => {
  const flat = (months: number, mrr: number) =>
    Array.from({ length: months }, (_, i) => ({
      month: `2024-${String((i % 12) + 1).padStart(2, "0")}-01`.replace(
        "2024",
        String(2024 + Math.floor(i / 12))
      ),
      mrr,
    }));

  it("pays up for a long, steady record over a one-month wonder", () => {
    const veteran = valuationMultiple(flat(36, 25_000));
    const rookie = valuationMultiple([{ month: "2026-08-01", mrr: 25_000 }]);
    expect(veteran).toBeGreaterThan(rookie * 1.5);
  });

  it("rewards growth and punishes decline", () => {
    const growing = valuationMultiple(
      flat(12, 1).map((p, i) => ({ ...p, mrr: 10_000 * 1.1 ** i }))
    );
    const flatline = valuationMultiple(flat(12, 10_000));
    const shrinking = valuationMultiple(
      flat(12, 1).map((p, i) => ({ ...p, mrr: 10_000 * 0.93 ** i }))
    );
    expect(growing).toBeGreaterThan(flatline);
    expect(flatline).toBeGreaterThan(shrinking);
  });

  it("discounts spiky revenue against the same average held steadily", () => {
    const steady = valuationMultiple(flat(12, 20_000));
    const spiky = valuationMultiple(
      flat(12, 1).map((p, i) => ({ ...p, mrr: i % 2 === 0 ? 8_000 : 32_000 }))
    );
    expect(steady).toBeGreaterThan(spiky);
  });

  it("never leaves the published band, whatever the inputs", () => {
    const rocket = flat(30, 1).map((p, i) => ({ ...p, mrr: 100 * 2 ** i }));
    const collapse = flat(30, 1).map((p, i) => ({ ...p, mrr: 1e9 * 0.5 ** i }));
    for (const h of [rocket, collapse, [], flat(1, 0)]) {
      const m = valuationMultiple(h);
      expect(m).toBeGreaterThanOrEqual(MULTIPLE_FLOOR);
      expect(m).toBeLessThanOrEqual(MULTIPLE_CEILING);
    }
  });

  it("feeds fairPrice — the same MRR prices differently by track record", () => {
    const veteran = valuationMultiple(flat(36, 25_000));
    const rookie = valuationMultiple([{ month: "2026-08-01", mrr: 25_000 }]);
    expect(fairPrice(25_000, veteran)).toBeGreaterThan(
      fairPrice(25_000, rookie)
    );
  });
});

// ── the float: a unit choice, not a supply of ownership ──────────────────────

describe("per-ticker floats", () => {
  const MRR = 10_000;

  it("cuts the same company into different sized slices", () => {
    expect(fairPrice(MRR, 2.5, 10_000)).toBeCloseTo(30, 6);
    expect(fairPrice(MRR, 2.5, 50_000)).toBeCloseTo(6, 6);
    expect(fairPrice(MRR, 2.5, 1_000)).toBeCloseTo(300, 6);
  });

  it("never changes what the company is worth", () => {
    const caps = [1_000, 10_000, 50_000, 1_000_000].map((f) =>
      marketCap(MRR, 0.2, 2.5, f)
    );
    for (const cap of caps) expect(cap).toBeCloseTo(caps[0], 6);
  });

  it("sizes a new listing to open in the same band as everything else", () => {
    for (const mrr of [500, 1_000, 5_000, 25_000, 100_000, 400_000]) {
      const shares = shareCountFor(mrr);
      const open = fairPrice(mrr, ARR_MULTIPLE, shares);
      expect(open).toBeGreaterThan(TARGET_OPENING_PRICE * 0.5);
      expect(open).toBeLessThan(TARGET_OPENING_PRICE * 2);
    }
  });

  it("falls back to the default float for junk", () => {
    expect(floatOf(undefined)).toBe(SHARES_OUTSTANDING);
    expect(floatOf(null)).toBe(SHARES_OUTSTANDING);
    expect(floatOf(0)).toBe(SHARES_OUTSTANDING);
    expect(floatOf(-5)).toBe(SHARES_OUTSTANDING);
    expect(floatOf(2_500)).toBe(2_500);
  });

  it("moves the price by the fraction of THAT float that traded", () => {
    // 100 shares is a tenth of a 1,000-share company and a 500th of a 50,000
    const small = tradeImpact("buy", 100, 1_000);
    const large = tradeImpact("buy", 100, 50_000);
    expect(small).toBeGreaterThan(large * 40);
    expect(tradeImpact("buy", 100, 10_000)).toBeCloseTo(
      tradeImpact("buy", 500, 50_000),
      9
    );
  });

  it("fills the same fraction of two floats at the same average price", () => {
    const a = executionFill(MRR, 0, "buy", 100, 2.5, 10_000);
    const b = executionFill(MRR, 0, "buy", 500, 2.5, 50_000);
    // same 1% of the company, so the same cost and the same sentiment move
    expect(a.total).toBeCloseTo(b.total, 6);
    expect(a.newSentiment).toBeCloseTo(b.newSentiment, 9);
  });
});

describe("position limits", () => {
  it("caps one account at a fraction of the float", () => {
    expect(positionLimit(10_000)).toBe(10_000 * MAX_POSITION_FRACTION);
    expect(positionLimit(50_000)).toBe(50_000 * MAX_POSITION_FRACTION);
  });

  it("always leaves at least one share buyable", () => {
    expect(positionLimit(1)).toBe(1);
    expect(positionLimit(5)).toBe(1);
  });
});

// ── the revenue pulse ────────────────────────────────────────────────────────

describe("revenue events between reports", () => {
  const T = 1_700_000_000_000;
  const REPORTED = 10_000;
  const churn: RevenueEvent = { at: T, prevMrr: 10_000, mrr: 9_000 };
  const signup: RevenueEvent = { at: T, prevMrr: 10_000, mrr: 11_000 };

  it("steps, because revenue steps", () => {
    expect(mrrAt([churn], 9_000, T - 1)).toBe(10_000);
    expect(mrrAt([churn], 9_000, T)).toBe(9_000);
    expect(mrrAt([churn], 9_000, T + 1)).toBe(9_000);
  });

  it("walks back through several changes", () => {
    const events: RevenueEvent[] = [
      { at: T, prevMrr: 10_000, mrr: 11_000 },
      { at: T + 3_600_000, prevMrr: 11_000, mrr: 10_500 },
    ];
    expect(mrrAt(events, 10_500, T - 1)).toBe(10_000);
    expect(mrrAt(events, 10_500, T + 60_000)).toBe(11_000);
    expect(mrrAt(events, 10_500, T + 7_200_000)).toBe(10_500);
  });

  it("prices a churn down and a signup up, immediately", () => {
    const before = flowPrice("TEST", REPORTED, 0, T - 1000, 2.5, 10_000, [churn]);
    const after = flowPrice("TEST", 9_000, 0, T + 1000, 2.5, 10_000, [churn]);
    expect(after).toBeLessThan(before * 0.9);

    const up = flowPrice("TEST", 11_000, 0, T + 1000, 2.5, 10_000, [signup]);
    const flat = flowPrice("TEST", REPORTED, 0, T - 1000, 2.5, 10_000, [signup]);
    expect(up).toBeGreaterThan(flat * 1.1);
  });

  it("overshoots on the news, then decays back to the step", () => {
    const spike = Math.abs(revenueShock([churn], T + 1000));
    const later = Math.abs(revenueShock([churn], T + SHOCK_HALFLIFE_MS));
    const gone = Math.abs(revenueShock([churn], T + SHOCK_HALFLIFE_MS * 9));
    expect(spike).toBeGreaterThan(0.1); // a 10% churn is a real candle
    expect(later).toBeCloseTo(spike / 2, 2);
    expect(gone).toBe(0);
  });

  it("caps a burst of news so nothing gaps to zero", () => {
    const catastrophe: RevenueEvent[] = Array.from({ length: 12 }, (_, i) => ({
      at: T + i,
      prevMrr: 10_000,
      mrr: 5_000,
    }));
    expect(revenueShock(catastrophe, T + 100)).toBeGreaterThanOrEqual(-SHOCK_CAP);
  });

  it("hands over to the monthly report without a gap", () => {
    // a month later the overshoot is long gone and only the step remains
    const later = T + 30 * 86_400_000;
    // before the report: reported 10k, live 11k, priced off live
    const beforeReport = flowPrice("TEST", 11_000, 0, later, 2.5, 10_000, [
      { at: T, prevMrr: 10_000, mrr: 11_000 },
    ]);
    // after: the report says 11k and the event is behind us — same price
    const afterReport = flowPrice("TEST", 11_000, 0, later, 2.5, 10_000, []);
    expect(beforeReport).toBeCloseTo(afterReport, 9);
  });

  it("fills at the tape price, news included", () => {
    const fill = executionFillAt("TEST", 9_000, 0, "buy", 10, T + 1000, 2.5, 10_000, [churn]);
    const quiet = executionFillAt("TEST", 10_000, 0, "buy", 10, T - 1000, 2.5, 10_000, [churn]);
    expect(fill.avgPrice).toBeLessThan(quiet.avgPrice * 0.9);
  });
});

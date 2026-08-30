import { describe, expect, it } from "vitest";
import {
  SHARES_OUTSTANDING,
  ARR_MULTIPLE,
  MONTHS_PER_YEAR,
  SENTIMENT_CAP,
  SENTIMENT_DAILY_DECAY,
  TRADE_IMPACT_FACTOR,
  applyTrade,
  changeFraction,
  clampSentiment,
  decaySentiment,
  executionFill,
  executionFillAt,
  fairPrice,
  FLOW_CAP,
  flowPrice,
  livePrice,
  marketCap,
  marketFlow,
  tradeImpact,
  volatilityFactor,
} from "@/lib/pricing";

describe("fairPrice — the 3× ARR anchor", () => {
  it("prices MRR at a 3x multiple spread over 10,000 shares", () => {
    // $10,000 MRR → $30,000 "valuation" → $3.00/share
    expect(fairPrice(10_000)).toBe(36); // $10k/mo = $120k ARR → 3× → $360k ÷ 10k shares
    expect(fairPrice(5_000)).toBe(18);
    expect(fairPrice(100_000)).toBe(360);
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
    expect(livePrice(10_000, 0)).toBe(36);
  });

  it("rises and falls with sentiment", () => {
    expect(livePrice(10_000, 0.2)).toBeCloseTo(43.2, 10);
    expect(livePrice(10_000, -0.2)).toBeCloseTo(28.8, 10);
  });

  it("never strays past the ±40% cap even if stored sentiment is corrupt", () => {
    expect(livePrice(10_000, 5)).toBeCloseTo(36 * (1 + SENTIMENT_CAP), 10);
    expect(livePrice(10_000, -5)).toBeCloseTo(36 * (1 - SENTIMENT_CAP), 10);
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
    expect(marketCap(10_000, 0)).toBe(360_000); // 3× $120k ARR
    expect(marketCap(10_000, 0.4)).toBeCloseTo(504_000, 6);
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
    expect(buy.avgPrice).toBeCloseTo(36 * (1 + 0.1), 10); // mean of 0 and +0.2

    const sell = executionFill(MRR, 0, "sell", 1_000);
    expect(sell.avgPrice).toBeLessThan(livePrice(MRR, 0));
    expect(sell.avgPrice).toBeCloseTo(36 * (1 - 0.1), 10);
  });

  it("sentiment after the fill matches applyTrade exactly", () => {
    const fill = executionFill(MRR, 0.05, "buy", 700);
    expect(fill.newSentiment).toBeCloseTo(applyTrade(0.05, "buy", 700), 10);
  });

  it("shares past the cap fill flat at the cap price", () => {
    // From 0, +0.4 cap is hit after 2,000 shares; the other 2,000 fill at cap.
    const fill = executionFill(MRR, 0, "buy", 4_000);
    const movingCost = 2_000 * 36 * (1 + 0.2); // mean sentiment 0 → 0.4 is 0.2
    const cappedCost = 2_000 * 36 * (1 + SENTIMENT_CAP);
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
    expect(opening).toBeCloseTo(28.8, 10); // $8k/mo → $96k ARR → 3× ÷ 10k

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

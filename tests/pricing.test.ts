import { describe, expect, it } from "vitest";
import {
  ARR_MULTIPLE,
  MAX_POSITION_FRACTION,
  MONTHS_PER_YEAR,
  MULTIPLE_CEILING,
  MULTIPLE_FLOOR,
  SENTIMENT_CAP,
  SENTIMENT_CEILING,
  SENTIMENT_FLOOR,
  SENTIMENT_DAILY_DECAY,
  SENTIMENT_DAILY_DECAY_DOWN,
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
  settledPrice,
  tapeJitter,
  TAPE_JITTER_PEAK,
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

  it("rises and falls with sentiment, exponentially", () => {
    expect(livePrice(10_000, 0.2)).toBeCloseTo(A(10_000) * Math.exp(0.2), 10);
    expect(livePrice(10_000, -0.2)).toBeCloseTo(A(10_000) * Math.exp(-0.2), 10);
  });

  it("is symmetric in log space — a doubling and a halving are one move", () => {
    const up = livePrice(10_000, Math.LN2);
    const down = livePrice(10_000, -Math.LN2);
    expect(up).toBeCloseTo(A(10_000) * 2, 10);
    expect(down).toBeCloseTo(A(10_000) / 2, 10);
  });

  it("approaches zero without ever reaching it, however hard it is sold", () => {
    let prev = livePrice(10_000, 0);
    for (const s of [-1, -2, -3, -4, -5]) {
      const px = livePrice(10_000, s);
      expect(px).toBeLessThan(prev); // always further to fall
      expect(px).toBeGreaterThan(0); // but never to nothing
      prev = px;
    }
  });

  it("stays finite on corrupt input rather than returning Infinity", () => {
    expect(Number.isFinite(livePrice(10_000, 500))).toBe(true);
    expect(livePrice(10_000, -500)).toBeGreaterThan(0);
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
    expect(marketCap(10_000, 0.4)).toBeCloseTo(
      A(10_000) * Math.exp(0.4) * SHARES_OUTSTANDING,
      6
    );
  });
});

describe("clampSentiment", () => {
  it("passes through values inside the band", () => {
    expect(clampSentiment(0.15)).toBe(0.15);
    expect(clampSentiment(-0.39)).toBe(-0.39);
  });

  it("leaves ordinary market pressure completely alone", () => {
    // the old ±0.4 clamp was a wall two sellers could reach; these must pass
    for (const s of [0.41, 1.2, -0.9, -2.5]) expect(clampSentiment(s)).toBe(s);
  });

  it("bounds only the absurd, to keep the arithmetic finite", () => {
    expect(clampSentiment(50)).toBe(SENTIMENT_CEILING);
    expect(clampSentiment(-50)).toBe(SENTIMENT_FLOOR);
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

  it("the tenth seller still moves it — no wall to run into", () => {
    // the whole point of leaving log space unclamped: a crowd never runs out
    // of road. Under the old ±0.4 cap, seller three onwards did nothing.
    let s = 0;
    const moves: number[] = [];
    for (let i = 0; i < 10; i++) {
      const before = livePrice(10_000, s);
      s = applyTrade(s, "sell", 1_000); // a max-size position each
      moves.push(before - livePrice(10_000, s));
    }
    expect(moves.every((m) => m > 0)).toBe(true); // every seller counts
    // and each one moves it less in dollars than the last — a thinner market
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i]).toBeLessThan(moves[i - 1]);
    }
  });

  it("a mass dump can take the price down 90%+, not 40%", () => {
    let s = 0;
    for (let i = 0; i < 12; i++) s = applyTrade(s, "sell", 1_000);
    expect(livePrice(10_000, s)).toBeLessThan(livePrice(10_000, 0) * 0.1);
  });
});

describe("decaySentiment — hype fades, MRR is gravity", () => {
  it("hype fades faster than fear — a crash is a scar, not a bruise", () => {
    expect(decaySentiment(0.4)).toBeCloseTo(0.4 * (1 - SENTIMENT_DAILY_DECAY), 10);
    expect(decaySentiment(-0.4)).toBeCloseTo(
      -0.4 * (1 - SENTIMENT_DAILY_DECAY_DOWN),
      10
    );
    // same size shock, one heals in half the time of the other
    const pump = Math.abs(0.4 - decaySentiment(0.4));
    const crash = Math.abs(-0.4 - decaySentiment(-0.4));
    expect(pump).toBeGreaterThan(crash * 2);
  });

  it("a crash still lingers a fortnight after a pump has gone", () => {
    let up = 0.5;
    let down = -0.5;
    for (let i = 0; i < 14; i++) {
      up = decaySentiment(up);
      down = decaySentiment(down);
    }
    expect(up).toBeLessThan(0.1); // two weeks on, the pump is spent
    expect(Math.abs(down)).toBeGreaterThan(0.2); // the crash is not
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
    let s = 0.4;
    for (let i = 0; i < 30; i++) s = decaySentiment(s); // a month of decay
    expect(livePrice(10_000, s)).toBeLessThan(livePrice(10_000, 0.4) * 0.97);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.4 * 0.05);
  });

  it("bounds corrupt input before decaying", () => {
    expect(decaySentiment(99)).toBeCloseTo(
      SENTIMENT_CEILING * (1 - SENTIMENT_DAILY_DECAY),
      10
    );
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
    // the integral of the curve, (e^δ − 1)/δ — a shade above the old
    // arithmetic midpoint, because an exponential curve is convex
    expect(buy.avgPrice).toBeCloseTo(A(10_000) * ((Math.exp(0.2) - 1) / 0.2), 10);

    const sell = executionFill(MRR, 0, "sell", 1_000);
    expect(sell.avgPrice).toBeLessThan(livePrice(MRR, 0));
    expect(sell.avgPrice).toBeCloseTo(A(10_000) * ((Math.exp(-0.2) - 1) / -0.2), 10);
  });

  it("sentiment after the fill matches applyTrade exactly", () => {
    const fill = executionFill(MRR, 0.05, "buy", 700);
    expect(fill.newSentiment).toBeCloseTo(applyTrade(0.05, "buy", 700), 10);
  });

  it("there is no flat stretch any more — every share costs more than the last", () => {
    // the old model capped sentiment, so half a big order filled at a flat
    // price and size stopped being punished. Now the curve never flattens.
    const small = executionFill(MRR, 0, "buy", 1_000);
    const big = executionFill(MRR, 0, "buy", 4_000);
    expect(big.avgPrice).toBeGreaterThan(small.avgPrice);
    // four times the size costs MORE than four times the money
    expect(big.total).toBeGreaterThan(small.total * 4);
  });

  it("a buy into an already-hyped ticker still pays up", () => {
    const cool = executionFill(MRR, 0, "buy", 500);
    const hot = executionFill(MRR, 0.4, "buy", 500);
    expect(hot.avgPrice).toBeGreaterThan(cool.avgPrice);
    expect(hot.newSentiment).toBeGreaterThan(0.4);
  });

  it("a round trip cancels to the cent, in either direction", () => {
    // exp makes this exact rather than approximate: the integral up and the
    // integral back down are the same number
    for (const n of [10, 500, 4_000]) {
      const buy = executionFill(MRR, 0, "buy", n);
      const back = executionFill(MRR, buy.newSentiment, "sell", n);
      expect(back.total).toBeCloseTo(buy.total, 8);
    }
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

    // A wave of buying: 3,000 shares (30% of float) → pressure +0.6, uncapped.
    sentiment = applyTrade(sentiment, "buy", 3_000);
    const pumped = livePrice(mrr, sentiment);
    expect(pumped).toBeCloseTo(opening * Math.exp(0.6), 10);

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

describe("the weather (drift + shimmer)", () => {
  it("the shimmer is deterministic and tiny — that is the whole point", () => {
    const t = Date.parse("2026-08-30T12:00:00Z");
    expect(tapeJitter("INBX", t, 8000)).toBe(tapeJitter("INBX", t, 8000));
    expect(tapeJitter("INBX", t)).not.toBe(tapeJitter("PRL", t));
  });

  it("the shimmer never exceeds its stated peak, at any sampled instant", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const ceiling = TAPE_JITTER_PEAK * volatilityFactor(300);
    let worst = 0;
    for (let i = 0; i < 20_000; i++) {
      worst = Math.max(worst, Math.abs(tapeJitter("VOLT", t0 + i * 2_137, 300)));
    }
    expect(worst).toBeLessThanOrEqual(ceiling);
    // and it really is sub-percent, so the tape never visibly disagrees with
    // the price an order fills at
    expect(ceiling).toBeLessThan(0.007);
  });

  it("small caps are wilder than big caps", () => {
    expect(volatilityFactor(300)).toBeGreaterThan(volatilityFactor(50_000));
  });

  it("THE FIX: no price function can see the future", () => {
    // The old marketFlow() was a pure function of (symbol, time), and it
    // shipped to the browser, so tomorrow's price was one console call away.
    // Now the weather is a parameter. Every price a client can compute for a
    // future instant is the CURRENT weather held flat — the next draw does not
    // exist yet — so the only thing left to predict is the shimmer, which is
    // sub-percent and excluded from fills.
    const t = Date.parse("2026-08-30T12:00:00Z");
    const tomorrow = t + 86_400_000;
    const known = 0.12;
    const now = settledPrice(8_000, 0.2, t, 2.5, 10_000, [], known);
    const ahead = settledPrice(8_000, 0.2, tomorrow, 2.5, 10_000, [], known);
    expect(ahead).toBe(now);
  });

  it("fills price off the drift, never off the shimmer", () => {
    const t = Date.parse("2026-08-30T15:30:00Z");
    const drift = 0.18;
    const buy = executionFillAt(
      "INBX", 8_000, 0, "buy", 500, t, 2.5, 10_000, [], drift
    );
    expect(buy.avgPrice).toBeCloseTo(
      executionFill(8_000, 0, "buy", 500).avgPrice * Math.exp(drift),
      10
    );
    // the shimmer is a function of the clock; if it leaked into fills, timing
    // it would be free money. Two instants with different shimmer, same fill:
    const later = executionFillAt(
      "INBX", 8_000, 0, "buy", 500, t + 91_000, 2.5, 10_000, [], drift
    );
    expect(tapeJitter("INBX", t, 8_000)).not.toBe(
      tapeJitter("INBX", t + 91_000, 8_000)
    );
    expect(later.avgPrice).toBe(buy.avgPrice);
  });

  it("REGRESSION: BUY AT is the price on the tape, whatever the weather", () => {
    // The tape is anchor × e^drift (settledPrice); the fill was still being
    // scaled by (1 + drift). Identical at drift 0 and a lie everywhere else:
    // at drift -0.3 a buy filled 5.5% under the quoted price, which the trade
    // panel dutifully showed as BUY AT $7.84 under a tape reading $8.23 — a
    // free discount on every red day, and a free skim for anyone who noticed
    // that selling back at the tape's number was arithmetic.
    const t = Date.parse("2026-09-01T21:00:00Z");
    for (const drift of [-0.9, -0.3, -0.1, 0, 0.1, 0.3, 0.9]) {
      const tape = settledPrice(8_000, 0.1, t, 2.5, 10_000, [], drift);
      const buy = executionFillAt(
        "INBX", 8_000, 0.1, "buy", 1, t, 2.5, 10_000, [], drift
      );
      const sell = executionFillAt(
        "INBX", 8_000, 0.1, "sell", 1, t, 2.5, 10_000, [], drift
      );
      // one share in ten thousand moves the hype curve by a hair, so the
      // fill and the tape agree to a hundredth of a percent
      expect(Math.abs(buy.avgPrice / tape - 1)).toBeLessThan(1e-3);
      expect(Math.abs(sell.avgPrice / tape - 1)).toBeLessThan(1e-3);
      expect(buy.avgPrice).toBeGreaterThanOrEqual(sell.avgPrice);
    }
    // the old formula, by number: 5.5% under the tape at drift -0.3
    const tape = settledPrice(8_000, 0.1, t, 2.5, 10_000, [], -0.3);
    const linear = executionFill(8_000, 0.1, "buy", 1).avgPrice * (1 - 0.3);
    expect(linear / tape).toBeLessThan(0.95);
  });

  it("round trips at one instant are still exactly a wash", () => {
    const t = Date.parse("2026-08-30T15:30:00Z");
    const buy = executionFillAt("INBX", 8_000, 0, "buy", 500, t, 2.5, 10_000, [], 0.2);
    const sell = executionFillAt(
      "INBX", 8_000, buy.newSentiment, "sell", 500, t, 2.5, 10_000, [], 0.2
    );
    expect(sell.total).toBeCloseTo(buy.total, 6);
  });

  it("flowPrice is settled × shimmer, with the weather in LOG space", () => {
    const t = Date.parse("2026-08-30T12:00:00Z");
    const p = flowPrice("INBX", 8_000, 0.2, t, 2.5, 10_000, [], 0.1);
    expect(p).toBeCloseTo(
      livePrice(8_000, 0.2) * Math.exp(0.1) * (1 + tapeJitter("INBX", t, 8_000)),
      10
    );
    expect(p).toBeGreaterThan(0);
    expect(flowPrice("INBX", 0, 0, t)).toBe(0);
  });

  it("REGRESSION: the weather can never take a price to or below zero", () => {
    // (1 + drift) died at drift <= -1, which is the only reason the band had
    // to be clamped tight — and a tight band with a short pull is an
    // oscillator. exp() has no such floor, so the band could be opened up.
    for (const drift of [-6, -1.4, -1, -0.999, 0, 1.4, 6]) {
      const p = settledPrice(8_000, 0, Date.now(), 2.5, 10_000, [], drift);
      expect(p).toBeGreaterThan(0);
      expect(Number.isFinite(p)).toBe(true);
    }
    // and it is symmetric: a halving and a doubling are the same size move
    const base = settledPrice(8_000, 0, Date.now(), 2.5, 10_000, [], 0);
    const up = settledPrice(8_000, 0, Date.now(), 2.5, 10_000, [], Math.LN2);
    const down = settledPrice(8_000, 0, Date.now(), 2.5, 10_000, [], -Math.LN2);
    expect(up / base).toBeCloseTo(2, 10);
    expect(base / down).toBeCloseTo(2, 10);
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

describe("the first reading after connecting", () => {
  const T = 1_700_000_000_000;

  it("steps the price to the truth but does not treat it as news", () => {
    const catchUp: RevenueEvent = {
      at: T,
      prevMrr: 635.5,
      mrr: 570,
      catchUp: true,
    };
    // no overshoot: a month-old report being stale is not a fresh churn
    expect(revenueShock([catchUp], T + 1000)).toBe(0);
    // but the price still moves to what Stripe actually says
    const before = flowPrice("TEST", 635.5, 0, T - 1000, 2, 1_000, [catchUp]);
    const after = flowPrice("TEST", 570, 0, T + 1000, 2, 1_000, [catchUp]);
    expect(after / before).toBeCloseTo(570 / 635.5, 2);
  });

  it("still overshoots on a real event that follows it", () => {
    const events: RevenueEvent[] = [
      { at: T, prevMrr: 635.5, mrr: 570, catchUp: true },
      { at: T + 3_600_000, prevMrr: 570, mrr: 500 },
    ];
    expect(revenueShock(events, T + 3_600_000 + 1000)).toBeLessThan(-0.1);
  });
});

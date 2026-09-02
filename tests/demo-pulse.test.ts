import { describe, expect, it } from "vitest";
import {
  DEMO_BAND,
  DEMO_EVENTS_PER_DAY,
  demoEventChance,
  guessSubscribers,
  nextDemoEvent,
} from "@/lib/demo-pulse";
import type { FlowRandom } from "@/lib/flow";

function seq(...units: number[]): FlowRandom {
  let i = 0;
  return { unit: () => units[Math.min(i++, units.length - 1)], gauss: () => 0 };
}

describe("the demo pulse", () => {
  it("fires two or three times a day per listing, in five-minute rolls", () => {
    expect(demoEventChance() * 288).toBeCloseTo(DEMO_EVENTS_PER_DAY, 10);
    expect(demoEventChance()).toBeLessThan(0.01);
  });

  it("a signup adds a customer's worth of MRR and a customer", () => {
    // roll 0.9 → new; unit draw 0.5 → 1.2× the average customer
    const ev = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, seq(0.9, 0.5));
    expect(ev?.kind).toBe("new");
    expect(ev?.prevMrr).toBe(10_000);
    expect(ev?.mrr).toBeCloseTo(10_120, 5);
    expect(ev?.prevSubs).toBe(100);
    expect(ev?.subs).toBe(101);
  });

  it("a churn takes one away, and the last two customers never leave", () => {
    const ev = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, seq(0.1, 0.5));
    expect(ev?.kind).toBe("churn");
    expect(ev?.mrr).toBeCloseTo(9_880, 5);
    expect(ev?.subs).toBe(99);
    expect(nextDemoEvent({ mrr: 100, subs: 2, reportedMrr: 100 }, seq(0.1, 0.5))).toBeNull();
  });

  it("one customer in the tail is worth many — a churn you can see", () => {
    // gauss = 2 is the two-sigma customer: e^(1.1·2) ≈ 9× the average plan
    const whale: FlowRandom = { unit: (() => { const u = [0.1, 0.5]; let i = 0; return () => u[Math.min(i++, 1)]; })(), gauss: () => 2 };
    const ev = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, whale);
    expect(ev?.kind).toBe("churn");
    expect(ev?.subs).toBe(99);
    expect(10_000 - ev!.mrr).toBeGreaterThan(800);
    expect(10_000 - ev!.mrr).toBeLessThan(1_200);
  });

  it("a launch brings a wave of customers, and a wave never empties the book", () => {
    // roll → new, size 0.5, wave roll 0.1 (< WAVE_CHANCE), count roll 0.5 → 2 + 3
    const ev = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, seq(0.9, 0.5, 0.1, 0.5));
    expect(ev?.kind).toBe("new");
    expect(ev?.subs).toBe(105);
    expect(ev?.mrr).toBeCloseTo(10_600, 5);
    // a churn wave on three customers takes one — the last two stay
    const thin = nextDemoEvent({ mrr: 300, subs: 3, reportedMrr: 300 }, seq(0.1, 0.5, 0.1, 0.9));
    expect(thin?.kind).toBe("churn");
    expect(thin?.subs).toBe(2);
  });

  it("caps a single event at a fifth of MRR", () => {
    const big: FlowRandom = { unit: seq(0.9, 0.9, 0.1, 0.99).unit, gauss: () => 4 };
    const ev = nextDemoEvent({ mrr: 10_000, subs: 20, reportedMrr: 10_000 }, big);
    expect(ev?.kind).toBe("new");
    expect(ev?.mrr).toBeCloseTo(12_000, 5);
  });

  it("expansion and contraction move money, not the count", () => {
    const up = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, seq(0.2, 0.5));
    const down = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, seq(0.3, 0.5));
    expect(up?.kind).toBe("expansion");
    expect(up?.subs).toBe(100);
    expect(up!.mrr).toBeGreaterThan(10_000);
    expect(down?.kind).toBe("contraction");
    expect(down!.mrr).toBeLessThan(10_000);
  });

  it("is steered back into its band: too rich churns, too poor signs up", () => {
    const rich = nextDemoEvent(
      { mrr: 10_000 * DEMO_BAND.ceil * 1.01, subs: 100, reportedMrr: 10_000 },
      seq(0.95, 0.5) // would be a signup, is forced to a churn
    );
    expect(rich?.kind).toBe("churn");
    const poor = nextDemoEvent(
      { mrr: 10_000 * DEMO_BAND.floor * 0.99, subs: 100, reportedMrr: 10_000 },
      seq(0.05, 0.5) // would be a churn, is forced to a signup
    );
    expect(poor?.kind).toBe("new");
  });

  it("guesses a believable customer count for a business with no record", () => {
    const n = guessSubscribers(14_600, seq(0.5));
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(1_000);
    expect(guessSubscribers(50, seq(0.5))).toBe(8);
  });

  it("refuses nonsense", () => {
    expect(nextDemoEvent({ mrr: 0, subs: 10, reportedMrr: 0 }, seq(0.9, 0.5))).toBeNull();
  });
});

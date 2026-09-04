import { describe, expect, it } from "vitest";
import {
  DEMO_BAND,
  DEMO_MIN_EVENTS_PER_DAY,
  demoEventChance,
  demoEventsPerDay,
  guessSubscribers,
  nextDemoEvent,
} from "@/lib/demo-pulse";
import type { FlowRandom } from "@/lib/flow";

function seq(...units: number[]): FlowRandom {
  let i = 0;
  return { unit: () => units[Math.min(i++, units.length - 1)], gauss: () => 0 };
}

describe("the demo pulse", () => {
  it("fires as often as the customer base moves, not on one rate for the board", () => {
    // the thing that looked wrong: 1,168 customers and 38 got the same day
    expect(demoEventsPerDay(1168)).toBeGreaterThan(4 * demoEventsPerDay(120));
    expect(demoEventsPerDay(1168)).toBeGreaterThan(10);
    expect(demoEventsPerDay(120)).toBeLessThan(3);
    // nothing goes completely quiet
    expect(demoEventsPerDay(0)).toBe(DEMO_MIN_EVENTS_PER_DAY);
    // and the per-round chance is that rate over a minute of cron, not five
    expect(demoEventChance(1168) * 1440).toBeCloseTo(demoEventsPerDay(1168), 10);
    expect(demoEventChance(1168)).toBeLessThan(0.05);
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
    // roll → new, size 0.5, wave roll 0.1 (< WAVE_CHANCE), count roll 0.5 → 2 + 2
    const ev = nextDemoEvent({ mrr: 10_000, subs: 100, reportedMrr: 10_000 }, seq(0.9, 0.5, 0.1, 0.5));
    expect(ev?.kind).toBe("new");
    expect(ev?.subs).toBe(104);
    expect(ev?.mrr).toBeCloseTo(10_480, 5);
    // a churn wave on three customers takes one — the last two stay
    const thin = nextDemoEvent({ mrr: 300, subs: 3, reportedMrr: 300 }, seq(0.1, 0.5, 0.1, 0.9));
    expect(thin?.kind).toBe("churn");
    expect(thin?.subs).toBe(2);
  });

  it("caps a single event at an eighth of MRR", () => {
    const big: FlowRandom = { unit: seq(0.9, 0.9, 0.1, 0.99).unit, gauss: () => 4 };
    const ev = nextDemoEvent({ mrr: 10_000, subs: 20, reportedMrr: 10_000 }, big);
    expect(ev?.kind).toBe("new");
    expect(ev?.mrr).toBeCloseTo(11_200, 5);
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

  it("leans back into its band, harder the further out — but is not a wall", () => {
    const over = (x: number) => 10_000 * DEMO_BAND.ceil * x;
    const at = (mrr: number, ...draws: number[]) =>
      nextDemoEvent({ mrr, subs: 100, reportedMrr: 10_000 }, seq(...draws))?.kind;
    // a step over the ceiling: the lean is about a third, so a low draw pulls back
    expect(at(over(1.01), 0.95, 0.2, 0.5)).toBe("churn");
    // ...and a high one lets a company having a good month carry on having it.
    // This is the case that used to be impossible: past the ceiling, EVERY
    // event was a churn, so a listing that had simply run ahead of its last
    // report printed nothing but churn until it came back down.
    expect(at(over(1.01), 0.95, 0.6, 0.5)).toBe("new");
    // far out, the pull is near certain
    expect(at(over(1.5), 0.95, 0.8, 0.5)).toBe("churn");
    // and it works the same way downward
    expect(at(10_000 * DEMO_BAND.floor * 0.99, 0.05, 0.2, 0.5)).toBe("new");
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

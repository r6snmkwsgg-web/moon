import { describe, expect, it } from "vitest";
import {
  actChance,
  WAKE_SCALE,
  generatePersona,
  generatePopulation,
  seededRng,
  timeOfDayFactor,
} from "@/lib/personas";

describe("the population", () => {
  const pop = generatePopulation(1000, "test/seed/1", ["hello", "b1996165"]);

  it("is deterministic in its seed", () => {
    const again = generatePopulation(1000, "test/seed/1", ["hello", "b1996165"]);
    expect(again.map((p) => p.username)).toEqual(pop.map((p) => p.username));
    expect(again[17]).toEqual(pop[17]);
    const other = generatePopulation(1000, "test/seed/2");
    expect(other.map((p) => p.username)).not.toEqual(pop.map((p) => p.username));
  });

  it("gives everyone a unique, URL-safe username that no person already has", () => {
    const names = pop.map((p) => p.username);
    expect(new Set(names).size).toBe(1000);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]+$/);
    expect(names).not.toContain("hello");
  });

  it("spreads stakes on a power law: a few dollars to six figures", () => {
    const stakes = pop.map((p) => p.cash).sort((a, b) => a - b);
    const q = (x: number) => stakes[Math.floor(x * (stakes.length - 1))];
    expect(q(0)).toBeGreaterThanOrEqual(25); // the cheapest share is about that
    expect(q(0.5)).toBeGreaterThan(80);
    expect(q(0.5)).toBeLessThan(600);
    expect(q(0.9)).toBeGreaterThan(1_000);
    expect(q(0.99)).toBeGreaterThan(5_000);
    expect(q(1)).toBeGreaterThan(30_000);
    expect(q(1)).toBeLessThanOrEqual(250_000);
    // in total, a slice of the board — not the board
    const total = stakes.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(500_000);
    expect(total).toBeLessThan(5_000_000);
  });

  it("makes most people occasional and a few relentless", () => {
    const rates = pop.map((p) => p.activityPerDay).sort((a, b) => a - b);
    const q = (x: number) => rates[Math.floor(x * (rates.length - 1))];
    expect(q(0.5)).toBeLessThan(1.5);
    expect(q(0.95)).toBeGreaterThan(2);
    expect(q(1)).toBeLessThanOrEqual(12);
    // the board sees a few dozen orders an hour from a thousand of them
    const perRound = pop.reduce((s, p) => s + p.activityPerDay / 288, 0);
    expect(perRound).toBeGreaterThan(2);
    expect(perRound).toBeLessThan(12);
  });

  it("mixes styles and only lets the rich be whales", () => {
    for (const p of pop) {
      const w = Object.values(p.styles).reduce((a, b) => a + (b ?? 0), 0);
      expect(w).toBeCloseTo(1, 6);
      if (p.styles.whale) expect(p.cash).toBeGreaterThanOrEqual(25_000);
    }
    const voices = new Set(pop.map((p) => p.voice));
    expect(voices.size).toBe(5);
    const holds = new Set(pop.map((p) => p.hold));
    expect(holds.size).toBe(3);
  });

  it("wires a follow graph that leans toward the big accounts", () => {
    for (const p of pop) {
      expect(p.follows.length).toBeGreaterThanOrEqual(3);
      expect(p.follows.length).toBeLessThanOrEqual(15);
      expect(p.follows).not.toContain(p.username);
    }
    const byName = new Map(pop.map((p) => [p.username, p]));
    const followed = pop.flatMap((p) => p.follows).map((u) => byName.get(u)!.cash);
    const meanFollowed = followed.reduce((a, b) => a + b, 0) / followed.length;
    const meanAll = pop.reduce((a, b) => a + b.cash, 0) / pop.length;
    expect(meanFollowed).toBeGreaterThan(meanAll);
  });

  it("a single persona is stable and complete", () => {
    const p = generatePersona("x", 3);
    expect(generatePersona("x", 3)).toEqual(p);
    expect(p.thesisRate).toBeGreaterThan(0);
    expect(p.postRate).toBeGreaterThan(0);
    expect(p.name.length).toBeGreaterThan(1);
  });
});

describe("the clock", () => {
  it("sleeps at night and is busiest in the working day, Eastern", () => {
    const at = (h: number) => Date.parse(`2026-09-02T${String((h + 4) % 24).padStart(2, "0")}:30:00Z`); // EDT = UTC−4
    expect(timeOfDayFactor(at(3))).toBeLessThan(timeOfDayFactor(at(12)));
    expect(timeOfDayFactor(at(12))).toBeGreaterThan(1);
    expect(timeOfDayFactor(at(3))).toBeLessThan(0.5);
  });

  it("turns a daily rate into a per-round chance", () => {
    const p = generatePersona("x", 1);
    const noon = Date.parse("2026-09-02T16:30:00Z");
    const c = actChance({ ...p, activityPerDay: 2.88 }, noon);
    expect(c).toBeCloseTo((2.88 / 288) * WAKE_SCALE * timeOfDayFactor(noon), 10);
    expect(actChance({ ...p, activityPerDay: 100_000 }, noon)).toBeLessThanOrEqual(0.95);
  });
});

describe("seededRng", () => {
  it("is reproducible and roughly uniform", () => {
    const a = seededRng("k");
    const b = seededRng("k");
    expect(Array.from({ length: 5 }, () => a.unit())).toEqual(Array.from({ length: 5 }, () => b.unit()));
    const xs = Array.from({ length: 5000 }, () => a.unit());
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

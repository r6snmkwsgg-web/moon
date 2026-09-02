import { describe, expect, it } from "vitest";
import { composeThesis, inVoice, type Situation } from "@/lib/theses";
import { generatePersona, seededRng, type Voice } from "@/lib/personas";

const sit = (over: Partial<Situation> = {}): Situation => ({
  symbol: "SNDR",
  side: "buy",
  reason: "value",
  edgePct: 18.4,
  change1hPct: 2.1,
  change24hPct: -3.4,
  newsKind: null,
  price: 24.2,
  fair: 28.65,
  mrr: 14_100,
  ...over,
});

describe("composeThesis", () => {
  it("resolves every slot and fits the print's limit", () => {
    const rng = seededRng("t1");
    for (let i = 0; i < 300; i++) {
      const p = generatePersona("v", i);
      const line = composeThesis(p, sit({ side: i % 2 ? "sell" : "buy", reason: (["value", "momentum", "news", "noise", "whale"] as const)[i % 5] }), rng);
      expect(line).not.toMatch(/\{/);
      expect(line.length).toBeLessThanOrEqual(140);
      expect(line.length).toBeGreaterThanOrEqual(3); // "dip" is a thesis
    }
  });

  it("does not sound like one person", () => {
    const rng = seededRng("t2");
    const lines = new Set<string>();
    for (let i = 0; i < 200; i++) lines.add(composeThesis(generatePersona("v", i), sit(), rng));
    expect(lines.size).toBeGreaterThan(60);
  });

  it("speaks in the voice it was given", () => {
    const rng = seededRng("t3");
    const line = "$SNDR is 18% under fair value. revenue does not lie, hype does.";
    const degen = inVoice(line, "degen", "buy", rng);
    expect(degen).toBe(degen.toLowerCase());
    expect(degen).not.toMatch(/\.$/);
    expect(inVoice(line, "analyst", "buy", rng)).toMatch(/^\$SNDR is .*\.$/);
    expect(inVoice(line, "terse", "buy", rng).length).toBeLessThan(line.length);
    expect(inVoice(line, "emoji", "sell", rng)).toMatch(/[📉🔻🩸💀🫡😬]/u);
    expect(inVoice(line, "founder", "buy", rng)).toMatch(/^(As a founder, |Founder take: )/);
    const voices: Voice[] = ["degen", "analyst", "terse", "emoji", "founder"];
    for (const v of voices) expect(inVoice(line, v, "buy", rng).length).toBeGreaterThan(0);
  });

  it("a standalone take leans the way the edge does, and may run to 280", () => {
    const rng = seededRng("t4");
    const p = { ...generatePersona("v", 9), voice: "analyst" as const };
    const bull = composeThesis(p, sit({ side: null, reason: "take", edgePct: 30 }), rng);
    const bear = composeThesis(p, sit({ side: null, reason: "take", edgePct: -30 }), rng);
    expect(bull.length).toBeGreaterThan(0);
    expect(bear.length).toBeGreaterThan(0);
    expect(bull).not.toBe(bear);
    expect(bull.length).toBeLessThanOrEqual(280);
  });
});

describe("naming the rugger", () => {
  const analyst = { ...generatePersona("v", 3), voice: "analyst" as Voice };
  const seeded = (n: number) => seededRng(`rug${n}`);
  const rugged: Situation = {
    symbol: "NTFY",
    side: "sell",
    reason: "panic",
    edgePct: 12,
    change1hPct: -11.1,
    change24hPct: 40,
    change15mPct: -11.1,
    shaken: "down",
    culprit: "@hello",
    culpritAmt: 28_200,
    culpritPct: 6.5,
    price: 41.8,
    fair: 46.8,
    mrr: 5_483,
  };

  it("a panic sell names who did it, with the size", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(composeThesis(analyst, rugged, seeded(100 + i)));
    }
    const named = [...seen].filter((l) => l.includes("@hello"));
    expect(named.length).toBeGreaterThan(seen.size * 0.6);
    expect([...seen].some((l) => l.includes("$28,200") || l.includes("6.5%"))).toBe(true);
  });

  it("a standalone take on a rugged name vents instead of reciting the multiple", () => {
    const take = composeThesis(analyst, { ...rugged, side: null, reason: "take" }, seeded(5));
    expect(take).toMatch(/hello/);
    expect(take).not.toMatch(/fair value|multiple/i);
  });

  it("a shout stays a shout in the degen voice", () => {
    const line = inVoice("WHO ELSE JUST GOT RUGGED BY @hello ON $NTFY", "degen", "sell", seeded(9));
    expect(line).toMatch(/RUGGED/);
  });

  it("without a name the reaction is still a reaction", () => {
    const line = composeThesis(analyst, { ...rugged, culprit: null }, seeded(3));
    expect(line).not.toMatch(/someone rugged|@/);
    expect(line.length).toBeGreaterThan(10);
  });
});

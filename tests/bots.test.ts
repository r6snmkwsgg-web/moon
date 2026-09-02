import { describe, expect, it } from "vitest";
import {
  BOTS,
  MAX_TRADES_PER_ROUND,
  conviction,
  decide,
  isBotUsername,
  type TickerView,
} from "@/lib/bots";
import type { FlowRandom } from "@/lib/flow";
import { positionLimit } from "@/lib/pricing";

/** A generator that always says "act" and never adds a note. */
function fixed(unit: number): FlowRandom {
  return { unit: () => unit, gauss: () => 0 };
}
function seeded(seed: number): FlowRandom {
  let s = seed >>> 0 || 1;
  const unit = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return { unit, gauss: () => 0 };
}

const view = (over: Partial<TickerView> = {}): TickerView => ({
  symbol: "SNDR",
  price: 25,
  fair: 25,
  float: 25_000,
  floatHeld: 1_000,
  change1h: 0,
  change24h: 0,
  news: [],
  held: 0,
  ...over,
});
const bot = (style: (typeof BOTS)[number]["style"]) =>
  BOTS.find((b) => b.style === style)!;

describe("the roster", () => {
  it("knows its own from a username alone", () => {
    expect(isBotUsername("quantfox")).toBe(true);
    expect(isBotUsername("hello")).toBe(false);
    expect(isBotUsername(null)).toBe(false);
    // every username is unique and lowercase — it is a URL
    const names = BOTS.map((b) => b.username);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]+$/);
  });
});

describe("conviction, by style", () => {
  const rng = fixed(0.5);
  it("value buys what is cheap against revenue and sells what is dear", () => {
    expect(conviction("value", view({ price: 20, fair: 25 }), rng)).toBeCloseTo(1, 5); // 25% cheap → full
    expect(conviction("value", view({ price: 27.5, fair: 25 }), rng)).toBeLessThan(-0.3);
    expect(conviction("value", view(), rng)).toBe(0);
  });
  it("momentum chases the tape and dumps a reversal", () => {
    expect(conviction("momentum", view({ change1h: 0.03 }), rng)).toBeCloseTo(0.6, 5);
    expect(conviction("momentum", view({ change1h: -0.05, change24h: -0.1 }), rng)).toBe(-1);
  });
  it("news reacts to a print and forgets it over the afternoon", () => {
    const fresh = conviction("news", view({ news: [{ move: -0.03, ageMs: 0 }] }), rng);
    const stale = conviction("news", view({ news: [{ move: -0.03, ageMs: 3 * 3_600_000 }] }), rng);
    expect(fresh).toBe(-1);
    expect(stale).toBeCloseTo(-0.125, 5);
    expect(conviction("news", view(), rng)).toBe(0);
  });
  it("a whale ignores small mispricings entirely", () => {
    expect(conviction("whale", view({ price: 23, fair: 25 }), rng)).toBe(0); // 8.7% is not worth the size
    expect(conviction("whale", view({ price: 20, fair: 25 }), rng)).toBeGreaterThan(0.5);
  });
});

describe("decide", () => {
  it("sizes a buy to conviction, and never past cash, the limit or the float", () => {
    const v = view({ price: 20, fair: 25 }); // full conviction
    const o = decide(bot("value"), 1_000_000, [v], fixed(0.0));
    expect(o).not.toBeNull();
    expect(o!.side).toBe("buy");
    expect(o!.symbol).toBe("SNDR");
    // 1.2% of the float at full conviction, scaled by the size draw (0.6 at unit 0)
    expect(o!.shares).toBe(Math.round(25_000 * 0.012 * 0.6));

    // cash-bound: $100 buys four shares at $20 with slack for the curve
    expect(decide(bot("value"), 100, [v], fixed(0.0))!.shares).toBe(4);
    // limit-bound: already at the position limit → nothing to buy
    expect(decide(bot("value"), 1e9, [view({ price: 20, fair: 25, held: positionLimit(25_000) })], fixed(0.0))).toBeNull();
    // float-bound: only three shares left in the float
    expect(decide(bot("value"), 1e9, [view({ price: 20, fair: 25, floatHeld: 24_997 })], fixed(0.0))!.shares).toBe(3);
  });

  it("only sells what it holds, and never sells short", () => {
    const dear = view({ price: 40, fair: 25 });
    expect(decide(bot("value"), 1e6, [dear], fixed(0.0))).toBeNull(); // nothing held
    const o = decide(bot("value"), 1e6, [{ ...dear, held: 30 }], fixed(0.0));
    expect(o!.side).toBe("sell");
    expect(o!.shares).toBeLessThanOrEqual(30);
  });

  it("stands down without a view, and news bots stand down without news", () => {
    expect(decide(bot("value"), 1e6, [view()], fixed(0.0))).toBeNull();
    expect(decide(bot("news"), 1e6, [view()], fixed(0.0))).toBeNull();
    expect(decide(bot("news"), 1e6, [view({ news: [{ move: 0.05, ageMs: 0 }] })], fixed(0.0))!.side).toBe("buy");
  });

  it("does not fire every round — a heartbeat, not a flood", () => {
    let acted = 0;
    const rng = seeded(7);
    for (let i = 0; i < 2_000; i++) {
      if (decide(bot("value"), 1e6, [view({ price: 20, fair: 25 })], rng)) acted++;
    }
    const rate = acted / 2_000;
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.35); // ACT_CHANCE.value is 0.25
    expect(MAX_TRADES_PER_ROUND).toBeLessThanOrEqual(8);
  });

  it("writes a thesis sometimes, with the numbers filled in", () => {
    let withNote = 0;
    const rng = seeded(99);
    for (let i = 0; i < 400; i++) {
      const o = decide(bot("value"), 1e6, [view({ price: 20, fair: 25 })], rng);
      if (o?.note) {
        withNote++;
        expect(o.note).not.toMatch(/\{/); // every placeholder resolved
      }
    }
    expect(withNote).toBeGreaterThan(10);
  });
});

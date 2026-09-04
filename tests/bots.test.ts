import { describe, expect, it } from "vitest";
import {
  BOTS,
  MAX_TRADES_PER_ROUND,
  conviction,
  decide,
  pickCulprit,
  type RecentPrint,
  isBotUsername,
  personaConviction,
  personaFromSpec,
  type TickerView,
} from "@/lib/bots";
import { startingCashFor } from "@/lib/bot-roster";
import { generatePersona, type Persona } from "@/lib/personas";
import type { FlowRandom } from "@/lib/flow";
import { positionLimit } from "@/lib/pricing";

/** A generator that always says the same thing. */
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
  change15m: 0,
  change24h: 0,
  news: [],
  held: 0,
  avgCost: 0,
  leaderHolds: false,
  herd: 0,
  mrr: 14_100,
  ...over,
});
const pure = (style: Persona["styles"] extends Partial<Record<infer S, number>> ? S : never, over: Partial<Persona> = {}): Persona => ({
  username: "t",
  name: "T",
  styles: { [style]: 1 },
  cash: 10_000,
  activityPerDay: 5,
  hold: "swing",
  voice: "analyst",
  thesisRate: 0,
  postRate: 0,
  follows: [],
  sloppiness: 0, // the tests pin the formula; the floor's own reads are tested apart
  ...over,
});

describe("the roster", () => {
  it("knows its own from a username alone", () => {
    expect(isBotUsername("quantfox")).toBe(true);
    expect(isBotUsername("hello")).toBe(false);
    expect(isBotUsername(null)).toBe(false);
    const names = BOTS.map((b) => b.username);
    expect(new Set(names).size).toBe(names.length);
  });

  it("measures P&L from the right zero: the persona's stake, then the roster's", () => {
    expect(startingCashFor("whale_wendy", 10_000)).toBe(150_000);
    expect(startingCashFor("quantfox", 10_000)).toBe(50_000);
    expect(startingCashFor("hello", 10_000)).toBe(10_000);
    expect(startingCashFor("quiet_lobster", 10_000, { cash: 340 })).toBe(340);
    expect(startingCashFor(null, 10_000)).toBe(10_000);
  });

  it("turns an original into a persona that is always on", () => {
    const p = personaFromSpec(BOTS[0]);
    expect(p.username).toBe(BOTS[0].username);
    expect(Object.values(p.styles)[0]).toBe(1);
    expect(p.activityPerDay).toBeGreaterThan(5);
  });
});

describe("conviction, by style", () => {
  const rng = fixed(0.5);
  it("value buys what is cheap against revenue and sells what is dear", () => {
    expect(conviction("value", view({ price: 20, fair: 25 }), rng)).toBeCloseTo(1, 5);
    expect(conviction("value", view({ price: 27.5, fair: 25 }), rng)).toBeLessThan(-0.3);
    expect(conviction("value", view(), rng)).toBe(0);
  });
  it("momentum chases the tape and dumps a reversal", () => {
    expect(conviction("momentum", view({ change1h: 0.03 }), rng)).toBeCloseTo(0.6, 5);
    expect(conviction("momentum", view({ change1h: -0.05, change24h: -0.1 }), rng)).toBe(-1);
  });
  it("news reacts to a print and forgets it over the afternoon", () => {
    expect(conviction("news", view({ news: [{ move: -0.03, ageMs: 0 }] }), rng)).toBe(-1);
    expect(conviction("news", view({ news: [{ move: -0.03, ageMs: 3 * 3_600_000 }] }), rng)).toBeCloseTo(-0.125, 5);
  });
  it("a whale ignores small mispricings entirely", () => {
    expect(conviction("whale", view({ price: 23, fair: 25 }), rng)).toBe(0);
    expect(conviction("whale", view({ price: 20, fair: 25 }), rng)).toBeGreaterThan(0.5);
  });
  it("a persona blends its styles and listens, a little, to the crowd", () => {
    const p = pure("value", { styles: { value: 0.5, momentum: 0.5 } });
    // cheap but falling: value says +1, momentum says −1 → a wash
    const mixed = personaConviction(p, view({ price: 20, fair: 25, change1h: -0.05, change24h: -0.1 }), rng);
    expect(Math.abs(mixed.c)).toBeLessThan(0.05);
    // the crowd buying tips it, but never past half size on its own
    const herded = personaConviction(pure("noise", { styles: { noise: 1 } }), view({ herd: 10 }), fixed(0.5));
    expect(herded.c).toBeCloseTo(0.6, 5);
  });
});

describe("decide", () => {
  it("can sell a position smaller than one share, and sweeps the dust", () => {
    // a reverse split leaves fractions behind (0013), and a holder who cannot
    // sell them is stuck in the name forever
    const dear = view({ price: 40, fair: 25, held: 0.42 });
    const o = decide(pure("value"), 1e6, [dear], fixed(0.0));
    expect(o).not.toBeNull();
    expect(o!.side).toBe("sell");
    expect(o!.shares).toBeCloseTo(0.42, 4); // the whole thing — the remainder would be dust
    // and a sell never exceeds the position, fraction or not
    const big = view({ price: 40, fair: 25, held: 500.25 });
    const p2 = decide(pure("value"), 1e6, [big], fixed(0.0));
    expect(p2!.shares).toBeGreaterThan(0);
    expect(p2!.shares).toBeLessThanOrEqual(500.25);
  });

  it("sizes a buy to its OWN stake and conviction, never past cash, the limit or the float", () => {
    const v = view({ price: 20, fair: 25 }); // full conviction for value
    const o = decide(pure("value"), 10_000, [v], fixed(0.0));
    expect(o).not.toBeNull();
    expect(o!.side).toBe("buy");
    // 35% of the stake at full conviction, scaled by the size draw (0.6 at unit 0)
    expect(o!.shares).toBe(Math.floor((10_000 * 0.35 * 1 * 0.6) / 20));
    // shares divide, so a small account stakes its slice instead of being
    // rounded up to a whole share it cannot really afford
    expect(decide(pure("value"), 60, [v], fixed(0.0))!.shares).toBeCloseTo(0.63, 4);
    expect(decide(pure("value"), 30, [v], fixed(0.0))!.shares).toBeCloseTo(0.315, 4);
    // below a dollar of notional there is nothing worth printing
    expect(decide(pure("value"), 4, [v], fixed(0.0))).toBeNull();
    // limit-bound
    expect(decide(pure("value"), 1e9, [view({ price: 20, fair: 25, held: positionLimit(25_000) })], fixed(0.0))).toBeNull();
    // float-bound
    expect(decide(pure("value"), 1e9, [view({ price: 20, fair: 25, floatHeld: 24_997 })], fixed(0.0))!.shares).toBe(3);
  });

  it("only sells what it holds, and paperhands let go faster than diamond hands", () => {
    const dear = view({ price: 40, fair: 25, held: 100 });
    expect(decide(pure("value"), 1e6, [view({ price: 40, fair: 25 })], fixed(0.0))).toBeNull();
    const paper = decide(pure("value", { hold: "paper" }), 1e6, [dear], fixed(0.0))!;
    const diamond = decide(pure("value", { hold: "diamond" }), 1e6, [dear], fixed(0.0))!;
    expect(paper.side).toBe("sell");
    expect(paper.shares).toBeGreaterThan(diamond.shares);
    expect(paper.shares).toBeLessThanOrEqual(100);
  });

  it("stands down without a view", () => {
    expect(decide(pure("value"), 1e6, [view()], fixed(0.0))).toBeNull();
    expect(decide(pure("news"), 1e6, [view()], fixed(0.0))).toBeNull();
  });

  it("writes a thesis at its own rate, with the numbers filled in and a reason", () => {
    let withNote = 0;
    const rng = seeded(99);
    for (let i = 0; i < 300; i++) {
      const o = decide(pure("value", { thesisRate: 0.5, voice: "degen" }), 1e6, [view({ price: 20, fair: 25 })], rng);
      if (o?.note) {
        withNote++;
        expect(o.note).not.toMatch(/\{/);
        expect(o.reason).toBe("value");
      }
    }
    expect(withNote).toBeGreaterThan(80);
    expect(withNote).toBeLessThan(220);
  });

  it("a generated persona trades like itself", () => {
    const p = generatePersona("v", 42);
    const o = decide({ ...p, styles: { value: 1 } }, p.cash, [view({ price: 20, fair: 25 })], fixed(0.0));
    if (o) expect(o.shares * 20).toBeLessThanOrEqual(p.cash);
    // The old ceiling of sixty was a budget guard: every fill cost six
    // database round trips, so a round could not afford more. Batched
    // (0014) a ticker's whole queue is one call, and this is a safety rail
    // against a runaway rather than the thing that sets market volume.
    expect(MAX_TRADES_PER_ROUND).toBeGreaterThan(60);
    expect(MAX_TRADES_PER_ROUND).toBeLessThanOrEqual(5_000);
  });
});

describe("the reflexes", () => {
  it("paper hands dump a name that just fell a tenth, and say so", () => {
    const p = pure("value", { hold: "paper", thesisRate: 0 });
    // fair still says hold — the reflex overrides the model
    const v = view({ price: 22, fair: 25, change15m: -0.12, change1h: -0.12, held: 400 });
    const o = decide(p, 1_000, [v], seeded(7));
    expect(o?.side).toBe("sell");
    expect(o?.reason).toBe("panic");
    expect(o?.shares).toBe(400); // the whole position
    // a panic is worth saying out loud even for a quiet account
    expect(typeof o?.note).toBe("string");
    expect(o?.note?.length).toBeGreaterThan(10);
  });

  it("diamond hands look away from the same drop", () => {
    const p = pure("value", { hold: "diamond" });
    const v = view({ price: 22, fair: 25, change15m: -0.12, change1h: -0.12, held: 400 });
    const o = decide(p, 1_000, [v], seeded(7));
    // value says buy (edge +13.6%), the reflex is a tenth — no sale
    expect(o?.side ?? "hold").not.toBe("sell");
  });

  it("a value account with cash buys the dip when the revenue did not move", () => {
    const p = pure("value", { hold: "swing" });
    const v = view({ price: 22, fair: 25, change15m: -0.12, change1h: -0.12, held: 0 });
    const o = decide(p, 5_000, [v], seeded(3));
    expect(o?.side).toBe("buy");
    expect(o?.reason).toBe("dip");
  });

  it("but not when the drop is a churn", () => {
    const p = pure("value", { hold: "swing" });
    const churned = view({
      price: 22,
      fair: 25,
      change15m: -0.12,
      change1h: -0.12,
      held: 0,
      news: [{ move: -0.08, ageMs: 10 * 60_000 }],
    });
    const o = decide(p, 5_000, [churned], seeded(3));
    expect(o?.reason).not.toBe("dip");
  });
});

describe("the rugger", () => {
  const now = Date.parse("2026-09-02T21:00:00Z");
  const print = (over: Partial<RecentPrint>): RecentPrint => ({
    userId: "u",
    tickerId: "t1",
    side: "sell",
    shares: 100,
    total: 2_000,
    at: now - 5 * 60_000,
    name: "hello",
    username: "hello-6725",
    bot: false,
    ...over,
  });

  it("is the biggest print the right way, named as a person with an @", () => {
    const prints = [
      print({ userId: "a", shares: 200, total: 4_000 }),
      print({ userId: "b", shares: 1_300, total: 28_200 }),
      print({ userId: "c", side: "buy", shares: 5_000, total: 90_000 }),
    ];
    const who = pickCulprit(prints, "t1", 20_000, "down", now);
    expect(who?.name).toBe("@hello-6725");
    expect(who?.total).toBe(28_200);
    expect(who?.pctOfFloat).toBeCloseTo(6.5, 5);
    expect(who?.human).toBe(true);
  });

  it("a bot is named as the tape names it, and a pump blames the buyer", () => {
    const prints = [print({ side: "buy", shares: 800, total: 30_000, name: "Whale Wendy", bot: true })];
    const who = pickCulprit(prints, "t1", 20_000, "up", now);
    expect(who?.name).toBe("Whale Wendy");
    expect(who?.side).toBe("buy");
  });

  it("nobody, when the biggest print was too small to matter", () => {
    const prints = [print({ shares: 10, total: 250 })];
    expect(pickCulprit(prints, "t1", 20_000, "down", now)).toBeNull();
  });
});

describe("leaders", () => {
  it("add to a name they hold and are slow to leave it", () => {
    const leader = pure("value", { leader: true, hold: "swing" });
    const follower = pure("value", { hold: "swing" });
    // a modest edge, so neither read is pinned at the clamp
    const cheap = view({ price: 22, fair: 25, held: 100 });
    expect(personaConviction(leader, cheap, seeded(1)).c).toBeGreaterThan(
      personaConviction(follower, cheap, seeded(1)).c
    );
    const rich = view({ price: 32, fair: 25, held: 100 });
    expect(personaConviction(leader, rich, seeded(1)).c).toBeGreaterThan(
      personaConviction(follower, rich, seeded(1)).c
    ); // less negative
  });

  it("a follower panics half as hard while the leader is still in", () => {
    const p = pure("value", { hold: "paper" });
    const alone = view({ price: 22, fair: 25, change15m: -0.12, change1h: -0.12, held: 400 });
    const covered = view({ ...alone, leaderHolds: true });
    expect(personaConviction(p, covered, seeded(2)).c).toBeGreaterThan(personaConviction(p, alone, seeded(2)).c);
  });
});

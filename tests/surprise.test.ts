import { describe, expect, it } from "vitest";
import {
  annualisedFromDaily,
  dailySpread,
  dayProgress,
  expectedDaily,
  revenueSurprise,
  surpriseResponse,
  SURPRISE_CAP,
  type DailyRevenue,
} from "@/lib/surprise";

/** n days of revenue, newest last. */
const days = (amounts: number[]): DailyRevenue[] =>
  amounts.map((amount, i) => ({
    day: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    amount,
  }));

/** A whole day at once, so `progress` is 1 and confidence is full. */
const scoreFullDay = (history: DailyRevenue[], today: number) =>
  surpriseResponse(revenueSurprise(history, today, 1));

describe("expectedDaily", () => {
  it("is the average of a steady business", () => {
    expect(expectedDaily(days(Array(30).fill(200)))).toBeCloseTo(200, 6);
  });

  it("leans on recent days more than old ones", () => {
    const rising = expectedDaily(days([100, 100, 100, 100, 300]));
    const falling = expectedDaily(days([300, 100, 100, 100, 100]));
    expect(rising).toBeGreaterThan(falling);
  });

  it("lets a big day fade instead of dropping off a cliff", () => {
    // a hard 30-day window would drop a spike whole on day 31 and crater the
    // price; the weighted mean lets it decay instead
    const recent = expectedDaily(days([...Array(20).fill(100), 400]));
    const old = expectedDaily(days([400, ...Array(20).fill(100)]));
    expect(recent).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(100);
  });

  it("will not let one whale invoice carry the valuation", () => {
    // $5,000 against a $100/day business is a windfall, not a new normal
    const whale = expectedDaily(days([...Array(20).fill(100), 5000]));
    const normal = expectedDaily(days(Array(21).fill(100)));
    expect(whale).toBeGreaterThan(normal);
    expect(whale).toBeLessThan(normal * 1.5);
  });

  it("but a genuine step change is believed", () => {
    // ten days at 10× is a different business, not an outlier
    const stepped = expectedDaily(days([...Array(20).fill(100), ...Array(10).fill(1000)]));
    expect(stepped).toBeGreaterThan(400);
  });

  it("is zero for a business with no history", () => {
    expect(expectedDaily([])).toBe(0);
  });
});

describe("dailySpread", () => {
  it("is wide for a lumpy business and narrow for a regular one", () => {
    const lumpy = days([0, 0, 900, 0, 0, 800, 0, 0, 0, 700]);
    const steady = days(Array(10).fill(240));
    expect(dailySpread(lumpy, expectedDaily(lumpy))).toBeGreaterThan(
      dailySpread(steady, expectedDaily(steady))
    );
  });

  it("never collapses to zero on a suspiciously smooth record", () => {
    const flat = days(Array(30).fill(200));
    // without a floor, an identical-every-day history gives spread 0 and
    // every $1 difference becomes an infinite z-score
    expect(dailySpread(flat, 200)).toBeGreaterThanOrEqual(200 * 0.2);
  });

  it("floors a record too short to measure", () => {
    expect(dailySpread(days([100, 100]), 100)).toBeGreaterThan(0);
  });
});

describe("the shape the market should have", () => {
  const steady = days(Array(30).fill(200));

  it("landing on expectation does nothing at all", () => {
    expect(scoreFullDay(steady, 200)).toBeCloseTo(0, 6);
  });

  it("a slight beat is a drift, not an event", () => {
    const r = scoreFullDay(steady, 210); // +5%
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.02);
  });

  it("a big beat rips", () => {
    const r = scoreFullDay(steady, 500); // +150%
    expect(r).toBeGreaterThan(0.25);
  });

  it("a big miss drops violently", () => {
    const r = scoreFullDay(steady, 20); // −90%
    expect(r).toBeLessThan(-0.3);
  });

  it("is convex — doubling the surprise more than doubles the move", () => {
    const small = scoreFullDay(steady, 260); // +1σ (spread floors at 40)
    const big = scoreFullDay(steady, 320); // +2σ
    expect(big).toBeGreaterThan(small * 2);
  });

  it("punishes a miss harder than it rewards the same beat", () => {
    const beat = scoreFullDay(steady, 320);
    const miss = scoreFullDay(steady, 80);
    expect(Math.abs(miss)).toBeGreaterThan(Math.abs(beat));
  });

  it("never moves the multiple more than the cap, however absurd the day", () => {
    expect(scoreFullDay(steady, 1_000_000)).toBeLessThanOrEqual(SURPRISE_CAP);
    expect(scoreFullDay(steady, 0)).toBeGreaterThanOrEqual(-SURPRISE_CAP);
  });
});

describe("a partial day is not a catastrophe", () => {
  const steady = days(Array(30).fill(240));

  it("no sales at 9am is barely a shrug", () => {
    const r = surpriseResponse(revenueSurprise(steady, 0, 9 / 24));
    expect(r).toBeGreaterThan(-0.25);
  });

  it("no sales by 11pm is a verdict", () => {
    const early = surpriseResponse(revenueSurprise(steady, 0, 9 / 24));
    const late = surpriseResponse(revenueSurprise(steady, 0, 23 / 24));
    expect(late).toBeLessThan(early);
    expect(late).toBeLessThan(-0.3);
  });

  it("keeping pace reads flat all day long", () => {
    for (const hour of [3, 8, 14, 20, 23]) {
      const p = hour / 24;
      const r = surpriseResponse(revenueSurprise(steady, 240 * p, p));
      expect(Math.abs(r)).toBeLessThan(0.01);
    }
  });

  it("the very first minutes cannot move anything", () => {
    // 30 seconds in, a single sale must not read as a 1000% beat
    const r = surpriseResponse(revenueSurprise(steady, 500, 0.0003));
    expect(Math.abs(r)).toBeLessThan(0.02);
  });
});

describe("a lumpy business is not whipsawed", () => {
  // sells a few times a week: most days nothing, occasionally a lot
  const lumpy = days([0, 0, 900, 0, 0, 0, 800, 0, 0, 0, 0, 700, 0, 0]);
  const steady = days(Array(14).fill(safeMean(lumpy)));

  function safeMean(h: DailyRevenue[]) {
    return h.reduce((s, d) => s + d.amount, 0) / h.length;
  }

  it("a zero day is normal for it, and barely moves the price", () => {
    const r = scoreFullDay(lumpy, 0);
    expect(Math.abs(r)).toBeLessThan(0.2);
  });

  it("the same zero day is a disaster for a business that never has one", () => {
    expect(scoreFullDay(steady, 0)).toBeLessThan(scoreFullDay(lumpy, 0));
  });

  it("its ordinary big day is not treated as an explosion", () => {
    expect(scoreFullDay(lumpy, 800)).toBeLessThan(0.35);
  });
});

describe("dayProgress", () => {
  const start = Date.UTC(2026, 7, 30, 4);
  const end = Date.UTC(2026, 7, 31, 4);

  it("runs 0 → 1 across the day", () => {
    expect(dayProgress(start, start, end)).toBe(0);
    expect(dayProgress(start + 12 * 3_600_000, start, end)).toBeCloseTo(0.5, 6);
    expect(dayProgress(end, start, end)).toBe(1);
  });

  it("clamps outside the day rather than going negative or past one", () => {
    expect(dayProgress(start - 5_000, start, end)).toBe(0);
    expect(dayProgress(end + 5_000, start, end)).toBe(1);
  });

  it("handles the 23- and 25-hour days without going out of range", () => {
    const short = start + 23 * 3_600_000;
    const long = start + 25 * 3_600_000;
    expect(dayProgress(short, start, short)).toBe(1);
    expect(dayProgress(start + 24 * 3_600_000, start, long)).toBeCloseTo(0.96, 2);
  });
});

describe("annualisedFromDaily", () => {
  it("turns a normal day into a yearly figure", () => {
    expect(annualisedFromDaily(200)).toBe(73_000);
  });
  it("never returns a negative from refunds outrunning sales", () => {
    expect(annualisedFromDaily(-50)).toBe(0);
  });
});

describe("a brand-new business", () => {
  it("cannot be scored before it has any days", () => {
    const s = revenueSurprise([], 500, 1);
    expect(s.z).toBe(0);
    expect(surpriseResponse(s)).toBe(0);
  });
});

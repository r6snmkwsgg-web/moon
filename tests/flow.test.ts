import { describe, it, expect } from "vitest";
import {
  DRIFT_HALFLIFE_DAYS,
  DRIFT_PULL,
  DRIFT_STEP_SD,
  FLOW_TICK_MS,
  JUMP_PROBABILITY,
  MAX_CATCHUP_TICKS,
  VOL_STATE_CAP,
  advanceFlow,
  cryptoRandom,
  initialFlowState,
  stepFlow,
  ticksDue,
  type FlowRandom,
} from "@/lib/flow";
import { FLOW_CAP, volatilityFactor } from "@/lib/pricing";

/**
 * A seeded generator, so the STATISTICS below are reproducible. Production
 * uses cryptoRandom() — the entire security property is that the real draws
 * cannot be reproduced, which is exactly why the tests need their own.
 */
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
  return {
    unit,
    gauss() {
      const u1 = Math.max(unit(), Number.MIN_VALUE);
      const u2 = unit();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
  };
}

/** Run the walk and return the drift at every tick. */
function walk(ticks: number, mrr: number, seed = 12345): number[] {
  const rng = seeded(seed);
  let state = initialFlowState();
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    state = stepFlow(state, mrr, rng);
    out.push(state.drift);
  }
  return out;
}

function sd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Excess kurtosis: >0 means fat tails — calm stretches broken by violence. */
function excessKurtosis(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  const m4 = xs.reduce((a, b) => a + (b - m) ** 4, 0) / xs.length;
  return m4 / v ** 2 - 3;
}

describe("the drift walk", () => {
  it("is pure: same state + same draws → same result", () => {
    const a = stepFlow({ drift: 0.1, vol: 0.2 }, 5_000, seeded(7));
    const b = stepFlow({ drift: 0.1, vol: 0.2 }, 5_000, seeded(7));
    expect(a).toEqual(b);
  });

  it("THE FIX: the next tick is unknowable from the current state", () => {
    // This is the whole reason the walk exists. The old weather was a pure
    // function of (symbol, time), so anyone holding the current value could
    // compute every future one. Here, the same state with different entropy
    // goes somewhere else — and in production the entropy is the platform
    // CSPRNG, which nobody holds.
    const state = { drift: 0.1, vol: 0 };
    const outcomes = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      outcomes.add(stepFlow(state, 5_000, seeded(seed)).drift);
    }
    expect(outcomes.size).toBe(50);
  });

  it("real entropy produces a plausible standard normal", () => {
    const rng = cryptoRandom();
    const draws = Array.from({ length: 20_000 }, () => rng.gauss());
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(sd(draws)).toBeGreaterThan(0.95);
    expect(sd(draws)).toBeLessThan(1.05);
    expect(draws.every(Number.isFinite)).toBe(true);
  });

  it("mean-reverts: with no shocks the level decays toward fair value", () => {
    const quiet: FlowRandom = { gauss: () => 0, unit: () => 1 };
    let state = { drift: 0.4, vol: 0 };
    const half = Math.round(DRIFT_HALFLIFE_DAYS * (86_400_000 / FLOW_TICK_MS));
    for (let i = 0; i < half; i++) state = stepFlow(state, 5_000, quiet);
    expect(state.drift).toBeCloseTo(0.2, 2); // one half-life ≈ half the level
    for (let i = 0; i < half * 8; i++) state = stepFlow(state, 5_000, quiet);
    expect(Math.abs(state.drift)).toBeLessThan(0.005);
  });

  it("never escapes the weather's cap, however long it runs", () => {
    for (const seed of [1, 99, 20_260_831]) {
      for (const d of walk(30_000, 400, seed)) {
        expect(Math.abs(d)).toBeLessThanOrEqual(FLOW_CAP);
      }
    }
  });

  it("holds the spread it was calibrated for (~14% in log space)", () => {
    // sd = DRIFT_STEP_SD / sqrt(2·DRIFT_PULL) for the neutral-volatility OU;
    // stochastic vol widens it, jumps widen it further. In log space 0.14 is
    // a typical band of about 0.87x to 1.15x fair value, two sigma 0.75x to
    // 1.33x — where a small cap's hype actually trades. It was 0.40, which
    // is a band of 0.67x to 1.5x, and on the live board that put half the
    // tickers 30% from fair value on a day with no trades and no news.
    const analytic = DRIFT_STEP_SD / Math.sqrt(2 * DRIFT_PULL);
    expect(analytic).toBeGreaterThan(0.1);
    expect(analytic).toBeLessThan(0.2);

    const observed = sd(walk(60_000, 8_000, 4242).slice(2_000));
    expect(observed).toBeGreaterThan(0.05);
    expect(observed).toBeLessThan(0.4);
  });

  it("REGRESSION: it wanders instead of sawtoothing", () => {
    // The measurable difference between a market and a noise generator. A
    // three-day half-life undid most of each move within the week: lag-1
    // autocorrelation of daily returns -0.14 and a variance ratio of 0.58,
    // where a real market sits at 0.00 and 1.0. Both are checked here because
    // shortening the half-life again would silently bring the sawtooth back.
    const series = walk(120 * 288, 5_000, 777);
    const daily: number[] = [];
    for (let d = 1; d * 288 < series.length; d++) {
      daily.push(series[d * 288] - series[(d - 1) * 288]); // already log space
    }
    const m = daily.reduce((a, b) => a + b, 0) / daily.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < daily.length; i++) {
      den += (daily[i] - m) ** 2;
      if (i >= 1) num += (daily[i] - m) * (daily[i - 1] - m);
    }
    expect(Math.abs(num / den)).toBeLessThan(0.12); // was -0.14

    const agg: number[] = [];
    for (let i = 0; i + 5 <= daily.length; i += 5) {
      agg.push(daily.slice(i, i + 5).reduce((a, b) => a + b, 0));
    }
    const va = (xs: number[]) => {
      const mm = xs.reduce((a, b) => a + b, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - mm) ** 2, 0) / xs.length;
    };
    expect(va(agg) / 5 / va(daily)).toBeGreaterThan(0.7); // was 0.58
  });

  it("moves enough per day to be worth trading, and no more", () => {
    const perDay = DRIFT_STEP_SD * Math.sqrt(86_400_000 / FLOW_TICK_MS);
    expect(perDay).toBeGreaterThan(0.025); // ≥2.5% of drift movement a day
    expect(perDay).toBeLessThan(0.06); // and not a meme coin
    // annualised: small-cap territory, somewhere between 40% and 120%
    expect(perDay * Math.sqrt(365)).toBeGreaterThan(0.4);
    expect(perDay * Math.sqrt(365)).toBeLessThan(1.2);
  });

  it("REGRESSION: a quiet day is a quiet day — the weather is not the news", () => {
    // Measured on the live board before this: no trades, no revenue events,
    // and half the tickers up or down 30% on the day, with one 7-day column
    // reading +217%. Over a long run the weather's daily moves should look
    // like a small cap's — a few percent typically, a bad day in the teens,
    // and a halving only ever on actual news.
    const series = walk(400 * 288, 5_000, 2026);
    const moves: number[] = [];
    for (let d = 1; d * 288 < series.length; d++) {
      moves.push(Math.abs(series[d * 288] - series[(d - 1) * 288]));
    }
    moves.sort((a, b) => a - b);
    const q = (p: number) => moves[Math.floor(p * (moves.length - 1))];
    expect(q(0.5)).toBeGreaterThan(0.01); // it does move
    expect(q(0.5)).toBeLessThan(0.05); // a typical day: a few percent
    expect(q(0.95)).toBeLessThan(0.2); // a bad day: not a halving
    expect(moves.filter((m) => m > 0.3).length / moves.length).toBeLessThan(
      0.01
    );
  });

  it("clusters: quiet fortnights and violent ones, not uniform chop", () => {
    // The old noise field had +0.39 excess kurtosis — evenly frantic, so a
    // crash never felt like an event. Stochastic vol plus jumps fixes that.
    const series = walk(80_000, 2_000, 31337);
    const steps: number[] = [];
    for (let i = 1; i < series.length; i++) steps.push(series[i] - series[i - 1]);
    expect(excessKurtosis(steps)).toBeGreaterThan(1);
  });

  it("keeps the volatility regime inside its band", () => {
    const rng = seeded(555);
    let state = initialFlowState();
    for (let i = 0; i < 40_000; i++) {
      state = stepFlow(state, 1_000, rng);
      expect(Math.abs(state.vol)).toBeLessThanOrEqual(VOL_STATE_CAP);
    }
  });

  it("jumps land at roughly the advertised rate", () => {
    const rng = seeded(2026);
    let jumps = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) if (rng.unit() < JUMP_PROBABILITY) jumps++;
    const rate = jumps / n;
    expect(rate).toBeGreaterThan(JUMP_PROBABILITY * 0.6);
    expect(rate).toBeLessThan(JUMP_PROBABILITY * 1.6);
  });

  it("micro-caps swing harder than the big names", () => {
    const small = sd(walk(40_000, 300, 8).slice(2_000));
    const large = sd(walk(40_000, 80_000, 8).slice(2_000));
    expect(small).toBeGreaterThan(large);
    expect(volatilityFactor(300) / volatilityFactor(80_000)).toBeGreaterThan(1.5);
  });
});

describe("catching up", () => {
  it("counts whole intervals since the last tick", () => {
    const now = Date.parse("2026-08-31T12:00:00Z");
    expect(ticksDue(now - 4 * 60_000, now)).toBe(0); // genuinely early
    expect(ticksDue(now - FLOW_TICK_MS, now)).toBe(1);
    expect(ticksDue(now - 62 * 60_000, now)).toBe(12);
    expect(ticksDue(null, now)).toBe(1); // never stepped
  });

  it("REGRESSION: a cron two seconds early still counts as due", () => {
    // Vercel does not fire on the second. A strict floor made a 4m58s cron
    // count zero and stand down, so the next one came ten minutes after the
    // last write and advanced twice — writing ONE row, because a call records
    // where the walk landed, not every step. The live board showed 106 ticks
    // in fourteen hours instead of 168, with 55 gaps of nine to eleven
    // minutes. Half resolution, from two seconds of jitter.
    const now = Date.parse("2026-08-31T12:00:00Z");
    expect(ticksDue(now - (FLOW_TICK_MS - 2_000), now)).toBe(1);
    expect(ticksDue(now - (FLOW_TICK_MS - 25_000), now)).toBe(1);
    // and it stays one, not two, when the scheduler runs a touch late
    expect(ticksDue(now - (FLOW_TICK_MS + 25_000), now)).toBe(1);
    // but a genuinely early nudge is still turned away
    expect(ticksDue(now - 60_000, now)).toBe(0);
  });

  it("a slept poller advances the market, it does not freeze it", () => {
    const rng = seeded(11);
    const state = advanceFlow(initialFlowState(), 5_000, 288, rng);
    expect(state.drift).not.toBe(0);
    expect(Math.abs(state.drift)).toBeLessThanOrEqual(FLOW_CAP);
  });

  it("catch-up is bounded — a month offline is not a month of CPU", () => {
    const a = advanceFlow(initialFlowState(), 5_000, 10 * MAX_CATCHUP_TICKS, seeded(3));
    const b = advanceFlow(initialFlowState(), 5_000, MAX_CATCHUP_TICKS, seeded(3));
    expect(a).toEqual(b);
  });

  it("zero or negative ticks change nothing", () => {
    const state = { drift: 0.3, vol: 0.1 };
    expect(advanceFlow(state, 5_000, 0, seeded(1))).toEqual(state);
    expect(advanceFlow(state, 5_000, -9, seeded(1))).toEqual(state);
  });
});

/* ── the poller: does the walk actually get WRITTEN DOWN? ─────────────────── */

interface Row {
  [k: string]: unknown;
}

/**
 * A small in-memory stand-in for the PostgREST client, supporting exactly the
 * chains advanceMarketFlow uses. Worth the twenty lines: the whole point of
 * this change is that the walk reaches the database, and a silently no-oped
 * update would look identical to a working one from the outside.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: string[] = [];
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const api = {
      select: () => api,
      order: () => api,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return api;
      },
      lt: (col: string, val: string) => {
        filters.push((r) => String(r[col] ?? "") < val);
        return api;
      },
      gte: (col: string, val: string) => {
        filters.push((r) => String(r[col] ?? "") >= val);
        return api;
      },
      or: (expr: string) => {
        // only the one shape this code emits: "drift_at.is.null,drift_at.lt.X"
        const cutoff = expr.split("drift_at.lt.")[1];
        filters.push(
          (r) => r.drift_at == null || String(r.drift_at) < cutoff
        );
        return api;
      },
      update(patch: Row) {
        pending = () => {
          const hit = rows().filter((r) => filters.every((f) => f(r)));
          for (const r of hit) Object.assign(r, patch);
          calls.push(`update:${table}:${hit.length}`);
          return hit;
        };
        return api;
      },
      upsert(newRows: Row[]) {
        pending = () => {
          rows().push(...newRows);
          calls.push(`upsert:${table}:${newRows.length}`);
          return newRows;
        };
        return api;
      },
      delete() {
        pending = () => {
          const keep = rows().filter((r) => !filters.every((f) => f(r)));
          const gone = rows().length - keep.length;
          tables[table] = keep;
          calls.push(`delete:${table}:${gone}`);
          return [];
        };
        return api;
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        const data = pending
          ? pending()
          : rows().filter((r) => filters.every((f) => f(r)));
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    let filters: ((r: Row) => boolean)[] = [];
    let pending: (() => Row[]) | null = null;
    filters = [];
    return api;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, calls, tables };
}

const MONTH = "2026-08-01";

function seedTables(overrides: Partial<Row> = {}) {
  return {
    tickers: [
      {
        id: "t1",
        symbol: "PRL",
        sentiment: 0.2,
        shares_outstanding: 10_000,
        drift: 0,
        vol_state: 0,
        drift_at: null,
        ...overrides,
      },
    ] as Row[],
    mrr_updates: [{ ticker_id: "t1", month: MONTH, mrr: 5_000 }] as Row[],
    stripe_connections: [] as Row[],
    flow_ticks: [] as Row[],
  };
}

describe("advanceMarketFlow", () => {
  it("writes the new state to the ticker AND a tick row with a price", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const db = fakeDb(seedTables());
    const now = Date.parse("2026-08-31T12:00:00Z");

    const result = await advanceMarketFlow(db.client, { rng: seeded(5), now });

    expect(result.advanced).toBe(1);
    expect(result.ticks).toBe(1);
    const ticker = db.tables.tickers[0];
    expect(ticker.drift).not.toBe(0);
    expect(ticker.drift_at).toBe(new Date(now).toISOString());
    expect(db.tables.flow_ticks).toHaveLength(1);
    const tick = db.tables.flow_ticks[0] as {
      ticker_id: string;
      drift: number;
      price: number;
    };
    expect(tick.ticker_id).toBe("t1");
    expect(tick.drift).toBe(ticker.drift);
    expect(tick.price).toBeGreaterThan(0);
  });

  it("the recorded price is the settled price at that drift — no shimmer", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const { settledPrice, valuationMultiple } = await import("@/lib/pricing");
    const db = fakeDb(seedTables());
    const now = Date.parse("2026-08-31T12:00:00Z");
    await advanceMarketFlow(db.client, { rng: seeded(5), now });

    const tick = db.tables.flow_ticks[0] as { drift: number; price: number };
    expect(tick.price).toBeCloseTo(
      settledPrice(
        5_000,
        0.2,
        now,
        valuationMultiple([{ month: MONTH, mrr: 5_000 }]),
        10_000,
        [],
        tick.drift
      ),
      10
    );
  });

  it("skips a ticker stepped inside the interval — the clock sets the pace", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const now = Date.parse("2026-08-31T12:00:00Z");
    const db = fakeDb(
      seedTables({
        drift: 0.1,
        drift_at: new Date(now - 60_000).toISOString(),
      })
    );

    const result = await advanceMarketFlow(db.client, { rng: seeded(5), now });
    expect(result.advanced).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.tables.tickers[0].drift).toBe(0.1);
    expect(db.tables.flow_ticks).toHaveLength(0);
    // and it does not even read the revenue tables to find that out
    expect(db.calls).toHaveLength(0);
  });

  it("a sequential re-nudge stands down before it reads anything", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const now = Date.parse("2026-08-31T12:00:00Z");
    const db = fakeDb(seedTables());

    const first = await advanceMarketFlow(db.client, { rng: seeded(5), now });
    expect(first.advanced).toBe(1);
    const after = db.tables.tickers[0].drift;

    const second = await advanceMarketFlow(db.client, { rng: seeded(9), now });
    expect(second.advanced).toBe(0);
    expect(db.tables.tickers[0].drift).toBe(after);
    expect(db.tables.flow_ticks).toHaveLength(1);
  });

  it("CONCURRENT nudges cannot double-step: the loser matches no rows", async () => {
    // /api/pulse is open, so two people opening the same ticker page in the
    // same second both read drift_at before either writes it. The staleness
    // test therefore lives inside the UPDATE, not in a read before it — this
    // is the test that fails if the .or() guard is removed.
    const { advanceMarketFlow } = await import("@/lib/flow");
    const now = Date.parse("2026-08-31T12:00:00Z");
    const db = fakeDb(seedTables());

    const [a, b] = await Promise.all([
      advanceMarketFlow(db.client, { rng: seeded(5), now }),
      advanceMarketFlow(db.client, { rng: seeded(9), now }),
    ]);

    expect(a.advanced + b.advanced).toBe(1);
    expect(db.tables.flow_ticks).toHaveLength(1);
    expect(db.tables.tickers[0].drift).toBe(
      (db.tables.flow_ticks[0] as { drift: number }).drift
    );
  });

  it("catches up a slept poller in one call", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const now = Date.parse("2026-08-31T12:00:00Z");
    const db = fakeDb(
      seedTables({ drift_at: new Date(now - 3 * 3_600_000).toISOString() })
    );
    const result = await advanceMarketFlow(db.client, { rng: seeded(5), now });
    expect(result.ticks).toBe(36); // three hours of five-minute ticks
    expect(db.tables.flow_ticks).toHaveLength(1); // one row: where it landed
  });

  it("prefers live Stripe MRR over the last monthly report", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const { settledPrice, valuationMultiple } = await import("@/lib/pricing");
    const now = Date.parse("2026-08-31T12:00:00Z");
    const tables = seedTables();
    tables.stripe_connections = [{ ticker_id: "t1", live_mrr: 9_000 }];
    const db = fakeDb(tables);
    await advanceMarketFlow(db.client, { rng: seeded(5), now });

    const tick = db.tables.flow_ticks[0] as { drift: number; price: number };
    expect(tick.price).toBeCloseTo(
      settledPrice(
        9_000,
        0.2,
        now,
        valuationMultiple([{ month: MONTH, mrr: 5_000 }]),
        10_000,
        [],
        tick.drift
      ),
      10
    );
  });

  it("REGRESSION: the tape carries the news — a print's overshoot is recorded", async () => {
    // A churn's overshoot lives for a few hours (revenueShock). The tape was
    // written without it, so for exactly those hours the live quote sat well
    // under every recorded tick: the header read $6.30, the chart's last
    // candle $8.15, and the dip everyone traded through vanished from the
    // record five minutes later.
    const { advanceMarketFlow } = await import("@/lib/flow");
    const { settledPrice, valuationMultiple, revenueShock } = await import(
      "@/lib/pricing"
    );
    const now = Date.parse("2026-09-01T21:45:00Z");
    const at = now - 2 * 60_000;
    const tables: Record<string, Row[]> = {
      ...seedTables(),
      stripe_connections: [{ ticker_id: "t1", live_mrr: 4_000 }],
      revenue_events: [
        {
          ticker_id: "t1",
          at: new Date(at).toISOString(),
          prev_mrr: 5_000,
          mrr: 4_000,
          prev_subscriptions: 10,
        },
      ],
    };
    const db = fakeDb(tables);
    await advanceMarketFlow(db.client, { rng: seeded(5), now });

    const tick = db.tables.flow_ticks[0] as { drift: number; price: number };
    const news = [{ at, mrr: 4_000, prevMrr: 5_000 }];
    const mult = valuationMultiple([{ month: MONTH, mrr: 5_000 }]);
    expect(tick.price).toBeCloseTo(
      settledPrice(4_000, 0.2, now, mult, 10_000, news, tick.drift),
      10
    );
    // and it really is under the no-news price by exactly the shock
    const quiet = settledPrice(4_000, 0.2, now, mult, 10_000, [], tick.drift);
    expect(revenueShock(news, now)).toBeLessThan(-0.2);
    expect(tick.price / quiet - 1).toBeCloseTo(revenueShock(news, now), 10);
  });

  it("stands down cleanly when 0007 has not been applied", async () => {
    const { advanceMarketFlow } = await import("@/lib/flow");
    const db = fakeDb({
      tickers: [{ id: "t1", symbol: "PRL", sentiment: 0 }],
      mrr_updates: [],
      stripe_connections: [],
      flow_ticks: [],
    });
    const result = await advanceMarketFlow(db.client, { rng: seeded(1) });
    expect(result.unavailable).toBe(true);
    expect(result.advanced).toBe(0);
    expect(db.tables.flow_ticks).toHaveLength(0);
  });
});

describe("pruneFlowTicks", () => {
  it("drops tape past the retention window and keeps the rest", async () => {
    const { pruneFlowTicks, FLOW_TICK_RETENTION_MS } = await import("@/lib/flow");
    const now = Date.parse("2026-08-31T12:00:00Z");
    const db = fakeDb({
      flow_ticks: [
        { ticker_id: "t1", at: new Date(now - 60_000).toISOString() },
        { ticker_id: "t1", at: new Date(now - 3 * 86_400_000).toISOString() },
        {
          ticker_id: "t1",
          at: new Date(now - FLOW_TICK_RETENTION_MS - 60_000).toISOString(),
        },
      ],
    });
    await pruneFlowTicks(db.client, now);
    expect(db.tables.flow_ticks).toHaveLength(2);
  });
});

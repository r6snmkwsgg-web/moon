/**
 * lib/flow.ts — the drift: market weather as a RECORD, not a formula.
 *
 * The old weather (marketFlow) was a deterministic noise field over
 * (symbol, time). Every page that shows a live price imports lib/pricing, so
 * that field shipped to the browser, and the whole future of every ticker was
 * one console line away:
 *
 *     marketFlow("PRL", Date.now() + 86_400_000, mrr)   // tomorrow, today
 *
 * A more elaborate function would not have fixed that. Nobody had to
 * reverse-engineer it; they only had to CALL it. The fix is to stop the
 * future from existing: the drift is advanced one tick at a time by the
 * five-minute poller using real entropy, written to the database, and only
 * ever read backwards. There is nothing to precompute, because the next
 * value has not been drawn yet.
 *
 * The walk has three parts, all of them things real tapes do:
 *
 *   · mean reversion — an Ornstein–Uhlenbeck pull back toward zero, so the
 *     weather always blows back to fair value and a ticker cannot drift away
 *     forever on noise alone.
 *   · stochastic volatility — a second, much slower walk on LOG volatility,
 *     so quiet fortnights and violent ones cluster. The old field had almost
 *     no excess kurtosis (+0.39): uniformly frantic, never calm-then-broken.
 *     This is what makes a crash feel like an event.
 *   · jumps — a rare fat-tailed shock, about once a week per ticker, that
 *     gaps the price the way real news does.
 *
 * Facts are still facts. MRR, trades and revenue events are never fabricated;
 * this module simulates only the weather, and it says so on /how.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FLOW_CAP,
  SHOCK_HALFLIFE_MS,
  floatOf,
  settledPrice,
  valuationMultiple,
  volatilityFactor,
  type RevenueEvent,
  type RevenuePoint,
} from "@/lib/pricing";
import type { MrrUpdate, Ticker } from "@/lib/types";

/** One tick of the walk. Matches the five-minute poller. */
export const FLOW_TICK_MS = 5 * 60_000;

const TICKS_PER_DAY = 86_400_000 / FLOW_TICK_MS; // 288

/**
 * Half-life of the pull back toward fair value, in days.
 *
 * This was 3, and it was the single thing making the charts look fake. A pull
 * that strong undoes most of each move within the week, so the price sawtooths
 * instead of going anywhere: lag-1 return autocorrelation -0.14, variance
 * ratio 0.58, Hurst 0.40 (a real market is 0.00 / 1.0 / 0.50). At 21 days the
 * same walk measures -0.02, 0.92 and 0.58 — a random walk that still, slowly,
 * knows where fair value is.
 */
export const DRIFT_HALFLIFE_DAYS = 21;
/** Per-tick reversion: what fraction of the level decays each step. */
export const DRIFT_PULL = 1 - Math.pow(0.5, 1 / (DRIFT_HALFLIFE_DAYS * TICKS_PER_DAY));

/**
 * Per-tick shock size at neutral volatility. Sized for a small-cap tape, not
 * a meme coin:
 *
 *     daily vol = DRIFT_STEP_SD · sqrt(288)          ≈ 0.0021 · 17 ≈ 3.6%
 *     spread    = DRIFT_STEP_SD / sqrt(2·DRIFT_PULL) ≈ 0.0021 / 0.0151 ≈ 0.14
 *
 * so a typical day moves a few percent and the weather usually holds a
 * ticker within ±14% of fair value (two sigma, ±30%). Small caps run hotter
 * through volatilityFactor, and a violent regime (below) up to ~3x hotter
 * still — that is where the crashes live, and they are rare.
 *
 * This was 0.0060: a 10% daily vol and a ±40% band. On the live board that
 * put half the tickers up or down 30% in a day with no trades and no revenue
 * news, and a 7-day column reading +217% off nothing. The shape of the walk
 * (its half-life, its clustering) was right; only its amplitude was absurd.
 */
export const DRIFT_STEP_SD = 0.0021;

/** Half-life of the volatility regime, in days — regimes outlast trends. */
export const VOL_HALFLIFE_DAYS = 10;
export const VOL_PULL = 1 - Math.pow(0.5, 1 / (VOL_HALFLIFE_DAYS * TICKS_PER_DAY));
/**
 * Vol-of-vol. The regime's stationary spread is VOL_STEP_SD / sqrt(2·VOL_PULL)
 * ≈ 0.013 / 0.022 ≈ 0.6 in log space: a typical ticker runs somewhere between
 * 0.55x and 1.8x its neutral volatility, and the tails reach the cap below.
 * That is enough to cluster — quiet fortnights broken by violent days, which
 * is what makes a crash read as an event — without the old 1.0 spread, which
 * spent a third of every ticker's life either asleep or on fire.
 */
export const VOL_STEP_SD = 0.013;
/** exp(±1.2): a sleepy ticker moves at 0.3×, a broken one at 3.3×. */
export const VOL_STATE_CAP = 1.2;

/** Chance per tick of a gap. 1/2000 ticks ≈ once a week per ticker. */
export const JUMP_PROBABILITY = 1 / 2000;
/**
 * Gap size, as a standard deviation of the level: a typical jump is ±6%, a
 * bad one ±12–18%. Revenue news moves prices on its own (lib/pricing
 * revenueShock); this is the weather's share of the gapping.
 */
export const JUMP_SD = 0.06;

/**
 * A cold start (or a poller that slept) is caught up by stepping, not by
 * jumping to a fresh draw — but only so far. Beyond this the walk is
 * effectively at its stationary distribution anyway, and stepping further
 * just burns CPU.
 */
export const MAX_CATCHUP_TICKS = 3 * TICKS_PER_DAY;

/** The walk's state for one ticker. */
export interface FlowState {
  /** Signed deviation from the sentiment-adjusted price. */
  drift: number;
  /** Log-volatility. 0 is neutral; exp(vol) scales the step size. */
  vol: number;
}

/** Where the randomness comes from. Injected so tests can be deterministic. */
export interface FlowRandom {
  /** A standard normal draw. */
  gauss(): number;
  /** A uniform draw in [0, 1). */
  unit(): number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** A sane starting point for a ticker that has never been stepped. */
export function initialFlowState(): FlowState {
  return { drift: 0, vol: 0 };
}

/**
 * One tick of the walk. Pure: same state + same draws → same result, so it
 * is fully testable, but the DRAWS are real entropy in production and the
 * output is written down rather than recomputed.
 */
export function stepFlow(
  state: FlowState,
  mrr: number,
  rng: FlowRandom
): FlowState {
  const scale = volatilityFactor(mrr);

  // the regime moves first, so a shock lands in the volatility it caused
  const vol = clamp(
    state.vol * (1 - VOL_PULL) + VOL_STEP_SD * rng.gauss(),
    -VOL_STATE_CAP,
    VOL_STATE_CAP
  );

  let drift = state.drift * (1 - DRIFT_PULL);
  drift += DRIFT_STEP_SD * scale * Math.exp(vol) * rng.gauss();
  if (rng.unit() < JUMP_PROBABILITY) {
    drift += JUMP_SD * scale * rng.gauss();
  }

  // the weather is bounded so the price stays positive and always has a way
  // home; the drama that is allowed to run away lives in sentiment, which
  // has no floor.
  return { drift: clamp(drift, -FLOW_CAP, FLOW_CAP), vol };
}

/**
 * Catch a ticker up by `ticks` steps. A cron that missed an hour should
 * advance an hour's worth of walk, not one step — otherwise the market
 * freezes whenever the scheduler hiccups.
 */
export function advanceFlow(
  state: FlowState,
  mrr: number,
  ticks: number,
  rng: FlowRandom
): FlowState {
  let next = state;
  const n = clamp(Math.floor(ticks), 0, MAX_CATCHUP_TICKS);
  for (let i = 0; i < n; i++) next = stepFlow(next, mrr, rng);
  return next;
}

/**
 * A scheduler that fires "every five minutes" does not fire on the second,
 * and a strict floor punishes it for that. A cron landing at 4m58s counted
 * zero ticks and stood down; the next one, ten minutes after the last write,
 * counted two and advanced the walk twice — but wrote a single row, because
 * one call records where the walk LANDED, not every step it took.
 *
 * Measured on the live board: 106 ticks in fourteen hours where there should
 * have been 168, and 55 gaps of nine to eleven minutes. The tape was running
 * at half its resolution because of two seconds of jitter.
 */
export const TICK_GRACE_MS = 30_000;

/** How many ticks are owed since `since`, forgiving a late scheduler. */
export function ticksDue(since: number | null, now: number): number {
  if (since === null || !Number.isFinite(since)) return 1;
  return Math.floor((now - since + TICK_GRACE_MS) / FLOW_TICK_MS);
}

/**
 * Real randomness, from the platform CSPRNG. Box–Muller over two uniforms.
 * Deliberately NOT seeded: a seed is a formula, and a formula is what we are
 * getting rid of.
 */
export function cryptoRandom(): FlowRandom {
  const unit = (): number => {
    // crypto.getRandomValues exists in Node 19+ and in every edge runtime
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
  return {
    unit,
    gauss(): number {
      // u1 must be strictly positive for the log
      const u1 = Math.max(unit(), Number.MIN_VALUE);
      const u2 = unit();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
  };
}

/* ── writing the walk down ───────────────────────────────────────────────── */

/** How long the recorded tape is kept. Charts read two days; keep a fortnight. */
export const FLOW_TICK_RETENTION_MS = 14 * 86_400_000;

export interface FlowAdvanceResult {
  advanced: number;
  skipped: number;
  /** Total steps taken across all tickers — >1 each when the poller slept. */
  ticks: number;
  /** Set when the 0007 migration has not been applied yet. */
  unavailable?: boolean;
}

/**
 * Advance every ticker's walk and write the result down: the new state on the
 * ticker row, and one flow_ticks row carrying the drift AND the settled price
 * at that instant.
 *
 * The price is stored rather than reconstructed on read because a chart drawn
 * next month has to show what the tape actually did, not what next month's
 * sentiment and multiple would imply it did.
 *
 * Tickers stepped within the last interval are skipped, so the client nudge on
 * /api/pulse cannot spin the walk faster than the clock no matter how many
 * people have a ticker page open.
 */
export async function advanceMarketFlow(
  admin: SupabaseClient,
  opts: { rng?: FlowRandom; now?: number } = {}
): Promise<FlowAdvanceResult> {
  const rng = opts.rng ?? cryptoRandom();
  const now = opts.now ?? Date.now();

  const { data: tickerRows } = await admin.from("tickers").select("*");
  const tickers = (tickerRows ?? []) as Ticker[];
  if (tickers.length === 0) return { advanced: 0, skipped: 0, ticks: 0 };

  // drift lives on the ticker row; if it is absent the migration hasn't run
  if (!("drift" in (tickers[0] as object))) {
    return { advanced: 0, skipped: tickers.length, ticks: 0, unavailable: true };
  }

  // /api/pulse is open, so the common case is "a page is being watched and
  // nothing is due yet". Find that out before reading the revenue tables.
  const due = new Map<string, number>();
  for (const t of tickers) {
    const n = ticksDue(t.drift_at ? Date.parse(t.drift_at) : null, now);
    if (n >= 1) due.set(t.id, n);
  }
  if (due.size === 0) {
    return { advanced: 0, skipped: tickers.length, ticks: 0 };
  }

  const { data: mrrRows } = await admin
    .from("mrr_updates")
    .select("*")
    .order("month", { ascending: true });

  const history = new Map<string, RevenuePoint[]>();
  for (const u of (mrrRows ?? []) as MrrUpdate[]) {
    const list = history.get(u.ticker_id) ?? [];
    list.push({ month: u.month, mrr: Number(u.mrr) });
    history.set(u.ticker_id, list);
  }

  // what Stripe says right now beats the last monthly report, exactly as the
  // live price does — otherwise the recorded tape and the tape disagree
  const liveMrr = new Map<string, number>();
  try {
    const { data } = await admin
      .from("stripe_connections")
      .select("ticker_id, live_mrr");
    for (const c of (data ?? []) as {
      ticker_id: string;
      live_mrr: number | null;
    }[]) {
      if (c.live_mrr !== null && Number(c.live_mrr) > 0) {
        liveMrr.set(c.ticker_id, Number(c.live_mrr));
      }
    }
  } catch {
    // pre-migration or no connections — reported MRR is the whole story
  }

  // The news the tape is reacting to right now. A print's overshoot lives
  // for a few hours (revenueShock), and the recorded price has to carry it:
  // the tape used to be written without it, so for exactly those hours the
  // live quote sat 20–40% under every recorded tick, the chart's last candle
  // disagreed with the header above it, and the dip the market was actually
  // trading through vanished from history five minutes later.
  const news = new Map<string, RevenueEvent[]>();
  try {
    const { data } = await admin
      .from("revenue_events")
      .select("ticker_id, at, prev_mrr, mrr, prev_subscriptions")
      .gte("at", new Date(now - SHOCK_HALFLIFE_MS * 8).toISOString())
      .order("at", { ascending: true });
    for (const e of (data ?? []) as {
      ticker_id: string;
      at: string;
      prev_mrr: number;
      mrr: number;
      prev_subscriptions: number | null;
    }[]) {
      const list = news.get(e.ticker_id) ?? [];
      list.push({
        at: Date.parse(e.at),
        mrr: Number(e.mrr),
        prevMrr: Number(e.prev_mrr),
        catchUp: e.prev_subscriptions === null,
      });
      news.set(e.ticker_id, list);
    }
  } catch {
    // no revenue_events table — nothing to react to
  }

  const rows: { ticker_id: string; at: string; drift: number; price: number }[] =
    [];
  const at = new Date(now).toISOString();
  let advanced = 0;
  let skipped = 0;
  let ticks = 0;

  // Two nudges landing in the same instant must not step the walk twice, so
  // the "is it due" test is part of the UPDATE rather than a read before it:
  // whichever request writes first moves drift_at forward, and the other one
  // matches no rows and stands down.
  // the same grace, or the row the read judged due matches nothing on write
  const staleBefore = new Date(now - FLOW_TICK_MS + TICK_GRACE_MS).toISOString();

  for (const ticker of tickers) {
    const owed = due.get(ticker.id);
    if (owed === undefined) {
      skipped++;
      continue;
    }

    const record = history.get(ticker.id) ?? [];
    const reported = record.length ? record[record.length - 1].mrr : 0;
    const mrr = liveMrr.get(ticker.id) ?? reported;

    const next = advanceFlow(
      { drift: Number(ticker.drift ?? 0), vol: Number(ticker.vol_state ?? 0) },
      mrr,
      owed,
      rng
    );

    const { data: won, error } = await admin
      .from("tickers")
      .update({ drift: next.drift, vol_state: next.vol, drift_at: at })
      .eq("id", ticker.id)
      .or(`drift_at.is.null,drift_at.lt.${staleBefore}`)
      .select("id");
    if (error || !won || won.length === 0) {
      skipped++;
      continue;
    }
    advanced++;
    ticks += Math.min(owed, MAX_CATCHUP_TICKS);

    rows.push({
      ticker_id: ticker.id,
      at,
      drift: next.drift,
      price: settledPrice(
        mrr,
        Number(ticker.sentiment),
        now,
        valuationMultiple(record),
        floatOf(ticker.shares_outstanding),
        news.get(ticker.id) ?? [],
        next.drift
      ),
    });
  }

  if (rows.length > 0) {
    await admin.from("flow_ticks").upsert(rows, { onConflict: "ticker_id,at" });
  }
  return { advanced, skipped, ticks };
}

/** Drop tape older than the retention window. Called by the daily cron. */
export async function pruneFlowTicks(
  admin: SupabaseClient,
  now = Date.now()
): Promise<void> {
  try {
    await admin
      .from("flow_ticks")
      .delete()
      .lt("at", new Date(now - FLOW_TICK_RETENTION_MS).toISOString());
  } catch {
    // pre-migration — nothing to prune
  }
}

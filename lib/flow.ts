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
  floatOf,
  settledPrice,
  valuationMultiple,
  volatilityFactor,
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
 * Per-tick shock size at neutral volatility. Chosen so the walk's stationary
 * spread is ~18% — i.e. the weather usually sits within ±36% of fair value,
 * the same range the old noise field covered:
 *
 *     sd = DRIFT_STEP_SD / sqrt(2·DRIFT_PULL) ≈ 0.0060 / 0.0151 ≈ 0.40
 *
 * In log space that is a typical range of about 0.67x to 1.5x fair value,
 * with the tails reaching further — roughly where real hype trades.
 */
export const DRIFT_STEP_SD = 0.0060;

/** Half-life of the volatility regime, in days — regimes outlast trends. */
export const VOL_HALFLIFE_DAYS = 10;
export const VOL_PULL = 1 - Math.pow(0.5, 1 / (VOL_HALFLIFE_DAYS * TICKS_PER_DAY));
/**
 * Vol-of-vol. Raised from 0.0099: volatility clustering measured 0.19 against
 * a real-market 0.15–0.30, and excess kurtosis 2.0 against +6..15. At 0.022
 * clustering lands at 0.31 and kurtosis at 4.1 — quiet fortnights broken by
 * violent days, which is what makes a crash read as an event instead of as
 * more of the same chop.
 */
export const VOL_STEP_SD = 0.022;
/** exp(±1.6): a sleepy ticker moves at 0.2×, a broken one at 5×. */
export const VOL_STATE_CAP = 1.6;

/** Chance per tick of a gap. 1/2000 ticks ≈ once a week per ticker. */
export const JUMP_PROBABILITY = 1 / 2000;
/** Gap size, as a standard deviation of the level. */
export const JUMP_SD = 0.11;

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

/** How many ticks are owed since `since`. */
export function ticksDue(since: number | null, now: number): number {
  if (since === null || !Number.isFinite(since)) return 1;
  return Math.floor((now - since) / FLOW_TICK_MS);
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
  const staleBefore = new Date(now - FLOW_TICK_MS).toISOString();

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
        [],
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

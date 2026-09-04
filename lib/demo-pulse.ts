/**
 * lib/demo-pulse.ts — a revenue pulse for the demo listings.
 *
 * Only Stripe-connected tickers have a live revenue feed. The demo tickers
 * were seeded with a plausible past (scripts/seed-revenue-events.ts) and then
 * stopped dead at the moment the seed ran: no new customers, no churn, no
 * earnings steps, nothing for the market to react to. This keeps them going
 * forward at the same cadence and in the same shape — clustered, mostly
 * signups, churn about one time in five, sized to the business — and the
 * newest event IS the ticker's live number (lib/pulse latestEventMrr), so
 * the quote, the fill and the tape all move on it exactly as they would on
 * a Stripe reading.
 *
 * Every event it writes is marked by the ticker being a fixture. PRL and any
 * other connected ticker are never touched: their events are real.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cryptoRandom, type FlowRandom } from "@/lib/flow";
import { PULSE_INTERVAL_MS } from "@/lib/pricing";
import { latestEventMrr } from "@/lib/pulse";
import { recordTickerSnapshot } from "@/lib/snapshot";


export type DemoKind = "new" | "churn" | "expansion" | "contraction";

export interface DemoState {
  /** Live MRR right now. */
  mrr: number;
  /** Paying customers right now. */
  subs: number;
  /** The last monthly report — the band the walk is kept inside. */
  reportedMrr: number;
}

export interface DemoEvent {
  kind: DemoKind;
  prevMrr: number;
  mrr: number;
  prevSubs: number;
  subs: number;
}

/** The band a listing stays inside, as multiples of its last report. */
export const DEMO_BAND = { floor: 0.55, ceil: 1.75 };

/**
 * Customers are not all the same size. Most are near the average; one in ten
 * is a plan worth four of them and one in a hundred is the team account worth
 * a dozen — log-normal around the average, and that tail is what makes one
 * churn on the chart worth looking at.
 */
export const WHALE_SIGMA = 1.1;
/**
 * Signups and churn cluster: a launch, a newsletter feature, a price hike
 * bring several at once. About one event in four is a wave of 2–5.
 */
export const WAVE_CHANCE = 0.28;
export const WAVE_MAX = 5;
/** No single event moves MRR more than this share of it. */
export const EVENT_CAP = 0.12;

/**
 * How much of a customer base does something in a month — signs up, churns,
 * upgrades, downgrades. Self-serve SMB SaaS at these prices runs somewhere
 * between a tenth and a fifth of its logos through one of those.
 */
export const MONTHLY_CUSTOMER_TURNOVER = 0.18;

/**
 * Customers per event, on average, given that WAVE_CHANCE of them are waves
 * of 2..WAVE_MAX. Events are what the tape shows; customers are what the
 * turnover is measured in, so the rate has to divide by this.
 */
export const AVG_WAVE = 1 - WAVE_CHANCE + WAVE_CHANCE * ((2 + WAVE_MAX) / 2);

/**
 * How much livelier than a real business the board runs. A real $17k SaaS
 * with 400 customers genuinely only sees a couple of these a day, which is
 * accurate and reads as dead — the same trade we already made on the tape.
 */
export const DEMO_TEMPO = 3;

/** Nothing goes completely silent, however few customers it has. */
export const DEMO_MIN_EVENTS_PER_DAY = 1;

/**
 * Events a day for a business with this many customers.
 *
 * This used to be a flat 2.5 for every listing on the board, which is the
 * thing that looked wrong: a company with 1,168 customers and one with 38
 * had exactly the same amount happen to them. Churn and signups scale with
 * how many people you have; nothing else does.
 */
export function demoEventsPerDay(subs: number): number {
  const customersPerDay = (Math.max(0, subs) * MONTHLY_CUSTOMER_TURNOVER) / 30;
  return Math.max(DEMO_MIN_EVENTS_PER_DAY, (customersPerDay / AVG_WAVE) * DEMO_TEMPO);
}

/** Chance of an event in one interval of the poller. */
export function demoEventChance(subs: number, intervalMs = PULSE_INTERVAL_MS): number {
  return Math.min(0.5, (demoEventsPerDay(subs) * intervalMs) / 86_400_000);
}

/**
 * One more month-of-a-small-SaaS step, forward this time. A customer is worth
 * roughly the average one with spread; the walk is steered back toward its
 * band rather than allowed to escape it, so a listing is still a believable
 * version of itself a quarter from now.
 */
export function nextDemoEvent(state: DemoState, rng: FlowRandom): DemoEvent | null {
  const subs = Math.max(2, Math.round(state.subs));
  const running = state.mrr;
  if (!(running > 0)) return null;

  let roll = rng.unit();
  const floor = state.reportedMrr * DEMO_BAND.floor;
  const ceil = state.reportedMrr * DEMO_BAND.ceil;
  // Outside the band the odds tilt back toward it, and tilt harder the
  // further out it has got. This used to be a wall — one step past the
  // ceiling and EVERY event was a churn, which is what a listing that had
  // simply had a good month looked like from the outside. A company on a
  // run can still sign someone; it just has further to fall.
  if (state.reportedMrr > 0) {
    const over = running > ceil ? (running - ceil) / ceil : 0;
    const under = running < floor ? (floor - running) / floor : 0;
    if (over > 0 && rng.unit() < Math.min(0.85, 0.35 + over * 2)) roll = 0.05;
    else if (under > 0 && rng.unit() < Math.min(0.85, 0.35 + under * 2)) roll = 0.9;
  }
  const kind: DemoKind =
    roll < 0.18
      ? "churn"
      : roll < 0.28
        ? "expansion"
        : roll < 0.34
          ? "contraction"
          : "new";
  // this customer's size: the average with spread, times the whale tail
  const unit = Math.max(
    1,
    (running / subs) * (0.5 + rng.unit() * 1.4) * Math.exp(WHALE_SIGMA * rng.gauss())
  );
  // how many of them: a wave, or the usual one
  const wave = rng.unit() < WAVE_CHANCE ? 2 + Math.floor(rng.unit() * (WAVE_MAX - 1)) : 1;
  const cap = running * EVENT_CAP;

  let after = running;
  let nextSubs = subs;
  if (kind === "new") {
    after = running + Math.min(unit * wave, cap);
    nextSubs = subs + wave;
  } else if (kind === "churn") {
    if (subs <= 2) return null; // the last customers stay
    const leaving = Math.min(wave, subs - 2);
    after = running - Math.min(unit * leaving, cap);
    nextSubs = subs - leaving;
  } else if (kind === "expansion") {
    after = running + Math.min(unit * 0.4, cap);
  } else {
    after = running - Math.min(unit * 0.4, cap);
  }
  if (after <= 1) return null;
  return {
    kind,
    prevMrr: Math.round(running * 100) / 100,
    mrr: Math.round(after * 100) / 100,
    prevSubs: subs,
    subs: nextSubs,
  };
}

/** A plausible customer count for a business this size, absent a record. */
export function guessSubscribers(mrr: number, rng: FlowRandom): number {
  return Math.max(8, Math.round(mrr / (18 + rng.unit() * 60)));
}

export interface DemoPulseResult {
  checked: number;
  events: { symbol: string; kind: DemoKind; from: number; to: number }[];
}

/**
 * One poller interval of demo revenue: each fixture without a connection rolls
 * for an event; a hit is written to revenue_events like a Stripe reading and
 * pinned into today's snapshot so the chart steps where it happened.
 */
export async function runDemoPulse(
  admin: SupabaseClient,
  opts: { now?: number; rng?: FlowRandom; intervalMs?: number } = {}
): Promise<DemoPulseResult> {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? cryptoRandom();
  const intervalMs = opts.intervalMs ?? PULSE_INTERVAL_MS;
  const out: DemoPulseResult = { checked: 0, events: [] };

  const [{ data: tickers }, { data: conns }, { data: reports }, latest] =
    await Promise.all([
      admin.from("tickers").select("id, symbol, fixture, stripe_verified"),
      admin.from("stripe_connections").select("ticker_id").eq("status", "active"),
      admin.from("mrr_updates").select("ticker_id, month, mrr").order("month", {
        ascending: true,
      }),
      latestEventMrr(admin),
    ]);
  const connected = new Set(
    ((conns ?? []) as { ticker_id: string }[]).map((c) => c.ticker_id)
  );
  const reported = new Map<string, number>();
  for (const r of (reports ?? []) as { ticker_id: string; mrr: number }[]) {
    reported.set(r.ticker_id, Number(r.mrr)); // month-ascending → last wins
  }

  for (const t of (tickers ?? []) as {
    id: string;
    symbol: string;
    fixture: boolean | null;
    stripe_verified: boolean | null;
  }[]) {
    if (!t.fixture || t.stripe_verified || connected.has(t.id)) continue;
    out.checked++;

    // how busy this listing is depends on how many customers it has, so the
    // roll has to come after we know — it used to be one rate for the board
    const last = latest.get(t.id);
    const reportedMrr = reported.get(t.id) ?? 0;
    const mrr = last?.mrr ?? reportedMrr;
    if (!(mrr > 0)) continue;
    const subs = last?.subscriptions ?? guessSubscribers(mrr, rng);
    if (rng.unit() >= demoEventChance(subs, intervalMs)) continue;

    const ev = nextDemoEvent({ mrr, subs, reportedMrr }, rng);
    if (!ev) continue;

    const { error } = await admin.from("revenue_events").insert({
      ticker_id: t.id,
      at: new Date(now).toISOString(),
      prev_mrr: ev.prevMrr,
      mrr: ev.mrr,
      kind: ev.kind,
      prev_subscriptions: ev.prevSubs,
      subscriptions: ev.subs,
    });
    if (error) continue;
    await recordTickerSnapshot(admin, t.id, { mrr: ev.mrr });
    out.events.push({ symbol: t.symbol, kind: ev.kind, from: ev.prevMrr, to: ev.mrr });
  }
  return out;
}

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
import { cryptoRandom, FLOW_TICK_MS, type FlowRandom } from "@/lib/flow";
import { latestEventMrr } from "@/lib/pulse";
import { recordTickerSnapshot } from "@/lib/snapshot";

/** Roughly two or three a day per listing — the cadence PRL actually shows. */
export const DEMO_EVENTS_PER_DAY = 2.5;

/** Chance of an event in one interval of the poller. */
export function demoEventChance(intervalMs = FLOW_TICK_MS): number {
  return (DEMO_EVENTS_PER_DAY * intervalMs) / 86_400_000;
}

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
  if (state.reportedMrr > 0) {
    if (running > ceil) roll = 0.05; // force a churn: too far above the band
    else if (running < floor) roll = 0.9; // force a signup: too far below
  }
  const kind: DemoKind =
    roll < 0.18
      ? "churn"
      : roll < 0.28
        ? "expansion"
        : roll < 0.34
          ? "contraction"
          : "new";
  const unit = Math.max(1, (running / subs) * (0.5 + rng.unit() * 1.4));

  let after = running;
  let nextSubs = subs;
  if (kind === "new") {
    after = running + unit;
    nextSubs = subs + 1;
  } else if (kind === "churn") {
    if (subs <= 2) return null; // the last customers stay
    after = running - unit;
    nextSubs = subs - 1;
  } else if (kind === "expansion") {
    after = running + unit * 0.4;
  } else {
    after = running - unit * 0.4;
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
  const chance = demoEventChance(opts.intervalMs ?? FLOW_TICK_MS);
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
    if (rng.unit() >= chance) continue;

    const last = latest.get(t.id);
    const reportedMrr = reported.get(t.id) ?? 0;
    const mrr = last?.mrr ?? reportedMrr;
    if (!(mrr > 0)) continue;
    const subs = last?.subscriptions ?? guessSubscribers(mrr, rng);
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

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authForConnection,
  readStripePayments,
  readStripeRevenue,
} from "@/lib/stripe";
import { marketDayKey } from "@/lib/market-time";
import { recordTickerSnapshot } from "@/lib/snapshot";
import { audienceForTicker, notifyUsers } from "@/lib/notify";
import { fmtCompact, fmtPct } from "@/lib/format";
import { changeFraction, type RevenueEvent } from "@/lib/pricing";

/** Don't hit Stripe more often than this per ticker. */
export const PULSE_INTERVAL_MS = 5 * 60_000;

/** Below this, a change is rounding, not news. */
const MIN_MOVE = 0.005; // half a percent of MRR

/** A move worth waking holders and watchers up for. */
const ALERT_MOVE = 0.03;

export type RevenueEventKind = "new" | "churn" | "expansion" | "contraction";

interface Connection {
  ticker_id: string;
  method: string | null;
  stripe_account_id: string | null;
  encrypted_key: string | null;
  status: string;
  last_mrr: number | null;
  live_mrr: number | null;
  revenue_backfilled?: boolean | null;
  revenue_error?: string | null;
  live_subscriptions: number | null;
  live_synced_at: string | null;
}

export interface PulseResult {
  checked: number;
  changed: number;
  errors: number;
  /** Payment syncs that failed — surfaced so an empty ledger is explainable. */
  revenueErrors?: number;
  events: { symbol: string; kind: RevenueEventKind; from: number; to: number }[];
}

/** What Stripe's subscription count says the money did. */
export function classify(
  from: number,
  to: number,
  prevSubs: number | null,
  subs: number
): RevenueEventKind {
  const up = to > from;
  if (prevSubs === null) return up ? "new" : "churn";
  if (subs > prevSubs) return "new";
  if (subs < prevSubs) return "churn";
  return up ? "expansion" : "contraction";
}

/**
 * Read every connected Stripe account and record what changed.
 *
 * This runs every five minutes; the monthly report in the daily cron is
 * untouched. The split is the point: the PRICE trades on what Stripe says
 * right now, the REPORTED number still only moves once a month, and the
 * handover is continuous because fair value is linear in MRR.
 *
 * Never throws — a failed poll leaves the last known revenue in place.
 */
/** How far the first sync reaches back for a newly connected account. */
export const REVENUE_BACKFILL_DAYS = 120;
/** How far every later poll re-reads, so late refunds and captures land. */
export const REVENUE_WINDOW_DAYS = 3;

/**
 * Record what a connected account actually collected, per market day.
 *
 * Every succeeded charge counts — a renewal, a first payment, a one-time
 * licence — because that is the whole point: MRR only ever saw recurring
 * revenue, so a founder could take payments all day and watch their ticker
 * sit still.
 *
 * Re-reading a short trailing window on every poll rather than only today is
 * deliberate: refunds and disputes land days after the charge, and a day is
 * not final the moment it ends.
 */
export async function recordDailyRevenue(
  admin: SupabaseClient,
  conn: Connection,
  now = Date.now()
): Promise<number> {
  const backfilled = conn.revenue_backfilled === true;
  const days = backfilled ? REVENUE_WINDOW_DAYS : REVENUE_BACKFILL_DAYS;
  const since = now - days * 86_400_000;

  const { days: takings, currencies } = await readStripePayments(
    authForConnection(conn),
    since,
    marketDayKey
  );

  if (takings.length > 0) {
    const rows = takings.map((d) => ({
      ticker_id: conn.ticker_id,
      day: d.day,
      gross_minor: d.grossMinor,
      net_minor: d.netMinor,
      payments: d.payments,
      currency: currencies.length === 1 ? currencies[0] : null,
      synced_at: new Date(now).toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin
        .from("daily_revenue")
        .upsert(rows.slice(i, i + 200), { onConflict: "ticker_id,day" });
      if (error) throw new Error(error.message);
    }
  }

  await admin
    .from("stripe_connections")
    .update({
      revenue_synced_at: new Date(now).toISOString(),
      revenue_backfilled: true,
    })
    .eq("ticker_id", conn.ticker_id);

  return takings.length;
}

export async function pollRevenuePulse(
  admin: SupabaseClient,
  opts: { tickerId?: string; force?: boolean } = {}
): Promise<PulseResult> {
  const out: PulseResult = { checked: 0, changed: 0, errors: 0, events: [] };

  let query = admin
    .from("stripe_connections")
    .select("*")
    .eq("status", "active");
  if (opts.tickerId) query = query.eq("ticker_id", opts.tickerId);

  const { data, error } = await query;
  if (error) return out;
  const connections = (data ?? []) as Connection[];
  if (connections.length === 0) return out;

  const { data: tickerRows } = await admin
    .from("tickers")
    .select("id, symbol")
    .in(
      "id",
      connections.map((c) => c.ticker_id)
    );
  const symbolOf = new Map(
    ((tickerRows ?? []) as { id: string; symbol: string }[]).map((t) => [
      t.id,
      t.symbol,
    ])
  );

  const now = Date.now();
  for (const conn of connections) {
    const age = conn.live_synced_at
      ? now - new Date(conn.live_synced_at).getTime()
      : Infinity;
    if (!opts.force && age < PULSE_INTERVAL_MS) continue;

    out.checked++;

    // Money received, which is what the price anchors on. Kept separate from
    // the subscription read so a failure in one does not lose the other, and
    // never fatal: a missing revenue row must not stop a ticker trading.
    //
    // But it is RECORDED. The first version swallowed the error whole, and
    // the result was daily_revenue sitting empty with no way to tell whether
    // the migration was missing, the deploy was behind, or the restricted key
    // simply has no charge-read scope — which is the likeliest of the three,
    // because a key created to read subscriptions does not get charges.
    try {
      await recordDailyRevenue(admin, conn, now);
      if (conn.revenue_error) {
        await admin
          .from("stripe_connections")
          .update({ revenue_error: null })
          .eq("ticker_id", conn.ticker_id);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      out.revenueErrors = (out.revenueErrors ?? 0) + 1;
      await admin
        .from("stripe_connections")
        .update({ revenue_error: reason.slice(0, 300) })
        .eq("ticker_id", conn.ticker_id)
        .then(
          () => undefined,
          () => undefined // pre-0008: nowhere to write it, carry on
        );
    }

    let reading;
    try {
      reading = await readStripeRevenue(authForConnection(conn));
    } catch {
      out.errors++;
      // a single failed read is not a churn — leave the last number standing
      await admin
        .from("stripe_connections")
        .update({ live_synced_at: new Date().toISOString() })
        .eq("ticker_id", conn.ticker_id);
      continue;
    }

    const previous = Number(conn.live_mrr ?? conn.last_mrr ?? reading.mrr);
    const moved =
      previous > 0 ? Math.abs(reading.mrr - previous) / previous : 0;

    // A read that says "every subscription is gone" is the one reading that
    // could wipe a company's valuation on a fluke, so it has to say it twice:
    // this poll banks the zero count but leaves the money where it was, and
    // the next one, five minutes later, either confirms it or takes it back.
    const unconfirmedWipeout =
      moved >= MIN_MOVE &&
      previous > 0 &&
      reading.subscriptions === 0 &&
      (conn.live_subscriptions ?? 0) > 0;

    await admin
      .from("stripe_connections")
      .update({
        live_synced_at: new Date().toISOString(),
        live_mrr: unconfirmedWipeout ? previous : reading.mrr,
        live_subscriptions: reading.subscriptions,
      })
      .eq("ticker_id", conn.ticker_id);

    if (previous <= 0 || moved < MIN_MOVE || unconfirmedWipeout) continue;

    const kind = classify(
      previous,
      reading.mrr,
      conn.live_subscriptions,
      reading.subscriptions
    );
    await admin.from("revenue_events").insert({
      ticker_id: conn.ticker_id,
      prev_mrr: previous,
      mrr: reading.mrr,
      kind,
      subscriptions: reading.subscriptions,
      prev_subscriptions: conn.live_subscriptions,
    });

    out.changed++;
    const symbol = symbolOf.get(conn.ticker_id) ?? "";
    out.events.push({ symbol, kind, from: previous, to: reading.mrr });

    // the print lands on the chart at the moment it happened
    await recordTickerSnapshot(admin, conn.ticker_id);

    if (moved >= ALERT_MOVE) {
      try {
        const audience = await audienceForTicker(conn.ticker_id);
        // the first reading is a catch-up, not an event — say so
        const firstRead = conn.live_subscriptions === null;
        const verb = firstRead
          ? "is trading on live revenue now"
          : kind === "new"
            ? "picked up a customer"
            : kind === "churn"
              ? "lost a customer"
              : kind === "expansion"
                ? "expanded an account"
                : "had an account downgrade";
        const detail = firstRead
          ? `Stripe says ${fmtCompact(reading.mrr)} against the last report of ${fmtCompact(previous)} (${fmtPct(changeFraction(previous, reading.mrr))})`
          : `MRR ${fmtCompact(previous)} → ${fmtCompact(reading.mrr)} (${fmtPct(changeFraction(previous, reading.mrr))})`;
        await notifyUsers(
          audience,
          "mrr",
          `$${symbol} ${verb} — ${detail}`,
          conn.ticker_id
        );
      } catch {
        // alerts are a nicety; the price already moved
      }
    }
  }

  return out;
}

/** The newest revenue event a ticker has on record — its live number when
 *  no Stripe connection is speaking for it (demo listings, or a disconnected
 *  one trading on its last known reading). */
export interface LatestEvent {
  mrr: number;
  subscriptions: number | null;
  at: number;
}

/**
 * Latest event per ticker. One ticker: an exact query. The whole board: the
 * newest thousand events, which at the demo cadence is weeks of history for
 * every listing, and the first row seen per ticker is its latest.
 */
export async function latestEventMrr(
  admin: SupabaseClient,
  tickerId?: string
): Promise<Map<string, LatestEvent>> {
  const out = new Map<string, LatestEvent>();
  let query = admin
    .from("revenue_events")
    .select("ticker_id, at, mrr, subscriptions")
    .order("at", { ascending: false });
  query = tickerId ? query.eq("ticker_id", tickerId).limit(1) : query.limit(1000);
  const { data } = await query;
  for (const r of (data ?? []) as {
    ticker_id: string;
    at: string;
    mrr: number;
    subscriptions: number | null;
  }[]) {
    if (out.has(r.ticker_id)) continue;
    out.set(r.ticker_id, {
      mrr: Number(r.mrr),
      subscriptions: r.subscriptions === null ? null : Number(r.subscriptions),
      at: Date.parse(r.at),
    });
  }
  return out;
}

/** Recent revenue changes for one ticker, oldest first — chart + fill input. */
export async function getRevenueEvents(
  admin: SupabaseClient,
  tickerId: string,
  sinceMs = 30 * 86_400_000
): Promise<RevenueEvent[]> {
  const { data } = await admin
    .from("revenue_events")
    .select("at, prev_mrr, mrr, prev_subscriptions")
    .eq("ticker_id", tickerId)
    .gte("at", new Date(Date.now() - sinceMs).toISOString())
    .order("at", { ascending: true })
    .limit(500);
  return (
    (data ?? []) as {
      at: string;
      prev_mrr: number;
      mrr: number;
      prev_subscriptions: number | null;
    }[]
  ).map((r) => ({
    at: Date.parse(r.at),
    mrr: Number(r.mrr),
    prevMrr: Number(r.prev_mrr),
    catchUp: r.prev_subscriptions === null,
  }));
}

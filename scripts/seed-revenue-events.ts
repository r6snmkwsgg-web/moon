/**
 * Give the fixture tickers a pulse.
 *
 * Only PRL is wired to Stripe, so only PRL ever had revenue_events — the
 * churn and signup markers under the chart, and the sharp step the price
 * takes when one lands. Every other ticker moved on weather alone: no
 * markers, no earnings steps, nothing to react to. A board of twenty tickers
 * where nineteen never report anything is a board with one story.
 *
 * This writes plausible events for the fixtures, then re-prices the daily
 * snapshots so the recorded history agrees with them. Events cluster the way
 * real ones do — a business signs two customers in a week and then nothing
 * for ten days — and churn is rarer than growth but lands harder.
 *
 * PRL is never touched: its events are real.
 *
 *   npx tsx scripts/seed-revenue-events.ts [--dry]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  fairPrice,
  floatOf,
  settledPrice,
  valuationMultiple,
  type RevenuePoint,
} from "../lib/pricing";

config({ path: ".env.local" });
const DRY = process.argv.includes("--dry");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAY = 86_400_000;
/** How far back to write events. Matches the chart's detail window. */
const WINDOW_DAYS = 45;

/** Deterministic per-symbol RNG, so a re-run reproduces the same history. */
function rng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

type Kind = "new" | "churn" | "expansion" | "contraction";

interface Ev {
  at: number;
  prevMrr: number;
  mrr: number;
  kind: Kind;
  prevSubs: number;
  subs: number;
}

/**
 * A month of a small SaaS: mostly signups, the occasional expansion, churn
 * about one time in five. Sized off the ticker's own MRR so a $4k business
 * moves in $4k-shaped steps, and clustered rather than evenly spaced.
 */
function makeEvents(symbol: string, mrr: number, now: number): Ev[] {
  const r = rng(`${symbol}/events`);
  const out: Ev[] = [];
  // a plausible customer count for this size of business
  let subs = Math.max(8, Math.round(mrr / (18 + r() * 60)));
  let running = mrr;

  // walk BACKWARDS from today so the series ends on the real current MRR
  let t = now - 60_000;
  const stop = now - WINDOW_DAYS * DAY;
  const steps: Ev[] = [];
  // Forty-five days must stay a believable version of this business, so the
  // backward walk is kept inside a band around today's number. Without it a
  // few hundred steps of drift put the ticker at a tenth of its MRR a month
  // ago, or ten times it, and the whole history reads as fiction.
  const floor = mrr * 0.55;
  const ceil = mrr * 1.75;

  while (t > stop) {
    // Clustered, and roughly two or three a day — the cadence PRL actually
    // shows. The first pass averaged a gap of nearly two days, so a chart at
    // its default window had no markers on it at all and the board still
    // looked dead.
    const gapH = r() < 0.5 ? 0.6 + r() * 3.5 : 6 + r() * 22;
    t -= gapH * 3600_000;
    if (t <= stop) break;

    let roll = r();
    // steer back toward the band rather than letting the walk escape it
    if (running > ceil) roll = 0.9; // force a signup: less money further back
    else if (running < floor) roll = 0.05; // force a churn: more money back then

    const kind: Kind =
      roll < 0.18 ? "churn" : roll < 0.28 ? "expansion" : roll < 0.34 ? "contraction" : "new";
    // one customer is worth roughly the average, with spread
    const unit = Math.max(1, (running / Math.max(subs, 1)) * (0.5 + r() * 1.4));

    const before = running;
    let after = running;
    let prevSubs = subs;
    if (kind === "new") {
      after = running - unit; // going backwards: before the signup there was less
      prevSubs = subs - 1;
    } else if (kind === "churn") {
      after = running + unit;
      prevSubs = subs + 1;
    } else if (kind === "expansion") {
      after = running - unit * 0.4;
    } else {
      after = running + unit * 0.4;
    }
    if (after <= 1 || prevSubs < 2) break;

    steps.push({
      at: t,
      prevMrr: Math.round(after * 100) / 100,
      mrr: Math.round(before * 100) / 100,
      kind,
      prevSubs,
      subs,
    });
    running = after;
    subs = prevSubs;
  }
  out.push(...steps.reverse());
  return out;
}

async function main() {
  const [{ data: tickers }, { data: mrrRows }] = await Promise.all([
    admin.from("tickers").select("*"),
    admin.from("mrr_updates").select("*").order("month", { ascending: true }),
  ]);
  const revenue = new Map<string, RevenuePoint[]>();
  for (const u of (mrrRows ?? []) as { ticker_id: string; month: string; mrr: number }[]) {
    const l = revenue.get(u.ticker_id) ?? [];
    l.push({ month: u.month, mrr: Number(u.mrr) });
    revenue.set(u.ticker_id, l);
  }

  const now = Date.now();
  let written = 0;

  for (const t of (tickers ?? []) as Record<string, unknown>[]) {
    const symbol = t.symbol as string;
    // PRL's events are real Stripe readings — never fabricate over them
    if (t.stripe_verified === true) {
      console.log(`${symbol.padEnd(5)} skipped — Stripe-verified, its events are real`);
      continue;
    }
    const record = revenue.get(t.id as string) ?? [];
    const mrr = record.length ? record[record.length - 1].mrr : 0;
    if (mrr <= 0) continue;

    const events = makeEvents(symbol, mrr, now);
    if (events.length === 0) continue;

    const kinds = events.reduce<Record<string, number>>((a, e) => {
      a[e.kind] = (a[e.kind] ?? 0) + 1;
      return a;
    }, {});
    console.log(
      `${symbol.padEnd(5)} ${String(events.length).padStart(3)} events over ${WINDOW_DAYS}d  ` +
        `${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}  ` +
        `$${events[0].prevMrr.toFixed(0)} → $${mrr.toFixed(0)}`
    );
    if (DRY) continue;

    await admin.from("revenue_events").delete().eq("ticker_id", t.id).gte(
      "at",
      new Date(now - WINDOW_DAYS * DAY).toISOString()
    );
    const rows = events.map((e) => ({
      ticker_id: t.id,
      at: new Date(e.at).toISOString(),
      prev_mrr: e.prevMrr,
      mrr: e.mrr,
      kind: e.kind,
      prev_subscriptions: e.prevSubs,
      subscriptions: e.subs,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from("revenue_events").insert(rows.slice(i, i + 200));
      if (error) throw new Error(`${symbol}: ${error.message}`);
    }
    written += rows.length;
  }
  console.log(DRY ? "\ndry run — nothing written" : `\n${written} revenue events written`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

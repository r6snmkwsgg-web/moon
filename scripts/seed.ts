/**
 * Seed the exchange with fixture tickers so it looks alive on first paint.
 *
 *   npm run seed
 *
 * Reads fixtures/tickers.json, inserts each ticker with 6 months of curated
 * MRR history, and backfills ~120 days of daily price snapshots (fair price
 * from the interpolated MRR anchor plus a small deterministic wiggle, so the
 * charts have texture without pretending to be real trading data).
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Safe to re-run: tickers that already exist are skipped.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fairPrice } from "../lib/pricing";
import fixtures from "../fixtures/tickers.json";

config({ path: ".env.local" });
config();

const SNAPSHOT_DAYS = 120;

interface FixtureTicker {
  symbol: string;
  name: string;
  pitch: string;
  founder_handle: string;
  mrr: number[]; // oldest → newest
}

/** Deterministic PRNG so re-seeding produces the same charts. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic starting sentiment in ±0.18 so the board opens with real
 * green/red movement instead of a wall of 0.0% (daily decay walks it home).
 */
function initialSentiment(symbol: string): number {
  const r = mulberry32(hashString(symbol + ":sentiment"))();
  return Math.round((r * 2 - 1) * 0.18 * 10000) / 10000;
}

function monthStartUTC(offsetMonths: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Linear interpolation of MRR between monthly anchors. */
function mrrAt(anchors: { time: number; mrr: number }[], time: number): number {
  if (time <= anchors[0].time) return anchors[0].mrr;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (time >= a.time && time <= b.time) {
      const f = (time - a.time) / (b.time - a.time || 1);
      return a.mrr + f * (b.mrr - a.mrr);
    }
  }
  return anchors[anchors.length - 1].mrr;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (put them in .env.local)."
    );
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tickers = fixtures.tickers as FixtureTicker[];
  console.log(`Seeding ${tickers.length} tickers…`);

  for (const fixture of tickers) {
    const { data: existing } = await admin
      .from("tickers")
      .select("id")
      .eq("symbol", fixture.symbol)
      .maybeSingle();
    if (existing) {
      console.log(`  $${fixture.symbol} exists — skipping`);
      continue;
    }

    const { data: ticker, error } = await admin
      .from("tickers")
      .insert({
        symbol: fixture.symbol,
        name: fixture.name,
        pitch: fixture.pitch,
        founder_handle: fixture.founder_handle,
        fixture: true, // demo data — purgeable in one click from /admin
        sentiment: initialSentiment(fixture.symbol),
        listed_at: monthStartUTC(-(fixture.mrr.length - 1)).toISOString(),
      })
      .select("id")
      .single();
    if (error || !ticker) {
      console.error(`  $${fixture.symbol} failed: ${error?.message}`);
      continue;
    }

    // Monthly MRR history: oldest value = (n-1) months ago … newest = this month.
    const months = fixture.mrr.map((mrr, i) => {
      const month = monthStartUTC(-(fixture.mrr.length - 1 - i));
      return { month, mrr };
    });
    const { error: mrrError } = await admin.from("mrr_updates").insert(
      months.map(({ month, mrr }) => ({
        ticker_id: ticker.id,
        month: iso(month),
        mrr,
        source: "curated",
      }))
    );
    if (mrrError) {
      console.error(`  $${fixture.symbol} MRR failed: ${mrrError.message}`);
      continue;
    }

    // Daily snapshots: fair price from the interpolated MRR anchor + wiggle.
    const anchors = months.map(({ month, mrr }) => ({
      time: month.getTime(),
      mrr,
    }));
    const rand = mulberry32(hashString(fixture.symbol));
    const phase = rand() * Math.PI * 2;
    const snapshots = [];
    for (let d = SNAPSHOT_DAYS; d >= 0; d--) {
      const day = new Date(Date.now() - d * 86400_000);
      const mrr = mrrAt(anchors, day.getTime());
      const fair = fairPrice(mrr);
      const wiggle =
        0.03 * Math.sin((SNAPSHOT_DAYS - d) / 5 + phase) +
        (rand() - 0.5) * 0.04;
      snapshots.push({
        ticker_id: ticker.id,
        day: iso(day),
        price: Number((fair * (1 + wiggle)).toFixed(6)),
        fair_price: Number(fair.toFixed(6)),
        sentiment: 0,
        mrr,
      });
    }
    const { error: snapError } = await admin
      .from("price_snapshots")
      .upsert(snapshots, { onConflict: "ticker_id,day" });
    if (snapError) {
      console.error(`  $${fixture.symbol} snapshots failed: ${snapError.message}`);
      continue;
    }

    console.log(
      `  $${fixture.symbol} listed — MRR $${fixture.mrr[fixture.mrr.length - 1].toLocaleString()} / ${snapshots.length} snapshots`
    );
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

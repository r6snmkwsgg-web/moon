/**
 * One-off: scale the recorded weather into a new amplitude.
 *
 * The walk's stationary spread went from ~0.40 to ~0.14 in log space (see
 * lib/flow DRIFT_STEP_SD) and its volatility regime from ~1.0 to ~0.6. The
 * RECORD — every ticker's current drift and regime, the last fortnight of
 * five-minute ticks, every daily snapshot — was drawn at the old amplitude,
 * and a 21-day pull would take a month to forget it. So the record is scaled
 * instead: every drift is multiplied by the ratio of the two spreads. That
 * keeps the SHAPE of every chart — each peak, dip and crash stays where it
 * was — and shrinks its height. Recorded prices follow the drift they carry:
 *
 *     price' = price × e^(drift' − drift)
 *
 * Facts are untouched: trades, revenue events, MRR, sentiment, fair value.
 * Only the weather on top of them changes.
 *
 *   npx tsx scripts/recalibrate-weather.ts <drift-factor> [<vol-factor>]
 *       [--symbols=PRL,LNCH] [--steps=state,ticks,snapshots] [--dry]
 *
 * e.g. `0.34 0.6` for the 0.40 → 0.14 / 1.0 → 0.6 move. Run
 * regenerate-history.ts afterwards: the daily snapshots older than the tape
 * are redrawn from the walk, pinned to the (now rescaled) ends.
 *
 * It is NOT idempotent — a second run scales again — which is what the two
 * selectors are for: a run that fails part-way is finished by naming the
 * tickers and steps still owed, not by running the whole thing twice.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { FLOW_CAP } from "../lib/pricing";
import { VOL_STATE_CAP } from "../lib/flow";

config({ path: ".env.local" });

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY = process.argv.includes("--dry");
const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ONLY = new Set(
  (flag("symbols") ?? "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
);
const STEPS = new Set(
  (flag("steps") ?? "state,ticks,snapshots").split(",").map((x) => x.trim())
);
const K = Number(args[0]);
const KV = args[1] !== undefined ? Number(args[1]) : K;
// any positive factor: a run that scaled something twice is undone with the
// inverse, which is above 1
if (!(K > 0) || !(KV > 0)) {
  throw new Error(
    "usage: recalibrate-weather.ts <drift-factor> [<vol-factor>] [--symbols=..] [--steps=..] [--dry]"
  );
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));
const scaleDrift = (d: number) => clamp(d * K, -FLOW_CAP, FLOW_CAP);

async function main() {
  const { data: tickers, error } = await admin
    .from("tickers")
    .select("id, symbol, drift, vol_state")
    .order("symbol");
  if (error) throw new Error(error.message);
  if (!tickers?.length) throw new Error("no tickers");

  let ticks = 0;
  let snaps = 0;
  for (const t of tickers as {
    id: string;
    symbol: string;
    drift: number | null;
    vol_state: number | null;
  }[]) {
    if (ONLY.size > 0 && !ONLY.has(t.symbol.toUpperCase())) continue;
    // ── 1. the live state ─────────────────────────────────────────────────
    const d0 = Number(t.drift ?? 0);
    const v0 = Number(t.vol_state ?? 0);
    const d1 = scaleDrift(d0);
    const v1 = clamp(v0 * KV, -VOL_STATE_CAP, VOL_STATE_CAP);
    if (!DRY && STEPS.has("state")) {
      const { error: e } = await admin
        .from("tickers")
        .update({ drift: d1, vol_state: v1 })
        .eq("id", t.id);
      if (e) throw new Error(`${t.symbol} state: ${e.message}`);
    }

    // ── 2. the recorded tape, page by page ────────────────────────────────
    const PAGE = 1000;
    let from = 0;
    let n = 0;
    for (; STEPS.has("ticks"); ) {
      const { data, error: e } = await admin
        .from("flow_ticks")
        .select("at, drift, price")
        .eq("ticker_id", t.id)
        .order("at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (e) throw new Error(`${t.symbol} ticks: ${e.message}`);
      if (!data?.length) break;
      const rows = (data as { at: string; drift: number; price: number }[]).map(
        (r) => {
          const a = Number(r.drift);
          const b = scaleDrift(a);
          return {
            ticker_id: t.id,
            at: r.at,
            drift: Number(b.toFixed(8)),
            price: Number((Number(r.price) * Math.exp(b - a)).toFixed(6)),
          };
        }
      );
      if (!DRY) {
        for (let i = 0; i < rows.length; i += 500) {
          const { error: ue } = await admin
            .from("flow_ticks")
            .upsert(rows.slice(i, i + 500), { onConflict: "ticker_id,at" });
          if (ue) throw new Error(`${t.symbol} ticks: ${ue.message}`);
        }
      }
      n += rows.length;
      if (data.length < PAGE) break;
      from += PAGE;
    }
    ticks += n;

    // ── 3. the daily snapshots ────────────────────────────────────────────
    // each row's weather is what its price carries over its own anchor.
    // The whole row goes back: an upsert is an INSERT first, and a partial
    // one trips the NOT NULL columns before the conflict is ever resolved.
    const { data: snapRows, error: se } = STEPS.has("snapshots")
      ? await admin
          .from("price_snapshots")
          .select("day, price, fair_price, sentiment, mrr")
          .eq("ticker_id", t.id)
      : { data: [], error: null };
    if (se) throw new Error(`${t.symbol} snapshots: ${se.message}`);
    const updates = (
      (snapRows ?? []) as {
        day: string;
        price: number;
        fair_price: number;
        sentiment: number;
        mrr: number;
      }[]
    ).flatMap((s) => {
      const anchor = Number(s.fair_price) * Math.exp(Number(s.sentiment));
      const price = Number(s.price);
      if (!(anchor > 0) || !(price > 0)) return [];
      const a = Math.log(price / anchor);
      const b = scaleDrift(a);
      return [
        {
          ticker_id: t.id,
          day: s.day,
          price: Number((anchor * Math.exp(b)).toFixed(6)),
          fair_price: Number(s.fair_price),
          sentiment: Number(s.sentiment),
          mrr: Number(s.mrr),
        },
      ];
    });
    if (!DRY && STEPS.has("snapshots")) {
      for (let i = 0; i < updates.length; i += 200) {
        const { error: ue } = await admin
          .from("price_snapshots")
          .upsert(updates.slice(i, i + 200), { onConflict: "ticker_id,day" });
        if (ue) throw new Error(`${t.symbol} snapshots: ${ue.message}`);
      }
    }
    snaps += updates.length;

    console.log(
      `${t.symbol.padEnd(5)} drift ${d0.toFixed(3).padStart(7)} → ${d1.toFixed(3).padStart(7)}   ` +
        `vol ${v0.toFixed(3).padStart(7)} → ${v1.toFixed(3).padStart(7)}   ` +
        `${String(n).padStart(5)} ticks  ${String(updates.length).padStart(4)} snapshots`
    );
  }

  console.log(
    DRY
      ? `\ndry run — would rescale ${ticks} ticks and ${snaps} snapshots`
      : `\n${ticks} ticks and ${snaps} snapshots rescaled`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

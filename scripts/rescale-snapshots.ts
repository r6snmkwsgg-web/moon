/**
 * One-off: re-derive every recorded price snapshot under the current
 * pricing formula, exactly as the nightly cron would have written it
 * (flow included, pinned to the cron's 06:00 UTC slot).
 *
 * Idempotent — it recomputes from the stored mrr/sentiment inputs, so
 * running it twice, or after a half-finished pass, lands in the same place.
 * Used when the valuation multiple changed (3× MRR → 3× ARR).
 *
 *   npx tsx scripts/rescale-snapshots.ts
 */
import { config } from "dotenv";
import { fairPrice, flowPrice } from "../lib/pricing";

config({ path: ".env.local" });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !KEY) throw new Error("Missing Supabase env vars.");

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

interface Snap {
  ticker_id: string;
  day: string;
  price: number;
  fair_price: number;
  sentiment: number;
  mrr: number;
}

async function main() {
  const tickers: { id: string; symbol: string }[] = await fetch(
    `${URL_}/rest/v1/tickers?select=id,symbol`,
    { headers: H }
  ).then((r) => r.json());
  const symbolOf = new Map(tickers.map((t) => [t.id, t.symbol]));
  console.log(`tickers: ${tickers.length}`);

  const countRes = await fetch(
    `${URL_}/rest/v1/price_snapshots?select=ticker_id`,
    { headers: { ...H, Prefer: "count=exact", Range: "0-0" } }
  );
  const total = Number(
    countRes.headers.get("content-range")?.split("/")[1] ?? 0
  );
  console.log(`snapshots: ${total}`);

  let done = 0;
  for (let offset = 0; offset < total; offset += 500) {
    const rows: Snap[] = await fetch(
      `${URL_}/rest/v1/price_snapshots?select=ticker_id,day,price,fair_price,sentiment,mrr&order=day.asc,ticker_id.asc&offset=${offset}&limit=500`,
      { headers: H }
    ).then((r) => r.json());
    if (rows.length === 0) break;

    const fixed = rows.map((s) => {
      const symbol = symbolOf.get(s.ticker_id) ?? "";
      const mrr = Number(s.mrr);
      const sentiment = Number(s.sentiment);
      const at = Date.parse(`${s.day}T06:00:00Z`); // the cron's slot
      return {
        ...s,
        fair_price: Number(fairPrice(mrr).toFixed(6)),
        price: Number(flowPrice(symbol, mrr, sentiment, at).toFixed(6)),
      };
    });

    const up = await fetch(
      `${URL_}/rest/v1/price_snapshots?on_conflict=ticker_id,day`,
      {
        method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(fixed),
      }
    );
    if (!up.ok) throw new Error(`upsert failed: ${up.status} ${await up.text()}`);
    done += fixed.length;
    console.log(`  ${done}/${total}`);
  }

  const check: Snap[] = await fetch(
    `${URL_}/rest/v1/price_snapshots?select=ticker_id,day,mrr,price,fair_price&order=day.desc&limit=3`,
    { headers: H }
  ).then((r) => r.json());
  console.log("spot check:");
  for (const s of check) {
    console.log(
      `  ${symbolOf.get(s.ticker_id)}  ${s.day}  mrr $${s.mrr}  fair $${s.fair_price}  price $${s.price}`
    );
  }
}

main();

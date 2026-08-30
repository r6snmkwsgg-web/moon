/**
 * One-off (after 0004_float.sql): give every existing listing its own float.
 *
 * Each ticker gets the share count a listing of its size would be issued
 * today — enough that it trades near TARGET_OPENING_PRICE instead of
 * wherever a flat 10,000 shares happened to put it. Market cap does not
 * move: this is a stock split, and it is applied the way a real exchange
 * applies one —
 *
 *   float  × ratio        (10,000 → 50,000 is a 5:1 split)
 *   price  ÷ ratio        every recorded snapshot, re-derived
 *   held   × ratio        open positions keep their value
 *   cost   ÷ ratio        so nobody's P&L changes by a cent
 *
 * Idempotent: a ticker already on its target float is skipped, and the
 * snapshot pass recomputes from stored inputs rather than scaling in place.
 *
 *   npx tsx scripts/split-floats.ts          # dry run, prints the plan
 *   npx tsx scripts/split-floats.ts --apply
 */
import { config } from "dotenv";
import { floatOf, shareCountFor, valuationMultiple } from "../lib/pricing";
import { rescaleSnapshots } from "./rescale-snapshots";

config({ path: ".env.local" });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !KEY) throw new Error("Missing Supabase env vars.");

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};
const APPLY = process.argv.includes("--apply");

const get = <T>(path: string): Promise<T> =>
  fetch(`${URL_}/rest/v1/${path}`, { headers: H }).then((r) => r.json());

const patch = async (path: string, body: unknown) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
};

async function main() {
  const tickers = await get<
    { id: string; symbol: string; shares_outstanding?: number }[]
  >("tickers?select=id,symbol,shares_outstanding");
  if (tickers.length && tickers[0].shares_outstanding === undefined) {
    throw new Error(
      "tickers.shares_outstanding is missing — apply supabase/migrations/0004_float.sql first."
    );
  }

  const revenue = await get<{ ticker_id: string; month: string; mrr: number }[]>(
    "mrr_updates?select=ticker_id,month,mrr&order=month.asc"
  );
  const historyOf = new Map<string, { month: string; mrr: number }[]>();
  for (const r of revenue) {
    const list = historyOf.get(r.ticker_id) ?? [];
    list.push({ month: r.month, mrr: Number(r.mrr) });
    historyOf.set(r.ticker_id, list);
  }

  console.log(APPLY ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");
  console.log("sym     old float    new float   split   price × 1/ratio");

  let changed = 0;
  for (const t of tickers) {
    const history = historyOf.get(t.id) ?? [];
    const mrr = history.length ? history[history.length - 1].mrr : 0;
    const target = shareCountFor(mrr, valuationMultiple(history));
    const current = floatOf(t.shares_outstanding);
    if (target === current) {
      console.log(`${t.symbol.padEnd(6)} ${String(current).padStart(10)}   (unchanged)`);
      continue;
    }
    const ratio = target / current;
    console.log(
      `${t.symbol.padEnd(6)} ${String(current).padStart(10)} → ${String(target).padStart(10)}   ${ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`}`
    );
    changed++;
    if (!APPLY) continue;

    await patch(`tickers?id=eq.${t.id}`, { shares_outstanding: target });

    // open positions keep their value across the split
    const holdings = await get<
      { user_id: string; shares: number; avg_cost: number }[]
    >(`holdings?select=user_id,shares,avg_cost&ticker_id=eq.${t.id}`);
    for (const h of holdings) {
      const shares = Math.max(1, Math.round(Number(h.shares) * ratio));
      const avg = (Number(h.avg_cost) * Number(h.shares)) / shares;
      await patch(
        `holdings?ticker_id=eq.${t.id}&user_id=eq.${h.user_id}`,
        { shares, avg_cost: Number(avg.toFixed(6)) }
      );
    }

    // and so does the printed record of how they got there
    const trades = await get<{ id: string; shares: number; price: number }[]>(
      `trades?select=id,shares,price&ticker_id=eq.${t.id}`
    );
    for (const tr of trades) {
      const shares = Math.max(1, Math.round(Number(tr.shares) * ratio));
      const price = (Number(tr.price) * Number(tr.shares)) / shares;
      await patch(`trades?id=eq.${tr.id}`, {
        shares,
        price: Number(price.toFixed(6)),
      });
    }
    if (holdings.length || trades.length) {
      console.log(
        `       adjusted ${holdings.length} position(s), ${trades.length} print(s)`
      );
    }
  }

  console.log(`\n${changed} ticker(s) to split.`);
  if (APPLY && changed > 0) {
    console.log("\nre-deriving price history at the new floats…");
    await rescaleSnapshots();
  }
}

main();

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fairPrice,
  floatOf,
  settledPrice,
  valuationMultiple,
} from "@/lib/pricing";

/**
 * Upsert TODAY's price snapshot for a ticker so charts and day-change
 * baselines reflect the newest event immediately, instead of waiting for
 * the nightly cron (which overwrites the row at 06:00 UTC anyway).
 * Callers pass mrr/sentiment when they already know them; otherwise the
 * latest rows are read. Never throws — a missed snapshot is cosmetic.
 */
export async function recordTickerSnapshot(
  admin: SupabaseClient,
  tickerId: string,
  known?: { mrr?: number; sentiment?: number }
): Promise<void> {
  try {
    let mrr = known?.mrr;
    let sentiment = known?.sentiment;

    const { data: ticker } = await admin
      .from("tickers")
      .select("*")
      .eq("id", tickerId)
      .maybeSingle();
    if (!ticker) return;
    if (sentiment === undefined) sentiment = Number(ticker.sentiment ?? 0);

    const { data: revenue } = await admin
      .from("mrr_updates")
      .select("month, mrr")
      .eq("ticker_id", tickerId)
      .order("month", { ascending: true });
    const history = ((revenue ?? []) as { month: string; mrr: number }[]).map(
      (r) => ({ month: r.month, mrr: Number(r.mrr) })
    );
    const multiple = valuationMultiple(history);
    const shares = floatOf(
      (ticker as { shares_outstanding?: number }).shares_outstanding
    );
    if (mrr === undefined) {
      mrr = history.length ? history[history.length - 1].mrr : 0;
    }

    await admin.from("price_snapshots").upsert(
      {
        ticker_id: tickerId,
        day: new Date().toISOString().slice(0, 10),
        // the record gets the settled price — no shimmer baked into history
        price: settledPrice(
          mrr,
          sentiment,
          Date.now(),
          multiple,
          shares,
          [],
          Number(ticker.drift ?? 0)
        ),
        fair_price: fairPrice(mrr, multiple, shares),
        sentiment,
        mrr,
      },
      { onConflict: "ticker_id,day" }
    );
  } catch {
    // cosmetic — the nightly cron records the canonical row
  }
}

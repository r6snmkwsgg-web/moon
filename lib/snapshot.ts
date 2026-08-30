import type { SupabaseClient } from "@supabase/supabase-js";
import { fairPrice, flowPrice } from "@/lib/pricing";

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
      .select("symbol, sentiment")
      .eq("id", tickerId)
      .maybeSingle();
    if (!ticker) return;
    if (sentiment === undefined) sentiment = Number(ticker.sentiment ?? 0);

    if (mrr === undefined) {
      const { data } = await admin
        .from("mrr_updates")
        .select("mrr")
        .eq("ticker_id", tickerId)
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle();
      mrr = Number(data?.mrr ?? 0);
    }

    await admin.from("price_snapshots").upsert(
      {
        ticker_id: tickerId,
        day: new Date().toISOString().slice(0, 10),
        price: flowPrice(ticker.symbol, mrr, sentiment),
        fair_price: fairPrice(mrr),
        sentiment,
        mrr,
      },
      { onConflict: "ticker_id,day" }
    );
  } catch {
    // cosmetic — the nightly cron records the canonical row
  }
}

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decaySentiment, fairPrice, livePrice } from "@/lib/pricing";
import type { MrrUpdate, Ticker } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily cron (vercel.json): for every ticker,
 *   1. decay sentiment 10% toward zero (hype fades, MRR is gravity), then
 *   2. snapshot today's price into price_snapshots (what the charts read).
 * Vercel calls this with "Authorization: Bearer ${CRON_SECRET}".
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const [tickersRes, mrrRes] = await Promise.all([
    admin.from("tickers").select("*"),
    admin.from("mrr_updates").select("*").order("month", { ascending: true }),
  ]);
  const tickers = (tickersRes.data ?? []) as Ticker[];

  const latestMrr = new Map<string, number>();
  for (const u of (mrrRes.data ?? []) as MrrUpdate[]) {
    latestMrr.set(u.ticker_id, Number(u.mrr)); // month-ascending → last wins
  }

  const today = new Date().toISOString().slice(0, 10);
  let snapshotted = 0;

  for (const ticker of tickers) {
    const mrr = latestMrr.get(ticker.id) ?? 0;
    const sentiment = decaySentiment(Number(ticker.sentiment));

    const { error: updateErr } = await admin
      .from("tickers")
      .update({ sentiment })
      .eq("id", ticker.id);
    if (updateErr) continue;

    const { error: snapErr } = await admin.from("price_snapshots").upsert(
      {
        ticker_id: ticker.id,
        day: today,
        price: livePrice(mrr, sentiment),
        fair_price: fairPrice(mrr),
        sentiment,
        mrr,
      },
      { onConflict: "ticker_id,day" }
    );
    if (!snapErr) snapshotted++;
  }

  return NextResponse.json({ ok: true, tickers: tickers.length, snapshotted });
}

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  changeFraction,
  decaySentiment,
  fairPrice,
  livePrice,
} from "@/lib/pricing";
import {
  computeMrrFromStripe,
  decryptStripeKey,
  stripeVerificationConfigured,
} from "@/lib/stripe";
import { audienceForTicker, notifyUsers } from "@/lib/notify";
import { getAllValuations } from "@/lib/data";
import { fmtCompact, fmtPct, currentMonthISO } from "@/lib/format";
import type { MrrUpdate, Ticker } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MOVE_ALERT_THRESHOLD = 0.1; // notify watchers/holders at ±10% on the day

/**
 * Daily cron (vercel.json):
 *   1. decay every ticker's sentiment 10% toward zero (hype fades),
 *   2. snapshot today's price (what every chart reads),
 *   3. alert watchers/holders about ±10% day moves,
 *   4. once a month (or when stale), re-pull Stripe-verified MRR — the
 *      automatic earnings report — and notify holders of the beat/miss,
 *   5. snapshot every player's portfolio value for PnL history.
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
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  let snapshotted = 0;
  let moveAlerts = 0;

  // ── 4. monthly Stripe re-sync (before snapshotting, so today's price
  //       already reflects the fresh number) ────────────────────────────────
  let stripeSynced = 0;
  if (stripeVerificationConfigured()) {
    try {
      const { data: connections } = await admin
        .from("stripe_connections")
        .select("*")
        .eq("status", "active");
      const staleBefore = Date.now() - 28 * 86400_000;
      const isFirstOfMonth = new Date().getUTCDate() === 1;
      for (const conn of connections ?? []) {
        const lastSynced = conn.last_synced_at
          ? new Date(conn.last_synced_at).getTime()
          : 0;
        if (!isFirstOfMonth && lastSynced > staleBefore) continue;
        const ticker = tickers.find((t) => t.id === conn.ticker_id);
        if (!ticker) continue;
        try {
          const mrr = await computeMrrFromStripe(
            decryptStripeKey(conn.encrypted_key)
          );
          const prev = latestMrr.get(ticker.id);
          await admin.from("mrr_updates").upsert(
            {
              ticker_id: ticker.id,
              month: currentMonthISO(),
              mrr,
              source: "stripe",
            },
            { onConflict: "ticker_id,month" }
          );
          await admin
            .from("stripe_connections")
            .update({ last_synced_at: new Date().toISOString(), last_mrr: mrr })
            .eq("ticker_id", ticker.id);
          latestMrr.set(ticker.id, mrr);
          stripeSynced++;

          const audience = await audienceForTicker(ticker.id);
          const delta =
            prev && prev > 0 ? ` (${fmtPct(changeFraction(prev, mrr))} MoM)` : "";
          await notifyUsers(
            audience,
            "mrr",
            `$${ticker.symbol} reported ${fmtCompact(mrr)} MRR${delta} — Stripe-verified`,
            ticker.id
          );
        } catch {
          await admin
            .from("stripe_connections")
            .update({ status: "error" })
            .eq("ticker_id", conn.ticker_id);
          await notifyUsers(
            [conn.connected_by],
            "system",
            `Stripe sync failed for $${ticker.symbol} — reconnect it from the ticker page.`,
            ticker.id
          );
        }
      }
    } catch {
      // stripe_connections missing pre-migration — skip
    }
  }

  // ── 1–3. decay, snapshot, move alerts ─────────────────────────────────────
  for (const ticker of tickers) {
    const mrr = latestMrr.get(ticker.id) ?? 0;
    const sentiment = decaySentiment(Number(ticker.sentiment));

    const { error: updateErr } = await admin
      .from("tickers")
      .update({ sentiment })
      .eq("id", ticker.id);
    if (updateErr) continue;

    const price = livePrice(mrr, sentiment);
    const { error: snapErr } = await admin.from("price_snapshots").upsert(
      {
        ticker_id: ticker.id,
        day: today,
        price,
        fair_price: fairPrice(mrr),
        sentiment,
        mrr,
      },
      { onConflict: "ticker_id,day" }
    );
    if (!snapErr) snapshotted++;

    const { data: prevSnap } = await admin
      .from("price_snapshots")
      .select("price")
      .eq("ticker_id", ticker.id)
      .eq("day", yesterday)
      .maybeSingle();
    if (prevSnap) {
      const change = changeFraction(Number(prevSnap.price), price);
      if (Math.abs(change) >= MOVE_ALERT_THRESHOLD) {
        const audience = await audienceForTicker(ticker.id);
        await notifyUsers(
          audience,
          "move",
          `$${ticker.symbol} ${fmtPct(change)} today`,
          ticker.id
        );
        moveAlerts++;
      }
    }
  }

  // ── 5. portfolio value history ────────────────────────────────────────────
  let portfoliosSnapshotted = 0;
  try {
    const valuations = await getAllValuations();
    if (valuations.length > 0) {
      const { error } = await admin.from("portfolio_snapshots").upsert(
        valuations.map((v) => ({
          user_id: v.profile.id,
          day: today,
          total_value: Number(v.totalValue.toFixed(2)),
          cash: Number(Number(v.profile.cash).toFixed(2)),
          holdings_value: Number(v.holdingsValue.toFixed(2)),
        })),
        { onConflict: "user_id,day" }
      );
      if (!error) portfoliosSnapshotted = valuations.length;
    }
  } catch {
    // table missing pre-migration — skip
  }

  return NextResponse.json({
    ok: true,
    tickers: tickers.length,
    snapshotted,
    moveAlerts,
    stripeSynced,
    portfoliosSnapshotted,
  });
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyTrade, livePrice, type TradeSide } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade { symbol, side: "buy" | "sell", shares }
 *
 * Price and sentiment are computed here via lib/pricing.ts (never in SQL),
 * then the ledger moves atomically inside the execute_trade function.
 * You trade at the CURRENT price; your trade moves sentiment for the next one.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to trade." }, { status: 401 });
  }

  let body: { symbol?: string; side?: string; shares?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const side = body.side as TradeSide;
  const shares = Number(body.shares);
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (
    !symbol ||
    (side !== "buy" && side !== "sell") ||
    !Number.isInteger(shares) ||
    shares <= 0 ||
    shares > 1_000_000
  ) {
    return NextResponse.json({ error: "Invalid trade." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, sentiment")
    .eq("symbol", symbol)
    .maybeSingle();
  if (!ticker) {
    return NextResponse.json({ error: "Unknown ticker." }, { status: 404 });
  }

  const { data: latest } = await admin
    .from("mrr_updates")
    .select("mrr")
    .eq("ticker_id", ticker.id)
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  const mrr = Number(latest?.mrr ?? 0);

  const price = livePrice(mrr, Number(ticker.sentiment));
  if (price <= 0) {
    return NextResponse.json(
      { error: "This ticker has no MRR on record yet — it can't trade." },
      { status: 400 }
    );
  }
  const newSentiment = applyTrade(Number(ticker.sentiment), side, shares);

  const { data, error } = await admin.rpc("execute_trade", {
    p_user_id: user.id,
    p_ticker_id: ticker.id,
    p_side: side,
    p_shares: shares,
    p_price: price,
    p_new_sentiment: newSentiment,
  });

  if (error) {
    const msg = error.message.includes("insufficient cash")
      ? "Not enough play money."
      : error.message.includes("insufficient shares")
        ? "You don't hold that many shares."
        : "Trade failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true, price, cash: data?.cash });
}

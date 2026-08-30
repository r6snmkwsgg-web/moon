import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  executionFillAt,
  SHARES_OUTSTANDING,
  type TradeSide,
} from "@/lib/pricing";
import { recordTickerSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade { symbol, side: "buy" | "sell", shares }
 *
 * Fills use executionFill from lib/pricing.ts (never SQL): the order walks
 * the sentiment curve, so big buys pay progressively more and big sells
 * receive progressively less — and a pump-then-dump round trip nets zero.
 * The ledger then moves atomically inside the execute_trade function.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to trade." }, { status: 401 });
  }

  let body: {
    symbol?: string;
    side?: string;
    shares?: number;
    note?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const side = body.side as TradeSide;
  const shares = Number(body.shares);
  const symbol = String(body.symbol ?? "").toUpperCase();
  const note = String(body.note ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
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

  // The float is finite: 10,000 shares exist per ticker, full stop. A buy
  // can't take total held past that. (Positions from before this rule are
  // grandfathered — they only ever shrink.)
  if (side === "buy") {
    const { data: heldRows } = await admin
      .from("holdings")
      .select("shares")
      .eq("ticker_id", ticker.id);
    const held = ((heldRows ?? []) as { shares: number }[]).reduce(
      (sum, h) => sum + Number(h.shares),
      0
    );
    const available = Math.max(0, SHARES_OUTSTANDING - held);
    if (shares > available) {
      return NextResponse.json(
        {
          error:
            available > 0
              ? `Only ${available.toLocaleString("en-US")} shares left in the float.`
              : "The float is fully held — someone has to sell first.",
        },
        { status: 400 }
      );
    }
  }

  // fill at the flow price — the same number the tape is showing right now
  const fill = executionFillAt(symbol, mrr, Number(ticker.sentiment), side, shares);
  if (fill.avgPrice <= 0) {
    return NextResponse.json(
      { error: "This ticker has no MRR on record yet — it can't trade." },
      { status: 400 }
    );
  }

  const { data, error } = await admin.rpc("execute_trade", {
    p_user_id: user.id,
    p_ticker_id: ticker.id,
    p_side: side,
    p_shares: shares,
    p_price: Number(fill.avgPrice.toFixed(6)),
    p_new_sentiment: fill.newSentiment,
  });

  if (error) {
    const msg = error.message.includes("insufficient cash")
      ? "Not enough play money."
      : error.message.includes("insufficient shares")
        ? "You don't hold that many shares."
        : "Trade failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // keep today's snapshot current so charts include this print's aftermath
  await recordTickerSnapshot(admin, ticker.id, {
    mrr,
    sentiment: fill.newSentiment,
  });

  // attach the public rationale to the print (0003; skipped pre-migration)
  if (note) {
    try {
      const { data: latest } = await admin
        .from("trades")
        .select("id")
        .eq("user_id", user.id)
        .eq("ticker_id", ticker.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        await admin.from("trades").update({ note }).eq("id", latest.id);
      }
    } catch {
      // note column missing pre-migration — the trade itself already landed
    }
  }

  // a real print from someone you follow is news — alert followers on size
  if (fill.total >= 500) {
    try {
      const [{ data: followers }, { data: me }] = await Promise.all([
        admin.from("follows").select("follower_id").eq("followee_id", user.id),
        admin
          .from("profiles")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
      const ids = ((followers ?? []) as { follower_id: string }[]).map(
        (f) => f.follower_id
      );
      if (ids.length > 0) {
        const { notifyUsers } = await import("@/lib/notify");
        await notifyUsers(
          ids,
          "move",
          `${me?.display_name ?? "Someone you follow"} ${side === "buy" ? "bought" : "sold"} ${shares.toLocaleString("en-US")} $${symbol} (~$${Math.round(fill.total).toLocaleString("en-US")})`
        );
      }
    } catch {
      // follows table missing pre-migration
    }
  }

  return NextResponse.json({
    ok: true,
    price: fill.avgPrice,
    total: fill.total,
    cash: data?.cash,
  });
}

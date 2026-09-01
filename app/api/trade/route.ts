import { after, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  executionFillAt,
  floatOf,
  MAX_POSITION_FRACTION,
  positionLimit,
  valuationMultiple,
  type TradeSide,
} from "@/lib/pricing";
import { recordTickerSnapshot } from "@/lib/snapshot";
import { getRevenueEvents } from "@/lib/pulse";
import { anchorRevenue } from "@/lib/revenue";

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
    .select("*")
    .eq("symbol", symbol)
    .maybeSingle();
  if (!ticker) {
    return NextResponse.json({ error: "Unknown ticker." }, { status: 404 });
  }

  // the whole revenue record, because the multiple is earned by durability —
  // fetched alongside the float check, since neither needs the other
  const [{ data: revenue }, { data: heldRows }, { data: conn }, events, dailyRes] =
    await Promise.all([
      admin
        .from("mrr_updates")
        .select("month, mrr")
        .eq("ticker_id", ticker.id)
        .order("month", { ascending: true }),
      side === "buy"
        ? admin
            .from("holdings")
            .select("user_id, shares")
            .eq("ticker_id", ticker.id)
        : Promise.resolve({
            data: [] as { user_id: string; shares: number }[],
          }),
      // what Stripe said in the last five minutes, and the changes behind it
      admin
        .from("stripe_connections")
        .select("*")
        .eq("ticker_id", ticker.id)
        .maybeSingle(),
      getRevenueEvents(admin, ticker.id, 12 * 3600_000),
      // the takings the QUOTE anchors on (lib/data buildQuote). Absent
      // pre-0008 or without charge scope, in which case the anchor falls
      // back to subscriptions exactly as the quote does.
      admin
        .from("daily_revenue")
        .select("day, net_minor")
        .eq("ticker_id", ticker.id)
        .gte(
          "day",
          new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)
        )
        .order("day", { ascending: true })
        .limit(400),
    ]);
  const outstanding = floatOf(
    (ticker as { shares_outstanding?: number }).shares_outstanding
  );
  const history = ((revenue ?? []) as { month: string; mrr: number }[]).map(
    (r) => ({ month: r.month, mrr: Number(r.mrr) })
  );
  const reportedMrr = history.length ? history[history.length - 1].mrr : 0;
  // Fills price off the SAME anchor as the quote the trader saw — one
  // function, lib/revenue anchorRevenue, decides what the business makes.
  // This used to read live_mrr straight off the connection, which agreed
  // with the tape only while the payments anchor was empty; the first day
  // the run rate took over, every fill would have quietly priced off
  // subscriptions while the chart traded on takings.
  const stripeMrr = (conn as { live_mrr?: number | null } | null)?.live_mrr;
  const anchor = anchorRevenue({
    daily: ((dailyRes.data ?? []) as { day: string; net_minor: number }[]).map(
      (r) => ({ day: r.day, amount: Number(r.net_minor) / 100 })
    ),
    stripeMrr: stripeMrr === null || stripeMrr === undefined ? null : Number(stripeMrr),
    reportedMrr,
  });
  const mrr = anchor.monthly;
  const multiple = valuationMultiple(history);

  // Two limits, both enforced here and not just in the UI:
  //   the float is finite — no more shares exist than the ticker issued;
  //   no single account may corner it (MAX_POSITION_FRACTION of the float).
  // Positions from before these rules are grandfathered: they only shrink.
  if (side === "buy") {
    const rows = (heldRows ?? []) as { user_id: string; shares: number }[];
    const held = rows.reduce((sum, h) => sum + Number(h.shares), 0);
    const mine = rows
      .filter((h) => h.user_id === user.id)
      .reduce((sum, h) => sum + Number(h.shares), 0);

    const available = Math.max(0, outstanding - held);
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

    const limit = positionLimit(outstanding);
    const room = Math.max(0, limit - mine);
    if (shares > room) {
      const pct = Math.round(MAX_POSITION_FRACTION * 100);
      return NextResponse.json(
        {
          error:
            room > 0
              ? `Position limit: one account can hold ${pct}% of the float (${limit.toLocaleString("en-US")} shs). You can buy ${room.toLocaleString("en-US")} more.`
              : `You're at the position limit — ${pct}% of the float (${limit.toLocaleString("en-US")} shs).`,
        },
        { status: 400 }
      );
    }
  }

  // Fill at the SETTLED price: the anchor, the recorded weather and any live
  // news, but not the sub-percent shimmer the tape draws on top. The shimmer
  // is a function of the clock, so a client could time it; leaving it out of
  // the fill is what makes timing it worth nothing.
  const fill = executionFillAt(
    symbol,
    mrr,
    Number(ticker.sentiment),
    side,
    shares,
    Date.now(),
    multiple,
    outstanding,
    events,
    Number(ticker.drift ?? 0)
  );
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

  // Everything below is bookkeeping the trader shouldn't wait on: it runs
  // after the response is flushed, which is most of the fill latency.
  after(async () => {
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
  });

  return NextResponse.json({
    ok: true,
    price: fill.avgPrice,
    total: fill.total,
    cash: data?.cash,
  });
}

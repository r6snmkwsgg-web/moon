/**
 * lib/trade.ts — one door for every order.
 *
 * Humans come through /api/trade, the AI traders through the five-minute
 * cron, and both end up here: the same anchor the quote uses, the same fill
 * curve, the same float and position limits, the same ledger function. The
 * route used to hold all of this inline; a second caller would have meant a
 * second copy of the rules, and two copies of a rule is one rule and a bug.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  executionFillAt,
  floatOf,
  MAX_POSITION_FRACTION,
  positionLimit,
  roundShares,
  valuationMultiple,
  type TradeSide,
} from "@/lib/pricing";
import { anchorRevenue } from "@/lib/revenue";
import { recordTickerSnapshot } from "@/lib/snapshot";
import { getRevenueEvents, latestEventMrr } from "@/lib/pulse";

export interface OrderInput {
  userId: string;
  symbol: string;
  side: TradeSide;
  shares: number;
  /** The public thesis, up to 140 characters. */
  note?: string;
}

export type OrderResult =
  | {
      ok: true;
      price: number;
      total: number;
      cash: number | null;
      newSentiment: number;
      /**
       * Bookkeeping the trader should not wait on: the snapshot, the note,
       * follower alerts. The route runs it after the response is flushed;
       * the bots simply await it.
       */
      settle: () => Promise<void>;
    }
  | { ok: false; error: string; status: number };

/**
 * How many times an order re-reads the curve when someone else moved it
 * between our read and our claim. Three collisions in a row on one ticker
 * inside a few milliseconds is not a race, it is a flood; the order is
 * turned away and the trader tries again.
 */
const CLAIM_ATTEMPTS = 3;
/** Numeric equality for the claim, wide enough to survive a JSON round trip. */
const CLAIM_EPS = 1e-9;

export async function placeOrder(
  admin: SupabaseClient,
  input: OrderInput,
  opts: { now?: number } = {}
): Promise<OrderResult> {
  for (let attempt = 1; ; attempt++) {
    const r = await placeOrderOnce(admin, input, opts);
    if (r !== "moved") return r;
    if (attempt >= CLAIM_ATTEMPTS) {
      return {
        ok: false,
        status: 409,
        error: "The price moved under your order — try again.",
      };
    }
  }
}

async function placeOrderOnce(
  admin: SupabaseClient,
  input: OrderInput,
  opts: { now?: number } = {}
): Promise<OrderResult | "moved"> {
  const now = opts.now ?? Date.now();
  const side = input.side;
  // to four places — a share is bought in pieces
  const shares = roundShares(Number(input.shares));
  const symbol = String(input.symbol ?? "").toUpperCase();
  const note = String(input.note ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  if (
    !symbol ||
    (side !== "buy" && side !== "sell") ||
    !(shares > 0) ||
    shares > 1_000_000
  ) {
    return { ok: false, error: "Invalid trade.", status: 400 };
  }

  const { data: ticker } = await admin
    .from("tickers")
    .select("*")
    .eq("symbol", symbol)
    .maybeSingle();
  if (!ticker) return { ok: false, error: "Unknown ticker.", status: 404 };

  // the whole revenue record, because the multiple is earned by durability —
  // fetched alongside the float check, since neither needs the other
  const [
    { data: revenue },
    { data: heldRows },
    { data: conn },
    events,
    dailyRes,
    latest,
  ] = await Promise.all([
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
      .gte("day", new Date(now - 120 * 86_400_000).toISOString().slice(0, 10))
      .order("day", { ascending: true })
      .limit(400),
    latestEventMrr(admin, ticker.id),
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
  // The live number is the connection's, else the newest event's (a demo
  // listing's pulse), else the last report.
  const stripeMrr = (conn as { live_mrr?: number | null } | null)?.live_mrr;
  const anchor = anchorRevenue({
    daily: ((dailyRes.data ?? []) as { day: string; net_minor: number }[]).map(
      (r) => ({ day: r.day, amount: Number(r.net_minor) / 100 })
    ),
    stripeMrr:
      stripeMrr === null || stripeMrr === undefined
        ? (latest.get(ticker.id)?.mrr ?? null)
        : Number(stripeMrr),
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
      .filter((h) => h.user_id === input.userId)
      .reduce((sum, h) => sum + Number(h.shares), 0);

    const available = Math.max(0, outstanding - held);
    if (shares > available) {
      return {
        ok: false,
        status: 400,
        error:
          available > 0
            ? `Only ${available.toLocaleString("en-US")} shares left in the float.`
            : "The float is fully held — someone has to sell first.",
      };
    }

    const limit = positionLimit(outstanding);
    const room = Math.max(0, limit - mine);
    if (shares > room) {
      const pct = Math.round(MAX_POSITION_FRACTION * 100);
      return {
        ok: false,
        status: 400,
        error:
          room > 0
            ? `Position limit: one account can hold ${pct}% of the float (${limit.toLocaleString("en-US")} shs). You can buy ${room.toLocaleString("en-US")} more.`
            : `You're at the position limit — ${pct}% of the float (${limit.toLocaleString("en-US")} shs).`,
      };
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
    now,
    multiple,
    outstanding,
    events,
    Number(ticker.drift ?? 0)
  );
  if (fill.avgPrice <= 0) {
    return {
      ok: false,
      status: 400,
      error: "This ticker has no MRR on record yet — it can't trade.",
    };
  }
  // the ledger books totals to the cent; an order worth less than one would
  // round to free stock
  if (fill.total < 0.01) {
    return { ok: false, status: 400, error: "That's less than a cent — size up a little." };
  }

  // CLAIM THE CURVE before the ledger moves. The fill above was priced off
  // the sentiment we read; if anyone — a person, a bot in the same second —
  // moved it since, this order would fill off a stale curve and its own
  // impact would overwrite theirs (execute_trade sets sentiment to the value
  // it is handed). So the move from s0 to s1 is a compare-and-set: it lands
  // only if the curve still reads s0, and otherwise the whole order is
  // re-read and re-priced. Concurrent orders on one ticker serialise on this
  // line, each filling off the curve the one before it left.
  const s0 = Number(ticker.sentiment);
  // the float is part of the claim too: a split landing between the read
  // and here would leave this order sized in the old unit
  let claim = admin
    .from("tickers")
    .update({ sentiment: fill.newSentiment })
    .eq("id", ticker.id)
    .gte("sentiment", s0 - CLAIM_EPS)
    .lte("sentiment", s0 + CLAIM_EPS);
  if (ticker.shares_outstanding !== null && ticker.shares_outstanding !== undefined) {
    claim = claim.eq("shares_outstanding", ticker.shares_outstanding);
  }
  const { data: claimed, error: claimErr } = await claim.select("id");
  if (claimErr) return { ok: false, error: "Trade failed.", status: 500 };
  if (!claimed || claimed.length === 0) return "moved";

  const { data, error } = await admin.rpc("execute_trade", {
    p_user_id: input.userId,
    p_ticker_id: ticker.id,
    p_side: side,
    p_shares: shares,
    p_price: Number(fill.avgPrice.toFixed(6)),
    p_new_sentiment: fill.newSentiment,
  });
  if (error) {
    // the ledger refused — give the curve back, unless someone has already
    // moved on from where we left it
    await admin
      .from("tickers")
      .update({ sentiment: s0 })
      .eq("id", ticker.id)
      .gte("sentiment", fill.newSentiment - CLAIM_EPS)
      .lte("sentiment", fill.newSentiment + CLAIM_EPS);
    const msg = error.message.includes("insufficient cash")
      ? "Not enough play money."
      : error.message.includes("insufficient shares")
        ? "You don't hold that many shares."
        : error.message.includes("whole number")
          ? "Whole shares only until the exchange's next update — try a round number."
          : error.message.includes("too small")
            ? "That's less than a cent — size up a little."
            : "Trade failed.";
    return { ok: false, error: msg, status: 400 };
  }

  // The thesis goes on the print BEFORE the response, not in the deferred
  // bookkeeping: it is one small update, and a page refreshed the moment the
  // fill lands has to show it. (Deferred, it depended on the after-response
  // hook actually running, and a thesis that never appeared is exactly what
  // that looks like from the outside.)
  if (note) {
    try {
      const { data: latestTrade } = await admin
        .from("trades")
        .select("id")
        .eq("user_id", input.userId)
        .eq("ticker_id", ticker.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestTrade) {
        await admin.from("trades").update({ note }).eq("id", latestTrade.id);
      }
    } catch {
      // note column missing pre-migration — the trade itself already landed
    }
  }

  const settle = async () => {
    // keep today's snapshot current so charts include this print's aftermath
    await recordTickerSnapshot(admin, ticker.id, {
      mrr,
      sentiment: fill.newSentiment,
    });

    // a real print from someone you follow is news — alert followers on size
    if (fill.total >= 500) {
      try {
        const [{ data: followers }, { data: me }] = await Promise.all([
          admin
            .from("follows")
            .select("follower_id")
            .eq("followee_id", input.userId),
          admin
            .from("profiles")
            .select("display_name")
            .eq("id", input.userId)
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
  };

  return {
    ok: true,
    price: fill.avgPrice,
    total: fill.total,
    cash: (data as { cash?: number } | null)?.cash ?? null,
    newSentiment: fill.newSentiment,
    settle,
  };
}

import { after, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { placeOrder } from "@/lib/trade";
import type { TradeSide } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade { symbol, side: "buy" | "sell", shares, note? }
 *
 * The rules live in lib/trade placeOrder — the same door the AI traders use.
 * This route only establishes who is asking.
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

  const result = await placeOrder(createSupabaseAdminClient(), {
    userId: user.id,
    symbol: String(body.symbol ?? ""),
    side: body.side as TradeSide,
    shares: Number(body.shares),
    note: body.note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Everything the trader shouldn't wait on runs after the response is
  // flushed, which is most of the fill latency.
  after(result.settle);

  return NextResponse.json({
    ok: true,
    shares: result.shares,
    price: result.price,
    total: result.total,
    cash: result.cash,
    // the curve after this fill — the page moves the chart on it at once
    sentiment: result.newSentiment,
  });
}

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pollRevenuePulse, PULSE_INTERVAL_MS } from "@/lib/pulse";
import { advanceMarketFlow } from "@/lib/flow";
import { stripeVerificationConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/pulse { symbol } — refresh one ticker's revenue if it is stale.
 *
 * It also advances the drift walk, so a page someone is actually looking at
 * keeps the tape moving even if the scheduler is down. That is safe to expose
 * for the same reason the revenue poll is: both are rate-limited per ticker in
 * the DATABASE (five minutes, against live_synced_at and tickers.drift_at), so
 * hammering this returns early and cannot spin the market faster than the
 * clock — the walk advances once per elapsed interval no matter who asks.
 */
export async function POST(request: Request) {
  let symbol = "";
  try {
    symbol = String(((await request.json()) as { symbol?: string }).symbol ?? "")
      .toUpperCase()
      .slice(0, 6);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!/^[A-Z]{2,6}$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id")
    .eq("symbol", symbol)
    .maybeSingle();
  if (!ticker) return NextResponse.json({ error: "Unknown ticker." }, { status: 404 });

  const flow = await advanceMarketFlow(admin);
  if (!stripeVerificationConfigured()) {
    return NextResponse.json({ ok: true, advanced: flow.advanced, every: PULSE_INTERVAL_MS });
  }
  const result = await pollRevenuePulse(admin, { tickerId: ticker.id });
  return NextResponse.json({
    ok: true,
    checked: result.checked,
    changed: result.changed,
    advanced: flow.advanced,
    every: PULSE_INTERVAL_MS,
  });
}

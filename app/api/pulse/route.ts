import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pollRevenuePulse, PULSE_INTERVAL_MS } from "@/lib/pulse";
import { stripeVerificationConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/pulse { symbol } — refresh one ticker's revenue if it is stale.
 *
 * Open on purpose: the poll it triggers is rate-limited per ticker inside
 * pollRevenuePulse (five minutes, checked against live_synced_at in the
 * database), so hammering this does nothing but return early. It exists so a
 * ticker page someone is watching stays live even without a scheduler.
 */
export async function POST(request: Request) {
  if (!stripeVerificationConfigured()) {
    return NextResponse.json({ ok: true, skipped: true });
  }
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

  const result = await pollRevenuePulse(admin, { tickerId: ticker.id });
  return NextResponse.json({
    ok: true,
    checked: result.checked,
    changed: result.changed,
    every: PULSE_INTERVAL_MS,
  });
}

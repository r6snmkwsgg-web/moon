import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pollRevenuePulse } from "@/lib/pulse";
import { stripeVerificationConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The five-minute poll: read every connected Stripe account and record what
 * changed. Prices move on it immediately; the monthly earnings report (in
 * /api/cron/daily) is untouched.
 *
 * Vercel's Hobby plan only schedules daily crons, so this endpoint takes the
 * same "Authorization: Bearer ${CRON_SECRET}" any scheduler can send — give
 * it a five-minute cron in vercel.json on Pro, or point cron-job.org or a
 * GitHub Action at it. Between polls the ticker page nudges /api/pulse, so a
 * page anyone is actually looking at stays fresh either way.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!stripeVerificationConfigured()) {
    return NextResponse.json({ ok: true, skipped: "stripe not configured" });
  }
  const result = await pollRevenuePulse(createSupabaseAdminClient(), {
    force: true,
  });
  return NextResponse.json({ ok: true, ...result });
}

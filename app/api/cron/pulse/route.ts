import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pollRevenuePulse } from "@/lib/pulse";
import { advanceMarketFlow } from "@/lib/flow";
import { stripeVerificationConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The five-minute poll. Two jobs:
 *
 *   1. advance every ticker's drift walk one tick and write it down. This is
 *      the market's heartbeat — the weather is a record now, not a formula,
 *      so if this never runs the tape simply stops moving.
 *   2. read every connected Stripe account and record what changed. Prices
 *      move on it immediately; the monthly earnings report (in
 *      /api/cron/daily) is untouched.
 *
 * The walk runs whether or not Stripe is configured: a board of fixtures
 * still has to breathe.
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
  const admin = createSupabaseAdminClient();
  const flow = await advanceMarketFlow(admin);
  if (!stripeVerificationConfigured()) {
    return NextResponse.json({ ok: true, flow, skipped: "stripe not configured" });
  }
  const result = await pollRevenuePulse(admin, { force: true });
  return NextResponse.json({ ok: true, flow, ...result });
}

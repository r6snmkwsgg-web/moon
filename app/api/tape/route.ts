import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRecentTrades } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * GET /api/tape?ticker=<id>&since=<iso>
 *
 * The prints on one name since an instant, newest first, and the curve as
 * it stands now — what an open page polls every few seconds so the tape
 * fills in as the market prints rather than on the next refresh. Public
 * data only: the tape is public, and so is the curve.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker") ?? "";
  const since = url.searchParams.get("since");
  if (!/^[0-9a-f-]{36}$/i.test(ticker)) {
    return NextResponse.json({ error: "ticker" }, { status: 400 });
  }
  const sinceIso = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null;
  const admin = createSupabaseAdminClient();
  const [trades, { data: row }] = await Promise.all([
    getRecentTrades(40, ticker, undefined, false, null, null, sinceIso),
    admin.from("tickers").select("sentiment, shares_outstanding").eq("id", ticker).maybeSingle(),
  ]);
  return NextResponse.json(
    {
      trades,
      sentiment: row ? Number(row.sentiment) : null,
      shares: row?.shares_outstanding ?? null,
      at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

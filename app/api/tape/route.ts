import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRecentTrades, getTickerPosts } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * GET /api/tape?ticker=<id>&since=<iso>
 * GET /api/tape?ticker=<id>&kind=trades|theses|posts&before=<iso>&limit=60&min=1000&price=12.5
 *
 * The first form is the open page's poll: the prints on one name since an
 * instant, newest first, and the curve as it stands now. The second pages
 * back through the floor — the tape, the theses written on prints, or the
 * posts — from an instant, so scrolling the floor reaches the first print
 * on the name. Public data only: the tape is public, and so is the curve.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker") ?? "";
  const since = url.searchParams.get("since");
  const before = url.searchParams.get("before");
  const kind = url.searchParams.get("kind") ?? "trades";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || (before ? 60 : 40)));
  const min = Number(url.searchParams.get("min")) || null;
  const price = Number(url.searchParams.get("price")) || 0;
  if (!/^[0-9a-f-]{36}$/i.test(ticker)) {
    return NextResponse.json({ error: "ticker" }, { status: 400 });
  }
  const iso = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  const sinceIso = iso(since);
  const beforeIso = iso(before);
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (kind === "posts") {
    const posts = await getTickerPosts(ticker, price, limit, null, beforeIso);
    return NextResponse.json({ posts, at: new Date().toISOString() }, noStore);
  }

  const admin = createSupabaseAdminClient();
  const [trades, { data: row }] = await Promise.all([
    getRecentTrades(limit, ticker, undefined, kind === "theses", null, min, sinceIso, beforeIso),
    // the curve rides along with the poll only
    beforeIso
      ? Promise.resolve({ data: null })
      : admin.from("tickers").select("sentiment, shares_outstanding").eq("id", ticker).maybeSingle(),
  ]);
  return NextResponse.json(
    {
      trades,
      sentiment: row ? Number(row.sentiment) : null,
      shares: row?.shares_outstanding ?? null,
      at: new Date().toISOString(),
    },
    noStore
  );
}

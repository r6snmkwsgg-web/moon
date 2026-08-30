import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/symbol-check?s=PRLA → { valid, available } (tickers are public read). */
export async function GET(request: Request) {
  const s = new URL(request.url).searchParams.get("s")?.toUpperCase().trim() ?? "";
  const valid = /^[A-Z]{2,6}$/.test(s);
  if (!valid) return NextResponse.json({ valid: false, available: false });

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("tickers")
    .select("id")
    .eq("symbol", s)
    .maybeSingle();
  return NextResponse.json({ valid: true, available: !data });
}

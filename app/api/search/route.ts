import { NextResponse } from "next/server";
import { getMarket } from "@/lib/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export interface SearchTicker {
  symbol: string;
  name: string;
  pitch: string;
  logo_url: string | null;
  price: number;
  dayChange: number;
  verified: boolean;
}

export interface SearchTrader {
  username: string;
  display_name: string;
}

/**
 * GET /api/search?q=  → tickers + traders matching the query.
 * Tickers are public; trader lookup crosses profile rows, so it runs with
 * the service role and returns nothing but the public handle and name.
 */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "")
    .trim()
    .slice(0, 40);
  if (q.length < 1) {
    return NextResponse.json({ tickers: [], traders: [] });
  }
  const needle = q.toLowerCase().replace(/^[$@]/, "");

  const market = await getMarket();
  const tickers: SearchTicker[] = market
    .map((quote) => {
      const t = quote.ticker;
      const symbol = t.symbol.toLowerCase();
      const name = t.name.toLowerCase();
      // rank: exact symbol > symbol prefix > name prefix > any substring
      let score = -1;
      if (symbol === needle) score = 0;
      else if (symbol.startsWith(needle)) score = 1;
      else if (name.startsWith(needle)) score = 2;
      else if (symbol.includes(needle) || name.includes(needle)) score = 3;
      else if (t.pitch.toLowerCase().includes(needle)) score = 4;
      return { quote, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || b.quote.marketCap - a.quote.marketCap)
    .slice(0, 6)
    .map(({ quote }) => ({
      symbol: quote.ticker.symbol,
      name: quote.ticker.name,
      pitch: quote.ticker.pitch,
      logo_url: quote.ticker.logo_url,
      price: quote.price,
      dayChange: quote.dayChange,
      verified: Boolean(quote.ticker.stripe_verified),
    }));

  let traders: SearchTrader[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("username, display_name")
      .or(`username.ilike.%${needle}%,display_name.ilike.%${needle}%`)
      .limit(4);
    traders = ((data ?? []) as SearchTrader[]).filter((t) => t.username);
  } catch {
    // profile columns missing pre-migration — tickers still search fine
  }

  return NextResponse.json({ tickers, traders });
}

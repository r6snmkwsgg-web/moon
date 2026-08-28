import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  changeFraction,
  fairPrice,
  livePrice,
  marketCap,
} from "@/lib/pricing";
import { STARTING_CASH } from "@/lib/config";
import type {
  Holding,
  MrrUpdate,
  PriceSnapshot,
  Profile,
  Ticker,
  TickerQuote,
} from "@/lib/types";

const SPARK_DAYS = 30;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Latest MRR per ticker from a list of updates sorted month-ascending. */
function latestMrrByTicker(updates: MrrUpdate[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const u of updates) map.set(u.ticker_id, Number(u.mrr)); // sorted asc → last wins
  return map;
}

function buildQuote(
  ticker: Ticker,
  latestMrr: number,
  snaps: PriceSnapshot[] // this ticker's snapshots, day ascending
): TickerQuote {
  const sentiment = Number(ticker.sentiment);
  const price = livePrice(latestMrr, sentiment);
  const spark = snaps.map((s) => Number(s.price));

  // Change vs. the snapshot closest to 1 / 7 days ago.
  const dayAgo = isoDaysAgo(1);
  const weekAgo = isoDaysAgo(7);
  const atOrBefore = (day: string) => {
    let found: PriceSnapshot | undefined;
    for (const s of snaps) {
      if (s.day <= day) found = s;
      else break;
    }
    return found ?? snaps[0];
  };
  const dayBase = atOrBefore(dayAgo);
  const weekBase = atOrBefore(weekAgo);

  return {
    ticker,
    latestMrr,
    price,
    fairPrice: fairPrice(latestMrr),
    marketCap: marketCap(latestMrr, sentiment),
    dayChange: dayBase ? changeFraction(Number(dayBase.price), price) : 0,
    weekChange: weekBase ? changeFraction(Number(weekBase.price), price) : 0,
    spark: [...spark, price], // live price as the final point
  };
}

/** Everything the exchange front page needs, sorted by market cap desc. */
export async function getMarket(): Promise<TickerQuote[]> {
  const supabase = await createSupabaseServerClient();

  const [tickersRes, mrrRes, snapsRes] = await Promise.all([
    supabase.from("tickers").select("*"),
    supabase.from("mrr_updates").select("*").order("month", { ascending: true }),
    supabase
      .from("price_snapshots")
      .select("*")
      .gte("day", isoDaysAgo(SPARK_DAYS))
      .order("day", { ascending: true }),
  ]);

  const tickers = (tickersRes.data ?? []) as Ticker[];
  const mrrMap = latestMrrByTicker((mrrRes.data ?? []) as MrrUpdate[]);

  const snapsByTicker = new Map<string, PriceSnapshot[]>();
  for (const s of (snapsRes.data ?? []) as PriceSnapshot[]) {
    const list = snapsByTicker.get(s.ticker_id) ?? [];
    list.push(s);
    snapsByTicker.set(s.ticker_id, list);
  }

  return tickers
    .map((t) =>
      buildQuote(t, mrrMap.get(t.id) ?? 0, snapsByTicker.get(t.id) ?? [])
    )
    .sort((a, b) => b.marketCap - a.marketCap);
}

/** One ticker page's worth of data. */
export async function getTickerPage(symbol: string): Promise<{
  quote: TickerQuote;
  mrrHistory: MrrUpdate[];
  snapshots: PriceSnapshot[];
  holdersCount: number;
} | null> {
  const supabase = await createSupabaseServerClient();

  const { data: ticker } = await supabase
    .from("tickers")
    .select("*")
    .ilike("symbol", symbol)
    .maybeSingle();
  if (!ticker) return null;

  const [mrrRes, snapsRes] = await Promise.all([
    supabase
      .from("mrr_updates")
      .select("*")
      .eq("ticker_id", ticker.id)
      .order("month", { ascending: true }),
    supabase
      .from("price_snapshots")
      .select("*")
      .eq("ticker_id", ticker.id)
      .order("day", { ascending: true }),
  ]);

  const mrrHistory = (mrrRes.data ?? []) as MrrUpdate[];
  const snapshots = (snapsRes.data ?? []) as PriceSnapshot[];
  const latestMrr = mrrHistory.length
    ? Number(mrrHistory[mrrHistory.length - 1].mrr)
    : 0;

  // Holders count crosses user rows, so it runs with the service role.
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("holdings")
    .select("*", { count: "exact", head: true })
    .eq("ticker_id", ticker.id)
    .gt("shares", 0);

  return {
    quote: buildQuote(
      ticker as Ticker,
      latestMrr,
      snapshots.filter((s) => s.day >= isoDaysAgo(SPARK_DAYS))
    ),
    mrrHistory,
    snapshots,
    holdersCount: count ?? 0,
  };
}

export interface PortfolioValuation {
  profile: Profile;
  positions: {
    quote: TickerQuote;
    holding: Holding;
    value: number;
    pnl: number; // vs. avg cost
  }[];
  holdingsValue: number;
  totalValue: number; // cash + holdings
  totalPnl: number; // vs. STARTING_CASH
}

function valuePortfolio(
  profile: Profile,
  holdings: Holding[],
  quotesById: Map<string, TickerQuote>
): PortfolioValuation {
  const positions = holdings
    .filter((h) => Number(h.shares) > 0 && quotesById.has(h.ticker_id))
    .map((h) => {
      const quote = quotesById.get(h.ticker_id)!;
      const shares = Number(h.shares);
      const value = shares * quote.price;
      return {
        quote,
        holding: h,
        value,
        pnl: value - shares * Number(h.avg_cost),
      };
    })
    .sort((a, b) => b.value - a.value);

  const holdingsValue = positions.reduce((sum, p) => sum + p.value, 0);
  const totalValue = Number(profile.cash) + holdingsValue;
  return {
    profile,
    positions,
    holdingsValue,
    totalValue,
    totalPnl: totalValue - STARTING_CASH,
  };
}

/** The signed-in user's valued portfolio plus their leaderboard rank. */
export async function getPortfolio(userId: string): Promise<{
  valuation: PortfolioValuation;
  rank: number;
  playerCount: number;
} | null> {
  const all = await getAllValuations();
  const idx = all.findIndex((v) => v.profile.id === userId);
  if (idx === -1) return null;
  return { valuation: all[idx], rank: idx + 1, playerCount: all.length };
}

/**
 * Every player's portfolio valued at live prices, sorted by total value desc.
 * Crosses user rows → service role. Fine at toy scale.
 */
export async function getAllValuations(): Promise<PortfolioValuation[]> {
  const admin = createSupabaseAdminClient();
  const [quotes, profilesRes, holdingsRes] = await Promise.all([
    getMarket(),
    admin.from("profiles").select("*"),
    admin.from("holdings").select("*"),
  ]);

  const quotesById = new Map(quotes.map((q) => [q.ticker.id, q]));
  const holdingsByUser = new Map<string, Holding[]>();
  for (const h of (holdingsRes.data ?? []) as Holding[]) {
    const list = holdingsByUser.get(h.user_id) ?? [];
    list.push(h);
    holdingsByUser.set(h.user_id, list);
  }

  return ((profilesRes.data ?? []) as Profile[])
    .map((p) => valuePortfolio(p, holdingsByUser.get(p.id) ?? [], quotesById))
    .sort((a, b) => b.totalValue - a.totalValue);
}

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
  PortfolioSnapshot,
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

// ── market depth (0002) ─────────────────────────────────────────────────────

export interface FeedTrade {
  id: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  total: number;
  created_at: string;
  trader: string; // display name
  username: string | null;
  symbol: string;
}

/** Recent trades for the tape (global) or one ticker. Service role: joins names. */
export async function getRecentTrades(
  limit = 40,
  tickerId?: string
): Promise<FeedTrade[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("trades")
    .select("*, profiles(display_name, username), tickers(symbol)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tickerId) query = query.eq("ticker_id", tickerId);
  const { data } = await query;
  return ((data ?? []) as Array<Record<string, unknown>>).map((t) => {
    const profile = (t.profiles ?? {}) as Record<string, unknown>;
    const ticker = (t.tickers ?? {}) as Record<string, unknown>;
    return {
      id: String(t.id),
      side: t.side as "buy" | "sell",
      shares: Number(t.shares),
      price: Number(t.price),
      total: Number(t.total),
      created_at: String(t.created_at),
      trader: String(profile.display_name ?? "trader"),
      username: (profile.username as string) ?? null,
      symbol: String(ticker.symbol ?? "?"),
    };
  });
}

/** Community bull/bear tally for one ticker (aggregated with service role). */
export async function getVoteGauge(
  tickerId: string
): Promise<{ bulls: number; bears: number }> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("ticker_votes")
      .select("vote")
      .eq("ticker_id", tickerId);
    const votes = (data ?? []) as { vote: number }[];
    return {
      bulls: votes.filter((v) => Number(v.vote) === 1).length,
      bears: votes.filter((v) => Number(v.vote) === -1).length,
    };
  } catch {
    return { bulls: 0, bears: 0 };
  }
}

/** The signed-in user's own daily portfolio values (RLS: own rows). */
export async function getPortfolioHistory(): Promise<PortfolioSnapshot[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .order("day", { ascending: true });
  return (data ?? []) as PortfolioSnapshot[];
}

export type LeaderboardRange = "all" | "7d" | "30d";

export interface LeaderboardRow {
  valuation: PortfolioValuation;
  rangePnl: number;
}

/**
 * Leaderboard over a window: PnL vs the latest portfolio snapshot at or
 * before the window start (players without history fall back to the
 * $10,000 starting stake).
 */
export async function getLeaderboard(
  range: LeaderboardRange
): Promise<LeaderboardRow[]> {
  const valuations = await getAllValuations();
  if (range === "all") {
    return valuations
      .map((v) => ({ valuation: v, rangePnl: v.totalPnl }))
      .sort((a, b) => b.rangePnl - a.rangePnl);
  }

  const startDay = isoDaysAgo(range === "7d" ? 7 : 30);
  const baseline = new Map<string, number>();
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("portfolio_snapshots")
      .select("user_id, day, total_value")
      .lte("day", startDay)
      .order("day", { ascending: true });
    for (const s of (data ?? []) as PortfolioSnapshot[]) {
      baseline.set(s.user_id, Number(s.total_value)); // ascending → last wins
    }
  } catch {
    // table missing pre-migration — everyone falls back to starting cash
  }

  return valuations
    .map((v) => ({
      valuation: v,
      rangePnl:
        v.totalValue - (baseline.get(v.profile.id) ?? STARTING_CASH),
    }))
    .sort((a, b) => b.rangePnl - a.rangePnl);
}

export interface PublicProfileData {
  profile: Profile;
  valuation: PortfolioValuation;
  rank: number;
  playerCount: number;
  history: PortfolioSnapshot[];
}

/** A trader's public page, looked up by username. Service role. */
export async function getPublicProfile(
  username: string
): Promise<PublicProfileData | null> {
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  if (!profile) return null;

  const all = await getAllValuations();
  const idx = all.findIndex((v) => v.profile.id === profile.id);
  if (idx === -1) return null;

  const { data: history } = await admin
    .from("portfolio_snapshots")
    .select("*")
    .eq("user_id", profile.id)
    .order("day", { ascending: true });

  return {
    profile: profile as Profile,
    valuation: all[idx],
    rank: idx + 1,
    playerCount: all.length,
    history: (history ?? []) as PortfolioSnapshot[],
  };
}

export interface RecapStats {
  topGainer: TickerQuote | null;
  topLoser: TickerQuote | null;
  newListings: TickerQuote[];
  mrrMoves: { quote: TickerQuote; from: number; to: number }[];
  mostTraded: { quote: TickerQuote; volume: number; trades: number }[];
  weekStart: string;
}

/** Everything the weekly recap needs, computed over the trailing 7 days. */
export async function getRecapStats(): Promise<RecapStats> {
  const market = await getMarket();
  const byId = new Map(market.map((q) => [q.ticker.id, q]));
  const weekStart = isoDaysAgo(7);
  const sorted = [...market].sort((a, b) => b.weekChange - a.weekChange);

  const newListings = market.filter(
    (q) => q.ticker.listed_at >= new Date(Date.now() - 7 * 86400_000).toISOString()
  );

  // Largest month-over-month MRR moves among updates posted this week.
  const admin = createSupabaseAdminClient();
  const mrrMoves: RecapStats["mrrMoves"] = [];
  try {
    const { data: recent } = await admin
      .from("mrr_updates")
      .select("*")
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
    for (const u of (recent ?? []) as MrrUpdate[]) {
      const quote = byId.get(u.ticker_id);
      if (!quote) continue;
      const { data: prev } = await admin
        .from("mrr_updates")
        .select("mrr")
        .eq("ticker_id", u.ticker_id)
        .lt("month", u.month)
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!prev) continue;
      mrrMoves.push({ quote, from: Number(prev.mrr), to: Number(u.mrr) });
    }
    mrrMoves.sort(
      (a, b) =>
        Math.abs(changeFraction(b.from, b.to)) -
        Math.abs(changeFraction(a.from, a.to))
    );
  } catch {
    // fine — section just stays empty
  }

  const mostTraded: RecapStats["mostTraded"] = [];
  try {
    const { data: trades } = await admin
      .from("trades")
      .select("ticker_id, total")
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());
    const agg = new Map<string, { volume: number; trades: number }>();
    for (const t of (trades ?? []) as { ticker_id: string; total: number }[]) {
      const cur = agg.get(t.ticker_id) ?? { volume: 0, trades: 0 };
      cur.volume += Number(t.total);
      cur.trades += 1;
      agg.set(t.ticker_id, cur);
    }
    for (const [tickerId, stats] of agg) {
      const quote = byId.get(tickerId);
      if (quote) mostTraded.push({ quote, ...stats });
    }
    mostTraded.sort((a, b) => b.volume - a.volume);
  } catch {
    // fine
  }

  return {
    topGainer: sorted[0] ?? null,
    topLoser: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    newListings,
    mrrMoves: mrrMoves.slice(0, 3),
    mostTraded: mostTraded.slice(0, 3),
    weekStart,
  };
}

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { marketDayStart } from "@/lib/market-time";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  annualRevenue,
  changeFraction,
  fairPrice,
  floatOf,
  bridgeAmplitude,
  bridgeNoise,
  flowPrice,
  valuationMultiple,
  type RevenueEvent,
  type RevenuePoint,
} from "@/lib/pricing";
import { mergeAnchors } from "@/lib/candles";
import { STARTING_CASH } from "@/lib/config";
import { getRevenueEvents } from "@/lib/pulse";
import type { EquityHolding, EquityTrade } from "@/lib/equity";
import { computeXp } from "@/lib/xp";
import type {
  ChartEvent,
  ChartPoint,
  Holding,
  MrrUpdate,
  PortfolioSnapshot,
  PriceSnapshot,
  Profile,
  Ticker,
  TickerQuote,
} from "@/lib/types";

const SPARK_DAYS = 30;

/** What the five-minute Stripe poll knows that the monthly report doesn't. */
export interface LiveRevenue {
  liveMrr: number | null;
  events: RevenueEvent[];
}

const NO_LIVE: LiveRevenue = { liveMrr: null, events: [] };

/**
 * Live revenue for every connected ticker: the current Stripe number and the
 * recent changes behind it. Both sides degrade to nothing if 0005 hasn't been
 * applied — the market then trades on the last reported number, as before.
 */
export async function getLiveRevenue(
  sinceMs = 12 * 3600_000
): Promise<Map<string, LiveRevenue>> {
  const admin = createSupabaseAdminClient();
  const out = new Map<string, LiveRevenue>();
  const [connsRes, eventsRes] = await Promise.all([
    admin.from("stripe_connections").select("*").eq("status", "active"),
    admin
      .from("revenue_events")
      .select("ticker_id, at, prev_mrr, mrr, prev_subscriptions")
      .gte("at", new Date(Date.now() - sinceMs).toISOString())
      .order("at", { ascending: true })
      .limit(1000),
  ]);

  for (const c of (connsRes.data ?? []) as {
    ticker_id: string;
    live_mrr?: number | null;
  }[]) {
    const live = c.live_mrr === undefined ? null : c.live_mrr;
    out.set(c.ticker_id, {
      liveMrr: live === null ? null : Number(live),
      events: [],
    });
  }
  for (const e of (eventsRes.data ?? []) as {
    ticker_id: string;
    at: string;
    prev_mrr: number;
    mrr: number;
    prev_subscriptions: number | null;
  }[]) {
    const entry = out.get(e.ticker_id) ?? { liveMrr: null, events: [] };
    entry.events.push({
      at: Date.parse(e.at),
      mrr: Number(e.mrr),
      prevMrr: Number(e.prev_mrr),
      catchUp: e.prev_subscriptions === null,
    });
    out.set(e.ticker_id, entry);
  }
  return out;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Revenue record per ticker, month-ascending — the input to the multiple. */
function historyByTicker(updates: MrrUpdate[]): Map<string, RevenuePoint[]> {
  const map = new Map<string, RevenuePoint[]>();
  for (const u of updates) {
    const list = map.get(u.ticker_id) ?? [];
    list.push({ month: u.month, mrr: Number(u.mrr) });
    map.set(u.ticker_id, list);
  }
  return map;
}

function buildQuote(
  ticker: Ticker,
  history: RevenuePoint[],
  snaps: PriceSnapshot[], // this ticker's snapshots, day ascending
  live: LiveRevenue = NO_LIVE
): TickerQuote {
  const sentiment = Number(ticker.sentiment);
  const latestMrr = history.length ? Number(history[history.length - 1].mrr) : 0;
  // the market pays for durability and growth, not just this month's number
  const multiple = valuationMultiple(history);
  // each listing sized its own float at IPO; older rows use the default
  const shares = floatOf(ticker.shares_outstanding);
  // the price trades on what Stripe says NOW; latestMrr is the last report
  const liveMrr =
    live.liveMrr !== null && live.liveMrr > 0 ? live.liveMrr : latestMrr;
  const events = live.events;
  // the recorded weather: whatever the poller last drew for this ticker
  const drift = Number(ticker.drift ?? 0);
  // anchor × hype × weather × news — the one price the whole app reads
  const price = flowPrice(
    ticker.symbol,
    liveMrr,
    sentiment,
    Date.now(),
    multiple,
    shares,
    events,
    drift
  );
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
    arr: annualRevenue(latestMrr),
    multiple,
    shares,
    liveMrr,
    unreported: latestMrr > 0 ? (liveMrr - latestMrr) / latestMrr : 0,
    price,
    fairPrice: fairPrice(liveMrr, multiple, shares),
    marketCap: price * shares,
    // the price a day ago, exposed so the client can recompute the change
    // against a live price instead of freezing it at server-render time
    dayBasePrice: dayBase ? Number(dayBase.price) : price,
    dayChange: dayBase ? changeFraction(Number(dayBase.price), price) : 0,
    weekChange: weekBase ? changeFraction(Number(weekBase.price), price) : 0,
    spark: [...spark, price], // live price as the final point
    drift, // clients recompute the live price off this, not off a formula
  };
}

/** Everything the exchange front page needs, sorted by market cap desc. */
export async function getMarket(): Promise<TickerQuote[]> {
  const supabase = await createSupabaseServerClient();

  const [tickersRes, mrrRes, snapsRes, live] = await Promise.all([
    supabase.from("tickers").select("*"),
    supabase.from("mrr_updates").select("*").order("month", { ascending: true }),
    supabase
      .from("price_snapshots")
      .select("*")
      .gte("day", isoDaysAgo(SPARK_DAYS))
      .order("day", { ascending: true }),
    getLiveRevenue(),
  ]);

  const tickers = (tickersRes.data ?? []) as Ticker[];
  const histories = historyByTicker((mrrRes.data ?? []) as MrrUpdate[]);

  const snapsByTicker = new Map<string, PriceSnapshot[]>();
  for (const s of (snapsRes.data ?? []) as PriceSnapshot[]) {
    const list = snapsByTicker.get(s.ticker_id) ?? [];
    list.push(s);
    snapsByTicker.set(s.ticker_id, list);
  }

  return tickers
    .map((t) =>
      buildQuote(
        t,
        histories.get(t.id) ?? [],
        snapsByTicker.get(t.id) ?? [],
        live.get(t.id)
      )
    )
    .sort((a, b) => b.marketCap - a.marketCap);
}

/**
 * The price series a chart deserves. Every anchor is a RECORD — daily
 * snapshots, every trade print, every five-minute tick of the walk, and the
 * live price. Between anchors the line carries the shimmer (endpoint-matched,
 * so every recorded value stays exactly where it happened).
 *
 * The five-minute ticks are what changed here. The chart used to redraw
 * recent history by re-running the flow FORMULA, which is why the same call
 * worked just as well for tomorrow; now the recent tape is read back out of
 * public.flow_ticks, and tomorrow simply has no rows.
 */
/** How far back the minute-level detail is filled in. Older history is its
 *  recorded anchors — enough to draw the shape, at a fraction of the payload. */
const DETAIL_WINDOW_MS = 45 * 86_400_000;

/** How much of the recorded walk rides along. Two days ≈ 576 ticks. */
const FLOW_TICK_WINDOW_MS = 2 * 86_400_000;

/** Hard ceiling on what gets shipped to the browser. */
const MAX_SERIES_POINTS = 2600;

export async function getPriceSeries(
  tickerId: string,
  symbol: string,
  mrr: number,
  sentiment: number,
  multiple?: number,
  shares?: number,
  events: RevenueEvent[] = [],
  drift = 0
): Promise<ChartPoint[]> {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const [snapsRes, tradesRes, ticksRes] = await Promise.all([
    supabase
      .from("price_snapshots")
      .select("day, price")
      .eq("ticker_id", tickerId)
      .order("day", { ascending: true }),
    // trade rows are RLS-scoped to their owner → service role for prints
    admin
      .from("trades")
      .select("price, created_at")
      .eq("ticker_id", tickerId)
      .order("created_at", { ascending: true })
      .limit(2000),
    supabase
      .from("flow_ticks")
      .select("at, price")
      .eq("ticker_id", tickerId)
      .gte("at", new Date(Date.now() - FLOW_TICK_WINDOW_MS).toISOString())
      .order("at", { ascending: true })
      .limit(1200),
  ]);

  const now = Date.now();
  // every rule about which points are real, and in what order, lives in
  // mergeAnchors — pure and covered in tests/candles.test.ts
  const anchors = mergeAnchors({
    snapshots: (snapsRes.data ?? []) as { day: string; price: number }[],
    trades: ((tradesRes.data ?? []) as { price: number; created_at: string }[]).map(
      (t) => ({ at: Date.parse(t.created_at), price: Number(t.price) })
    ),
    // the recorded walk — absent until 0007 is applied and the poller has run,
    // in which case the chart falls back to snapshots and prints as before
    ticks: ((ticksRes.data ?? []) as { at: string; price: number }[]).map((k) => ({
      at: Date.parse(k.at),
      price: Number(k.price),
    })),
    now,
    live: flowPrice(symbol, mrr, sentiment, now, multiple, shares, events, drift),
  });

  // A BROWNIAN BRIDGE between each pair of real prices, in log space.
  //
  // This used to be a straight line with smooth noise multiplied over it, and
  // that is precisely what the charts looked like: long clean diagonals with a
  // gentle wobble, joining one daily snapshot to the next. No amount of
  // texture rescues a straight line, because the line is the problem — a real
  // price does not travel from Monday to Tuesday in a ruled diagonal.
  //
  // A bridge is not decoration. It is the actual distribution a random walk
  // takes given both of its endpoints, so it is jagged at every zoom, has no
  // preferred scale, and still lands exactly on both recorded prices. Log
  // space because a bridge in price space can go negative on a big gap, and
  // because a halving and a doubling should be the same size of move.
  //
  // Only gaps of 30 minutes or more are filled, and the recorded tape is five
  // minutes apart, so this never touches the recent window — it is strictly
  // the inside of a day-scale gap in old history, where the ticks have been
  // pruned and one snapshot a day is all that is left.
  const detailFrom = now - DETAIL_WINDOW_MS;
  const series: ChartPoint[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    series.push(a);
    const b = anchors[i + 1];
    if (!b) break;
    const gap = b.t - a.t;
    if (gap < 30 * 60_000 || a.price <= 0 || b.price <= 0) continue;
    if (b.t < detailFrom) continue; // older than the window: the anchor alone
    const steps = Math.min(48, Math.floor(gap / (10 * 60_000)));
    if (steps < 2) continue;
    const logA = Math.log(a.price);
    const logB = Math.log(b.price);
    // one seed per gap, so a bridge is stable as long as its endpoints are
    const seed = `${symbol}@${a.t}`;
    const amp = bridgeAmplitude(gap, mrr, logB - logA);
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      series.push({
        t: a.t + gap * u,
        price: Math.exp(logA + (logB - logA) * u + amp * bridgeNoise(seed, u)),
      });
    }
  }
  return series.slice(-MAX_SERIES_POINTS);
}

/**
 * Story dots for the landing hero: the featured ticker's real moments in the
 * last 30 days — its latest MRR report, the biggest print, the window high.
 * Every annotation is pulled from a table, never invented.
 */
export async function getHeroStory(
  tickerId: string,
  series: ChartPoint[]
): Promise<ChartEvent[]> {
  const events: ChartEvent[] = [];
  if (series.length < 3) return events;
  const windowStart = Date.now() - 30 * 86400_000;

  const priceAt = (t: number): number => {
    let best = series[0];
    for (const p of series) {
      if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    }
    return best.price;
  };

  try {
    const admin = createSupabaseAdminClient();
    const [mrrRes, bigTradeRes] = await Promise.all([
      admin
        .from("mrr_updates")
        .select("mrr, source, month, created_at")
        .eq("ticker_id", tickerId)
        .order("month", { ascending: false })
        .limit(2),
      admin
        .from("trades")
        .select("shares, price, total, created_at")
        .eq("ticker_id", tickerId)
        .gte("created_at", new Date(windowStart).toISOString())
        .order("total", { ascending: false })
        .limit(1),
    ]);

    const updates = (mrrRes.data ?? []) as {
      mrr: number;
      source: string;
      month: string;
      created_at: string;
    }[];
    if (updates.length > 0) {
      const u = updates[0];
      // curated backfills carry stale created_at ordering — pin those to
      // their reported month; real reports pin to the moment they posted
      const t =
        u.source === "curated"
          ? Date.parse(`${u.month}T06:00:00Z`)
          : Date.parse(u.created_at);
      if (t >= windowStart) {
        const prev = updates[1];
        const mom =
          prev && Number(prev.mrr) > 0
            ? changeFraction(Number(prev.mrr), Number(u.mrr))
            : null;
        events.push({
          t,
          price: priceAt(t),
          label:
            mom === null
              ? `MRR reported`
              : `MRR ${mom >= 0 ? "beat" : "miss"} ${(mom * 100).toFixed(1)}%`,
          tone: "revenue",
        });
      }
    }

    const big = (bigTradeRes.data ?? [])[0] as
      | { shares: number; price: number; total: number; created_at: string }
      | undefined;
    if (big && Number(big.total) > 100) {
      const t = Date.parse(big.created_at);
      events.push({
        t,
        price: priceAt(t),
        label: `${Number(big.shares).toLocaleString("en-US")} shs printed`,
        tone: "trade",
      });
    }
  } catch {
    // annotations are garnish — the chart works without them
  }

  // the window high, only when it isn't the live point (that has the caption)
  const inWindow = series.filter((p) => p.t >= windowStart);
  if (inWindow.length > 2) {
    let hi = inWindow[0];
    for (const p of inWindow) if (p.price > hi.price) hi = p;
    const isEdge =
      hi.t === inWindow[inWindow.length - 1].t || hi.t === inWindow[0].t;
    const nearOther = events.some((e) => Math.abs(e.t - hi.t) < 86400_000);
    if (!isEdge && !nearOther) {
      events.push({ t: hi.t, price: hi.price, label: "30d high", tone: "high" });
    }
  }

  return events.slice(0, 3);
}

export interface DayStats {
  open: number | null; // yesterday's close (last snapshot before today)
  high: number | null;
  low: number | null;
  volumeShares: number;
  volumeNotional: number;
  trades: number;
}

/** One ticker page's worth of data. */
export async function getTickerPage(symbol: string): Promise<{
  quote: TickerQuote;
  mrrHistory: MrrUpdate[];
  snapshots: PriceSnapshot[];
  holdersCount: number;
  watchersCount: number;
  series: ChartPoint[];
  fairSeries: ChartPoint[];
  dayStats: DayStats;
  floatHeld: number; // shares currently held across all players
  tradePoints: { t: number; shares: number }[];
  /**
   * Where the chart is allowed to start: the listing, or the first price we
   * actually recorded if that came later. Drawing back to the listing when
   * the record starts weeks after it just paints a flat line where no price
   * was ever observed — invented history, which is the one thing this chart
   * is not for.
   */
  earliest: number;
  revenueEvents: RevenueEvent[]; // Stripe changes since the last report
} | null> {
  const supabase = await createSupabaseServerClient();

  const { data: ticker } = await supabase
    .from("tickers")
    .select("*")
    .ilike("symbol", symbol)
    .maybeSingle();
  if (!ticker) return null;

  const [mrrRes, snapsRes, liveAll] = await Promise.all([
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
    // 30 days of revenue changes: enough to redraw every step on the chart
    getLiveRevenue(30 * 86_400_000),
  ]);

  const live = liveAll.get(ticker.id);
  const revenueEvents = live?.events ?? [];
  const mrrHistory = (mrrRes.data ?? []) as MrrUpdate[];
  const snapshots = (snapsRes.data ?? []) as PriceSnapshot[];
  const history: RevenuePoint[] = mrrHistory.map((u) => ({
    month: u.month,
    mrr: Number(u.mrr),
  }));
  const latestMrr = history.length ? Number(history[history.length - 1].mrr) : 0;

  const quote = buildQuote(
    ticker as Ticker,
    history,
    snapshots.filter((s) => s.day >= isoDaysAgo(SPARK_DAYS)),
    live
  );

  // Cross-user reads (counts, prints, positions) run with the service role.
  const admin = createSupabaseAdminClient();
  // "today" is the market's day, the same one the portfolio chart draws —
  // today's range and today's volume have to reset when the day does
  const todayStart = new Date(marketDayStart(Date.now())).toISOString();
  const [
    holdersRes,
    watchersRes,
    heldRes,
    todayTradesRes,
    allTradesRes,
    series,
  ] = await Promise.all([
    admin
      .from("holdings")
      .select("*", { count: "exact", head: true })
      .eq("ticker_id", ticker.id)
      .gt("shares", 0),
    admin
      .from("watchlists")
      .select("*", { count: "exact", head: true })
      .eq("ticker_id", ticker.id),
    admin.from("holdings").select("shares").eq("ticker_id", ticker.id),
    admin
      .from("trades")
      .select("price, shares, total")
      .eq("ticker_id", ticker.id)
      .gte("created_at", todayStart),
    // every print, for the chart's volume histogram at any granularity
    admin
      .from("trades")
      .select("shares, created_at")
      .eq("ticker_id", ticker.id)
      .order("created_at", { ascending: true })
      .limit(2000),
    getPriceSeries(
      ticker.id,
      (ticker as Ticker).symbol,
      quote.liveMrr,
      Number((ticker as Ticker).sentiment),
      quote.multiple,
      quote.shares,
      revenueEvents,
      quote.drift
    ),
  ]);

  const tradePoints = (
    (allTradesRes.data ?? []) as { shares: number; created_at: string }[]
  ).map((t) => ({ t: Date.parse(t.created_at), shares: Number(t.shares) }));

  const floatHeld = ((heldRes.data ?? []) as { shares: number }[]).reduce(
    (sum, h) => sum + Number(h.shares),
    0
  );

  const todayTrades = (todayTradesRes.data ?? []) as {
    price: number;
    shares: number;
    total: number;
  }[];
  const prevSnap = [...snapshots]
    .reverse()
    .find((s) => s.day < todayStart.slice(0, 10));
  const tradedPrices = todayTrades.map((t) => Number(t.price));
  // Today's range comes off the recorded tape, not a re-run of a formula.
  // (It used to re-sample the flow every 15 minutes — which was the only way
  // to know the day's path when the path was a function. Now the path is
  // written down every five minutes, so the high and the low are facts.)
  const t0 = Date.parse(todayStart);
  const dayPrices = [
    ...tradedPrices,
    quote.price,
    ...series.filter((p) => p.t >= t0).map((p) => p.price),
  ];
  const dayStats: DayStats = {
    open: prevSnap ? Number(prevSnap.price) : null,
    high: dayPrices.length ? Math.max(...dayPrices) : null,
    low: dayPrices.length ? Math.min(...dayPrices) : null,
    volumeShares: todayTrades.reduce((s, t) => s + Number(t.shares), 0),
    volumeNotional: todayTrades.reduce((s, t) => s + Number(t.total), 0),
    trades: todayTrades.length,
  };

  // same rule as the price series: today's row is rewritten all day, so its
  // 06:00 pin is fiction. The live fair value is appended instead.
  const fairToday = new Date().toISOString().slice(0, 10);
  const fairSeries: ChartPoint[] = snapshots
    .filter((s) => s.day < fairToday)
    .map((s) => ({
      t: Date.parse(`${s.day}T06:00:00Z`),
      price: Number(s.fair_price),
    }));
  fairSeries.push({ t: Date.now(), price: quote.fairPrice });

  return {
    quote,
    mrrHistory,
    snapshots,
    holdersCount: holdersRes.count ?? 0,
    watchersCount: watchersRes.count ?? 0,
    series,
    fairSeries,
    dayStats,
    floatHeld,
    tradePoints,
    earliest: Math.max(
      Date.parse((ticker as Ticker).listed_at),
      series.length > 0 ? series[0].t : 0
    ),
    revenueEvents,
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
  note: string | null; // the public "why" (0003)
}

/**
 * Recent trades for the tape (global), one ticker, or a set of traders
 * (the "following" filter). Service role: joins names across users.
 */
export async function getRecentTrades(
  limit = 40,
  tickerId?: string,
  userIds?: string[],
  thesesOnly = false
): Promise<FeedTrade[]> {
  if (userIds && userIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("trades")
    .select("*, profiles(display_name, username), tickers(symbol)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tickerId) query = query.eq("ticker_id", tickerId);
  if (userIds) query = query.in("user_id", userIds);
  // trades that carry a written thesis (0003; the filter no-ops to an empty
  // result pre-migration since the column is missing)
  if (thesesOnly) query = query.not("note", "is", null);
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
      note: (t.note as string) ?? null,
    };
  });
}

// ── social core (0003) ──────────────────────────────────────────────────────

export interface TickerPost {
  id: string;
  body: string;
  stance: 1 | -1 | null;
  created_at: string;
  author: string;
  username: string | null;
  userId: string;
  /** The poster's REAL position, joined live — never stored, can't be faked. */
  positionShares: number;
  positionPnl: number | null; // vs avg cost at the live price
}

/** Discussion thread for one ticker, each post carrying its author's live position. */
export async function getTickerPosts(
  tickerId: string,
  livePrice: number,
  limit = 30
): Promise<TickerPost[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("posts")
      .select("*, profiles(display_name, username)")
      .eq("ticker_id", tickerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
    const { data: holdings } = await admin
      .from("holdings")
      .select("user_id, shares, avg_cost")
      .eq("ticker_id", tickerId)
      .in("user_id", userIds);
    const position = new Map(
      ((holdings ?? []) as { user_id: string; shares: number; avg_cost: number }[]).map(
        (h) => [h.user_id, h]
      )
    );

    return rows.map((r) => {
      const profile = (r.profiles ?? {}) as Record<string, unknown>;
      const pos = position.get(String(r.user_id));
      const shares = pos ? Number(pos.shares) : 0;
      return {
        id: String(r.id),
        body: String(r.body),
        stance: (r.stance === null ? null : Number(r.stance)) as 1 | -1 | null,
        created_at: String(r.created_at),
        author: String(profile.display_name ?? "trader"),
        username: (profile.username as string) ?? null,
        userId: String(r.user_id),
        positionShares: shares,
        positionPnl:
          pos && shares > 0
            ? shares * livePrice - shares * Number(pos.avg_cost)
            : null,
      };
    });
  } catch {
    return []; // posts table missing pre-migration
  }
}

export interface FollowStats {
  followers: number;
  following: number;
}

/** Follower/following counts for a profile. */
export async function getFollowStats(profileId: string): Promise<FollowStats> {
  try {
    const admin = createSupabaseAdminClient();
    const [followersRes, followingRes] = await Promise.all([
      admin
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("followee_id", profileId),
      admin
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", profileId),
    ]);
    return {
      followers: followersRes.count ?? 0,
      following: followingRes.count ?? 0,
    };
  } catch {
    return { followers: 0, following: 0 };
  }
}

/** Is the viewer following this profile? */
export async function getIsFollowing(
  viewerId: string,
  profileId: string
): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("follows")
      .select("follower_id")
      .eq("follower_id", viewerId)
      .eq("followee_id", profileId)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Everyone the viewer follows — powers the "Following" feed filter. */
export async function getFollowedIds(viewerId: string): Promise<string[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("follows")
      .select("followee_id")
      .eq("follower_id", viewerId);
    return ((data ?? []) as { followee_id: string }[]).map(
      (f) => f.followee_id
    );
  } catch {
    return [];
  }
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


/**
 * Everything the equity curve needs to be reconstructed instead of recorded:
 * the price inputs for every ticker this account has ever touched, plus the
 * trade log to replay holdings and cash backwards. See lib/equity.ts.
 */
export const TRADE_HISTORY_LIMIT = 500;

export async function getEquityInputs(userId: string): Promise<{
  cash: number;
  startedAt: number;
  holdings: EquityHolding[];
  trades: EquityTrade[];
}> {
  const admin = createSupabaseAdminClient();
  const [quotes, profileRes, holdingsRes, tradesRes] = await Promise.all([
    getMarket(),
    admin.from("profiles").select("cash, created_at").eq("id", userId).maybeSingle(),
    admin
      .from("holdings")
      .select("ticker_id, shares, avg_cost")
      .eq("user_id", userId),
    admin
      .from("trades")
      .select("ticker_id, side, shares, price, total, note, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(TRADE_HISTORY_LIMIT),
  ]);

  const byId = new Map(quotes.map((q) => [q.ticker.id, q]));
  const holdingRows = (holdingsRes.data ?? []) as {
    ticker_id: string;
    shares: number;
    avg_cost: number;
  }[];
  const heldNow = new Map(
    holdingRows.map((h) => [h.ticker_id, Number(h.shares)])
  );
  const costOf = new Map(
    holdingRows.map((h) => [h.ticker_id, Number(h.avg_cost)])
  );
  const tradeRows = (tradesRes.data ?? []) as {
    ticker_id: string;
    side: "buy" | "sell";
    shares: number;
    price: number;
    total: number;
    note: string | null;
    created_at: string;
  }[];

  // anything held now OR ever traded — a closed position still shaped the past
  const touched = new Set<string>([
    ...heldNow.keys(),
    ...tradeRows.map((t) => t.ticker_id),
  ]);

  const holdings: EquityHolding[] = [];
  for (const id of touched) {
    const quote = byId.get(id);
    if (!quote) continue;
    const events = await getRevenueEvents(admin, id, 30 * 86_400_000);
    const series = await getPriceSeries(
      id,
      quote.ticker.symbol,
      quote.liveMrr,
      Number(quote.ticker.sentiment),
      quote.multiple,
      quote.shares,
      events,
      quote.drift
    );
    holdings.push({
      symbol: quote.ticker.symbol,
      shares: heldNow.get(id) ?? 0,
      mrr: quote.liveMrr,
      sentiment: Number(quote.ticker.sentiment),
      multiple: quote.multiple,
      outstanding: quote.shares,
      series,
      events,
      drift: quote.drift,
      name: quote.ticker.name,
      logoUrl: quote.ticker.logo_url,
      avgCost: Number(costOf.get(id) ?? 0),
      dayChange: quote.dayChange,
      weekChange: quote.weekChange,
      spark: quote.spark,
    });
  }

  const symbolOf = new Map(quotes.map((q) => [q.ticker.id, q.ticker.symbol]));
  const trades: EquityTrade[] = tradeRows
    .filter((t) => symbolOf.has(t.ticker_id))
    .map((t) => ({
      t: Date.parse(t.created_at),
      symbol: symbolOf.get(t.ticker_id)!,
      side: t.side,
      shares: Number(t.shares),
      price: Number(t.price),
      total: Number(t.total),
      note: t.note ?? null,
    }));

  return {
    cash: Number(profileRes.data?.cash ?? 0),
    startedAt: profileRes.data?.created_at
      ? Date.parse(profileRes.data.created_at)
      : Date.now() - 86_400_000,
    holdings,
    trades,
  };
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

// ── engagement layer (wire · feed · pulse · xp · streaks) ───────────────────

export interface MarketPulse {
  totalCap: number;
  volume24h: number;
  trades24h: number;
  gainers: number;
  losers: number;
}

/** The stat band: everything real, nothing fabricated. */
export async function getMarketPulse(quotes: TickerQuote[]): Promise<MarketPulse> {
  let volume24h = 0;
  let trades24h = 0;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("trades")
      .select("total")
      .gte("created_at", new Date(Date.now() - 86400_000).toISOString());
    for (const t of (data ?? []) as { total: number }[]) {
      volume24h += Number(t.total);
      trades24h += 1;
    }
  } catch {
    // fine — band shows zeros
  }
  return {
    totalCap: quotes.reduce((s, q) => s + q.marketCap, 0),
    volume24h,
    trades24h,
    gainers: quotes.filter((q) => q.dayChange > 0.0005).length,
    losers: quotes.filter((q) => q.dayChange < -0.0005).length,
  };
}

export interface EarningsEvent {
  symbol: string;
  tickerId: string;
  mrr: number;
  prevMrr: number | null;
  source: string;
  month: string; // the reported month ("2026-08-01")
  at: string; // created_at
}

/** Recent MRR reports with MoM context — the wire. Newest first. */
export async function getEarningsWire(limit = 6): Promise<EarningsEvent[]> {
  try {
    const admin = createSupabaseAdminClient();
    const [updatesRes, tickersRes] = await Promise.all([
      admin.from("mrr_updates").select("*").order("month", { ascending: true }),
      admin.from("tickers").select("id, symbol"),
    ]);
    const symbols = new Map(
      ((tickersRes.data ?? []) as { id: string; symbol: string }[]).map((t) => [
        t.id,
        t.symbol,
      ])
    );
    const byTicker = new Map<string, MrrUpdate[]>();
    for (const u of (updatesRes.data ?? []) as MrrUpdate[]) {
      const list = byTicker.get(u.ticker_id) ?? [];
      list.push(u); // month ascending
      byTicker.set(u.ticker_id, list);
    }
    const events: EarningsEvent[] = [];
    for (const [tickerId, list] of byTicker) {
      const symbol = symbols.get(tickerId);
      if (!symbol) continue;
      list.forEach((u, i) => {
        events.push({
          symbol,
          tickerId,
          mrr: Number(u.mrr),
          prevMrr: i > 0 ? Number(list[i - 1].mrr) : null,
          source: u.source,
          month: u.month,
          at: u.created_at,
        });
      });
    }
    // Newest first, tie-broken by month so bulk-seeded rows order sanely,
    // then one entry per ticker — the wire reports the latest, not history.
    events.sort(
      (a, b) => b.at.localeCompare(a.at) || b.month.localeCompare(a.month)
    );
    const seen = new Set<string>();
    const deduped: EarningsEvent[] = [];
    for (const e of events) {
      if (seen.has(e.tickerId)) continue;
      seen.add(e.tickerId);
      deduped.push(e);
    }
    return deduped.slice(0, limit);
  } catch {
    return [];
  }
}

export type FeedEvent =
  | { kind: "trade"; at: string; trade: FeedTrade }
  | { kind: "earnings"; at: string; earnings: EarningsEvent }
  | { kind: "listing"; at: string; quote: TickerQuote };

export type FeedFilter =
  | "all"
  | "trades"
  | "earnings"
  | "listings"
  | "following";

/** The unified activity feed: trades + earnings + listings, newest first. */
export async function getFeedEvents(
  quotes: TickerQuote[],
  filter: FeedFilter = "all",
  limit = 50,
  followedIds?: string[]
): Promise<FeedEvent[]> {
  const wantTrades =
    filter === "all" || filter === "trades" || filter === "following";
  const wantEarnings = filter === "all" || filter === "earnings";
  const wantListings = filter === "all" || filter === "listings";

  const [trades, earnings] = await Promise.all([
    wantTrades
      ? getRecentTrades(
          limit,
          undefined,
          filter === "following" ? (followedIds ?? []) : undefined
        )
      : Promise.resolve([]),
    wantEarnings ? getEarningsWire(30) : Promise.resolve([]),
  ]);

  const events: FeedEvent[] = [
    ...trades.map((t) => ({ kind: "trade" as const, at: t.created_at, trade: t })),
    ...earnings.map((e) => ({ kind: "earnings" as const, at: e.at, earnings: e })),
    ...(wantListings
      ? quotes
          .filter((q) => !q.ticker.fixture)
          .map((q) => ({
            kind: "listing" as const,
            at: q.ticker.listed_at,
            quote: q,
          }))
      : []),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface TrendingRow {
  quote: TickerQuote;
  trades24h: number;
  votes: number;
}

/** Trending = most traded in 24h, votes as the tiebreaker. */
export async function getTrending(
  quotes: TickerQuote[],
  limit = 5
): Promise<TrendingRow[]> {
  const byId = new Map(quotes.map((q) => [q.ticker.id, q]));
  const tradeCounts = new Map<string, number>();
  const voteCounts = new Map<string, number>();
  try {
    const admin = createSupabaseAdminClient();
    const [tradesRes, votesRes] = await Promise.all([
      admin
        .from("trades")
        .select("ticker_id")
        .gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
      admin.from("ticker_votes").select("ticker_id"),
    ]);
    for (const t of (tradesRes.data ?? []) as { ticker_id: string }[]) {
      tradeCounts.set(t.ticker_id, (tradeCounts.get(t.ticker_id) ?? 0) + 1);
    }
    for (const v of (votesRes.data ?? []) as { ticker_id: string }[]) {
      voteCounts.set(v.ticker_id, (voteCounts.get(v.ticker_id) ?? 0) + 1);
    }
  } catch {
    // fall through to |dayChange| ranking
  }
  return [...byId.values()]
    .map((quote) => ({
      quote,
      trades24h: tradeCounts.get(quote.ticker.id) ?? 0,
      votes: voteCounts.get(quote.ticker.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.trades24h - a.trades24h ||
        b.votes - a.votes ||
        Math.abs(b.quote.dayChange) - Math.abs(a.quote.dayChange)
    )
    .slice(0, limit);
}

/** XP for every user, derived from activity counts (service role). */
export async function getXpMap(): Promise<Map<string, number>> {
  const xp = new Map<string, number>();
  try {
    const admin = createSupabaseAdminClient();
    const [tradesRes, votesRes, tickersRes, profilesRes] = await Promise.all([
      admin.from("trades").select("user_id"),
      admin.from("ticker_votes").select("user_id"),
      admin.from("tickers").select("listed_by"),
      admin.from("profiles").select("id, invited_by"),
    ]);
    const counts = new Map<
      string,
      { trades: number; votes: number; listings: number; invites: number }
    >();
    const bump = (
      userId: string | null | undefined,
      key: "trades" | "votes" | "listings" | "invites"
    ) => {
      if (!userId) return;
      const c =
        counts.get(userId) ?? { trades: 0, votes: 0, listings: 0, invites: 0 };
      c[key] += 1;
      counts.set(userId, c);
    };
    for (const t of (tradesRes.data ?? []) as { user_id: string }[]) bump(t.user_id, "trades");
    for (const v of (votesRes.data ?? []) as { user_id: string }[]) bump(v.user_id, "votes");
    for (const t of (tickersRes.data ?? []) as { listed_by: string | null }[]) bump(t.listed_by, "listings");
    for (const p of (profilesRes.data ?? []) as { id: string; invited_by: string | null }[]) bump(p.invited_by, "invites");
    for (const [userId, c] of counts) xp.set(userId, computeXp(c));
  } catch {
    // XP layer degrades to zero
  }
  return xp;
}

/** Unread alert count for the nav badges. */
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    const admin = createSupabaseAdminClient();
    const { count } = await admin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Lifetime trade count — zero means the welcome mat is still out. */
export async function getTradeCountFor(userId: string): Promise<number> {
  try {
    const admin = createSupabaseAdminClient();
    const { count } = await admin
      .from("trades")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export interface MissedToday {
  quote: TickerQuote;
  hypotheticalStake: number;
  hypotheticalGain: number;
  onWatchlist: boolean;
}

/**
 * The guilt card: today's top gainer the user does NOT hold, with an honest
 * hypothetical ("a $2,500 bag at open would be up $X"). Null when the market
 * is flat or the user holds today's winner (then there's nothing to rub in).
 */
export async function getMissedToday(
  quotes: TickerQuote[],
  userId: string
): Promise<MissedToday | null> {
  const STAKE = 2_500;
  try {
    const admin = createSupabaseAdminClient();
    const [holdingsRes, watchRes] = await Promise.all([
      admin.from("holdings").select("ticker_id").eq("user_id", userId).gt("shares", 0),
      admin.from("watchlists").select("ticker_id").eq("user_id", userId),
    ]);
    const held = new Set(
      ((holdingsRes.data ?? []) as { ticker_id: string }[]).map((h) => h.ticker_id)
    );
    const watched = new Set(
      ((watchRes.data ?? []) as { ticker_id: string }[]).map((w) => w.ticker_id)
    );
    const candidate = [...quotes]
      .filter((q) => !held.has(q.ticker.id) && q.dayChange > 0.02)
      .sort((a, b) => b.dayChange - a.dayChange)[0];
    if (!candidate) return null;
    return {
      quote: candidate,
      hypotheticalStake: STAKE,
      hypotheticalGain: STAKE * candidate.dayChange,
      onWatchlist: watched.has(candidate.ticker.id),
    };
  } catch {
    return null;
  }
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
    // One read for the whole revenue record, then the previous month is a
    // lookup — this was a query per update, which cost 16s on a live board.
    const { data: all } = await admin
      .from("mrr_updates")
      .select("*")
      .order("month", { ascending: true });
    const history = historyByTicker((all ?? []) as MrrUpdate[]);
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    // One entry per COMPANY, not per update. A ticker that posted twice in a
    // week was listed twice — duplicate React keys, and worse, it ate two of
    // the three slots below and pushed another company off the recap.
    const biggest = new Map<string, RecapStats["mrrMoves"][number]>();
    for (const u of (all ?? []) as MrrUpdate[]) {
      if (u.created_at < since) continue;
      const quote = byId.get(u.ticker_id);
      if (!quote) continue;
      const months = history.get(u.ticker_id) ?? [];
      const i = months.findIndex((m) => m.month === u.month);
      if (i < 1) continue;
      const move = { quote, from: months[i - 1].mrr, to: Number(u.mrr) };
      const swing = (m: RecapStats["mrrMoves"][number]) =>
        m.from > 0 ? Math.abs(m.to - m.from) / m.from : 0;
      const held = biggest.get(u.ticker_id);
      if (!held || swing(move) > swing(held)) biggest.set(u.ticker_id, move);
    }
    mrrMoves.push(...biggest.values());
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

/**
 * Cheap existence checks for the two [param] routes.
 *
 * They run inside generateMetadata, which resolves before the body streams —
 * the last moment a 404 status can still be set. head:true means Postgres
 * counts rather than returning the row.
 */
export async function tickerExists(symbol: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("tickers")
    .select("*", { count: "exact", head: true })
    .ilike("symbol", symbol);
  return (count ?? 0) > 0;
}

export async function profileExists(username: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .ilike("username", username);
  return (count ?? 0) > 0;
}

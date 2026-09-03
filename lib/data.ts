import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { marketDayStart } from "@/lib/market-time";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pageAll } from "@/lib/supabase/page-all";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import { anchorRevenue } from "@/lib/revenue";
import { summariseHolderTrades } from "@/lib/holders";
import { latestEventMrr } from "@/lib/pulse";
import { isBotProfile, startingCashFor } from "@/lib/bot-roster";
import type { DailyRevenue } from "@/lib/surprise";
import { STARTING_CASH } from "@/lib/config";
import { thinSeries, type EquityHolding, type EquityTrade } from "@/lib/equity";
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
  Trade,
} from "@/lib/types";

const SPARK_DAYS = 30;

/** What the five-minute Stripe poll knows that the monthly report doesn't. */
export interface LiveRevenue {
  liveMrr: number | null;
  events: RevenueEvent[];
  /** Money actually received, per market day, newest last. */
  daily: DailyRevenue[];
}

const NO_LIVE: LiveRevenue = { liveMrr: null, events: [], daily: [] };

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
  const [connsRes, eventsRes, dailyRes, latest] = await Promise.all([
    admin.from("stripe_connections").select("*").eq("status", "active"),
    // NEWEST first. Ordered ascending, the row cap silently kept the OLDEST
    // events and dropped everything recent — so once the board carried a few
    // thousand events, every chart lost its markers and its earnings steps
    // while the table was full of them. Sorted back into time order below.
    admin
      .from("revenue_events")
      .select("ticker_id, at, prev_mrr, mrr, prev_subscriptions")
      .gte("at", new Date(Date.now() - sinceMs).toISOString())
      .order("at", { ascending: false })
      .limit(4000),
    // the takings the price anchors on. A long window regardless of sinceMs:
    // the run rate is an average over weeks, not a recent-events feed.
    admin
      .from("daily_revenue")
      .select("ticker_id, day, net_minor")
      .gte(
        "day",
        new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)
      )
      .order("day", { ascending: true })
      .limit(5000),
    // the newest event per listing: a demo ticker's live number, since its
    // pulse (lib/demo-pulse) writes events the way a Stripe reading does
    latestEventMrr(admin),
  ]);

  for (const c of (connsRes.data ?? []) as {
    ticker_id: string;
    live_mrr?: number | null;
  }[]) {
    const live = c.live_mrr === undefined ? null : c.live_mrr;
    out.set(c.ticker_id, {
      liveMrr: live === null ? null : Number(live),
      events: [],
      daily: [],
    });
  }
  for (const e of (eventsRes.data ?? []) as {
    ticker_id: string;
    at: string;
    prev_mrr: number;
    mrr: number;
    prev_subscriptions: number | null;
  }[]) {
    const entry = out.get(e.ticker_id) ?? { liveMrr: null, events: [], daily: [] };
    entry.events.push({
      at: Date.parse(e.at),
      mrr: Number(e.mrr),
      prevMrr: Number(e.prev_mrr),
      catchUp: e.prev_subscriptions === null,
    });
    out.set(e.ticker_id, entry);
  }
  // the fetch came back newest-first; everything downstream walks time forward
  for (const entry of out.values()) entry.events.sort((a, b) => a.at - b.at);
  // no connection speaking for a ticker → its newest event is the live number
  for (const [tickerId, ev] of latest) {
    const entry = out.get(tickerId) ?? { liveMrr: null, events: [], daily: [] };
    if (entry.liveMrr === null && ev.mrr > 0) entry.liveMrr = ev.mrr;
    out.set(tickerId, entry);
  }
  // absent until 0008 is applied and the poller has run once, in which case
  // the anchor falls back to subscriptions exactly as before
  for (const r of (dailyRes.data ?? []) as {
    ticker_id: string;
    day: string;
    net_minor: number;
  }[]) {
    const entry = out.get(r.ticker_id) ?? { liveMrr: null, events: [], daily: [] };
    entry.daily.push({ day: r.day, amount: Number(r.net_minor) / 100 });
    out.set(r.ticker_id, entry);
  }
  return out;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
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
  // EVERY PAYMENT, not just the recurring ones. The anchor is the monthly run
  // rate implied by money actually received; it falls back to the
  // subscriptions number until there is enough of it, and to the last report
  // if the account is not connected at all. A subscription business lands in
  // the same place either way — a month of renewals averages to its MRR — and
  // a shop selling one-time licences becomes tradeable, which it never was.
  const anchor = anchorRevenue({
    daily: live.daily,
    stripeMrr: live.liveMrr,
    reportedMrr: latestMrr,
  });
  const liveMrr = anchor.monthly;
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
    // ARR off the LIVE number, not the last monthly report. The two tiles sit
    // side by side — "MRR (live) $668" next to "ARR $7.6K" was $635.50 x 12,
    // and adjacent tiles that disagree read as an arithmetic error even when
    // both are defensible. The price already trades on live MRR; the headline
    // valuation should say the same thing.
    arr: annualRevenue(liveMrr),
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
    revenueSource: anchor.source,
  };
}

/** Everything the exchange front page needs, sorted by market cap desc. */
export const getMarket = cache(async (): Promise<TickerQuote[]> => {
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
});

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

/** The recorded prices a series is built from — fetched once, built anywhere. */
export interface SeriesRows {
  snapshots: { day: string; price: number }[];
  /** Time order, oldest first. */
  trades: { price: number; created_at: string }[];
  ticks: { at: string; price: number }[];
}

/** Every recorded price on one name, in one round trip. */
export async function fetchSeriesRows(admin: SupabaseClient, tickerId: string): Promise<SeriesRows> {
  const [snapsRes, tradesRes, ticksRes] = await Promise.all([
    admin.from("price_snapshots").select("day, price").eq("ticker_id", tickerId).order("day", { ascending: true }),
    // the NEWEST two thousand. Ascending with a cap kept the OLDEST, so a
    // busy name's recent prints fell off its own chart once it had printed
    // more than that.
    admin
      .from("trades")
      .select("price, created_at")
      .eq("ticker_id", tickerId)
      .order("created_at", { ascending: false })
      .limit(2000),
    admin
      .from("flow_ticks")
      .select("at, price")
      .eq("ticker_id", tickerId)
      .gte("at", new Date(Date.now() - FLOW_TICK_WINDOW_MS).toISOString())
      .order("at", { ascending: true })
      .limit(1200),
  ]);
  return {
    snapshots: ((snapsRes.data ?? []) as { day: string; price: number }[]).map((s) => ({
      day: s.day,
      price: Number(s.price),
    })),
    trades: ((tradesRes.data ?? []) as { price: number; created_at: string }[]).reverse(),
    ticks: (ticksRes.data ?? []) as { at: string; price: number }[],
  };
}

export async function getPriceSeries(
  tickerId: string,
  symbol: string,
  mrr: number,
  sentiment: number,
  multiple?: number,
  shares?: number,
  events: RevenueEvent[] = [],
  drift = 0,
  listedAt?: number
): Promise<ChartPoint[]> {
  const rows = await fetchSeriesRows(createSupabaseAdminClient(), tickerId);
  return buildPriceSeries(rows, symbol, mrr, sentiment, multiple, shares, events, drift, listedAt);
}

/**
 * The series from its rows — pure, so a page that already has the rows in
 * hand builds it without another trip.
 */
export function buildPriceSeries(
  rows: SeriesRows,
  symbol: string,
  mrr: number,
  sentiment: number,
  multiple?: number,
  shares?: number,
  events: RevenueEvent[] = [],
  drift = 0,
  listedAt?: number
): ChartPoint[] {
  const now = Date.now();
  // every rule about which points are real, and in what order, lives in
  // mergeAnchors — pure and covered in tests/candles.test.ts
  const anchors = mergeAnchors({
    snapshots: rows.snapshots,
    trades: rows.trades.map((t) => ({ at: Date.parse(t.created_at), price: Number(t.price) })),
    // the recorded walk — absent until 0007 is applied and the poller has run,
    // in which case the chart falls back to snapshots and prints as before
    ticks: rows.ticks.map((k) => ({ at: Date.parse(k.at), price: Number(k.price) })),
    now,
    live: flowPrice(symbol, mrr, sentiment, now, multiple, shares, events, drift),
    notBefore: listedAt,
    // a churn happens at a moment, not over the five minutes until the next
    // tick — weight each by its log MRR change so several inside one gap
    // split the move the way they actually caused it
    steps: events
      .filter((e) => e.prevMrr > 0 && e.mrr > 0)
      .map((e) => ({ at: e.at, weight: Math.abs(Math.log(e.mrr / e.prevMrr)) })),
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
 * The landing hero's chart: the series and its story dots. The rows and the
 * revenue news go out together, then the story reads off the series.
 */
export async function getHeroChart(q: TickerQuote): Promise<{ series: ChartPoint[]; events: ChartEvent[] }> {
  const admin = createSupabaseAdminClient();
  const [live, rows] = await Promise.all([getLiveRevenue(30 * 86_400_000), fetchSeriesRows(admin, q.ticker.id)]);
  const series = buildPriceSeries(
    rows,
    q.ticker.symbol,
    q.liveMrr,
    Number(q.ticker.sentiment),
    q.multiple,
    q.shares,
    live.get(q.ticker.id)?.events ?? [],
    q.drift,
    Date.parse(q.ticker.listed_at)
  );
  const events = await getHeroStory(q.ticker.id, series);
  return { series, events };
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
  dayStats: DayStats;
  floatHeld: number; // shares currently held across all players
  /** Shares in the ten largest positions — the strip's "top 10 holding". */
  topTenShares: number;
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
  /** Every print of the last 24 hours — the About card's window stats. */
  flow24h: { side: "buy" | "sell"; total: number; userId: string; at: number }[];
  /** The founder's earnings calls, newest first (0012). */
  calls: TickerCall[];
  /** The last dividend paid on the name, if any (0012). */
  dividend: { month: string; perShare: number; pool: number; holders: number } | null;
  /** Shares the founder has retired, in total (0012). */
  buybacks: { shares: number; total: number; count: number; lastAt: string | null };
} | null> {
  // shared with the metadata lookup and the viewer's own rows — one read
  const ticker = await getTickerRow(symbol);
  if (!ticker) return null;

  // Cross-user reads (counts, prints, positions) run with the service role.
  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();
  // "today" is the market's day, the same one the portfolio chart draws —
  // today's range and today's volume have to reset when the day does
  const todayStart = new Date(marketDayStart(nowMs)).toISOString();
  // Everything the page needs, in one round trip. This was three in a row
  // — the ticker, then its revenue, then everything else — and each one
  // crossed the continent before the next could start.
  const [
    mrrRes,
    snapsRes,
    liveAll,
    holdersRes,
    watchersRes,
    heldRes,
    tapeRes,
    ticksRes,
    callsRes,
    dividendRes,
    buybacksRes,
  ] = await Promise.all([
    admin.from("mrr_updates").select("*").eq("ticker_id", ticker.id).order("month", { ascending: true }),
    admin.from("price_snapshots").select("*").eq("ticker_id", ticker.id).order("day", { ascending: true }),
    // 30 days of revenue changes: enough to redraw every step on the chart
    getLiveRevenue(30 * 86_400_000),
    admin.from("holdings").select("*", { count: "exact", head: true }).eq("ticker_id", ticker.id).gt("shares", 0),
    admin.from("watchlists").select("*", { count: "exact", head: true }).eq("ticker_id", ticker.id),
    // every position, biggest first — a thousand accounts can all hold one name
    pageAll<{ shares: number }>((f, t) =>
      admin
        .from("holdings")
        .select("shares")
        .eq("ticker_id", ticker.id)
        .gt("shares", 0)
        .order("shares", { ascending: false })
        .range(f, t)
    ).then((data) => ({ data })),
    // the newest two thousand prints, once: the chart's anchors and its
    // volume, today's range and the day's order flow all read from them.
    // (Three queries used to fetch overlapping slices of the same rows, and
    // the chart's slice was the OLDEST two thousand — a busy name lost its
    // recent prints off its own chart once it had printed more than that.)
    admin
      .from("trades")
      .select("side, price, shares, total, user_id, created_at")
      .eq("ticker_id", ticker.id)
      .order("created_at", { ascending: false })
      .limit(2000),
    admin
      .from("flow_ticks")
      .select("at, price")
      .eq("ticker_id", ticker.id)
      .gte("at", new Date(nowMs - FLOW_TICK_WINDOW_MS).toISOString())
      .order("at", { ascending: true })
      .limit(1200),
    // the founder's moves (0012) — each reads as empty until the migration runs
    admin
      .from("calls")
      .select("*, profiles(display_name, username)")
      .eq("ticker_id", ticker.id)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("dividends")
      .select("month, per_share, pool, holders")
      .eq("ticker_id", ticker.id)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("buybacks").select("shares, total, created_at").eq("ticker_id", ticker.id).order("created_at", { ascending: false }).limit(500),
  ]);

  const live = liveAll.get(ticker.id);
  const revenueEvents = live?.events ?? [];
  const mrrHistory = (mrrRes.data ?? []) as MrrUpdate[];
  const snapshots = (snapsRes.data ?? []) as PriceSnapshot[];
  const history: RevenuePoint[] = mrrHistory.map((u) => ({ month: u.month, mrr: Number(u.mrr) }));
  const quote = buildQuote(ticker, history, snapshots.filter((s) => s.day >= isoDaysAgo(SPARK_DAYS)), live);

  // the tape, newest first as fetched; time order where the chart wants it
  const tape = (
    (tapeRes.data ?? []) as {
      side: "buy" | "sell";
      price: number;
      shares: number;
      total: number;
      user_id: string;
      created_at: string;
    }[]
  ).map((r) => ({
    side: r.side,
    price: Number(r.price),
    shares: Number(r.shares),
    total: Number(r.total),
    userId: r.user_id,
    at: Date.parse(r.created_at),
    created_at: r.created_at,
  }));
  const tapeAsc = [...tape].reverse();
  const series = buildPriceSeries(
    {
      snapshots: snapshots.map((s) => ({ day: s.day, price: Number(s.price) })),
      trades: tapeAsc.map((t) => ({ price: t.price, created_at: t.created_at })),
      ticks: (ticksRes.data ?? []) as { at: string; price: number }[],
    },
    ticker.symbol,
    quote.liveMrr,
    Number(ticker.sentiment),
    quote.multiple,
    quote.shares,
    revenueEvents,
    quote.drift,
    Date.parse(ticker.listed_at)
  );
  const calls: TickerCall[] = ((callsRes.data ?? []) as Record<string, unknown>[]).map((c) => {
    const pr = (c.profiles ?? {}) as { display_name?: string; username?: string | null };
    return {
      id: String(c.id),
      body: String(c.body),
      guidance: Number(c.guidance),
      actual: c.actual === null || c.actual === undefined ? null : Number(c.actual),
      outcome: (c.outcome as TickerCall["outcome"]) ?? null,
      settledMonth: (c.settled_month as string) ?? null,
      createdAt: String(c.created_at),
      founder: String(pr.display_name ?? "founder"),
      username: pr.username ?? null,
    };
  });
  const dividend = dividendRes.data
    ? {
        month: String(dividendRes.data.month),
        perShare: Number(dividendRes.data.per_share),
        pool: Number(dividendRes.data.pool),
        holders: Number(dividendRes.data.holders),
      }
    : null;
  const buybackRows = (buybacksRes.data ?? []) as { shares: number; total: number; created_at: string }[];
  const buybacks = {
    shares: buybackRows.reduce((a, b) => a + Number(b.shares), 0),
    total: buybackRows.reduce((a, b) => a + Number(b.total), 0),
    count: buybackRows.length,
    lastAt: buybackRows[0]?.created_at ?? null,
  };
  // the last day's order flow, for the window stats (5M / 1H / 4H / 1D)
  const flow24h = tape
    .filter((t) => t.at >= nowMs - 86_400_000)
    .map(({ side, total, userId, at }) => ({ side, total, userId, at }));
  // every print, for the chart's volume histogram at any granularity
  const tradePoints = tapeAsc.map((t) => ({ t: t.at, shares: t.shares }));

  const heldRows = (heldRes.data ?? []) as { shares: number }[];
  const floatHeld = heldRows.reduce((sum, h) => sum + Number(h.shares), 0);
  const topTenShares = heldRows.slice(0, 10).reduce((sum, h) => sum + Number(h.shares), 0);

  const todayTrades = tape.filter((t) => t.at >= Date.parse(todayStart));
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

  return {
    quote,
    mrrHistory,
    snapshots,
    holdersCount: holdersRes.count ?? 0,
    watchersCount: watchersRes.count ?? 0,
    series,
    dayStats,
    floatHeld,
    topTenShares,
    calls,
    dividend,
    buybacks,
    tradePoints,
    earliest: Math.max(
      Date.parse((ticker as Ticker).listed_at),
      series.length > 0 ? series[0].t : 0
    ),
    revenueEvents,
    flow24h,
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
  totalPnl: number; // vs. the account's starting stake
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
    totalPnl:
      totalValue - startingCashFor(profile.username, STARTING_CASH, profile.persona),
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
  // a thousand accounts and their positions are past the API's page — read all
  const [quotes, profiles, holdings] = await Promise.all([
    getMarket(),
    pageAll<Profile>((f, t) => admin.from("profiles").select("*").order("id").range(f, t)),
    pageAll<Holding>((f, t) =>
      admin.from("holdings").select("*").order("user_id").order("ticker_id").range(f, t)
    ),
  ]);

  const quotesById = new Map(quotes.map((q) => [q.ticker.id, q]));
  const holdingsByUser = new Map<string, Holding[]>();
  for (const h of holdings) {
    const list = holdingsByUser.get(h.user_id) ?? [];
    list.push(h);
    holdingsByUser.set(h.user_id, list);
  }

  return profiles
    // the AI traders rank too — labeled, and measured from their own stake
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
  /** An AI trader's print. */
  bot: boolean;
  /** Hearts on the note (0010). */
  likes: number;
  likedByMe: boolean;
  /** A founder's buyback — the shares were retired, not held (0012). */
  buyback: boolean;
}

/**
 * Hearts on a batch of theses: how many, and whether the viewer is one of
 * them. Pre-0010 the table is missing and everything reads as zero.
 */
async function likesFor(
  admin: SupabaseClient,
  kind: "post" | "trade",
  ids: string[],
  viewerId?: string | null
): Promise<Map<string, { likes: number; mine: boolean }>> {
  const out = new Map<string, { likes: number; mine: boolean }>();
  if (ids.length === 0) return out;
  try {
    const rows = await pageAll<{ target_id: string; user_id: string }>((f, t) =>
      admin
        .from("thesis_likes")
        .select("target_id, user_id")
        .eq("kind", kind)
        .in("target_id", ids)
        .order("target_id")
        .order("user_id")
        .range(f, t)
    );
    for (const r of rows) {
      const cur = out.get(r.target_id) ?? { likes: 0, mine: false };
      cur.likes++;
      if (viewerId && r.user_id === viewerId) cur.mine = true;
      out.set(r.target_id, cur);
    }
  } catch {
    // no likes table yet
  }
  return out;
}

/**
 * Recent trades for the tape (global), one ticker, or a set of traders
 * (the "following" filter). Service role: joins names across users.
 */
export async function getRecentTrades(
  limit = 40,
  tickerId?: string,
  userIds?: string[],
  thesesOnly = false,
  viewerId?: string | null,
  /** Only prints of at least this many dollars — the floor's size filter, applied where the rows are. */
  minTotal?: number | null,
  /** Only prints after this instant — the open page's poll. */
  since?: string | null,
  /** Only prints before this instant — paging back through someone's history. */
  before?: string | null
): Promise<FeedTrade[]> {
  if (userIds && userIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("trades")
    .select("*, profiles(*), tickers(symbol)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tickerId) query = query.eq("ticker_id", tickerId);
  if (userIds) query = query.in("user_id", userIds);
  if (minTotal && minTotal > 0) query = query.gte("total", minTotal);
  if (since) query = query.gt("created_at", since);
  if (before) query = query.lt("created_at", before);
  // trades that carry a written thesis (0003; the filter no-ops to an empty
  // result pre-migration since the column is missing)
  if (thesesOnly) query = query.not("note", "is", null);
  const { data } = await query;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // hearts only matter on the notes — the plain tape carries none
  const hearts = thesesOnly
    ? await likesFor(admin, "trade", rows.map((t) => String(t.id)), viewerId)
    : new Map<string, { likes: number; mine: boolean }>();
  return rows.map((t) => {
    const profile = (t.profiles ?? {}) as Record<string, unknown>;
    const ticker = (t.tickers ?? {}) as Record<string, unknown>;
    const h = hearts.get(String(t.id));
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
      bot: isBotProfile(profile as { username?: string | null; is_bot?: boolean | null }),
      likes: h?.likes ?? 0,
      likedByMe: h?.mine ?? false,
      buyback: Boolean(t.is_buyback),
    };
  });
}

/** A founder's earnings call, as the page shows it. */
export interface TickerCall {
  id: string;
  body: string;
  guidance: number;
  actual: number | null;
  outcome: "beat" | "met" | "missed" | null;
  settledMonth: string | null;
  createdAt: string;
  founder: string;
  username: string | null;
}

/** One row of the public holders table — every number off the ledger. */
export interface HolderRow {
  userId: string;
  trader: string;
  username: string | null;
  shares: number;
  avgCost: number;
  /** shares × the live price */
  value: number;
  /** value − shares × avgCost */
  pnl: number;
  /** pnl over cost, as a fraction */
  pnlPct: number;
  /** avgCost × the float — the market cap they bought in at */
  entryMarketCap: number;
  /** epoch ms the open position started; null when the ledger has no buy */
  heldSince: number | null;
  thesis: string | null;
  thesisAt: number | null;
  /** Where the thesis lives, so it can be liked: a floor post or a print's note. */
  thesisKind: "post" | "trade" | null;
  thesisId: string | null;
  thesisLikes: number;
  thesisLikedByMe: boolean;
  lastTradeAt: number | null;
  /** An AI trader. */
  bot: boolean;
}

/**
 * Who holds a ticker, biggest position first. Service role: holdings are
 * RLS "read own", but a position is already public beside every discussion
 * post and every print carries a name on the tape — this is the same fact,
 * sorted. `limit` caps the rows shipped; `total` is the whole count.
 */
export async function getHolders(
  tickerId: string,
  price: number,
  float: number,
  limit = 100,
  viewerId: string | null = null
): Promise<{ rows: HolderRow[]; total: number }> {
  const admin = createSupabaseAdminClient();
  const { data, count } = await admin
    .from("holdings")
    .select("user_id, shares, avg_cost, profiles(*)", {
      count: "exact",
    })
    .eq("ticker_id", tickerId)
    .gt("shares", 0)
    .order("shares", { ascending: false })
    .limit(limit);
  const held = (data ?? []) as Array<Record<string, unknown>>;
  if (held.length === 0) return { rows: [], total: count ?? 0 };

  const ids = held.map((h) => String(h.user_id));
  const [{ data: tradeRows }, postsRes] = await Promise.all([
    admin
      .from("trades")
      .select("id, user_id, side, shares, created_at, note")
      .eq("ticker_id", tickerId)
      .in("user_id", ids)
      .order("created_at", { ascending: true })
      .limit(5000),
    // a thesis posted straight to the floor counts too — the newest of
    // either kind is the one the row shows
    admin
      .from("posts")
      .select("id, user_id, body, created_at")
      .eq("ticker_id", tickerId)
      .in("user_id", ids)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);
  const latestPost = new Map<string, { id: string; body: string; at: number }>();
  for (const r of (postsRes.data ?? []) as { id: string; user_id: string; body: string; created_at: string }[]) {
    if (!latestPost.has(r.user_id)) latestPost.set(r.user_id, { id: r.id, body: r.body, at: Date.parse(r.created_at) });
  }
  const activity = summariseHolderTrades(
    ((tradeRows ?? []) as {
      id: string;
      user_id: string;
      side: "buy" | "sell";
      shares: number;
      created_at: string;
      note: string | null;
    }[]).map((t) => ({
      id: String(t.id),
      userId: t.user_id,
      side: t.side,
      shares: Number(t.shares),
      at: Date.parse(t.created_at),
      note: t.note ?? null,
    }))
  );

  // hearts on whichever thesis each row will show — one lookup per kind
  const postIds: string[] = [];
  const tradeIds: string[] = [];
  for (const h of held) {
    const uid = String(h.user_id);
    const a = activity.get(uid);
    const post = latestPost.get(uid);
    if (post && (a?.thesisAt === null || a?.thesisAt === undefined || post.at > a.thesisAt)) {
      postIds.push(post.id);
    } else if (a?.thesisTradeId) {
      tradeIds.push(a.thesisTradeId);
    }
  }
  const [postHearts, tradeHearts] = await Promise.all([
    likesFor(admin, "post", postIds, viewerId),
    likesFor(admin, "trade", tradeIds, viewerId),
  ]);
  const hearts = new Map<string, { likes: number; mine: boolean }>();
  for (const [id, v] of postHearts) hearts.set(`post:${id}`, v);
  for (const [id, v] of tradeHearts) hearts.set(`trade:${id}`, v);

  const rows = held
    .map((h): HolderRow => {
      const profile = (h.profiles ?? {}) as Record<string, unknown>;
      const shares = Number(h.shares);
      const avgCost = Number(h.avg_cost);
      const value = shares * price;
      const cost = shares * avgCost;
      const a = activity.get(String(h.user_id));
      const post = latestPost.get(String(h.user_id));
      const thesis =
        post && (a?.thesisAt === null || a?.thesisAt === undefined || post.at > a.thesisAt)
          ? { text: post.body, at: post.at, kind: "post" as const, id: post.id }
          : a?.thesis
            ? { text: a.thesis, at: a.thesisAt ?? null, kind: "trade" as const, id: a.thesisTradeId }
            : null;
      const heart = thesis?.id ? hearts.get(`${thesis.kind}:${thesis.id}`) : undefined;
      return {
        userId: String(h.user_id),
        trader: String(profile.display_name ?? "trader"),
        username: (profile.username as string) ?? null,
        shares,
        avgCost,
        value,
        pnl: value - cost,
        pnlPct: cost > 0 ? (value - cost) / cost : 0,
        entryMarketCap: avgCost * float,
        heldSince: a?.heldSince ?? null,
        thesis: thesis?.text ?? null,
        thesisAt: thesis?.at ?? null,
        thesisKind: thesis?.id ? thesis.kind : null,
        thesisId: thesis?.id ?? null,
        thesisLikes: heart?.likes ?? 0,
        thesisLikedByMe: heart?.mine ?? false,
        lastTradeAt: a?.lastTradeAt ?? null,
        bot: isBotProfile(profile as { username?: string | null; is_bot?: boolean | null }),
      };
    })
    .sort((a, b) => b.value - a.value);
  return { rows, total: count ?? rows.length };
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
  /** shares × the live price — what the take is backed with, and the size filter's key */
  positionValue: number;
  /** positionPnl over cost, as a fraction; null without a position */
  positionPnlPct: number | null;
  /** An AI trader's take. */
  bot: boolean;
  /** Hearts (0010). */
  likes: number;
  likedByMe: boolean;
}

/**
 * How much floor a name has: every print ever, and every thesis — the
 * ones posted straight to the floor and the ones written on a print. The
 * tab labels, so the count is the history and not the page.
 */
export async function getFloorCounts(tickerId: string): Promise<{ trades: number; theses: number }> {
  const admin = createSupabaseAdminClient();
  const [tradesRes, notedRes, postsRes] = await Promise.all([
    admin.from("trades").select("*", { count: "exact", head: true }).eq("ticker_id", tickerId),
    admin.from("trades").select("*", { count: "exact", head: true }).eq("ticker_id", tickerId).not("note", "is", null),
    admin.from("posts").select("*", { count: "exact", head: true }).eq("ticker_id", tickerId),
  ]);
  return {
    trades: tradesRes.count ?? 0,
    theses: (notedRes.count ?? 0) + (postsRes.count ?? 0),
  };
}

/** Discussion thread for one ticker, each post carrying its author's live position. */
export async function getTickerPosts(
  tickerId: string,
  livePrice: number,
  limit = 30,
  viewerId?: string | null,
  /** Only posts before this instant — paging back through the floor. */
  before?: string | null
): Promise<TickerPost[]> {
  try {
    const admin = createSupabaseAdminClient();
    let query = admin
      .from("posts")
      .select("*, profiles(*)")
      .eq("ticker_id", tickerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data } = await query;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
    const [{ data: holdings }, hearts] = await Promise.all([
      admin
        .from("holdings")
        .select("user_id, shares, avg_cost")
        .eq("ticker_id", tickerId)
        .in("user_id", userIds),
      likesFor(admin, "post", rows.map((r) => String(r.id)), viewerId),
    ]);
    const position = new Map(
      ((holdings ?? []) as { user_id: string; shares: number; avg_cost: number }[]).map(
        (h) => [h.user_id, h]
      )
    );

    return rows.map((r) => {
      const profile = (r.profiles ?? {}) as Record<string, unknown>;
      const pos = position.get(String(r.user_id));
      const shares = pos ? Number(pos.shares) : 0;
      const cost = pos && shares > 0 ? shares * Number(pos.avg_cost) : 0;
      const h = hearts.get(String(r.id));
      return {
        id: String(r.id),
        body: String(r.body),
        stance: (r.stance === null ? null : Number(r.stance)) as 1 | -1 | null,
        created_at: String(r.created_at),
        author: String(profile.display_name ?? "trader"),
        username: (profile.username as string) ?? null,
        userId: String(r.user_id),
        positionShares: shares,
        positionPnl: pos && shares > 0 ? shares * livePrice - cost : null,
        positionValue: shares * livePrice,
        positionPnlPct: cost > 0 ? (shares * livePrice - cost) / cost : null,
        bot: isBotProfile(profile as { username?: string | null; is_bot?: boolean | null }),
        likes: h?.likes ?? 0,
        likedByMe: h?.mine ?? false,
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
  /** Dividends collected, in total (0012). */
  dividends: number;
}> {
  const admin = createSupabaseAdminClient();
  const [quotes, profileRes, holdingsRes, tradesRes, dividendsRes] = await Promise.all([
    getMarket(),
    admin.from("profiles").select("cash, created_at").eq("id", userId).maybeSingle(),
    admin
      .from("holdings")
      .select("ticker_id, shares, avg_cost")
      .eq("user_id", userId),
    admin
      .from("trades")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(TRADE_HISTORY_LIMIT),
    admin.from("dividend_payments").select("amount").eq("user_id", userId).limit(5000),
  ]);
  const dividends = ((dividendsRes.data ?? []) as { amount: number }[]).reduce((a, d) => a + Number(d.amount), 0);

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
  // a buyback's shares were retired the moment they were bought — not a position
  const tradeRows = ((tradesRes.data ?? []) as Record<string, unknown>[]).filter((t) => !t.is_buyback) as unknown as {
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

  // every name at once, in one round trip: the revenue news for all of
  // them in one query, the recorded prices per name beside it. (This
  // walked them one by one, two round trips each, and a six-name book was
  // twelve in a row before the curve drew.)
  const ids = [...touched].filter((id) => byId.has(id));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [rowsPer, eventsRes] = await Promise.all([
    Promise.all(ids.map((id) => fetchSeriesRows(admin, id))),
    ids.length
      ? admin
          .from("revenue_events")
          .select("ticker_id, at, prev_mrr, mrr, prev_subscriptions")
          .in("ticker_id", ids)
          .gte("at", since)
          .order("at", { ascending: false })
          .limit(4000)
      : Promise.resolve({ data: null }),
  ]);
  const eventsOf = new Map<string, RevenueEvent[]>();
  for (const r of (
    (eventsRes.data ?? []) as {
      ticker_id: string;
      at: string;
      prev_mrr: number;
      mrr: number;
      prev_subscriptions: number | null;
    }[]
  ).reverse()) {
    const l = eventsOf.get(r.ticker_id) ?? [];
    l.push({ at: Date.parse(r.at), mrr: Number(r.mrr), prevMrr: Number(r.prev_mrr), catchUp: r.prev_subscriptions === null });
    eventsOf.set(r.ticker_id, l);
  }
  const now = Date.now();
  const holdings: EquityHolding[] = ids.map((id, i) => {
    const quote = byId.get(id)!;
    const events = eventsOf.get(id) ?? [];
    // at the resolution the curve can show — a whole book at full detail
    // was a megabyte and a half of page
    const series = thinSeries(
      buildPriceSeries(
        rowsPer[i],
        quote.ticker.symbol,
        quote.liveMrr,
        Number(quote.ticker.sentiment),
        quote.multiple,
        quote.shares,
        events,
        quote.drift,
        Date.parse(quote.ticker.listed_at)
      ),
      now
    );
    return {
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
    };
  });

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
    dividends,
  };
}

export type LeaderboardRange = "all" | "1d" | "7d" | "30d";
const RANGE_MS: Record<Exclude<LeaderboardRange, "all">, number> = {
  "1d": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

export interface LeaderboardRow {
  valuation: PortfolioValuation;
  rangePnl: number;
  /** What the account was worth at the start of the window — the stake the PnL is a return on. */
  rangeBase: number;
  /** rangePnl over rangeBase. Bankrolls run from $25 to $250k, so this is the rank. */
  rangePct: number;
}

function leaderboardRow(v: PortfolioValuation, base: number): LeaderboardRow {
  const rangePnl = v.totalValue - base;
  return { valuation: v, rangePnl, rangeBase: base, rangePct: base > 0 ? rangePnl / base : 0 };
}

/**
 * Leaderboard over a window: PnL vs the latest portfolio snapshot at or
 * before the window start (players without history fall back to the
 * $10,000 starting stake).
 */
/**
 * What every account was worth at one instant, rebuilt from the ledger: the
 * cash and shares of right now with every trade since then undone, marked
 * at the tape as it stood then. This is the 24h baseline — the daily
 * snapshots are a day coarse and did not exist for most of the population
 * until it did.
 */
async function valuesAt(
  admin: SupabaseClient,
  valuations: PortfolioValuation[],
  t0: number
): Promise<Map<string, number>> {
  const iso = new Date(t0).toISOString();
  const day = iso.slice(0, 10);
  const [trades, ticks, snaps] = await Promise.all([
    pageAll<Pick<Trade, "user_id" | "ticker_id" | "side" | "shares" | "total">>((f, t) =>
      admin
        .from("trades")
        .select("user_id, ticker_id, side, shares, total")
        .gte("created_at", iso)
        .order("id")
        .range(f, t)
    ),
    // the last tick at or before the instant — the walk steps every five
    // minutes, so two hours back is plenty
    pageAll<{ ticker_id: string; price: number }>((f, t) =>
      admin
        .from("flow_ticks")
        .select("ticker_id, at, price")
        .lte("at", iso)
        .gte("at", new Date(t0 - 2 * 3_600_000).toISOString())
        .order("at", { ascending: false })
        .range(f, t)
    ),
    admin.from("price_snapshots").select("ticker_id, price").eq("day", day),
  ]);
  const priceThen = new Map<string, number>();
  for (const k of ticks) if (!priceThen.has(k.ticker_id)) priceThen.set(k.ticker_id, Number(k.price));
  for (const k of (snaps.data ?? []) as { ticker_id: string; price: number }[]) {
    if (!priceThen.has(k.ticker_id)) priceThen.set(k.ticker_id, Number(k.price));
  }
  // undo the window: a buy gave up cash for shares, so undoing it is the reverse
  const undo = new Map<string, { cash: number; shares: Map<string, number> }>();
  const lastPrint = new Map<string, number>(); // a price of last resort
  for (const tr of trades) {
    const u = undo.get(tr.user_id) ?? { cash: 0, shares: new Map<string, number>() };
    const sign = tr.side === "buy" ? 1 : -1;
    u.cash += sign * Number(tr.total);
    u.shares.set(tr.ticker_id, (u.shares.get(tr.ticker_id) ?? 0) - sign * Number(tr.shares));
    undo.set(tr.user_id, u);
    if (Number(tr.shares) > 0) lastPrint.set(tr.ticker_id, Number(tr.total) / Number(tr.shares));
  }
  const out = new Map<string, number>();
  for (const v of valuations) {
    const shares = new Map<string, number>();
    const priceNow = new Map<string, number>();
    for (const pos of v.positions) {
      shares.set(pos.holding.ticker_id, Number(pos.holding.shares));
      priceNow.set(pos.holding.ticker_id, pos.quote.price);
    }
    let cash = Number(v.profile.cash);
    const u = undo.get(v.profile.id);
    if (u) {
      cash += u.cash;
      for (const [tid, d] of u.shares) shares.set(tid, (shares.get(tid) ?? 0) + d);
    }
    let value = cash;
    for (const [tid, n] of shares) {
      if (n <= 0) continue;
      value += n * (priceThen.get(tid) ?? priceNow.get(tid) ?? lastPrint.get(tid) ?? 0);
    }
    out.set(v.profile.id, value);
  }
  return out;
}

/** The daily snapshot on or just before a day, for everyone who has one. */
async function snapshotValuesAt(admin: SupabaseClient, t0: number): Promise<Map<string, number>> {
  const day = new Date(t0).toISOString().slice(0, 10);
  const floor = new Date(t0 - 3 * 86_400_000).toISOString().slice(0, 10);
  const rows = await pageAll<{ user_id: string; day: string; total_value: number }>((f, t) =>
    admin
      .from("portfolio_snapshots")
      .select("user_id, day, total_value")
      .lte("day", day)
      .gte("day", floor)
      .order("day", { ascending: false })
      .order("user_id")
      .range(f, t)
  );
  const out = new Map<string, number>();
  for (const r of rows) if (!out.has(r.user_id)) out.set(r.user_id, Number(r.total_value));
  return out;
}

/**
 * Leaderboard over a window. The return is measured from what the account
 * was worth when the window opened: rebuilt from the ledger for 24h, the
 * daily snapshot for a week or a month. An account younger than the window
 * is measured from its stake — its return over the window is its return
 * since it existed.
 */
export async function getLeaderboard(
  range: LeaderboardRange
): Promise<LeaderboardRow[]> {
  const valuations = await getAllValuations();
  const stake = (v: PortfolioValuation) =>
    startingCashFor(v.profile.username, STARTING_CASH, v.profile.persona);
  if (range === "all") {
    return valuations
      .map((v) => leaderboardRow(v, stake(v)))
      .sort((a, b) => b.rangePct - a.rangePct);
  }

  const t0 = Date.now() - RANGE_MS[range];
  let baseline = new Map<string, number>();
  try {
    const admin = createSupabaseAdminClient();
    baseline =
      range === "1d" ? await valuesAt(admin, valuations, t0) : await snapshotValuesAt(admin, t0);
  } catch {
    // no history to read — everyone is measured from their stake
  }

  return valuations
    .map((v) => {
      const young = Date.parse(v.profile.created_at) > t0;
      return leaderboardRow(v, young ? stake(v) : (baseline.get(v.profile.id) ?? stake(v)));
    })
    .sort((a, b) => b.rangePct - a.rangePct);
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
  // the row is cached per request — the page and the metadata have already
  // read it — so this resolves at once, and the valuations and the history
  // go out together behind it
  const profile = await getProfileRow(username);
  if (!profile) return null;
  const [all, { data: history }] = await Promise.all([
    getAllValuations(),
    admin.from("portfolio_snapshots").select("*").eq("user_id", profile.id).order("day", { ascending: true }),
  ]);
  const idx = all.findIndex((v) => v.profile.id === profile.id);
  if (idx === -1) return null;

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
    // tiers are for people: the AI traders have no XP, and their prints
    // would be most of the trades table in a week
    const profiles = (
      await pageAll<{ id: string; invited_by: string | null; username?: string | null; is_bot?: boolean | null }>(
        (f, t) => admin.from("profiles").select("id, invited_by, username, is_bot").order("id").range(f, t)
      )
    ).filter((p) => !isBotProfile(p));
    const humans = profiles.map((p) => p.id);
    const byHuman = (table: "trades" | "ticker_votes") =>
      Promise.all(
        chunk(humans, 200).map((ids) =>
          pageAll<{ user_id: string }>((f, t) =>
            admin.from(table).select("user_id").in("user_id", ids).order("user_id").range(f, t)
          )
        )
      ).then((pages) => pages.flat());
    const [trades, votes, tickersRes] = await Promise.all([
      byHuman("trades"),
      byHuman("ticker_votes"),
      admin.from("tickers").select("listed_by"),
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
    for (const t of trades) bump(t.user_id, "trades");
    for (const v of votes) bump(v.user_id, "votes");
    for (const t of (tickersRes.data ?? []) as { listed_by: string | null }[]) bump(t.listed_by, "listings");
    for (const p of profiles) bump(p.invited_by, "invites");
    for (const [userId, c] of counts) xp.set(userId, computeXp(c));
  } catch {
    // XP layer degrades to zero
  }
  return xp;
}

/** Unread alert count for the nav badges. */
/** Unread alerts for the badge. Once per request, however many badges ask. */
export const getUnreadCount = cache(async (userId: string): Promise<number> => {
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
});

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
/**
 * One ticker by symbol, once per request: the metadata, the page and the
 * viewer's own rows all ask, and they all get the same read.
 */
export const getTickerRow = cache(async (symbol: string): Promise<Ticker | null> => {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("tickers").select("*").ilike("symbol", symbol).maybeSingle();
  return (data as Ticker | null) ?? null;
});

export async function tickerExists(symbol: string): Promise<boolean> {
  return (await getTickerRow(symbol)) !== null;
}

/** One profile by username, once per request — the same idea. */
export const getProfileRow = cache(async (username: string): Promise<Profile | null> => {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("profiles").select("*").ilike("username", username).maybeSingle();
  return (data as Profile | null) ?? null;
});

export async function profileExists(username: string): Promise<boolean> {
  return (await getProfileRow(username)) !== null;
}

/**
 * lib/bots.ts — the AI traders.
 *
 * A market with one human in it has nothing to play out. A population of
 * accounts run by code — a dozen named originals (lib/bot-roster) and, once
 * 0009 is applied and seeded, a thousand generated personas (lib/personas)
 * — read the same board a person sees and trade through the same door
 * (lib/trade placeOrder): same anchor, same fill curve, same float and
 * position limits, same ledger. Their prints are real prints, on the tape,
 * in the holders table, moving the hype curve. Only their judgement is
 * simulated, and the AI chip says so wherever a name shows.
 *
 * Every five minutes the round rolls every bot against its own activity
 * rate and the time of day, so most sleep through most rounds; the ones that
 * wake read the board, weigh it by their style mix, glance at what the
 * accounts they follow just did, and size to their own stake. Every decision
 * draws real entropy in production and a seeded generator in tests, exactly
 * like the weather — there is no formula to read ahead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOTS, type BotSpec, type BotStyle } from "@/lib/bot-roster";
import { cryptoRandom, type FlowRandom } from "@/lib/flow";
import { actChance, type Persona } from "@/lib/personas";
import {
  fairPrice,
  floatOf,
  positionLimit,
  settledPrice,
  valuationMultiple,
  type RevenueEvent,
  type TradeSide,
} from "@/lib/pricing";
import { latestEventMrr } from "@/lib/pulse";
import { composeThesis, type Situation } from "@/lib/theses";
import { placeOrder } from "@/lib/trade";

export { BOTS, isBotUsername } from "@/lib/bot-roster";

/** What a bot sees of one ticker. */
export interface TickerView {
  symbol: string;
  price: number;
  fair: number;
  float: number;
  /** Shares held across every account. */
  floatHeld: number;
  change1h: number;
  change24h: number;
  /** Revenue news of the last few hours: signed fraction of MRR, and age. */
  news: { move: number; ageMs: number }[];
  /** This bot's own position. */
  held: number;
  /** What the accounts this bot follows just did here: +1 per buy, −1 per sell. */
  herd: number;
  mrr: number;
}

export interface BotOrder {
  symbol: string;
  side: TradeSide;
  shares: number;
  note: string | null;
  reason: BotStyle;
}

/** Hard ceiling on prints per round, board-wide — a heartbeat, not a flood. */
export const MAX_TRADES_PER_ROUND = 40;

/** Standalone theses per round, board-wide. */
export const MAX_POSTS_PER_ROUND = 6;

/** Below this, a bot has no view worth trading. */
const MIN_CONVICTION = 0.15;

/** How much of the stake goes into one order at full conviction. */
const STAKE_PER_ORDER = 0.35;

/** How readily each holding habit lets go. */
const SELL_APPETITE = { paper: 1.5, swing: 1, diamond: 0.4 } as const;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Conviction in [-1, 1] for ONE style: positive wants to buy, negative wants
 * to sell. Pure, so the tests can pin every style's behaviour.
 */
export function conviction(style: BotStyle, v: TickerView, rng: FlowRandom): number {
  const edge = v.price > 0 && v.fair > 0 ? v.fair / v.price - 1 : 0;
  switch (style) {
    case "value":
      // a name 25% under fair value is a full-size buy; 25% over, a full sell
      return clamp(edge / 0.25, -1, 1);
    case "momentum": {
      // rides the tape: a 3% hour or a 10% day is a full-size chase
      const m = 0.6 * (v.change1h / 0.03) + 0.4 * (v.change24h / 0.1);
      return clamp(m, -1, 1);
    }
    case "news": {
      // reacts to revenue prints, less the older they are (hour half-life)
      let score = 0;
      for (const n of v.news) score += n.move * Math.pow(0.5, n.ageMs / 3_600_000);
      return clamp(score / 0.03, -1, 1);
    }
    case "noise":
      return (rng.unit() * 2 - 1) * 0.6;
    case "whale":
      // only moves on a real mispricing, and then moves size
      return Math.abs(edge) < 0.12 ? 0 : clamp(edge / 0.3, -1, 1);
  }
}

/** A persona's conviction: its style mix, plus the crowd it follows. */
export function personaConviction(p: Persona, v: TickerView, rng: FlowRandom): {
  c: number;
  reason: BotStyle;
} {
  let total = 0;
  let best: BotStyle = "noise";
  let bestAbs = -1;
  for (const [style, w] of Object.entries(p.styles) as [BotStyle, number][]) {
    const c = conviction(style, v, rng) * w;
    total += c;
    if (Math.abs(c) > bestAbs) {
      bestAbs = Math.abs(c);
      best = style;
    }
  }
  // herding: a buy by someone you follow is worth a bit of conviction on its
  // own, capped so a crowd cannot talk you into more than a half-size order
  total += clamp(v.herd * 0.2, -0.5, 0.5);
  return { c: clamp(total, -1, 1), reason: best };
}

/** The twelve originals as personas — always on, never asleep. */
export function personaFromSpec(spec: BotSpec): Persona {
  const activity = spec.style === "whale" ? 8 : 20;
  return {
    username: spec.username,
    name: spec.name,
    styles: { [spec.style]: 1 },
    cash: spec.cash,
    activityPerDay: activity,
    hold: spec.style === "momentum" || spec.style === "noise" ? "paper" : "swing",
    voice: spec.style === "noise" ? "degen" : spec.style === "whale" ? "founder" : "analyst",
    thesisRate: 0.4,
    postRate: 0.3,
    follows: [],
  };
}

/**
 * One bot, one round: what it does, if anything. Pure.
 *
 * Whether it acts at all is decided by the caller (actChance); this is the
 * "what". Sizing is a slice of the bot's OWN stake — a $200 account buys
 * $20 of something, a $200k account buys a real position — and respects
 * everything the ledger will: cash on a buy with slack for the curve, the
 * position limit, the shares actually left in the float, the position on a
 * sell.
 */
export function decide(
  p: Persona,
  cash: number,
  views: TickerView[],
  rng: FlowRandom
): BotOrder | null {
  const scored = views
    .map((v) => ({ v, ...personaConviction(p, v, rng) }))
    .filter(({ v, c }) => c >= MIN_CONVICTION || (c <= -MIN_CONVICTION && v.held > 0))
    .map((x) => ({ ...x, w: Math.abs(x.c) * (0.7 + 0.6 * rng.unit()) }))
    .sort((a, b) => b.w - a.w);
  if (scored.length === 0) return null;
  const { v, c, reason } = scored[0];
  const side: TradeSide = c > 0 ? "buy" : "sell";

  let shares: number;
  if (side === "buy") {
    const notional = cash * STAKE_PER_ORDER * (0.3 + 0.7 * Math.abs(c)) * (0.6 + 0.8 * rng.unit());
    const room = Math.max(0, positionLimit(v.float) - v.held);
    const left = Math.max(0, v.float - v.floatHeld);
    // slack for the fill curve: a big order pays above the mark
    const affordable = v.price > 0 ? Math.floor(cash / (v.price * 1.12)) : 0;
    // a small account whose slice is less than one share still buys the one
    // share it can afford — that is what a $40 account does with conviction
    let want = Math.floor(notional / v.price);
    if (want < 1 && affordable >= 1) want = 1;
    shares = Math.min(want, room, left, affordable);
  } else {
    const appetite = SELL_APPETITE[p.hold];
    shares = Math.min(v.held, Math.max(1, Math.round(v.held * clamp(Math.abs(c) * appetite, 0.1, 1))));
  }
  if (!(shares >= 1)) return null;

  let note: string | null = null;
  if (rng.unit() < p.thesisRate) {
    note = composeThesis(p, situationFor(v, side, reason), rng);
  }
  return { symbol: v.symbol, side, shares, note, reason };
}

function situationFor(
  v: TickerView,
  side: "buy" | "sell" | null,
  reason: BotStyle | "take"
): Situation {
  const freshest = [...v.news].sort((a, b) => a.ageMs - b.ageMs)[0];
  return {
    symbol: v.symbol,
    side,
    reason,
    edgePct: v.price > 0 ? (v.fair / v.price - 1) * 100 : 0,
    change1hPct: v.change1h * 100,
    change24hPct: v.change24h * 100,
    newsKind: freshest ? (freshest.move >= 0 ? "new" : "churn") : null,
    price: v.price,
    fair: v.fair,
    mrr: v.mrr,
  };
}

export interface BotRoundResult {
  bots: number;
  awake: number;
  attempted: number;
  filled: number;
  posted: number;
  errors: string[];
  /** Set when no bot accounts exist yet. */
  unavailable?: boolean;
}

interface Account {
  id: string;
  username: string;
  cash: number;
  persona: Persona;
}

/** Every bot account: the flagged population (0009), else the roster. */
async function loadPopulation(admin: SupabaseClient): Promise<Account[]> {
  const specByName = new Map(BOTS.map((b) => [b.username, b]));
  const flagged = await admin
    .from("profiles")
    .select("id, username, cash, persona")
    .eq("is_bot", true)
    .limit(5000);
  const rows: { id: string; username: string; cash: number; persona?: unknown }[] = [];
  if (!flagged.error && flagged.data && flagged.data.length > 0) {
    rows.push(...(flagged.data as typeof rows));
  } else {
    // pre-0009: the roster is the population
    const { data } = await admin
      .from("profiles")
      .select("id, username, cash")
      .in(
        "username",
        BOTS.map((b) => b.username)
      );
    rows.push(...((data ?? []) as typeof rows));
  }
  return rows.flatMap((r) => {
    const stored = r.persona as Persona | null | undefined;
    const spec = specByName.get(r.username);
    const persona =
      stored && typeof stored === "object" && stored.styles
        ? { ...stored, username: r.username, follows: stored.follows ?? [] }
        : spec
          ? personaFromSpec(spec)
          : null;
    if (!persona) return [];
    return [{ id: r.id, username: r.username, cash: Number(r.cash), persona }];
  });
}

/**
 * One round for the whole population: roll everyone against their activity
 * and the clock, build the awake ones' view of the board off the same
 * numbers the quote uses, let each decide, and put the orders through
 * placeOrder. A few of the ones that did not trade post a thesis instead.
 * Bounded by MAX_TRADES_PER_ROUND and MAX_POSTS_PER_ROUND.
 */
export async function runBotRound(
  admin: SupabaseClient,
  opts: { now?: number; rng?: FlowRandom; maxTrades?: number; maxPosts?: number } = {}
): Promise<BotRoundResult> {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? cryptoRandom();
  const maxTrades = opts.maxTrades ?? MAX_TRADES_PER_ROUND;
  const maxPosts = opts.maxPosts ?? MAX_POSTS_PER_ROUND;
  const out: BotRoundResult = { bots: 0, awake: 0, attempted: 0, filled: 0, posted: 0, errors: [] };

  const population = await loadPopulation(admin);
  if (population.length === 0) return { ...out, unavailable: true };
  out.bots = population.length;

  // who wakes up this round — decided before the board is read, since most
  // rounds most of a thousand accounts are asleep and the board is not free
  const awake = population.filter((a) => rng.unit() < actChance(a.persona, now));
  out.awake = awake.length;
  if (awake.length === 0) return out;

  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const newsSince = new Date(now - 4 * 3_600_000).toISOString();
  const herdSince = new Date(now - 15 * 60_000).toISOString();
  const botIds = new Set(population.map((a) => a.id));
  const usernameOf = new Map(population.map((a) => [a.id, a.username]));
  const [
    { data: tickers },
    { data: reports },
    { data: conns },
    latest,
    { data: newsRows },
    { data: holdings },
    { data: ticksAgo },
    { data: snaps },
    { data: recentPrints },
  ] = await Promise.all([
    admin.from("tickers").select("*"),
    admin.from("mrr_updates").select("ticker_id, month, mrr").order("month", { ascending: true }),
    admin.from("stripe_connections").select("ticker_id, live_mrr").eq("status", "active"),
    latestEventMrr(admin),
    admin
      .from("revenue_events")
      .select("ticker_id, at, prev_mrr, mrr, prev_subscriptions")
      .gte("at", newsSince)
      .order("at", { ascending: true }),
    admin.from("holdings").select("user_id, ticker_id, shares").gt("shares", 0),
    admin
      .from("flow_ticks")
      .select("ticker_id, at, price")
      .lte("at", hourAgo)
      .order("at", { ascending: false })
      .limit(1000),
    admin.from("price_snapshots").select("ticker_id, price").eq("day", dayAgo),
    // what everyone printed in the last quarter hour — the herd signal
    admin
      .from("trades")
      .select("user_id, ticker_id, side")
      .gte("created_at", herdSince)
      .limit(2000),
  ]);

  const history = new Map<string, { month: string; mrr: number }[]>();
  for (const r of (reports ?? []) as { ticker_id: string; month: string; mrr: number }[]) {
    const l = history.get(r.ticker_id) ?? [];
    l.push({ month: r.month, mrr: Number(r.mrr) });
    history.set(r.ticker_id, l);
  }
  const live = new Map<string, number>();
  for (const c of (conns ?? []) as { ticker_id: string; live_mrr: number | null }[]) {
    if (c.live_mrr !== null && Number(c.live_mrr) > 0) live.set(c.ticker_id, Number(c.live_mrr));
  }
  const news = new Map<string, RevenueEvent[]>();
  for (const e of (newsRows ?? []) as {
    ticker_id: string;
    at: string;
    prev_mrr: number;
    mrr: number;
    prev_subscriptions: number | null;
  }[]) {
    const l = news.get(e.ticker_id) ?? [];
    l.push({ at: Date.parse(e.at), mrr: Number(e.mrr), prevMrr: Number(e.prev_mrr), catchUp: e.prev_subscriptions === null });
    news.set(e.ticker_id, l);
  }
  const floatHeld = new Map<string, number>();
  const mine = new Map<string, number>(); // `${userId}/${tickerId}` → shares
  for (const h of (holdings ?? []) as { user_id: string; ticker_id: string; shares: number }[]) {
    floatHeld.set(h.ticker_id, (floatHeld.get(h.ticker_id) ?? 0) + Number(h.shares));
    mine.set(`${h.user_id}/${h.ticker_id}`, Number(h.shares));
  }
  const priceHourAgo = new Map<string, number>();
  for (const k of (ticksAgo ?? []) as { ticker_id: string; price: number }[]) {
    if (!priceHourAgo.has(k.ticker_id)) priceHourAgo.set(k.ticker_id, Number(k.price));
  }
  const priceDayAgo = new Map<string, number>();
  for (const s of (snaps ?? []) as { ticker_id: string; price: number }[]) {
    priceDayAgo.set(s.ticker_id, Number(s.price));
  }
  // recent prints by bots, keyed by the printer's username, per ticker
  const printsBy = new Map<string, { tickerId: string; side: TradeSide }[]>();
  for (const t of (recentPrints ?? []) as { user_id: string; ticker_id: string; side: TradeSide }[]) {
    if (!botIds.has(t.user_id)) continue;
    const u = usernameOf.get(t.user_id)!;
    const l = printsBy.get(u) ?? [];
    l.push({ tickerId: t.ticker_id, side: t.side });
    printsBy.set(u, l);
  }

  // the board as the quote prices it, minus the shimmer
  const board = ((tickers ?? []) as Record<string, unknown>[])
    .map((t) => {
      const id = String(t.id);
      const record = history.get(id) ?? [];
      const reported = record.length ? record[record.length - 1].mrr : 0;
      const mrr = live.get(id) ?? latest.get(id)?.mrr ?? reported;
      const multiple = valuationMultiple(record);
      const float = floatOf(t.shares_outstanding as number | null);
      const events = news.get(id) ?? [];
      const price = settledPrice(mrr, Number(t.sentiment ?? 0), now, multiple, float, events, Number(t.drift ?? 0));
      const ago1h = priceHourAgo.get(id);
      const ago24h = priceDayAgo.get(id);
      return {
        id,
        symbol: String(t.symbol),
        price,
        fair: fairPrice(mrr, multiple, float),
        float,
        floatHeld: floatHeld.get(id) ?? 0,
        change1h: ago1h && ago1h > 0 ? price / ago1h - 1 : 0,
        change24h: ago24h && ago24h > 0 ? price / ago24h - 1 : 0,
        news: events
          .filter((e) => !e.catchUp && e.prevMrr > 0)
          .map((e) => ({ move: (e.mrr - e.prevMrr) / e.prevMrr, ageMs: now - e.at })),
        mrr,
      };
    })
    .filter((v) => v.price > 0);

  const viewsFor = (a: Account): TickerView[] =>
    board.map((v) => {
      let herd = 0;
      for (const u of a.persona.follows) {
        for (const pr of printsBy.get(u) ?? []) {
          if (pr.tickerId === v.id) herd += pr.side === "buy" ? 1 : -1;
        }
      }
      return {
        symbol: v.symbol,
        price: v.price,
        fair: v.fair,
        float: v.float,
        floatHeld: v.floatHeld,
        change1h: v.change1h,
        change24h: v.change24h,
        news: v.news,
        held: mine.get(`${a.id}/${v.id}`) ?? 0,
        herd,
        mrr: v.mrr,
      };
    });

  // shuffle so the same bot is not always first to the trough
  const roster = [...awake].sort(() => rng.unit() - 0.5);
  const idle: Account[] = [];
  for (const account of roster) {
    if (out.filled >= maxTrades) break;
    const o = decide(account.persona, account.cash, viewsFor(account), rng);
    if (!o) {
      idle.push(account);
      continue;
    }
    out.attempted++;
    const result = await placeOrder(
      admin,
      { userId: account.id, symbol: o.symbol, side: o.side, shares: o.shares, note: o.note ?? undefined },
      { now }
    );
    if (!result.ok) {
      out.errors.push(`${account.username} ${o.side} ${o.shares} ${o.symbol}: ${result.error}`);
      continue;
    }
    await result.settle();
    out.filled++;
    // keep the board honest for the next bot in the same round
    const v = board.find((b) => b.symbol === o.symbol);
    if (v) {
      const signed = o.side === "buy" ? o.shares : -o.shares;
      v.floatHeld += signed;
      const key = `${account.id}/${v.id}`;
      mine.set(key, (mine.get(key) ?? 0) + signed);
      account.cash = Number(account.cash) + (o.side === "buy" ? -result.total : result.total);
      const l = printsBy.get(account.username) ?? [];
      l.push({ tickerId: v.id, side: o.side });
      printsBy.set(account.username, l);
    }
  }

  // a few of the ones with nothing to trade say something instead
  for (const account of idle) {
    if (out.posted >= maxPosts) break;
    if (rng.unit() >= account.persona.postRate / 288) continue;
    const views = viewsFor(account);
    // talk about what you hold, else about whatever is most mispriced
    const held = views.filter((v) => v.held > 0);
    const pool = held.length ? held : [...views].sort((a, b) => Math.abs(b.fair / b.price - 1) - Math.abs(a.fair / a.price - 1)).slice(0, 5);
    const v = pool[Math.floor(rng.unit() * pool.length)];
    if (!v) continue;
    const tickerId = board.find((b) => b.symbol === v.symbol)?.id;
    if (!tickerId) continue;
    const body = composeThesis(account.persona, situationFor(v, null, "take"), rng);
    const edge = v.fair / v.price - 1;
    const stance = edge > 0.08 ? 1 : edge < -0.08 ? -1 : null;
    const { error } = await admin.from("posts").insert({ ticker_id: tickerId, user_id: account.id, body, stance });
    if (!error) out.posted++;
  }
  return out;
}

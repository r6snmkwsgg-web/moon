/**
 * lib/bots.ts — the AI traders.
 *
 * A market with one human in it has nothing to play out. These are a dozen
 * accounts run by code, each with a style — value, momentum, news, noise, a
 * couple of whales — that read the same board a person sees and trade through
 * the same door (lib/trade placeOrder): same anchor, same fill curve, same
 * float and position limits, same ledger. Their prints are real prints, on
 * the tape, in the holders table, moving the hype curve. Only their judgement
 * is simulated, and the roster (lib/bot-roster) says so wherever a name shows.
 *
 * Every decision draws real entropy in production and a seeded generator in
 * tests, exactly like the weather — there is no formula to read ahead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOTS, type BotSpec, type BotStyle } from "@/lib/bot-roster";
import { cryptoRandom, type FlowRandom } from "@/lib/flow";
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
}

export interface BotOrder {
  symbol: string;
  side: TradeSide;
  shares: number;
  note: string | null;
}

/** Hard ceiling on prints per round, board-wide — a heartbeat, not a flood. */
export const MAX_TRADES_PER_ROUND = 6;

/**
 * How often each style pulls the trigger in a given round, and how big it
 * goes at full conviction. Big and rare, on purpose: a 1.2%-of-float buy
 * prints as a jump on the chart, and that is how a thin market actually
 * moves — someone shows up with size and the price gaps. (A tuning toward
 * many small prints was tried and taken back at the founder's request.)
 */
const ACT_CHANCE: Record<BotStyle, number> = {
  value: 0.25,
  momentum: 0.3,
  news: 0.35,
  noise: 0.22,
  whale: 0.06,
};

/** Order size at full conviction, as a fraction of the float. */
const SIZE_OF_FLOAT: Record<BotStyle, number> = {
  value: 0.012,
  momentum: 0.01,
  news: 0.015,
  noise: 0.005,
  whale: 0.035,
};

/** Below this, a bot has no view worth trading. */
const MIN_CONVICTION = 0.15;

/** How far a bot goes on a note. */
const NOTE_CHANCE = 0.4;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Conviction in [-1, 1]: positive wants to buy, negative wants to sell.
 * Pure, so the tests can pin every style's behaviour.
 */
export function conviction(
  style: BotStyle,
  v: TickerView,
  rng: FlowRandom
): number {
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
      for (const n of v.news) {
        score += n.move * Math.pow(0.5, n.ageMs / 3_600_000);
      }
      // a 3% MRR move is a full-size reaction
      return clamp(score / 0.03, -1, 1);
    }
    case "noise":
      return (rng.unit() * 2 - 1) * 0.6;
    case "whale":
      // only moves on a real mispricing, and then moves size
      return Math.abs(edge) < 0.12 ? 0 : clamp(edge / 0.3, -1, 1);
  }
}

const NOTES: Record<BotStyle, { buy: string[]; sell: string[] }> = {
  value: {
    buy: [
      "{pct}% under fair value. revenue says cheap.",
      "mrr is the anchor and the anchor is above the price. adding.",
      "paying {price} for a business worth {fair}. yes please.",
    ],
    sell: [
      "{pct}% over fair. taking it off.",
      "hype is doing the work here, not revenue. trimming.",
    ],
  },
  momentum: {
    buy: ["up {h1}% on the hour. riding it.", "trend is the friend. in."],
    sell: ["{h1}% on the hour the wrong way. out.", "momentum gone. flat."],
  },
  news: {
    buy: ["new logo just printed. adding on the news.", "expansion on the tape. buying the print."],
    sell: ["churn just printed. not sticking around.", "downgrade on the tape. lightening up."],
  },
  noise: {
    buy: ["vibes.", "dip.", "felt like it."],
    sell: ["taking the win.", "need the cash for something dumber."],
  },
  whale: {
    buy: ["size position. fair value is {fair}.", "accumulating. this is mispriced."],
    sell: ["distribution. {pct}% over fair is a gift.", "size out."],
  },
};

function fmt(n: number): string {
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

function pick<T>(xs: T[], rng: FlowRandom): T {
  return xs[Math.min(xs.length - 1, Math.floor(rng.unit() * xs.length))];
}

/**
 * One bot, one round: does it trade, what, and how much. Pure.
 *
 * Sizing respects everything the ledger will: cash on a buy (with slack for
 * the fill curve), the position limit, the shares actually left in the float,
 * and the position on a sell.
 */
export function decide(
  bot: BotSpec,
  cash: number,
  views: TickerView[],
  rng: FlowRandom
): BotOrder | null {
  const style = bot.style;
  const hasNews = views.some((v) => v.news.length > 0);
  const chance = style === "news" && !hasNews ? 0 : ACT_CHANCE[style];
  if (rng.unit() >= chance) return null;

  // every ticker gets a view; the strongest tradeable one wins, with a little
  // randomness so two value bots do not always pile into the same name
  const scored = views
    .map((v) => ({ v, c: conviction(style, v, rng) }))
    .filter(({ v, c }) => (c >= MIN_CONVICTION) || (c <= -MIN_CONVICTION && v.held > 0))
    .map((x) => ({ ...x, w: Math.abs(x.c) * (0.7 + 0.6 * rng.unit()) }))
    .sort((a, b) => b.w - a.w);
  if (scored.length === 0) return null;
  const { v, c } = scored[0];
  const side: TradeSide = c > 0 ? "buy" : "sell";

  let shares = Math.round(
    v.float * SIZE_OF_FLOAT[style] * Math.abs(c) * (0.6 + 0.8 * rng.unit())
  );
  if (side === "buy") {
    const room = Math.max(0, positionLimit(v.float) - v.held);
    const left = Math.max(0, v.float - v.floatHeld);
    // slack for the fill curve: a big order pays above the mark
    const affordable = v.price > 0 ? Math.floor(cash / (v.price * 1.12)) : 0;
    shares = Math.min(shares, room, left, affordable);
  } else {
    shares = Math.min(shares, v.held);
  }
  if (shares < 1) return null;

  let note: string | null = null;
  if (rng.unit() < NOTE_CHANCE) {
    const edge = v.fair / v.price - 1;
    note = pick(NOTES[style][side], rng)
      .replace("{pct}", Math.abs(edge * 100).toFixed(0))
      .replace("{price}", fmt(v.price))
      .replace("{fair}", fmt(v.fair))
      .replace("{h1}", Math.abs(v.change1h * 100).toFixed(1));
  }
  return { symbol: v.symbol, side, shares, note };
}

export interface BotRoundResult {
  bots: number;
  attempted: number;
  filled: number;
  errors: string[];
  /** Set when the bot accounts have not been seeded yet. */
  unavailable?: boolean;
}

/**
 * One round for the whole roster: build every bot's view of the board off
 * the same numbers the quote uses, let each decide, and put the orders
 * through placeOrder. Bounded by MAX_TRADES_PER_ROUND.
 */
export async function runBotRound(
  admin: SupabaseClient,
  opts: { now?: number; rng?: FlowRandom; maxTrades?: number } = {}
): Promise<BotRoundResult> {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? cryptoRandom();
  const maxTrades = opts.maxTrades ?? MAX_TRADES_PER_ROUND;
  const out: BotRoundResult = { bots: 0, attempted: 0, filled: 0, errors: [] };

  const { data: botRows } = await admin
    .from("profiles")
    .select("id, username, cash")
    .in(
      "username",
      BOTS.map((b) => b.username)
    );
  const accounts = (botRows ?? []) as { id: string; username: string; cash: number }[];
  if (accounts.length === 0) return { ...out, unavailable: true };
  out.bots = accounts.length;

  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const newsSince = new Date(now - 4 * 3_600_000).toISOString();
  const [
    { data: tickers },
    { data: reports },
    { data: conns },
    latest,
    { data: newsRows },
    { data: holdings },
    { data: ticksAgo },
    { data: snaps },
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
    // the newest recorded tick at or before an hour ago, per ticker: the
    // first row seen per ticker in this newest-first page is it
    admin
      .from("flow_ticks")
      .select("ticker_id, at, price")
      .lte("at", hourAgo)
      .order("at", { ascending: false })
      .limit(1000),
    admin.from("price_snapshots").select("ticker_id, price").eq("day", dayAgo),
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
    l.push({
      at: Date.parse(e.at),
      mrr: Number(e.mrr),
      prevMrr: Number(e.prev_mrr),
      catchUp: e.prev_subscriptions === null,
    });
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

  // the board as the quote prices it, minus the shimmer
  const board = ((tickers ?? []) as Record<string, unknown>[]).map((t) => {
    const id = String(t.id);
    const record = history.get(id) ?? [];
    const reported = record.length ? record[record.length - 1].mrr : 0;
    const mrr = live.get(id) ?? latest.get(id)?.mrr ?? reported;
    const multiple = valuationMultiple(record);
    const float = floatOf(t.shares_outstanding as number | null);
    const events = news.get(id) ?? [];
    const price = settledPrice(
      mrr,
      Number(t.sentiment ?? 0),
      now,
      multiple,
      float,
      events,
      Number(t.drift ?? 0)
    );
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
    };
  }).filter((v) => v.price > 0);

  // shuffle so the same bot is not always first to the trough
  const roster = [...accounts].sort(() => rng.unit() - 0.5);
  for (const account of roster) {
    if (out.filled >= maxTrades) break;
    const spec = BOTS.find((b) => b.username === account.username);
    if (!spec) continue;
    const views: TickerView[] = board.map((v) => ({
      symbol: v.symbol,
      price: v.price,
      fair: v.fair,
      float: v.float,
      floatHeld: v.floatHeld,
      change1h: v.change1h,
      change24h: v.change24h,
      news: v.news,
      held: mine.get(`${account.id}/${v.id}`) ?? 0,
    }));
    const o = decide(spec, Number(account.cash), views, rng);
    if (!o) continue;
    out.attempted++;
    const result = await placeOrder(
      admin,
      {
        userId: account.id,
        symbol: o.symbol,
        side: o.side,
        shares: o.shares,
        note: o.note ?? undefined,
      },
      { now }
    );
    if (!result.ok) {
      out.errors.push(
        `${account.username} ${o.side} ${o.shares} ${o.symbol}: ${result.error}`
      );
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
      account.cash =
        Number(account.cash) + (o.side === "buy" ? -result.total : result.total);
    }
  }
  return out;
}

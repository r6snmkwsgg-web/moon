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
import { actChance, myFairValue, timeOfDayFactor, type Persona } from "@/lib/personas";
import { pageAll } from "@/lib/supabase/page-all";
import { CALL_DISCOUNT, CALL_NEWS_MS, credibility, type CallOutcome } from "@/lib/calls";
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
import { composeThesis, stageOf, type Situation } from "@/lib/theses";
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
  /** The last quarter hour — a dump shows up here first. */
  change15m: number;
  /** News of the last few hours — a revenue print, a founder's call, a buyback — as a signed move, and its age. */
  news: { move: number; ageMs: number; kind?: "revenue" | "call" | "buyback" }[];
  /** This bot's own position, and what it paid on average (0 without one). */
  held: number;
  avgCost: number;
  /** A leader this bot follows holds the name — their conviction is borrowed. */
  leaderHolds: boolean;
  /** That leader, by tape name, for the line that credits them. */
  leaderName?: string | null;
  /** Accounts holding the name. */
  holders?: number;
  /** The biggest print behind the last half hour's move, if one is big enough to blame. */
  culprit?: Culprit | null;
  /** What the accounts this bot follows just did here: +1 per buy, −1 per sell. */
  herd: number;
  mrr: number;
}

/** The account behind a move: the biggest print the right way in the last half hour. */
export interface Culprit {
  /** As the tape names them; "@handle" for a person. */
  name: string;
  side: TradeSide;
  total: number;
  shares: number;
  /** shares over the float, in percent */
  pctOfFloat: number;
  ageMs: number;
  human: boolean;
}

export interface RecentPrint {
  userId: string;
  tickerId: string;
  side: TradeSide;
  shares: number;
  total: number;
  at: number;
  name: string;
  username: string | null;
  bot: boolean;
}

/** A print worth blaming: this much of the float, or this many dollars. */
export const CULPRIT_MIN_PCT = 1.5;
export const CULPRIT_MIN_TOTAL = 1_500;

/**
 * Who moved it. For a drop, the biggest sell of the last half hour; for a
 * pump, the biggest buy. Nobody, if the biggest one was too small to matter
 * — then the move was the crowd, or the weather, and no name goes on it.
 */
export function pickCulprit(
  prints: RecentPrint[],
  tickerId: string,
  float: number,
  direction: "down" | "up",
  now: number
): Culprit | null {
  const side: TradeSide = direction === "down" ? "sell" : "buy";
  let best: RecentPrint | null = null;
  for (const pr of prints) {
    if (pr.tickerId !== tickerId || pr.side !== side) continue;
    if (!best || pr.total > best.total) best = pr;
  }
  if (!best) return null;
  const pct = float > 0 ? (best.shares / float) * 100 : 0;
  if (pct < CULPRIT_MIN_PCT && best.total < CULPRIT_MIN_TOTAL) return null;
  return {
    name: best.bot ? best.name : `@${best.username ?? best.name}`,
    side,
    total: best.total,
    shares: best.shares,
    pctOfFloat: pct,
    ageMs: now - best.at,
    human: !best.bot,
  };
}

/** What carried a decision: a style, or one of the two reflexes. */
export type Reason = BotStyle | "panic" | "dip";

export interface BotOrder {
  symbol: string;
  side: TradeSide;
  shares: number;
  note: string | null;
  reason: Reason;
}

/** Hard ceiling on prints per round, board-wide — a heartbeat, not a flood. */
export const MAX_TRADES_PER_ROUND = 40;

/** Standalone theses per round, board-wide. */
export const MAX_POSTS_PER_ROUND = 12;
/** Tickers filling at once in a round. */
export const FILL_CONCURRENCY = 4;
/** How long a round may spend filling before it stops — the cron has sixty seconds for everything. */
export const ROUND_BUDGET_MS = 30_000;

/** Below this, a bot has no view worth trading. */
const MIN_CONVICTION = 0.15;

/** How much of the stake goes into one order at full conviction. */
const STAKE_PER_ORDER = 0.35;

/** How readily each holding habit lets go. */
const SELL_APPETITE = { paper: 1.5, swing: 1, diamond: 0.4 } as const;

/**
 * A quarter-hour move this big shakes a ticker's holders awake and they
 * decide with the panic reflex in the blend. A 6.5%-of-float dump is -12%.
 */
export const SHAKE_MOVE = 0.05;
/** Chance a holder wakes when their ticker is shaken, by grip, at a full-size move. */
export const SHAKE_WAKE = { paper: 0.8, swing: 0.4, diamond: 0.1 } as const;
/** Chance a value or whale account wakes to buy a shaken ticker it does not hold. */
export const DIP_WAKE = 0.12;
/** Chance a holder of a shaken name posts about it this round, by grip. */
export const SHAKE_POST = { paper: 0.3, swing: 0.15, diamond: 0.08 } as const;
/** How hard the drop pushes a holder toward selling, by grip. */
const PANIC = { paper: 1.2, swing: 0.6, diamond: 0.1 } as const;
/**
 * How many extra accounts a shake may wake in one round. Waking is cheap —
 * the fills are what the round budget bounds — and a low cap here meant one
 * ticker's holders used it up before the next ticker's were even rolled.
 */
export const MAX_SHAKEN = 200;
/** The floor talks twice as much as the personas' own rate says — thirty listings is a lot of floor. */
export const POST_SCALE = 2;
/** Hearts the population leaves on the floor per round, at most. */
export const MAX_LIKES_PER_ROUND = 20;
/** Votes the population casts on the community gauges per round, at most. */
export const MAX_VOTES_PER_ROUND = 40;

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
export function personaConviction(
  p: Persona,
  view: TickerView,
  rng: FlowRandom,
  now = Date.now()
): {
  c: number;
  reason: Reason;
} {
  // nobody trades the formula: they trade their own read of it, which is
  // wrong by a personal, persistent amount — so accounts disagree, some buy
  // what others sell, and none of them knows exactly when
  const v: TickerView = { ...view, fair: myFairValue(p, view.symbol, view.fair, now) };
  let total = 0;
  let best: Reason = "noise";
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
  total += clamp(v.herd * 0.2, -0.6, 0.6);
  // a leader adds to their own call and does not chase the exit
  if (p.leader && v.held > 0 && total > 0) total += 0.2;
  if (p.leader && total < 0) total *= 0.5;

  // The reflexes. A holder watching their name drop a tenth in a quarter
  // hour does not consult a model: paper hands are out, swing hands trim,
  // diamond hands look away. And a value account with cash watching the
  // same drop on NO bad news sees a seller, not a churn — and buys it.
  const drop = Math.max(0, -v.change15m, -v.change1h * 0.5);
  if (v.held > 0 && drop >= 0.03) {
    // half the panic if someone you follow is still in — that is what a leader is for
    const panic = PANIC[p.hold] * clamp(drop / 0.08, 0, 1) * (v.leaderHolds ? 0.5 : 1);
    total -= panic;
    if (panic > bestAbs) {
      bestAbs = panic;
      best = "panic";
    }
  } else if (drop >= SHAKE_MOVE && v.held === 0) {
    const badNews = v.news.some((n) => n.move < 0 && n.ageMs < 2 * 3_600_000);
    const edge = v.price > 0 && v.fair > 0 ? v.fair / v.price - 1 : 0;
    const eye = (p.styles.value ?? 0) + (p.styles.whale ?? 0);
    if (!badNews && edge > 0.05 && eye > 0) {
      const dip = eye * clamp(drop / 0.1, 0, 1) * 0.8;
      total += dip;
      if (dip > bestAbs) {
        bestAbs = dip;
        best = "dip";
      }
    }
  }
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
    const appetite = SELL_APPETITE[p.hold] * (p.leader ? 0.5 : 1);
    const frac = clamp(Math.abs(c) * appetite, 0.1, 1);
    // a near-full sell is a full sell — nobody leaves seven shares behind
    shares = frac >= 0.9 ? v.held : Math.min(v.held, Math.max(1, Math.round(v.held * frac)));
  }
  if (!(shares >= 1)) return null;

  let note: string | null = null;
  // a panic or a dip buy is worth saying out loud more often than a routine print
  const rate =
    reason === "panic" || reason === "dip"
      ? Math.max(p.thesisRate, v.culprit ? 0.85 : 0.6)
      : p.thesisRate;
  if (rng.unit() < rate) {
    // the note cites this account's own fair value, not the formula's
    const mine = { ...v, fair: myFairValue(p, v.symbol, v.fair, Date.now()) };
    note = composeThesis(p, situationFor(mine, side, reason, p), rng);
  }
  return { symbol: v.symbol, side, shares, note, reason };
}

function situationFor(
  v: TickerView,
  side: "buy" | "sell" | null,
  reason: Reason | "take",
  p?: Persona
): Situation {
  const freshest = [...v.news].sort((a, b) => a.ageMs - b.ageMs)[0];
  return {
    symbol: v.symbol,
    side,
    reason,
    stage: stageOf(v.change24h, v.change1h, v.change15m),
    pnlPct: v.held > 0 && v.avgCost > 0 ? (v.price / v.avgCost - 1) * 100 : null,
    heldValue: v.held * v.price,
    leader: v.leaderName ?? null,
    holders: v.holders ?? 0,
    isLeader: Boolean(p?.leader),
    edgePct: v.price > 0 ? (v.fair / v.price - 1) * 100 : 0,
    change1hPct: v.change1h * 100,
    change24hPct: v.change24h * 100,
    change15mPct: v.change15m * 100,
    shaken:
      Math.abs(v.change15m) >= SHAKE_MOVE || Math.abs(v.change1h) >= SHAKE_MOVE * 1.6
        ? (v.change15m || v.change1h) < 0
          ? "down"
          : "up"
        : null,
    culprit: v.culprit?.name ?? null,
    culpritAmt: v.culprit?.total,
    culpritPct: v.culprit?.pctOfFloat,
    newsKind: freshest
      ? freshest.kind === "call"
        ? "call"
        : freshest.kind === "buyback"
          ? "buyback"
          : freshest.move >= 0
            ? "new"
            : "churn"
      : null,
    price: v.price,
    fair: v.fair,
    mrr: v.mrr,
  };
}

export interface BotRoundResult {
  bots: number;
  awake: number;
  /** Of the awake, how many a price shake woke. */
  shaken?: number;
  /** Hearts left on the floor this round. */
  liked?: number;
  /** Votes cast on the gauges this round. */
  voted?: number;
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
  const rows: { id: string; username: string; cash: number; persona?: unknown }[] = [];
  let flagged: typeof rows = [];
  try {
    // past the API's thousand-row page — read every page
    flagged = await pageAll<(typeof rows)[number]>((f, t) =>
      admin.from("profiles").select("id, username, cash, persona").eq("is_bot", true).order("id").range(f, t)
    );
  } catch {
    // pre-0009: no is_bot column
  }
  if (flagged.length > 0) {
    rows.push(...flagged);
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
  opts: { now?: number; rng?: FlowRandom; maxTrades?: number; maxPosts?: number; budgetMs?: number } = {}
): Promise<BotRoundResult> {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? cryptoRandom();
  const maxTrades = opts.maxTrades ?? MAX_TRADES_PER_ROUND;
  const maxPosts = opts.maxPosts ?? MAX_POSTS_PER_ROUND;
  const budgetMs = opts.budgetMs ?? ROUND_BUDGET_MS;
  const out: BotRoundResult = { bots: 0, awake: 0, attempted: 0, filled: 0, posted: 0, errors: [] };

  const population = await loadPopulation(admin);
  if (population.length === 0) return { ...out, unavailable: true };
  out.bots = population.length;

  // who wakes up this round — decided before the board is read, since most
  // rounds most of a thousand accounts are asleep and the board is not free
  const awake = population.filter((a) => rng.unit() < actChance(a.persona, now));

  const hourAgo = new Date(now - 3_600_000).toISOString();
  const quarterAgo = new Date(now - 15 * 60_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const newsSince = new Date(now - 4 * 3_600_000).toISOString();
  const herdSince = now - 30 * 60_000;
  const blameSince = new Date(now - 30 * 60_000).toISOString();
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
    { data: ticksQuarterAgo },
    { data: snaps },
    { data: recentPrints },
    { data: recentCalls },
    { data: recentBuybacks },
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
    pageAll<{ user_id: string; ticker_id: string; shares: number; avg_cost?: number }>((f, t) =>
      admin
        .from("holdings")
        .select("user_id, ticker_id, shares, avg_cost")
        .gt("shares", 0)
        .order("user_id")
        .order("ticker_id")
        .range(f, t)
    ).then((data) => ({ data })),
    admin
      .from("flow_ticks")
      .select("ticker_id, at, price")
      .lte("at", hourAgo)
      .order("at", { ascending: false })
      .limit(1000),
    admin
      .from("flow_ticks")
      .select("ticker_id, at, price")
      .lte("at", quarterAgo)
      .order("at", { ascending: false })
      .limit(1000),
    admin.from("price_snapshots").select("ticker_id, price").eq("day", dayAgo),
    // what everyone printed in the last half hour — the herd signal, and
    // the name on the move
    admin
      .from("trades")
      .select("user_id, ticker_id, side, shares, total, created_at, profiles(display_name, username, is_bot, username)")
      .gte("created_at", blameSince)
      .order("created_at", { ascending: false })
      .limit(2000),
    // the founders' moves (0012): every call for credibility, the recent ones as news
    admin.from("calls").select("ticker_id, user_id, guidance, outcome, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("buybacks").select("ticker_id, shares, created_at").gte("created_at", new Date(now - CALL_NEWS_MS).toISOString()).limit(200),
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
  const myAvg = new Map<string, number>(); // `${userId}/${tickerId}` → avg cost
  for (const h of (holdings ?? []) as { user_id: string; ticker_id: string; shares: number }[]) {
    floatHeld.set(h.ticker_id, (floatHeld.get(h.ticker_id) ?? 0) + Number(h.shares));
    mine.set(`${h.user_id}/${h.ticker_id}`, Number(h.shares));
    myAvg.set(`${h.user_id}/${h.ticker_id}`, Number((h as { avg_cost?: number }).avg_cost ?? 0));
  }
  // how many accounts hold each name
  const holdersOf = new Map<string, number>();
  for (const [k, n] of mine) {
    if (n <= 0) continue;
    const tid = k.slice(k.indexOf("/") + 1);
    holdersOf.set(tid, (holdersOf.get(tid) ?? 0) + 1);
  }
  const nameOf = new Map(population.map((a) => [a.username, a.persona.name]));
  // which names each leader is in — followers borrow that conviction
  const leaderHoldings = new Map<string, Set<string>>();
  for (const a of population) {
    if (!a.persona.leader) continue;
    const held = new Set<string>();
    for (const [k, n] of mine) if (n > 0 && k.startsWith(`${a.id}/`)) held.add(k.slice(a.id.length + 1));
    leaderHoldings.set(a.username, held);
  }
  const priceHourAgo = new Map<string, number>();
  for (const k of (ticksAgo ?? []) as { ticker_id: string; price: number }[]) {
    if (!priceHourAgo.has(k.ticker_id)) priceHourAgo.set(k.ticker_id, Number(k.price));
  }
  const priceQuarterAgo = new Map<string, number>();
  for (const k of (ticksQuarterAgo ?? []) as { ticker_id: string; price: number }[]) {
    if (!priceQuarterAgo.has(k.ticker_id)) priceQuarterAgo.set(k.ticker_id, Number(k.price));
  }
  const priceDayAgo = new Map<string, number>();
  for (const s of (snaps ?? []) as { ticker_id: string; price: number }[]) {
    priceDayAgo.set(s.ticker_id, Number(s.price));
  }
  const prints: RecentPrint[] = ((recentPrints ?? []) as Record<string, unknown>[]).map((t) => {
    const pr = (t.profiles ?? {}) as { display_name?: string; username?: string | null; is_bot?: boolean | null };
    return {
      userId: String(t.user_id),
      tickerId: String(t.ticker_id),
      side: t.side as TradeSide,
      shares: Number(t.shares),
      total: Number(t.total),
      at: Date.parse(String(t.created_at)),
      name: String(pr.display_name ?? "someone"),
      username: pr.username ?? null,
      bot: botIds.has(String(t.user_id)) || Boolean(pr.is_bot),
    };
  });
  // recent prints by bots, keyed by the printer's username, per ticker —
  // the herd looks at the last quarter hour only
  const printsBy = new Map<string, { tickerId: string; side: TradeSide; weight: number }[]>();
  const leaderNames = new Set(population.filter((a) => a.persona.leader).map((a) => a.username));
  for (const t of prints) {
    if (!botIds.has(t.userId) || t.at < herdSince) continue;
    const u = usernameOf.get(t.userId)!;
    const l = printsBy.get(u) ?? [];
    l.push({ tickerId: t.tickerId, side: t.side, weight: leaderNames.has(u) ? 2 : 1 });
    printsBy.set(u, l);
  }

  // the board as the quote prices it, minus the shimmer
  // a founder's call is news at a discount, and at their record's credibility
  type CallLite = { ticker_id: string; user_id: string; guidance: number; outcome: CallOutcome | null; created_at: string };
  const callRows = ((recentCalls ?? []) as unknown[]) as CallLite[];
  const recordOf = new Map<string, CallOutcome[]>();
  for (const c of callRows) if (c.outcome) recordOf.set(c.user_id, [...(recordOf.get(c.user_id) ?? []), c.outcome]);
  const extraNews = new Map<string, { move: number; ageMs: number; kind: "call" | "buyback" }[]>();
  for (const c of callRows) {
    const age = now - Date.parse(c.created_at);
    if (age < 0 || age > CALL_NEWS_MS) continue;
    const l = extraNews.get(c.ticker_id) ?? [];
    l.push({ move: Number(c.guidance) * CALL_DISCOUNT * credibility(recordOf.get(c.user_id) ?? []), ageMs: age, kind: "call" });
    extraNews.set(c.ticker_id, l);
  }
  const floatById = new Map(((tickers ?? []) as Record<string, unknown>[]).map((t) => [String(t.id), floatOf(t.shares_outstanding as number | null)]));
  for (const b of (recentBuybacks ?? []) as { ticker_id: string; shares: number; created_at: string }[]) {
    const l = extraNews.get(b.ticker_id) ?? [];
    // retiring 2% of the float reads like a 6% revenue beat — a founder buying is the strongest signal there is
    l.push({ move: (Number(b.shares) / (floatById.get(b.ticker_id) ?? 10_000)) * 3, ageMs: now - Date.parse(b.created_at), kind: "buyback" });
    extraNews.set(b.ticker_id, l);
  }

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
      const ago15m = priceQuarterAgo.get(id);
      const ago24h = priceDayAgo.get(id);
      return {
        id,
        symbol: String(t.symbol),
        price,
        fair: fairPrice(mrr, multiple, float),
        float,
        floatHeld: floatHeld.get(id) ?? 0,
        change1h: ago1h && ago1h > 0 ? price / ago1h - 1 : 0,
        change15m: ago15m && ago15m > 0 ? price / ago15m - 1 : 0,
        change24h: ago24h && ago24h > 0 ? price / ago24h - 1 : 0,
        culprit: null as Culprit | null,
        news: [
          ...events
            .filter((e) => !e.catchUp && e.prevMrr > 0)
            .map((e) => ({ move: (e.mrr - e.prevMrr) / e.prevMrr, ageMs: now - e.at, kind: "revenue" as const })),
          ...(extraNews.get(id) ?? []),
        ],
        mrr,
      };
    })
    .filter((v) => v.price > 0);
  for (const v of board) {
    const move = Math.abs(v.change15m) >= SHAKE_MOVE ? v.change15m : Math.abs(v.change1h) >= SHAKE_MOVE * 1.6 ? v.change1h : 0;
    if (move !== 0) v.culprit = pickCulprit(prints, v.id, v.float, move < 0 ? "down" : "up", now);
  }

  const viewsFor = (a: Account): TickerView[] =>
    board.map((v) => {
      let herd = 0;
      let leaderHolds = false;
      let leaderName: string | null = null;
      for (const u of a.persona.follows) {
        for (const pr of printsBy.get(u) ?? []) {
          if (pr.tickerId === v.id) herd += (pr.side === "buy" ? 1 : -1) * pr.weight;
        }
        if (leaderHoldings.get(u)?.has(v.id)) {
          leaderHolds = true;
          leaderName ??= nameOf.get(u) ?? u;
        }
      }
      return {
        symbol: v.symbol,
        price: v.price,
        fair: v.fair,
        float: v.float,
        floatHeld: v.floatHeld,
        change1h: v.change1h,
        change15m: v.change15m,
        change24h: v.change24h,
        culprit: v.culprit,
        news: v.news,
        held: mine.get(`${a.id}/${v.id}`) ?? 0,
        avgCost: myAvg.get(`${a.id}/${v.id}`) ?? 0,
        leaderHolds,
        leaderName,
        holders: holdersOf.get(v.id) ?? 0,
        herd,
        mrr: v.mrr,
      };
    });

  // Everyone decides off the same board, then the orders fill ticker by
  // ticker, a few tickers at a time: orders on one ticker queue behind each
  // other (placeOrder's claim is per ticker) while different tickers fill
  // together. Filled one after another, forty prints took a minute — the
  // whole cron's budget. Shuffled so the same bot is not always first to
  // the trough, and stopped at the deadline whatever is left.
  // A shake wakes people who were not going to look. Holders of a ticker
  // that just moved a twentieth in a quarter hour roll to wake by grip —
  // paper hands nearly always, diamond hands rarely — and a few value or
  // whale accounts wake to a drop in a name they do not own, to buy it.
  // This is the cascade: one dump, a round of panic prints, then the bids.
  const shaken = board.filter(
    (v) => Math.abs(v.change15m) >= SHAKE_MOVE || Math.abs(v.change1h) >= SHAKE_MOVE * 1.6
  );
  const awakeIds = new Set(awake.map((a) => a.id));
  const extras: Account[] = [];
  if (shaken.length > 0) {
    for (const a of population) {
      if (extras.length >= MAX_SHAKEN) break;
      if (awakeIds.has(a.id)) continue;
      let chance = 0;
      for (const v of shaken) {
        const move = Math.max(Math.abs(v.change15m), Math.abs(v.change1h) / 1.6);
        const held = mine.get(`${a.id}/${v.id}`) ?? 0;
        if (held > 0) {
          chance = Math.max(chance, SHAKE_WAKE[a.persona.hold] * Math.min(1, move / 0.12));
        } else if (v.change15m < 0 && ((a.persona.styles.value ?? 0) + (a.persona.styles.whale ?? 0)) > 0) {
          chance = Math.max(chance, DIP_WAKE * Math.min(1, move / 0.12));
        }
      }
      if (chance > 0 && rng.unit() < chance) extras.push(a);
    }
  }
  out.awake = awake.length + extras.length;
  out.shaken = extras.length;
  const roster = [...awake, ...extras].sort(() => rng.unit() - 0.5);
  const orders: { account: Account; o: NonNullable<ReturnType<typeof decide>> }[] = [];
  for (const account of roster) {
    if (orders.length >= maxTrades) break;
    const o = decide(account.persona, account.cash, viewsFor(account), rng);
    if (o) orders.push({ account, o });
  }
  const queues = new Map<string, typeof orders>();
  for (const order of orders) {
    const q = queues.get(order.o.symbol) ?? [];
    q.push(order);
    queues.set(order.o.symbol, q);
  }
  const pending = [...queues.values()];
  const deadline = Date.now() + budgetMs;
  const traded = new Set<string>();
  await Promise.all(
    Array.from({ length: FILL_CONCURRENCY }, async () => {
      for (let q = pending.shift(); q; q = pending.shift()) {
        for (const { account, o } of q) {
          if (Date.now() > deadline) return;
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
          traded.add(account.id);
        }
      }
    })
  );

  // A take does not need a trade. Anyone in the population can say
  // something this round, at their own rate and the hour's — it used to be
  // only the handful awake and idle, which rolled that rate against six
  // accounts instead of a thousand and posted about never.
  const hour = timeOfDayFactor(now);
  for (const account of population) {
    if (out.posted >= maxPosts) break;
    if (traded.has(account.id)) continue;
    // a holder of a name that just got hit does not wait for their turn to
    // talk — that is the wall of "wtf" after a rug
    const hit = shaken.filter((v) => (mine.get(`${account.id}/${v.id}`) ?? 0) > 0);
    const venting = hit.length > 0 && rng.unit() < SHAKE_POST[account.persona.hold];
    if (!venting && rng.unit() >= (account.persona.postRate * POST_SCALE * hour) / 288) continue;
    const views = viewsFor(account);
    // vent about the hit name; else talk about what you hold, else about whatever is most mispriced
    const held = views.filter((v) => v.held > 0);
    const pool = venting
      ? views.filter((v) => hit.some((h) => h.symbol === v.symbol))
      : held.length
        ? held
        : [...views].sort((a, b) => Math.abs(b.fair / b.price - 1) - Math.abs(a.fair / a.price - 1)).slice(0, 5);
    const v = pool[Math.floor(rng.unit() * pool.length)];
    if (!v) continue;
    const tickerId = board.find((b) => b.symbol === v.symbol)?.id;
    if (!tickerId) continue;
    const own = { ...v, fair: myFairValue(account.persona, v.symbol, v.fair, now) };
    const body = composeThesis(account.persona, situationFor(own, null, "take", account.persona), rng);
    const edge = v.fair / v.price - 1;
    const stance = edge > 0.08 ? 1 : edge < -0.08 ? -1 : null;
    const { error } = await admin.from("posts").insert({ ticker_id: tickerId, user_id: account.id, body, stance });
    if (!error) out.posted++;
  }
  // The poll. Everyone awake this round has an opinion on the name they
  // looked hardest at; about half of them say so on the gauge — bull if
  // they would buy it, bear if they would sell. Upserted, so a change of
  // mind is one row, not two.
  try {
    let voted = 0;
    const votes: { user_id: string; ticker_id: string; vote: 1 | -1; updated_at: string }[] = [];
    for (const account of roster) {
      if (votes.length >= MAX_VOTES_PER_ROUND) break;
      if (rng.unit() > 0.5) continue;
      const views = viewsFor(account);
      let strongest: { v: TickerView; c: number } | null = null;
      for (const v of views) {
        const { c } = personaConviction(account.persona, v, rng, now);
        if (!strongest || Math.abs(c) > Math.abs(strongest.c)) strongest = { v, c };
      }
      if (!strongest || Math.abs(strongest.c) < 0.3) continue;
      const tickerId = board.find((b) => b.symbol === strongest!.v.symbol)?.id;
      if (!tickerId) continue;
      votes.push({ user_id: account.id, ticker_id: tickerId, vote: strongest.c > 0 ? 1 : -1, updated_at: new Date(now).toISOString() });
    }
    if (votes.length > 0) {
      const { error } = await admin.from("ticker_votes").upsert(votes, { onConflict: "user_id,ticker_id" });
      if (!error) voted = votes.length;
    }
    out.voted = voted;
  } catch {
    // votes are cosmetic
  }

  // Hearts. Awake accounts read the last day of theses on names they hold
  // and like some — weighted to the big positions and the leaders, since
  // that is who gets read: a take backed by $40k gets the hearts, a take
  // backed by $40 gets scrolled past. Pre-0010 the table is missing.
  try {
    const dayAgoIso = new Date(now - 86_400_000).toISOString();
    const [{ data: recentPosts }, { data: recentNotes }] = await Promise.all([
      admin
        .from("posts")
        .select("id, ticker_id, user_id")
        .gte("created_at", dayAgoIso)
        .order("created_at", { ascending: false })
        .limit(300),
      admin
        .from("trades")
        .select("id, ticker_id, user_id")
        .not("note", "is", null)
        .gte("created_at", dayAgoIso)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    type Thesis = { id: string; ticker_id: string; user_id: string };
    const priceOf = new Map(board.map((b) => [b.id, b.price]));
    const theses = [
      ...((recentPosts ?? []) as Thesis[]).map((r) => ({ kind: "post" as const, ...r })),
      ...((recentNotes ?? []) as Thesis[]).map((r) => ({ kind: "trade" as const, ...r })),
    ].map((t) => {
      const backing = (mine.get(`${t.user_id}/${t.ticker_id}`) ?? 0) * (priceOf.get(t.ticker_id) ?? 0);
      const author = usernameOf.get(t.user_id);
      const leader = author ? leaderNames.has(author) : false;
      return { ...t, weight: Math.sqrt(1 + backing / 100) * (leader ? 3 : 1) };
    });
    let liked = 0;
    for (const account of roster) {
      if (liked >= MAX_LIKES_PER_ROUND) break;
      if (rng.unit() > 0.5) continue;
      const own = theses.filter(
        (t) => t.user_id !== account.id && (mine.get(`${account.id}/${t.ticker_id}`) ?? 0) > 0
      );
      const total = own.reduce((a, t) => a + t.weight, 0);
      if (total <= 0) continue;
      let r = rng.unit() * total;
      let pick = own[own.length - 1];
      for (const t of own) if ((r -= t.weight) <= 0) { pick = t; break; }
      const { error } = await admin
        .from("thesis_likes")
        .upsert(
          { kind: pick.kind, target_id: pick.id, user_id: account.id },
          { onConflict: "kind,target_id,user_id", ignoreDuplicates: true }
        );
      if (!error) liked++;
    }
    out.liked = liked;
  } catch {
    // no likes table yet
  }
  return out;
}

/**
 * lib/splits.ts — the float grows with demand, and shrinks at the floor.
 *
 * A float is a unit, not a supply of ownership: market cap is revenue times
 * the multiple however many slices it is cut into, and a dollar of buying
 * moves the price the same whether the slice is $20 or $0.20. What the
 * float does decide is how much room there is — when most of it is held,
 * orders start bouncing off "no shares left" — and what a share costs to
 * pick up. So the float grows when a name is crowded or expensive, the way
 * a company splits its stock, and it shrinks when a share has fallen to
 * pennies, the way an exchange consolidates one. Every holder keeps exactly
 * the value they had; only the count changes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fairPrice, floatOf, settledPrice, valuationMultiple, type RevenueEvent } from "@/lib/pricing";
import { latestEventMrr } from "@/lib/pulse";
import { pageAll } from "@/lib/supabase/page-all";

/** A share this expensive gets cut so a small account can buy one. */
export const SPLIT_PRICE = 80;
/** This much of the float held, and the float doubles so there is room. */
export const CROWDED_FRACTION = 0.6;
/** A day of buying this large against the cap, on a float this held, doubles it too. */
export const DEMAND_FRACTION = 0.4;
export const DEMAND_HELD = 0.4;
/** Below a cent the share is consolidated a hundred to one — a price never reads $0.00. */
export const FLOOR_PRICE = 0.01;
export const REVERSE_FACTOR = 0.01;
/** A split does not follow another one this soon. */
export const SPLIT_COOLDOWN_MS = 6 * 3_600_000;
/**
 * Unless the float is this full. A float nobody can buy into is not a
 * market — every order bounces off "fully held" — so a name this crowded
 * doubles on the spot, cooldown or not, and again on the next pass if the
 * crowd is still eating it. A run big enough to take a float four times
 * over gets four floats.
 */
export const FULL_FRACTION = 0.9;

export interface SplitInput {
  price: number;
  /** shares held across every account, over the float */
  heldFraction: number;
  /** buys in the last day, in dollars, over the market cap */
  demand: number;
  lastSplitAt: number | null;
  now: number;
}

/**
 * The factor to apply, or null. Above one is a split (2 = two for one);
 * below one is a reverse split (0.01 = a hundred to one).
 */
export function splitFactor(s: SplitInput): number | null {
  if (!(s.price > 0)) return null;
  // a float that is all but gone makes room now; everything else waits its turn
  const full = s.heldFraction >= FULL_FRACTION && s.price / 2 >= FLOOR_PRICE;
  if (full) return 2;
  if (s.lastSplitAt !== null && s.now - s.lastSplitAt < SPLIT_COOLDOWN_MS) return null;
  // the floor first — a name that fell through it is consolidated whatever else is true
  if (s.price < FLOOR_PRICE) return REVERSE_FACTOR;
  // expensive: cut it back toward a $20 share
  if (s.price >= SPLIT_PRICE) {
    if (s.price >= SPLIT_PRICE * 5) return 10;
    if (s.price >= SPLIT_PRICE * 2) return 5;
    return 2;
  }
  // crowded, or in heavy demand on a float that is filling: make room —
  // but never split a share below the floor
  const crowded = s.heldFraction >= CROWDED_FRACTION;
  const inDemand = s.demand >= DEMAND_FRACTION && s.heldFraction >= DEMAND_HELD;
  if ((crowded || inDemand) && s.price / 2 >= FLOOR_PRICE) return 2;
  return null;
}

export interface SplitResult {
  checked: number;
  splits: { symbol: string; factor: number; price: number; newFloat: number }[];
  errors: string[];
}

/**
 * One pass over the board. Reads what the flow reads, decides per ticker,
 * and applies through the split_ticker function (migration 0011) so every
 * table that carries shares or a per-share price changes in one
 * transaction. Pre-0011 the function is missing and this is a no-op.
 */
export async function runSplits(
  admin: SupabaseClient,
  opts: { now?: number } = {}
): Promise<SplitResult> {
  const now = opts.now ?? Date.now();
  const out: SplitResult = { checked: 0, splits: [], errors: [] };
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const [{ data: tickers }, { data: reports }, { data: conns }, latest, held, buys] = await Promise.all([
    admin.from("tickers").select("*"),
    admin.from("mrr_updates").select("ticker_id, month, mrr").order("month", { ascending: true }),
    admin.from("stripe_connections").select("ticker_id, live_mrr").eq("status", "active"),
    latestEventMrr(admin),
    pageAll<{ ticker_id: string; shares: number }>((f, t) =>
      admin.from("holdings").select("ticker_id, shares").gt("shares", 0).order("user_id").order("ticker_id").range(f, t)
    ),
    pageAll<{ ticker_id: string; total: number }>((f, t) =>
      admin.from("trades").select("ticker_id, total").eq("side", "buy").gte("created_at", dayAgo).order("id").range(f, t)
    ),
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
  const heldOf = new Map<string, number>();
  for (const h of held) heldOf.set(h.ticker_id, (heldOf.get(h.ticker_id) ?? 0) + Number(h.shares));
  const boughtOf = new Map<string, number>();
  for (const b of buys) boughtOf.set(b.ticker_id, (boughtOf.get(b.ticker_id) ?? 0) + Number(b.total));

  for (const t of (tickers ?? []) as Record<string, unknown>[]) {
    out.checked++;
    const id = String(t.id);
    const record = history.get(id) ?? [];
    const reported = record.length ? record[record.length - 1].mrr : 0;
    const mrr = live.get(id) ?? latest.get(id)?.mrr ?? reported;
    if (!(mrr > 0)) continue;
    const multiple = valuationMultiple(record);
    const float = floatOf(t.shares_outstanding as number | null);
    const events: RevenueEvent[] = [];
    const price = settledPrice(mrr, Number(t.sentiment ?? 0), now, multiple, float, events, Number(t.drift ?? 0));
    const cap = fairPrice(mrr, multiple, float) * float;
    const factor = splitFactor({
      price,
      heldFraction: (heldOf.get(id) ?? 0) / float,
      demand: cap > 0 ? (boughtOf.get(id) ?? 0) / cap : 0,
      lastSplitAt: t.split_at ? Date.parse(String(t.split_at)) : null,
      now,
    });
    if (factor === null) continue;
    const { data, error } = await admin.rpc("split_ticker", {
      p_ticker_id: id,
      p_factor: factor,
      p_price: Number(price.toFixed(6)),
    });
    if (error) {
      out.errors.push(`${String(t.symbol)}: ${error.message}`);
      continue;
    }
    out.splits.push({ symbol: String(t.symbol), factor, price, newFloat: Number(data ?? float * factor) });
  }
  return out;
}

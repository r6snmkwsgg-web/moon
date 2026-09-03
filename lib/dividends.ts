/**
 * lib/dividends.ts — holding a real growing business pays.
 *
 * When a listing's monthly MRR comes in above the month before, the growth
 * is paid out to holders: a year of the extra revenue, split per share
 * across the float. A $14,200 name that prints $15,000 pays a $9,600 pool,
 * so 5% of the float collects $480. A flat or shrinking month pays nothing.
 * This is the mechanic that makes picking a business that actually grows
 * different from picking one that is merely loud.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Years of the month-over-month growth paid out. */
export const DIVIDEND_YEARS = 1;

export function dividendPool(prevMrr: number, mrr: number): number {
  if (!(prevMrr > 0) || !(mrr > prevMrr)) return 0;
  return (mrr - prevMrr) * 12 * DIVIDEND_YEARS;
}

export interface DividendRun {
  checked: number;
  paid: { symbol: string; month: string; pool: number; perShare: number }[];
  errors: string[];
}

/**
 * Pay every listing whose latest two monthly reports show growth and which
 * has not been paid for that month yet. Safe to run every day: the function
 * is idempotent per (ticker, month). Pre-0012 the function is missing and
 * this reports it and carries on.
 */
export async function payDividends(admin: SupabaseClient): Promise<DividendRun> {
  const out: DividendRun = { checked: 0, paid: [], errors: [] };
  const [{ data: tickers }, { data: reports }] = await Promise.all([
    admin.from("tickers").select("id, symbol"),
    admin.from("mrr_updates").select("ticker_id, month, mrr").order("month", { ascending: true }),
  ]);
  const history = new Map<string, { month: string; mrr: number }[]>();
  for (const r of (reports ?? []) as { ticker_id: string; month: string; mrr: number }[]) {
    const l = history.get(r.ticker_id) ?? [];
    l.push({ month: r.month, mrr: Number(r.mrr) });
    history.set(r.ticker_id, l);
  }
  for (const t of (tickers ?? []) as { id: string; symbol: string }[]) {
    const h = history.get(t.id) ?? [];
    if (h.length < 2) continue;
    out.checked++;
    const prev = h[h.length - 2];
    const last = h[h.length - 1];
    const pool = dividendPool(prev.mrr, last.mrr);
    if (pool <= 0) continue;
    const { data, error } = await admin.rpc("pay_dividend", {
      p_ticker_id: t.id,
      p_month: last.month,
      p_prev_mrr: prev.mrr,
      p_mrr: last.mrr,
      p_pool: Number(pool.toFixed(2)),
    });
    if (error) {
      out.errors.push(`${t.symbol}: ${error.message}`);
      continue;
    }
    const perShare = Number(data ?? 0);
    if (perShare > 0) {
      out.paid.push({ symbol: t.symbol, month: last.month, pool, perShare });
      // tell the people — the bots do not read their alerts
      try {
        const { data: paid } = await admin
          .from("dividend_payments")
          .select("user_id, amount, profiles(is_bot)")
          .eq("ticker_id", t.id)
          .eq("month", last.month)
          .limit(2000);
        const { notifyUsers } = await import("@/lib/notify");
        const monthName = new Date(last.month).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
        const humans = ((paid ?? []) as { user_id: string; amount: number; profiles?: { is_bot?: boolean | null } | null }[]).filter(
          (r) => !r.profiles?.is_bot && Number(r.amount) >= 0.01
        );
        await Promise.all(
          humans.map((r) =>
            notifyUsers([r.user_id], "system", `$${t.symbol} paid you a $${Number(r.amount).toFixed(2)} dividend for ${monthName} — MRR grew`, t.id)
          )
        );
      } catch {
        // alerts are cosmetic
      }
    }
  }
  return out;
}

/**
 * lib/calls.ts — a founder's word, and the print that judges it.
 *
 * An earnings call is guidance: the founder says what next month's MRR
 * will do. The market trades the call at a discount — a founder is an
 * interested party — and when the month's real number lands, the call is
 * marked beat, met or missed against it. A founder's record of calls is
 * their credibility, and the market discounts the next call by it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Guidance the form offers: expected change in next month's MRR. */
export const GUIDANCE_STEPS = [-0.2, -0.1, 0, 0.05, 0.1, 0.25, 0.5] as const;

/** How much of a call's guidance the market prices in, before credibility. */
export const CALL_DISCOUNT = 0.4;
/** Within this many points of guidance counts as met. */
export const MET_BAND = 0.05;
/** A call is news for this long. */
export const CALL_NEWS_MS = 24 * 3_600_000;

export type CallOutcome = "beat" | "met" | "missed";

export function judgeCall(guidance: number, actual: number): CallOutcome {
  if (actual >= guidance + MET_BAND) return "beat";
  if (actual <= guidance - MET_BAND) return "missed";
  return "met";
}

/**
 * How far to believe this founder: one for a clean record, down toward a
 * third for a serial misser. Beats count for, misses against, met is even.
 */
export function credibility(history: CallOutcome[]): number {
  if (history.length === 0) return 0.7;
  let score = 0;
  for (const o of history) score += o === "beat" ? 1 : o === "met" ? 0.8 : -0.6;
  return Math.max(0.3, Math.min(1, 0.7 + score / (history.length + 2)));
}

export interface CallRow {
  id: string;
  ticker_id: string;
  user_id: string;
  body: string;
  guidance: number;
  actual: number | null;
  outcome: CallOutcome | null;
  settled_month: string | null;
  created_at: string;
}

/**
 * Settle every open call against the latest monthly report that came
 * after it. Run daily; pre-0012 the table is missing and this no-ops.
 */
export async function settleCalls(admin: SupabaseClient): Promise<{ settled: number; errors: string[] }> {
  const out = { settled: 0, errors: [] as string[] };
  try {
    const [{ data: open }, { data: reports }] = await Promise.all([
      admin.from("calls").select("*").is("outcome", null).order("created_at", { ascending: true }),
      admin.from("mrr_updates").select("ticker_id, month, mrr").order("month", { ascending: true }),
    ]);
    const history = new Map<string, { month: string; mrr: number }[]>();
    for (const r of (reports ?? []) as { ticker_id: string; month: string; mrr: number }[]) {
      const l = history.get(r.ticker_id) ?? [];
      l.push({ month: r.month, mrr: Number(r.mrr) });
      history.set(r.ticker_id, l);
    }
    for (const c of (open ?? []) as CallRow[]) {
      const h = history.get(c.ticker_id) ?? [];
      // the first report that lands after the call, measured against the one before it
      const idx = h.findIndex((r) => Date.parse(r.month) > Date.parse(c.created_at));
      if (idx < 1) continue;
      const prev = h[idx - 1];
      const next = h[idx];
      if (!(prev.mrr > 0)) continue;
      const actual = next.mrr / prev.mrr - 1;
      const outcome = judgeCall(Number(c.guidance), actual);
      const { error } = await admin
        .from("calls")
        .update({ actual: Number(actual.toFixed(4)), outcome, settled_month: next.month })
        .eq("id", c.id);
      if (error) out.errors.push(error.message);
      else out.settled++;
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}

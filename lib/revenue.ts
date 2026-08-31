/**
 * lib/revenue.ts — what a business is worth, measured in money received.
 *
 * The market used to anchor on MRR, and that had two costs. It excluded every
 * business that does not bill on a subscription, and even for the ones that
 * do it missed most of what happened: a renewal changes no run rate, so a
 * founder could collect payments all day and watch their ticker sit still.
 *
 * The anchor is now a run rate derived from actual daily takings. For a
 * subscription business that lands in the same place — a month of renewals
 * averages out to the MRR — so nothing is lost there, and a shop selling
 * one-time licences becomes tradeable, which it never was.
 */

import { DailyRevenue, expectedDaily } from "@/lib/surprise";

/** Mean days in a month. Used to turn a daily rate into a monthly one. */
export const DAYS_PER_MONTH = 30.436875;

/**
 * Below this many recorded days the run rate is guesswork, and the ticker
 * keeps its reported MRR until there is enough tape to price on.
 */
export const MIN_DAYS_FOR_RUN_RATE = 7;

/**
 * The monthly run rate implied by daily takings.
 *
 * An EWMA rather than a trailing sum, deliberately. A trailing 30-day total
 * carries a big one-off sale at full weight for exactly thirty days and then
 * drops it in a single step — a cliff on the chart a month after the event,
 * caused by nothing. An exponential average lifts on the sale and fades
 * smoothly, which is also how a buyer would actually rate it.
 *
 * `partial` is today: it is still being earned, so it is deliberately NOT fed
 * to the expectation, or every ticker would sag through the small hours and
 * recover by evening.
 */
export function monthlyRunRate(history: DailyRevenue[]): number {
  if (!history || history.length < MIN_DAYS_FOR_RUN_RATE) return 0;
  return Math.max(0, expectedDaily(history)) * DAYS_PER_MONTH;
}

/**
 * The number the price anchors on: the run rate once there is enough of it,
 * otherwise whatever the subscriptions API says, otherwise the last report.
 *
 * Kept as one function so there is exactly one answer to "what is this
 * business making", and every tile, the fair price and the multiple all read
 * it rather than each picking their own.
 */
export function anchorRevenue({
  daily,
  stripeMrr,
  reportedMrr,
}: {
  daily: DailyRevenue[];
  stripeMrr: number | null;
  reportedMrr: number;
}): { monthly: number; source: "payments" | "subscriptions" | "reported" } {
  const runRate = monthlyRunRate(daily);
  if (runRate > 0) return { monthly: runRate, source: "payments" };
  if (stripeMrr !== null && stripeMrr > 0) {
    return { monthly: stripeMrr, source: "subscriptions" };
  }
  return { monthly: Math.max(0, reportedMrr), source: "reported" };
}

/**
 * XP, ranked tiers, and trade streaks — the cosmetic progression layer.
 * Pure functions only; XP is DERIVED from existing activity counts (no XP
 * table to drift out of sync), and everything here is play-status only:
 * tiers and flames never convert to anything, real or fake.
 */

export const XP_PER_TRADE = 50;
export const XP_PER_VOTE = 25;
export const XP_PER_LISTING = 500;
export const XP_PER_INVITE = 250;

export interface ActivityCounts {
  trades: number;
  votes: number;
  listings: number;
  invites: number;
}

export function computeXp(counts: Partial<ActivityCounts>): number {
  return (
    (counts.trades ?? 0) * XP_PER_TRADE +
    (counts.votes ?? 0) * XP_PER_VOTE +
    (counts.listings ?? 0) * XP_PER_LISTING +
    (counts.invites ?? 0) * XP_PER_INVITE
  );
}

export interface Tier {
  name: string;
  min: number;
  color: string; // badge color, used inline (not a Tailwind class)
}

/** Ascending. Bronze is the floor — everyone has a tier from XP 0. */
export const TIERS: Tier[] = [
  { name: "Bronze", min: 0, color: "#cd8a4b" },
  { name: "Silver", min: 1_000, color: "#b9c2cf" },
  { name: "Gold", min: 3_000, color: "#fbbf24" },
  { name: "Platinum", min: 7_000, color: "#7fe3c9" },
  { name: "Diamond", min: 15_000, color: "#7cc7ff" },
];

export interface TierStanding {
  tier: Tier;
  next: Tier | null; // null at Diamond
  /** 0..1 progress from this tier's floor to the next tier's floor. */
  progress: number;
  xp: number;
}

export function tierFor(xp: number): TierStanding {
  const clamped = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (clamped >= t.min) tier = t;
  }
  const idx = TIERS.indexOf(tier);
  const next = idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
  const progress = next
    ? Math.min(1, (clamped - tier.min) / (next.min - tier.min))
    : 1;
  return { tier, next, progress, xp: clamped };
}

// ── streaks ─────────────────────────────────────────────────────────────────

export interface Streak {
  /** Consecutive UTC days with ≥1 trade, counting back from today/yesterday. */
  days: number;
  /** Whether a trade has happened today (UTC) — if false, the streak is at risk. */
  tradedToday: boolean;
}

/** Days a streak must reach before the 🔥 shows on the public profile. */
export const STREAK_FLAME_AT = 5;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the streak from a set of "YYYY-MM-DD" UTC day strings.
 * A streak survives overnight: if there's no trade yet today, it still counts
 * as alive (ending yesterday) — but `tradedToday` is false so the UI can nag.
 */
export function streakFromDays(tradeDays: Iterable<string>, now = new Date()): Streak {
  const days = new Set(tradeDays);
  const today = isoDay(now);
  const tradedToday = days.has(today);

  const cursor = new Date(now);
  if (!tradedToday) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let count = 0;
  while (days.has(isoDay(cursor))) {
    count++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { days: count, tradedToday };
}

/** The next cron-driven earnings sync: the 1st of next month, 06:00 UTC. */
export function nextEarningsDate(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 6, 0, 0)
  );
}

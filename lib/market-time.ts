/**
 * One clock for the whole market.
 *
 * A day has to mean the same thing to everyone. If "today" were each
 * viewer's local midnight, two people looking at the same account would read
 * different day changes, the leaderboard would rank yesterday's gains against
 * this morning's, and a print at 11pm would land on different days depending
 * on who was watching. Real exchanges solve this by having a house clock, and
 * quote everything in it however far away you are.
 *
 * Ours is New York, because that is the clock every US market keeps and the
 * one traders already read without converting. It follows daylight saving —
 * midnight ET is midnight ET in June and in December — so two days a year are
 * 23 or 25 hours long, and every function here is written to survive that
 * rather than assume a day is 86,400,000ms.
 */

export const MARKET_TZ = "America/New_York";
export const MARKET_TZ_LABEL = "ET";

const DAY = 86_400_000;

const WALL = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * How far the market's wall clock sits from UTC at a given instant, in ms.
 * Negative west of Greenwich, so −5h in winter and −4h on daylight time.
 */
export function marketOffset(t: number): number {
  const parts = WALL.formatToParts(new Date(t));
  const at = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    // some ICU builds render midnight as hour 24 under hour12:false
    at("hour") % 24,
    at("minute"),
    at("second")
  );
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * The instant the market's day containing `t` began — midnight ET.
 *
 * Computed twice on purpose. On the two changeover days the offset in force
 * at midnight differs from the one in force now, so the first answer can be
 * an hour out; re-reading the offset at the candidate instant fixes it.
 */
export function marketDayStart(t: number): number {
  const off = marketOffset(t);
  const wallMidnight = Math.floor((t + off) / DAY) * DAY;
  const guess = wallMidnight - off;
  const settled = marketOffset(guess);
  return settled === off ? guess : wallMidnight - settled;
}

/** The next midnight ET — the far edge of the day containing `t`. */
export function marketDayEnd(t: number): number {
  // 36h from midnight lands mid-afternoon of the next day whether that day
  // ran 23, 24 or 25 hours, so its own midnight is the one we want.
  return marketDayStart(marketDayStart(t) + 36 * 3_600_000);
}

/** The instant at which the market clock reads `hour:00` on that day. */
export function marketHour(dayStart: number, hour: number): number {
  const naive = dayStart + hour * 3_600_000;
  return naive + (marketOffset(dayStart) - marketOffset(naive));
}

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  hour: "numeric",
  minute: "2-digit",
});

const DATETIME = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  month: "short",
  day: "numeric",
});

/** "3:04 PM" — always the market's clock, never the viewer's. */
export function fmtMarketTime(t: number): string {
  return TIME.format(new Date(t));
}

/** "Aug 30, 3:04 PM" */
export function fmtMarketDateTime(t: number): string {
  return DATETIME.format(new Date(t));
}

/** "Aug 30" */
export function fmtMarketDate(t: number): string {
  return DATE.format(new Date(t));
}

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const CLOCK_SEC = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "14:00" — the 24-hour form a price axis wants. */
export function fmtMarketClock(t: number, seconds = false): string {
  // en-GB renders midnight as 00, where en-US hour12:false can say 24
  return (seconds ? CLOCK_SEC : CLOCK).format(new Date(t));
}

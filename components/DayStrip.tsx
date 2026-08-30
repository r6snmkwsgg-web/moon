import Link from "next/link";
import { Flame } from "lucide-react";
import type { MissedToday } from "@/lib/data";
import type { Streak } from "@/lib/xp";
import { nextEarningsDate } from "@/lib/xp";
import { fmtPct } from "@/lib/format";
import CountdownChip from "@/components/CountdownChip";

/**
 * The signed-in day strip: streak, next earnings, and the missed-today nudge
 * as ONE slim row — the FOMO pack without eating the homepage.
 */
export default function DayStrip({
  streak,
  missed,
}: {
  streak: Streak;
  missed: MissedToday | null;
}) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs">
      <Link
        href="/portfolio"
        title={
          streak.tradedToday
            ? "Locked in for today"
            : "Trade before midnight UTC to keep it"
        }
        className={`flex items-center gap-1.5 font-mono font-bold ${
          streak.days > 0 ? "text-terminal-amber" : "text-terminal-muted"
        }`}
      >
        <Flame
          size={13}
          fill={streak.days > 0 ? "currentColor" : "none"}
          className="shrink-0"
        />
        {streak.days}-day streak
        {streak.days > 0 && !streak.tradedToday && (
          <span className="rounded bg-terminal-amber/15 px-1.5 py-0.5 text-[10px] font-semibold">
            trade today to keep it
          </span>
        )}
      </Link>

      <CountdownChip
        target={nextEarningsDate().toISOString()}
        prefix="earnings in"
      />

      {missed && (
        <Link
          href={`/t/${missed.quote.ticker.symbol}`}
          className="flex min-w-0 items-baseline gap-1.5 hover:text-terminal-text"
        >
          <span className="text-terminal-muted">missed:</span>
          <span className="font-mono font-bold">
            ${missed.quote.ticker.symbol}
          </span>
          <span className="num font-mono font-semibold text-terminal-up">
            {fmtPct(missed.quote.dayChange)}
          </span>
          <span className="truncate text-terminal-muted">
            — you&apos;re not in it →
          </span>
        </Link>
      )}

      <Link
        href="/tape"
        className="ml-auto whitespace-nowrap text-terminal-accent"
      >
        the feed →
      </Link>
    </div>
  );
}

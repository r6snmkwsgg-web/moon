import Link from "next/link";
import type { MissedToday } from "@/lib/data";
import { nextEarningsDate } from "@/lib/xp";
import { fmtPct } from "@/lib/format";
import CountdownChip from "@/components/CountdownChip";

/**
 * The signed-in day strip: next earnings and the missed-today nudge as ONE
 * slim row — what's going on, without eating the homepage.
 */
export default function DayStrip({ missed }: { missed: MissedToday | null }) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs">
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

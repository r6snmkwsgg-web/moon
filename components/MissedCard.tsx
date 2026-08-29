import Link from "next/link";
import type { MissedToday } from "@/lib/data";
import { fmtMoney, fmtPct } from "@/lib/format";

/** The guilt card: an honest hypothetical about today's runner you don't hold. */
export default function MissedCard({ missed }: { missed: MissedToday }) {
  const t = missed.quote.ticker;
  return (
    <div className="panel space-y-2 p-4">
      <div className="microlabel">What you missed today</div>
      <p className="text-sm leading-snug">
        <Link
          href={`/t/${t.symbol}`}
          className="font-mono font-bold hover:text-terminal-accent"
        >
          ${t.symbol}
        </Link>{" "}
        is{" "}
        <span className="num font-mono font-semibold text-terminal-up">
          {fmtPct(missed.quote.dayChange)}
        </span>{" "}
        today — a {fmtMoney(missed.hypotheticalStake, 0)} bag at open would be{" "}
        <span className="num font-mono font-semibold text-terminal-up">
          +{fmtMoney(missed.hypotheticalGain)}
        </span>{" "}
        right now.
      </p>
      <p className="text-[11px] text-terminal-muted">
        {missed.onWatchlist
          ? "It's on your watchlist — alerts had your back, the trigger finger didn't."
          : "Alerts fix this: watch a ticker → get pinged the second it moves."}
      </p>
      <Link
        href={`/t/${t.symbol}`}
        className="inline-block rounded-md border border-terminal-up/50 bg-terminal-up/10 px-2.5 py-1 text-xs font-bold text-terminal-up hover:bg-terminal-up/20"
      >
        {missed.onWatchlist ? "Open the chart →" : `Watch $${t.symbol} →`}
      </Link>
    </div>
  );
}

import Link from "next/link";
import { Megaphone } from "lucide-react";
import type { TickerCall } from "@/lib/data";

function ago(iso: string): string {
  const m = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const pct = (f: number) => `${f >= 0 ? "+" : ""}${Math.round(f * 100)}%`;

/**
 * The founder's latest earnings call: what they said, what they guided,
 * and — once the next real print has landed — whether they were right.
 * A call is public and permanent; the record under it is the founder's
 * credibility, and the market discounts the next call by it.
 */
export default function EarningsCallCard({ calls, symbol }: { calls: TickerCall[]; symbol: string }) {
  if (calls.length === 0) return null;
  const [latest, ...older] = calls;
  const record = calls.filter((c) => c.outcome);
  const beats = record.filter((c) => c.outcome === "beat").length;
  const met = record.filter((c) => c.outcome === "met").length;
  return (
    <section className="panel space-y-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Megaphone size={13} className="text-terminal-amber" />
        <h2 className="font-mono text-sm font-bold">Earnings call</h2>
        <span className="ml-auto font-mono text-[10px] text-terminal-muted">{ago(latest.createdAt)}</span>
      </div>
      <p className="text-[13px] leading-snug text-terminal-text">{latest.body}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
        {latest.username ? (
          <Link href={`/u/${latest.username}`} className="font-bold hover:text-terminal-accent">
            {latest.founder}
          </Link>
        ) : (
          <span className="font-bold">{latest.founder}</span>
        )}
        <span className="text-terminal-muted">founder</span>
        <span
          className={`rounded px-1.5 py-0.5 font-semibold ${
            latest.guidance > 0
              ? "bg-terminal-up/10 text-terminal-up"
              : latest.guidance < 0
                ? "bg-terminal-down/10 text-terminal-down"
                : "bg-terminal-raise text-terminal-muted"
          }`}
          title="Guidance: what the founder says next month's MRR will do"
        >
          guiding {pct(latest.guidance)}
        </span>
        {latest.outcome ? (
          <span
            className={`rounded px-1.5 py-0.5 font-semibold ${
              latest.outcome === "missed" ? "bg-terminal-down/10 text-terminal-down" : "bg-terminal-up/10 text-terminal-up"
            }`}
            title={`The month printed ${pct(latest.actual ?? 0)} against guidance of ${pct(latest.guidance)}`}
          >
            {latest.outcome} · printed {pct(latest.actual ?? 0)}
          </span>
        ) : (
          <span className="text-terminal-muted">settles with the next report</span>
        )}
      </div>
      {record.length > 0 && (
        <p className="border-t border-terminal-line pt-1.5 font-mono text-[10px] text-terminal-muted">
          record: {beats} beat · {met} met · {record.length - beats - met} missed
          {older.length > 0 && ` · ${older.length} earlier call${older.length === 1 ? "" : "s"}`}
        </p>
      )}
    </section>
  );
}

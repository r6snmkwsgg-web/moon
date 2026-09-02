import Link from "next/link";
import { ScrollText } from "lucide-react";
import type { FeedTrade } from "@/lib/data";
import { fmtPrice } from "@/lib/format";
import AiChip from "@/components/AiChip";

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The thesis feed: every written thesis is bolted to a REAL executed trade —
 * side, size, and entry price on record. The trade chip is the receipt.
 */
export default function ThesisFeed({
  theses,
  showSymbol = false,
}: {
  theses: FeedTrade[];
  showSymbol?: boolean;
}) {
  return (
    <section className="panel">
      <div className="flex items-center gap-2 border-b border-terminal-line px-3 py-2">
        <ScrollText size={12} className="text-terminal-muted" />
        <h2 className="microlabel font-bold !text-terminal-text">Theses</h2>
        <span className="microlabel">{theses.length} on record</span>
      </div>
      {theses.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-terminal-muted">
          No theses yet. Attach one to your next trade — it goes on the
          record with your entry price.
        </p>
      ) : (
        <ul className="divide-y divide-terminal-line/40">
          {theses.map((t) => (
            <li key={t.id} className="space-y-1 px-3 py-2.5">
              <p className="text-sm leading-snug text-terminal-text">
                “{t.note}”
              </p>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                {t.username ? (
                  <Link
                    href={`/u/${t.username}`}
                    className="font-mono font-bold text-terminal-text hover:text-terminal-accent"
                  >
                    {t.trader}
                  </Link>
                ) : (
                  <span className="font-mono font-bold">{t.trader}</span>
                )}
                <AiChip username={t.username} />
                <span
                  className={`num rounded px-1.5 py-0.5 font-mono font-semibold ${
                    t.side === "buy"
                      ? "bg-terminal-up/10 text-terminal-up"
                      : "bg-terminal-down/10 text-terminal-down"
                  }`}
                  title="The trade behind this thesis — real entry, on record"
                >
                  {t.side === "buy" ? "bought" : "sold"}{" "}
                  {t.shares.toLocaleString("en-US")}
                  {showSymbol ? ` $${t.symbol}` : ""} @ {fmtPrice(t.price)}
                </span>
                <span className="ml-auto font-mono text-terminal-muted">
                  {timeAgo(t.created_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import Link from "next/link";
import type { FeedTrade } from "@/lib/data";
import { fmtMoney, fmtPrice, fmtShares } from "@/lib/format";
import CopyTradeButton from "@/components/CopyTradeButton";
import AiChip from "@/components/AiChip";

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A list of recent trades — the tape. Used globally and per ticker. */
export default function TradesList({
  trades,
  showSymbol = true,
  signedIn = false,
  showNotes = true,
  showTrader = true,
  freshIds,
}: {
  trades: FeedTrade[];
  showSymbol?: boolean;
  signedIn?: boolean;
  showNotes?: boolean; // off where a ThesisFeed already shows them
  showTrader?: boolean; // off on a profile, where every row is the same person
  /** Rows that just landed — they flash in. */
  freshIds?: Set<string>;
}) {
  if (trades.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-terminal-muted">
        No trades yet — the tape starts when someone pulls the trigger.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-terminal-line/40">
      {trades.map((t) => (
        <li
          key={t.id}
          className={`space-y-0.5 px-3 py-1.5 text-[12px] ${
            showSymbol ? "row-hover cursor-pointer" : ""
          } ${freshIds?.has(t.id) ? (t.side === "buy" ? "tape-in-up" : "tape-in-down") : ""}`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={`font-mono text-[11px] font-bold uppercase ${
                t.side === "buy" ? "text-terminal-up" : "text-terminal-down"
              }`}
            >
              {t.side}
            </span>
            {showTrader &&
              (t.username ? (
                <Link
                  href={`/u/${t.username}`}
                  className="relative z-[2] font-mono text-terminal-text hover:text-terminal-accent"
                >
                  {t.trader}
                </Link>
              ) : (
                <span className="font-mono text-terminal-text">{t.trader}</span>
              ))}
            {showTrader && <AiChip username={t.username} bot={t.bot} />}
            {showTrader && (
              <span className="text-terminal-muted">
                {t.buyback ? "bought back" : t.side === "buy" ? "bought" : "sold"}
              </span>
            )}
            {/* the size in money — the shares and the price sit in the tooltip */}
            <span
              className="num font-mono font-semibold"
              title={`${fmtShares(t.shares)} shs @ ${fmtPrice(t.price)}`}
            >
              {fmtMoney(t.total, t.total >= 1000 ? 0 : 2)}
            </span>
            {showSymbol && (
              <>
                <span className="text-terminal-muted">of</span>
                <Link
                  href={`/t/${t.symbol}`}
                  aria-label={`$${t.symbol}`}
                  className="row-link font-mono font-bold"
                >
                  ${t.symbol}
                </Link>
              </>
            )}
            <span className="relative z-[2] ml-auto flex items-center gap-2">
              <CopyTradeButton
                symbol={t.symbol}
                side={t.side}
                shares={t.shares}
                traderUsername={t.username}
                signedIn={signedIn}
              />
              <span className="font-mono text-[11px] text-terminal-muted">
                {timeAgo(t.created_at)}
              </span>
            </span>
          </div>
          {showNotes && t.note && (
            <p className="border-l-2 border-terminal-line pl-2 text-xs italic leading-snug text-terminal-muted">
              “{t.note}”
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

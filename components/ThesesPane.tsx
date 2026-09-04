"use client";

import { useTransition } from "react";
import Link from "next/link";
import TimeAgo from "@/components/TimeAgo";
import { fmtMarketDateTime } from "@/lib/market-time";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { FeedTrade, TickerPost } from "@/lib/data";
import { deletePost } from "@/app/t/[symbol]/actions";
import { fmtMoney, fmtPrice, fmtShares } from "@/lib/format";
import AiChip from "@/components/AiChip";
import Tri from "@/components/Tri";
import LikeButton from "@/components/LikeButton";

type Item =
  | { kind: "post"; at: number; post: TickerPost }
  | { kind: "print"; at: number; trade: FeedTrade };

/**
 * Every thesis on the name, newest first: the ones posted straight to the
 * floor, each with the author's real position beside it, and the ones
 * written on a print, each with the trade it rode in on.
 */
export default function ThesesPane({
  posts,
  theses,
  symbol,
  viewerId,
  signedIn = viewerId !== null,
  filtered = false,
}: {
  posts: TickerPost[];
  theses: FeedTrade[];
  symbol: string;
  viewerId: string | null;
  signedIn?: boolean;
  /** A size filter emptied the list — say so rather than "no theses yet". */
  filtered?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const items: Item[] = [
    ...posts.map((post) => ({ kind: "post" as const, at: Date.parse(post.created_at), post })),
    ...theses.map((trade) => ({ kind: "print" as const, at: Date.parse(trade.created_at), trade })),
  ].sort((a, b) => b.at - a.at);

  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-terminal-muted">
        {filtered
          ? "Nothing backed by that much yet — lower the filter."
          : "No theses yet. Add one above, or attach one to your next trade."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-terminal-line/40">
      {items.map((it) =>
        it.kind === "post" ? (
          <li key={`p${it.post.id}`} className="space-y-1 px-3 py-2">
            <p className="text-[13px] leading-snug text-terminal-text">{it.post.body}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              {it.post.username ? (
                <Link
                  href={`/u/${it.post.username}`}
                  className="font-mono font-bold text-terminal-text hover:text-terminal-accent"
                >
                  {it.post.author}
                </Link>
              ) : (
                <span className="font-mono font-bold">{it.post.author}</span>
              )}
              <AiChip username={it.post.username} bot={it.post.bot} />
              {it.post.stance !== null && (
                <span
                  className={`flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] font-bold ${
                    it.post.stance === 1
                      ? "bg-terminal-up/10 text-terminal-up"
                      : "bg-terminal-down/10 text-terminal-down"
                  }`}
                >
                  <Tri dir={it.post.stance === 1 ? "up" : "down"} size={6} />
                  {it.post.stance === 1 ? "bull" : "bear"}
                </span>
              )}
              {/* the live position badge — the whole point: what the take is backed with */}
              {it.post.positionShares > 0 ? (
                <span
                  className="num flex items-center gap-1 rounded bg-terminal-raise px-1.5 py-0.5 font-mono text-[10px]"
                  title={`Real position, read live from holdings — ${fmtShares(it.post.positionShares)} shs`}
                >
                  <span className="font-semibold text-terminal-text">
                    {fmtMoney(it.post.positionValue, it.post.positionValue >= 1000 ? 0 : 2)}
                  </span>
                  {it.post.positionPnlPct !== null && (
                    <span
                      className={`flex items-center gap-0.5 ${
                        it.post.positionPnlPct >= 0 ? "text-terminal-up" : "text-terminal-down"
                      }`}
                    >
                      <Tri dir={it.post.positionPnlPct >= 0 ? "up" : "down"} size={5} />
                      {Math.abs(it.post.positionPnlPct * 100).toFixed(1)}%
                    </span>
                  )}
                </span>
              ) : (
                <span className="rounded bg-terminal-raise px-1.5 py-0.5 font-mono text-[10px] text-terminal-muted/70">
                  no position
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                <LikeButton
                  kind="post"
                  targetId={it.post.id}
                  symbol={symbol}
                  likes={it.post.likes}
                  liked={it.post.likedByMe}
                  signedIn={signedIn}
                />
                <TimeAgo
                  at={it.post.created_at}
                  title={fmtMarketDateTime(Date.parse(it.post.created_at))}
                  className="font-mono text-[10px] text-terminal-muted"
                />
              </span>
              {viewerId === it.post.userId && (
                <button
                  type="button"
                  title="Delete"
                  onClick={() =>
                    startTransition(async () => {
                      await deletePost(it.post.id, symbol);
                      router.refresh();
                    })
                  }
                  className="text-terminal-muted transition-colors hover:text-terminal-down"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </li>
        ) : (
          <li key={`t${it.trade.id}`} className="space-y-1 px-3 py-2">
            <p className="text-[13px] leading-snug text-terminal-text">“{it.trade.note}”</p>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
              {it.trade.username ? (
                <Link
                  href={`/u/${it.trade.username}`}
                  className="font-mono font-bold text-terminal-text hover:text-terminal-accent"
                >
                  {it.trade.trader}
                </Link>
              ) : (
                <span className="font-mono font-bold">{it.trade.trader}</span>
              )}
              <AiChip username={it.trade.username} bot={it.trade.bot} />
              <span
                className={`num rounded px-1.5 py-0.5 font-mono font-semibold ${
                  it.trade.side === "buy"
                    ? "bg-terminal-up/10 text-terminal-up"
                    : "bg-terminal-down/10 text-terminal-down"
                }`}
                title={`The trade behind this thesis — ${fmtShares(it.trade.shares)} shs @ ${fmtPrice(it.trade.price)}, on record`}
              >
                {it.trade.buyback ? "bought back" : it.trade.side === "buy" ? "bought" : "sold"}{" "}
                {fmtMoney(it.trade.total, it.trade.total >= 1000 ? 0 : 2)}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <LikeButton
                  kind="trade"
                  targetId={it.trade.id}
                  symbol={symbol}
                  likes={it.trade.likes}
                  liked={it.trade.likedByMe}
                  signedIn={signedIn}
                />
                <TimeAgo
                  at={it.trade.created_at}
                  title={fmtMarketDateTime(Date.parse(it.trade.created_at))}
                  className="font-mono text-[10px] text-terminal-muted"
                />
              </span>
            </div>
          </li>
        )
      )}
    </ul>
  );
}

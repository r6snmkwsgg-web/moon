"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import type { TickerPost } from "@/lib/data";
import { addPost, deletePost } from "@/app/t/[symbol]/actions";
import { fmtMoney } from "@/lib/format";
import Tri from "@/components/Tri";

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
 * The ticker's discussion thread. The badge next to every author is their
 * REAL position, joined live from holdings — skin in the game is visible,
 * "no position" is visible too. Talk is cheap; this prices it.
 */
export default function Discussion({
  posts,
  tickerId,
  symbol,
  signedIn,
  viewerId,
}: {
  posts: TickerPost[];
  tickerId: string;
  symbol: string;
  signedIn: boolean;
  viewerId: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [stance, setStance] = useState<1 | -1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn) {
      router.push(`/login?next=/t/${symbol}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addPost(tickerId, symbol, body, stance);
        setBody("");
        setStance(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not post.");
      }
    });
  }

  return (
    <section className="panel">
      <div className="flex items-center gap-2 border-b border-terminal-line px-3 py-2">
        <MessageSquare size={12} className="text-terminal-muted" />
        <h2 className="microlabel font-bold !text-terminal-text">
          The floor
        </h2>
        <span className="microlabel">{posts.length} takes</span>
      </div>

      <form onSubmit={submit} className="space-y-2 border-b border-terminal-line/60 p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder={
            signedIn
              ? `Your take on $${symbol} — your position shows next to it`
              : `Sign in to post your take on $${symbol}`
          }
          className="input resize-none text-sm"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStance(stance === 1 ? null : 1)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${
              stance === 1
                ? "border-terminal-up bg-terminal-up/15 text-terminal-up"
                : "border-terminal-line text-terminal-muted hover:text-terminal-up"
            }`}
          >
            <Tri dir="up" size={7} />
            Bullish
          </button>
          <button
            type="button"
            onClick={() => setStance(stance === -1 ? null : -1)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${
              stance === -1
                ? "border-terminal-down bg-terminal-down/15 text-terminal-down"
                : "border-terminal-line text-terminal-muted hover:text-terminal-down"
            }`}
          >
            <Tri dir="down" size={7} />
            Bearish
          </button>
          <span className="num ml-auto font-mono text-[10px] text-terminal-muted">
            {body.length}/280
          </span>
          <button
            type="submit"
            disabled={pending || body.trim().length === 0}
            className="btn-ghost px-3 py-1 text-xs"
          >
            {pending ? "…" : "Post"}
          </button>
        </div>
        {error && <p className="text-xs text-terminal-down">{error}</p>}
      </form>

      {posts.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-terminal-muted">
          No takes yet. First one sets the tone.
        </p>
      ) : (
        <ul className="divide-y divide-terminal-line/40">
          {posts.map((p) => (
            <li key={p.id} className="space-y-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {p.username ? (
                  <Link
                    href={`/u/${p.username}`}
                    className="font-mono font-bold text-terminal-text hover:text-terminal-accent"
                  >
                    {p.author}
                  </Link>
                ) : (
                  <span className="font-mono font-bold">{p.author}</span>
                )}

                {p.stance !== null && (
                  <span
                    className={`flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] font-bold ${
                      p.stance === 1
                        ? "bg-terminal-up/10 text-terminal-up"
                        : "bg-terminal-down/10 text-terminal-down"
                    }`}
                  >
                    <Tri dir={p.stance === 1 ? "up" : "down"} size={6} />
                    {p.stance === 1 ? "bull" : "bear"}
                  </span>
                )}

                {/* the live position badge — the whole point */}
                {p.positionShares > 0 ? (
                  <span
                    className="num rounded bg-terminal-raise px-1.5 py-0.5 font-mono text-[10px] text-terminal-muted"
                    title="Real position, read live from holdings"
                  >
                    holds {p.positionShares.toLocaleString("en-US")} shs
                    {p.positionPnl !== null && (
                      <span
                        className={
                          p.positionPnl >= 0
                            ? " text-terminal-up"
                            : " text-terminal-down"
                        }
                      >
                        {" "}
                        {p.positionPnl >= 0 ? "+" : "−"}
                        {fmtMoney(Math.abs(p.positionPnl), 0)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="rounded bg-terminal-raise px-1.5 py-0.5 font-mono text-[10px] text-terminal-muted/70">
                    no position
                  </span>
                )}

                <span className="ml-auto font-mono text-[10px] text-terminal-muted">
                  {timeAgo(p.created_at)}
                </span>
                {viewerId === p.userId && (
                  <button
                    type="button"
                    title="Delete"
                    onClick={() =>
                      startTransition(async () => {
                        await deletePost(p.id, symbol);
                        router.refresh();
                      })
                    }
                    className="text-terminal-muted transition-colors hover:text-terminal-down"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <p className="text-sm leading-snug text-terminal-text">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

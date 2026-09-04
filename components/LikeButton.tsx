"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { toggleLike, type LikeKind } from "@/app/t/[symbol]/actions";

/**
 * A heart and a count on a thesis. Optimistic: the heart fills the instant
 * you tap it and the server catches up; if the server disagrees the count
 * snaps to what it says. Signed out, the heart is a link to sign in.
 */
export default function LikeButton({
  kind,
  targetId,
  symbol,
  likes,
  liked,
  signedIn,
}: {
  kind: LikeKind;
  targetId: string;
  symbol: string;
  likes: number;
  liked: boolean;
  signedIn: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setOptimistic] = useOptimistic(
    { likes, liked },
    (_cur, next: { likes: number; liked: boolean }) => next
  );

  // a real button, not a glyph: bordered, counted even at zero, red once yours
  const cls = `inline-flex min-h-[26px] items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] leading-none transition-colors ${
    state.liked
      ? "border-terminal-down/40 bg-terminal-down/10 text-terminal-down"
      : "border-terminal-line text-terminal-muted hover:border-terminal-text/40 hover:text-terminal-text"
  }`;

  if (!signedIn) {
    return (
      <Link href={`/login?next=/t/${symbol}`} className={cls} title="Sign in to like">
        <Heart size={12} />
        <span className="num">{state.likes}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={state.liked}
      title={state.liked ? "Unlike" : "Like"}
      onClick={() =>
        startTransition(async () => {
          setOptimistic({ liked: !state.liked, likes: state.likes + (state.liked ? -1 : 1) });
          await toggleLike(kind, targetId, symbol).catch(() => null);
        })
      }
      className={cls}
    >
      <Heart size={12} fill={state.liked ? "currentColor" : "none"} />
      <span className="num">{state.likes}</span>
    </button>
  );
}

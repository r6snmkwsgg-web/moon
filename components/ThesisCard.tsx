"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { addPost } from "@/app/t/[symbol]/actions";

const MAX = 280;

/**
 * Write a thesis on the name, no trade required. It goes on the record with
 * your real position beside it, read live from holdings — including "no
 * position", which is its own kind of statement.
 */
export default function ThesisCard({
  tickerId,
  symbol,
  signedIn,
  author,
}: {
  tickerId: string;
  symbol: string;
  signedIn: boolean;
  /** The viewer, for the card's byline. */
  author: { name: string; username: string | null } | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn) {
      router.push(`/login?next=/t/${symbol}`);
      return;
    }
    if (body.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await addPost(tickerId, symbol, body, null);
        setBody("");
        setDone(true);
        setTimeout(() => setDone(false), 2000);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not post.");
      }
    });
  }

  const initial = (author?.name ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <form onSubmit={submit} className="panel space-y-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-terminal-raise font-mono text-[10px] font-bold text-terminal-text">
          {initial}
        </span>
        {author?.username ? (
          <Link
            href={`/u/${author.username}`}
            className="font-mono text-xs font-bold text-terminal-text hover:text-terminal-accent"
          >
            {author.name}
          </Link>
        ) : (
          <span className="font-mono text-xs font-bold text-terminal-text">
            {author?.name ?? "you"}
          </span>
        )}
        <span className="rounded bg-terminal-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-terminal-accent">
          Thesis
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX))}
        // Signed out this used to redirect on FOCUS, so a keyboard user
        // could not tab past the composer without being thrown to /login.
        // Reading is allowed; the sign-in prompt belongs on the attempt.
        readOnly={!signedIn}
        onClick={() => {
          if (!signedIn) router.push(`/login?next=/t/${symbol}`);
        }}
        rows={3}
        placeholder={
          signedIn ? `Write a thesis on $${symbol}...` : `Sign in to write a thesis on $${symbol}`
        }
        className="w-full resize-none bg-transparent text-[13px] leading-snug text-terminal-text outline-none placeholder:text-terminal-muted/60"
      />
      <div className="flex items-center gap-2 text-[11px] text-terminal-muted">
        <Globe size={11} />
        <span title="Your real position shows next to it, read live from holdings">
          Visible to everyone
        </span>
        <span className="num ml-auto font-mono text-[10px]">
          {body.length}/{MAX}
        </span>
        {signedIn ? (
          <button
            type="submit"
            disabled={pending || body.trim().length === 0}
            className="btn-ghost px-2.5 py-0.5 text-[11px]"
          >
            {pending ? "…" : done ? "Posted" : "Post"}
          </button>
        ) : (
          <Link href={`/login?next=/t/${symbol}`} className="btn-ghost px-3 py-1 text-xs">
            Sign in
          </Link>
        )}
      </div>
      {error && <p className="text-xs text-terminal-down">{error}</p>}
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPost } from "@/app/t/[symbol]/actions";

/**
 * One text box. Type a thesis, press Enter, and it goes on the record with
 * your real position beside it, read live from holdings.
 */
export default function ThesisBox({
  tickerId,
  symbol,
  signedIn,
}: {
  tickerId: string;
  symbol: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
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
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not post.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="relative">
      <input
        type="text"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={() => {
          if (!signedIn) router.push(`/login?next=/t/${symbol}`);
        }}
        maxLength={280}
        placeholder="add a thesis"
        aria-label={`Add a thesis on $${symbol}`}
        className="input pr-16 text-sm"
      />
      {body.trim().length > 0 && (
        <button
          type="submit"
          disabled={pending}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-terminal-line bg-terminal-bg px-2 py-0.5 font-mono text-[11px] text-terminal-accent hover:border-terminal-accent"
        >
          {pending ? "…" : "post ↵"}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-terminal-down">{error}</p>}
    </form>
  );
}

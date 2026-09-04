"use client";

import { useActionState } from "react";
import Link from "next/link";
import { setHandle, type HandleResult } from "./actions";

const initialState: HandleResult = {};

export default function HandleForm({ current, next = "/" }: { current: string; /** where to land once the handle is claimed */ next?: string }) {
  const [state, formAction, pending] = useActionState(setHandle, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg text-terminal-muted">@</span>
        <input
          name="handle"
          defaultValue={current}
          required
          minLength={3}
          maxLength={20}
          pattern="[a-zA-Z0-9][a-zA-Z0-9\-]{1,18}[a-zA-Z0-9]"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="input font-mono lowercase"
          aria-label="Trader handle"
        />
      </div>
      {state.error && (
        <p className="text-xs text-terminal-down">{state.error}</p>
      )}
      <input type="hidden" name="next" value={next} />
      <button type="submit" disabled={pending} className="btn-buy w-full">
        {pending ? "…" : "Claim it & hit the market"}
      </button>
      <p className="text-center text-[11px] text-terminal-muted">
        <Link href={next} className="hover:text-terminal-text">
          skip for now →
        </Link>
      </p>
    </form>
  );
}

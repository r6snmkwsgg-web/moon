"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/portfolio";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <p className="panel p-4 text-sm text-terminal-up">
        ✓ Check your email for the sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="input"
        autoComplete="email"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="btn-ghost w-full"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state === "error" && (
        <p className="text-xs text-terminal-down">
          Couldn&apos;t send the link — check the address and try again.
        </p>
      )}
    </form>
  );
}

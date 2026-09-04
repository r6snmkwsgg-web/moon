"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { claimInvite } from "./actions";

/**
 * One form, no confirmation links: enter email + password and you're
 * trading. If the account exists the password signs you in; if it doesn't,
 * it's created on the spot (Supabase email confirmation is disabled, so
 * sign-up returns a live session immediately).
 */
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  // fresh sign-ins land on the market, not an empty portfolio
  const nextParam = searchParams.get("next") ?? "/";
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();

    // Try signing in first; an unknown account falls through to sign-up.
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (!signIn.error) {
      router.push(next);
      router.refresh();
      return;
    }

    if (!/invalid login credentials/i.test(signIn.error.message)) {
      setError(signIn.error.message);
      setPending(false);
      return;
    }

    const signUp = await supabase.auth.signUp({ email, password });
    if (signUp.error) {
      // The email exists but the password was wrong → signUp echoes a
      // conflict; surface it as the sign-in problem it really is.
      setError(
        /already registered/i.test(signUp.error.message)
          ? "Wrong password for that email."
          : signUp.error.message
      );
      setPending(false);
      return;
    }

    if (!signUp.data.session) {
      // Email confirmation is still switched on in Supabase.
      setError(
        "Account created, but Supabase still has email confirmation on — check your inbox this once (and turn it off under Authentication → Providers → Email)."
      );
      setPending(false);
      return;
    }

    await claimInvite();
    // brand-new account → claim a handle before hitting the market, then on
    // to wherever they were headed when they were asked to sign in
    router.push(next === "/" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`);
    router.refresh();
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
      <input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password (8+ characters)"
        className="input"
        autoComplete="current-password"
      />
      <button type="submit" disabled={pending} className="btn-buy w-full">
        {pending ? "…" : "Start trading"}
      </button>
      {error && <p className="text-xs text-terminal-down">{error}</p>}
      <p className="text-[11px] leading-snug text-terminal-muted">
        New email = new account with $10,000, instantly. No confirmation
        links, nothing to verify.
      </p>
    </form>
  );
}

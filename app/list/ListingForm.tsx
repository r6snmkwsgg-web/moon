"use client";

import { useActionState } from "react";
import { Zap } from "lucide-react";
import { listStartup, type ListingResult } from "./actions";

const initialState: ListingResult = {};

export default function ListingForm() {
  const [state, formAction, pending] = useActionState(
    listStartup,
    initialState
  );

  return (
    <form action={formAction} className="panel space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-terminal-muted">
          Ticker symbol (2–6 letters)
          <input
            name="symbol"
            required
            maxLength={6}
            placeholder="PRLA"
            className="input mt-1 font-mono uppercase"
            pattern="[A-Za-z]{2,6}"
          />
        </label>
        <label className="text-xs text-terminal-muted">
          Startup name
          <input name="name" required maxLength={60} placeholder="Pearla" className="input mt-1" />
        </label>
        <label className="text-xs text-terminal-muted sm:col-span-2">
          One-line pitch
          <input
            name="pitch"
            required
            maxLength={140}
            placeholder="Screenshot-to-invoice for freelance designers."
            className="input mt-1"
          />
        </label>
        <label className="text-xs text-terminal-muted">
          Your X/Threads handle
          <input name="handle" required placeholder="@you" className="input mt-1 font-mono" />
        </label>
        <label className="text-xs text-terminal-muted">
          Logo URL (optional, https)
          <input name="logo_url" placeholder="https://…" className="input mt-1" />
        </label>
      </div>

      <div className="space-y-2 rounded-md border border-terminal-amber/30 bg-terminal-amber/5 p-3">
        <label className="block text-xs font-semibold text-terminal-amber">
          Read-only Stripe restricted key (required — this IS the listing)
          <input
            name="stripe_key"
            required
            placeholder="rk_live_…"
            autoComplete="off"
            className="input mt-1.5 font-mono"
          />
        </label>
        <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-terminal-muted">
          <li>
            Stripe Dashboard → <span className="text-terminal-text">Developers → API keys</span> →{" "}
            <span className="text-terminal-text">Create restricted key</span>
          </li>
          <li>
            Set <span className="text-terminal-text">Subscriptions: Read</span> and{" "}
            <span className="text-terminal-text">Invoices: Read</span> — leave everything else{" "}
            <span className="text-terminal-text">None</span>
          </li>
          <li>Create it, copy the <span className="font-mono">rk_live_…</span> key, paste it above</li>
        </ol>
        <p className="text-[11px] leading-relaxed text-terminal-muted">
          We compute your MRR from active subscriptions and refresh it monthly —
          your automatic earnings report. The key is checked to be read-only
          (anything stronger is refused, secret keys especially), stored
          encrypted, never shown to anyone, and deleted if you disconnect or
          delist. Only the MRR number is public.
        </p>
      </div>

      {state.error && (
        <p className="rounded-md border border-terminal-down/40 bg-terminal-down/10 px-3 py-2 text-xs text-terminal-down">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-buy w-full">
        {pending ? (
          "Verifying with Stripe…"
        ) : (
          <>
            <Zap size={14} fill="currentColor" strokeWidth={0} />
            Verify &amp; list my startup
          </>
        )}
      </button>
      <p className="text-center text-[11px] text-terminal-muted">
        Play money only — a listing can never be bought, sold, or cashed out
        for real value. You can request delisting at any time.
      </p>
    </form>
  );
}

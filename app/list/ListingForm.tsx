"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  X,
  Zap,
} from "lucide-react";
import { ARR_MULTIPLE, fairPrice, SHARES_OUTSTANDING } from "@/lib/pricing";
import { fmtCompact, fmtPrice } from "@/lib/format";
import LogoTile from "@/components/LogoTile";
import { listStartup, uploadLogo, type ListingResult } from "./actions";

const initialState: ListingResult = {};

/**
 * Stripe's key-creation page, pre-filled: right name, right permissions
 * (Subscriptions + Invoices read). Founder clicks create → copies → pastes.
 */
const STRIPE_KEY_URL =
  "https://dashboard.stripe.com/apikeys/create?name=SAAS%20EXCHANGE%20(read-only)&permissions[]=rak_subscription_read&permissions[]=rak_invoice_read";

const STEPS = ["Your startup", "Verify revenue", "IPO"] as const;

type SymbolStatus = "idle" | "checking" | "free" | "taken" | "invalid";

export default function ListingForm() {
  const [state, formAction, pending] = useActionState(
    listStartup,
    initialState
  );

  const [step, setStep] = useState(0);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [pitch, setPitch] = useState("");
  const [handle, setHandle] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoState, setLogoState] = useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [stripeKey, setStripeKey] = useState("");
  const [symbolStatus, setSymbolStatus] = useState<SymbolStatus>("idle");
  const [copied, setCopied] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a server error lands you back on the review step, not a dead screen
  useEffect(() => {
    if (state.error) setStep(2);
  }, [state]);

  // debounced symbol availability
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const s = symbol.toUpperCase().trim();
    if (s.length === 0) {
      setSymbolStatus("idle");
      return;
    }
    if (!/^[A-Z]{2,6}$/.test(s)) {
      setSymbolStatus("invalid");
      return;
    }
    setSymbolStatus("checking");
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbol-check?s=${encodeURIComponent(s)}`);
        const json = await res.json();
        setSymbolStatus(json.available ? "free" : "taken");
      } catch {
        setSymbolStatus("idle"); // network hiccup — the server re-checks anyway
      }
    }, 350);
  }, [symbol]);

  const sym = symbol.toUpperCase().trim();
  const step1Ok =
    (symbolStatus === "free" || symbolStatus === "idle") &&
    /^[A-Z]{2,6}$/.test(sym) &&
    name.trim().length > 0 &&
    pitch.trim().length > 0 &&
    /^@?[A-Za-z0-9_.]{1,50}$/.test(handle.trim()) &&
    handle.trim().length > 0;
  const keyLooksRight = /^rk_(live|test)_/.test(stripeKey.trim());

  // A dead button with no explanation is the worst thing in a form. Say what
  // is missing, in the order the fields appear.
  const step1Blocker = !/^[A-Z]{2,6}$/.test(sym)
    ? "Pick a ticker symbol — 2 to 6 letters."
    : symbolStatus === "taken"
      ? `$${sym} is already trading. Try another symbol.`
      : !name.trim()
        ? "Add your startup's name."
        : !pitch.trim()
          ? "Add the one-line pitch traders will see."
          : !handle.trim()
            ? "Add your X or Threads handle — it's how traders check a listing is really you."
            : !/^@?[A-Za-z0-9_.]{1,50}$/.test(handle.trim())
              ? "That handle has characters X and Threads don't allow."
              : null;
  const step2Blocker = !stripeKey.trim()
    ? "Paste your restricted key to continue — your MRR (and your opening price) comes from it."
    : !keyLooksRight
      ? "Restricted keys start with rk_live_ — that's the one to paste."
      : null;

  // ── the celebration: MRR → fair value → opening price ────────────────────
  if (state.ok) {
    const o = state.ok;
    const post = `Just IPO'd $${o.symbol} on SAAS EXCHANGE — my real Stripe-verified MRR sets the price, traders fight over 10,000 fake shares. ${typeof window !== "undefined" ? window.location.origin : ""}/t/${o.symbol}`;
    return (
      <div className="space-y-4">
        <div className="panel space-y-3 border-terminal-up/40 bg-gradient-to-b from-terminal-up/10 to-transparent p-6 text-center">
          <p className="fade-up microlabel !text-terminal-amber">
            MRR verified — {fmtCompact(o.mrr)}/mo, straight from Stripe
          </p>
          <p
            className="fade-up text-xs text-terminal-muted"
            style={{ animationDelay: "0.5s" }}
          >
            fair value = {ARR_MULTIPLE}× ARR ÷ {SHARES_OUTSTANDING.toLocaleString("en-US")} shares (ARR = MRR × 12)
          </p>
          <p
            className="fade-up font-mono text-3xl font-bold text-terminal-up"
            style={{ animationDelay: "1s" }}
          >
            ${o.symbol} opens at {fmtPrice(o.ipoPrice)}
          </p>
          <p
            className="fade-up text-sm text-terminal-muted"
            style={{ animationDelay: "1.4s" }}
          >
            {o.name} is live on the board. You just IPO&apos;d.
          </p>
        </div>

        {/* the share kit — founders announcing their own IPO is the growth loop */}
        <div className="panel overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/t/${o.symbol}/opengraph-image`}
            alt={`$${o.symbol} share card`}
            className="w-full border-b border-terminal-line"
          />
          <div className="space-y-2 p-3">
            <p className="text-xs text-terminal-muted">
              This card unfurls automatically when your link is posted on
              X/Threads/Discord.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost flex-1 text-xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(post);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    window.prompt("Copy your launch post:", post);
                  }
                }}
              >
                {copied ? (
                  <>
                    <Check size={12} className="text-terminal-up" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    Copy launch post
                  </>
                )}
              </button>
              <Link
                href={`/t/${o.symbol}?ipo=1`}
                className="btn-buy flex-1 text-xs"
              >
                Go to your ticker
                <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* progress dots */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                i < step
                  ? "bg-terminal-up text-black"
                  : i === step
                    ? "border border-terminal-up text-terminal-up"
                    : "border border-terminal-line text-terminal-muted"
              }`}
            >
              {i < step ? <Check size={12} /> : i + 1}
            </span>
            <span
              className={`hidden text-xs sm:block ${
                i === step ? "font-semibold text-terminal-text" : "text-terminal-muted"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-terminal-line" />
            )}
          </li>
        ))}
      </ol>

      {/* live preview — the board row they're building */}
      <div className="panel overflow-hidden">
        <div className="microlabel border-b border-terminal-line px-3 py-1.5">
          Your row on the board
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <LogoTile symbol={sym || "??"} logoUrl={logoUrl.trim() || null} size={28} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-mono text-[13px] font-bold">
              ${sym || "————"}
              <span className="inline-flex items-center gap-0.5 rounded bg-terminal-amber/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-terminal-amber">
                <Zap size={10} fill="currentColor" strokeWidth={0} />
              </span>
              <span className="rounded bg-terminal-up/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-terminal-up">
                NEW
              </span>
            </span>
            <span className="block truncate text-xs text-terminal-muted">
              {name.trim() || "Your startup"} —{" "}
              {pitch.trim() || "your one-line pitch"}
            </span>
          </span>
          <span className="text-right">
            <span className="num block font-mono text-[13px] font-semibold text-terminal-muted">
              {step >= 1 && keyLooksRight ? "verifying…" : "$—.——"}
            </span>
            <span className="block font-mono text-[10px] text-terminal-muted">
              {step === 0 ? "price = your real MRR" : "set at verification"}
            </span>
          </span>
        </div>
      </div>

      {/* step 1 — identity */}
      {step === 0 && (
        <div className="panel space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-terminal-muted">
              Ticker symbol (2–6 letters)
              <span className="relative mt-1 block">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="PRLA"
                  className="input font-mono uppercase"
                  autoComplete="off"
                />
                <span className="absolute inset-y-0 right-2.5 flex items-center font-mono text-[10px]">
                  {symbolStatus === "checking" && (
                    <span className="text-terminal-muted">…</span>
                  )}
                  {symbolStatus === "free" && (
                    <span className="flex items-center gap-0.5 text-terminal-up">
                      <Check size={11} /> free
                    </span>
                  )}
                  {symbolStatus === "taken" && (
                    <span className="flex items-center gap-0.5 text-terminal-down">
                      <X size={11} /> taken
                    </span>
                  )}
                </span>
              </span>
            </label>
            <label className="text-xs text-terminal-muted">
              Startup name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Pearla"
                className="input mt-1"
              />
            </label>
            <label className="text-xs text-terminal-muted sm:col-span-2">
              One-line pitch
              <input
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                maxLength={140}
                placeholder="Screenshot-to-invoice for freelance designers."
                className="input mt-1"
              />
            </label>
            <label className="text-xs text-terminal-muted">
              Your X/Threads handle (required)
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@you"
                className="input mt-1 font-mono"
              />
            </label>
            <label className="text-xs text-terminal-muted">
              Logo (optional — PNG/JPG/WebP, under 1MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setLogoState("uploading");
                  setLogoError(null);
                  const fd = new FormData();
                  fd.append("logo", file);
                  const res = await uploadLogo(fd);
                  if (res.url) {
                    setLogoUrl(res.url);
                    setLogoState("done");
                  } else {
                    setLogoState("error");
                    setLogoError(res.error ?? "Upload failed.");
                  }
                }}
                className="input mt-1 file:mr-2 file:rounded file:border-0 file:bg-terminal-raise file:px-2 file:py-1 file:font-sans file:text-xs file:text-terminal-text"
              />
              <span className="mt-1 block font-mono text-[10px]">
                {logoState === "uploading" && (
                  <span className="text-terminal-muted">uploading…</span>
                )}
                {logoState === "done" && (
                  <span className="flex items-center gap-0.5 text-terminal-up">
                    <Check size={10} /> uploaded — see the preview above
                  </span>
                )}
                {logoState === "error" && (
                  <span className="text-terminal-down">{logoError}</span>
                )}
              </span>
            </label>
          </div>
          <button
            type="button"
            disabled={!step1Ok}
            onClick={() => setStep(1)}
            className="btn-buy w-full"
          >
            Next: verify your revenue
            <ArrowRight size={13} />
          </button>
          {step1Blocker && (
            <p className="text-center text-[11px] text-terminal-muted">
              {step1Blocker}
            </p>
          )}
        </div>
      )}

      {/* step 2 — the key */}
      {step === 1 && (
        <div className="panel space-y-3 p-4">
          <div className="space-y-2 rounded-md border border-terminal-amber/30 bg-terminal-amber/5 p-3">
            <p className="text-xs font-semibold text-terminal-amber">
              Your MRR comes straight from Stripe — never typed in. That&apos;s
              what the verified badge means.
            </p>
            <a
              href={STRIPE_KEY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-ghost w-full text-xs"
            >
              <ExternalLink size={12} />
              Open Stripe&apos;s key creator — name &amp; permissions pre-filled
            </a>
            <p className="text-[11px] leading-relaxed text-terminal-muted">
              It opens with <b className="text-terminal-text">Subscriptions: Read</b>{" "}
              and <b className="text-terminal-text">Invoices: Read</b> already
              selected. Hit <b className="text-terminal-text">Create key</b>,
              copy the <span className="font-mono">rk_live_…</span> value, paste
              it below. (If the pre-fill doesn&apos;t stick, set those two to
              Read and everything else to None.)
            </p>
            <input
              value={stripeKey}
              onChange={(e) => setStripeKey(e.target.value)}
              placeholder="rk_live_…"
              autoComplete="off"
              spellCheck={false}
              className="input font-mono"
              aria-label="Read-only Stripe restricted key"
            />
            {stripeKey.trim().startsWith("sk_") && (
              <p className="text-[11px] font-semibold text-terminal-down">
                That&apos;s your SECRET key — never share it, with us or anyone.
                We only accept restricted rk_ keys.
              </p>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-terminal-muted">
            The key is verified read-only (a hidden write probe rejects
            anything stronger), stored encrypted, never shown or logged, and
            deleted if you disconnect or delist. Only the MRR number is public.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="btn-ghost text-xs"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!keyLooksRight}
              onClick={() => setStep(2)}
              className="btn-buy flex-1"
            >
              Next: review your IPO
              <ArrowRight size={13} />
            </button>
          </div>
          {step2Blocker && (
            <p className="text-center text-[11px] text-terminal-muted">
              {step2Blocker}
            </p>
          )}
        </div>
      )}

      {/* step 3 — review & launch */}
      {step === 2 && (
        <form action={formAction} className="panel space-y-3 p-4">
          <input type="hidden" name="symbol" value={sym} />
          <input type="hidden" name="name" value={name.trim()} />
          <input type="hidden" name="pitch" value={pitch.trim()} />
          <input type="hidden" name="handle" value={handle.trim()} />
          <input type="hidden" name="logo_url" value={logoUrl.trim()} />
          <input type="hidden" name="stripe_key" value={stripeKey.trim()} />

          <dl className="space-y-1.5 text-sm">
            {[
              ["Ticker", `$${sym}`],
              ["Name", name.trim()],
              ["Pitch", pitch.trim()],
              ["Founder", `@${handle.trim().replace(/^@/, "")}`],
              [
                "Stripe key",
                `rk_…${stripeKey.trim().slice(-4)} (read-only, encrypted)`,
              ],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-24 shrink-0 text-xs text-terminal-muted">
                  {k}
                </dt>
                <dd className="min-w-0 truncate font-mono text-xs">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="rounded-md bg-terminal-raise/60 px-3 py-2 text-[11px] leading-relaxed text-terminal-muted">
            On launch we verify the key, compute your MRR from active
            subscriptions, and your opening price is set at fair value —{" "}
            {ARR_MULTIPLE}× ARR over{" "}
            {SHARES_OUTSTANDING.toLocaleString("en-US")} shares. For{" "}
            {fmtCompact(1000)} MRR that&apos;s{" "}
            {fmtPrice(fairPrice(1000))}/share, for {fmtCompact(10000)} it&apos;s{" "}
            {fmtPrice(fairPrice(10000))}.
          </p>

          {state.error && (
            <p className="rounded-md border border-terminal-down/40 bg-terminal-down/10 px-3 py-2 text-xs text-terminal-down">
              {state.error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-ghost text-xs"
            >
              Back
            </button>
            <button type="submit" disabled={pending} className="btn-buy flex-1">
              {pending ? (
                "Verifying with Stripe…"
              ) : (
                <>
                  <Zap size={14} fill="currentColor" strokeWidth={0} />
                  Verify &amp; IPO
                </>
              )}
            </button>
          </div>
          <p className="text-center text-[11px] text-terminal-muted">
            Play money only — a listing can never be bought, sold, or cashed
            out for real value. Delist any time.
          </p>
        </form>
      )}
    </div>
  );
}

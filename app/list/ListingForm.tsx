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
import { TARGET_OPENING_PRICE } from "@/lib/pricing";
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

/** Where the half-filled form waits while the founder is over on Stripe. */
const DRAFT = "sx.listing.draft";

const CONNECT_ERRORS: Record<string, string> = {
  denied: "You cancelled on Stripe — nothing was shared.",
  state: "That link expired. Start the connection again.",
  session: "You were signed out mid-connection. Sign in and retry.",
  nocode: "Stripe didn't send an authorization back — try again.",
  exchange: "Stripe rejected the authorization. Try again in a minute.",
};

type SymbolStatus = "idle" | "checking" | "free" | "taken" | "invalid";

export default function ListingForm({
  connectAvailable,
}: {
  /** Whether this deployment has Stripe Connect set up (server-decided). */
  connectAvailable: boolean;
}) {
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
  const [website, setWebsite] = useState("");
  const [logoState, setLogoState] = useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [stripeKey, setStripeKey] = useState("");
  const [connected, setConnected] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [symbolStatus, setSymbolStatus] = useState<SymbolStatus>("idle");
  const [copied, setCopied] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a server error lands you back on the review step, not a dead screen
  useEffect(() => {
    if (state.error) setStep(2);
  }, [state]);

  /*
   * Coming back from Stripe. The callback bounces here with ?stripe=<outcome>,
   * so this picks the parked draft back up, reports what happened, and drops
   * the query so a refresh doesn't replay the banner.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("stripe");
    if (!outcome) return;

    try {
      const raw = sessionStorage.getItem(DRAFT);
      if (raw) {
        const d = JSON.parse(raw) as Record<string, string>;
        if (d.symbol) setSymbol(d.symbol);
        if (d.name) setName(d.name);
        if (d.pitch) setPitch(d.pitch);
        if (d.handle) setHandle(d.handle);
        if (d.logoUrl) setLogoUrl(d.logoUrl);
        if (d.website) setWebsite(d.website);
        sessionStorage.removeItem(DRAFT);
      }
    } catch {
      // private mode, or nothing parked — the fields just stay empty
    }

    if (outcome === "connected") {
      setConnected(params.get("acct") ?? "connected");
    } else {
      setConnectError(
        CONNECT_ERRORS[outcome] ?? "Stripe connection failed — try again."
      );
    }
    setStep(1);
    window.history.replaceState({}, "", "/list");
  }, []);

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

  /*
   * Connecting leaves the page, so the half-filled form has to be parked and
   * picked back up. sessionStorage is right for this: per-tab, dies with the
   * tab, and nothing in it is sensitive — the key field is deliberately never
   * included.
   */
  function startConnect() {
    try {
      sessionStorage.setItem(
        DRAFT,
        JSON.stringify({ symbol: sym, name, pitch, handle, logoUrl, website })
      );
    } catch {
      // private mode — they will just re-enter the fields
    }
    window.location.href = "/api/stripe/connect?return=%2Flist";
  }

  const step1Ok =
    (symbolStatus === "free" || symbolStatus === "idle") &&
    /^[A-Z]{2,6}$/.test(sym) &&
    name.trim().length > 0 &&
    pitch.trim().length > 0 &&
    /^@?[A-Za-z0-9_.]{1,50}$/.test(handle.trim()) &&
    handle.trim().length > 0;
  const keyLooksRight = /^rk_(live|test)_/.test(stripeKey.trim());
  // either path satisfies step 2
  const revenueReady = connected !== null || keyLooksRight;

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
  const step2Blocker = connected
    ? null
    : !stripeKey.trim()
    ? "Connect Stripe (or paste a read-only key) to continue — your MRR sets your opening price."
    : !keyLooksRight
      ? "Restricted keys start with rk_live_ — that's the one to paste."
      : null;

  // ── the celebration: MRR → opening price ─────────────────────────────────
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
            your revenue set the opening price, spread over a{" "}
            {o.shares.toLocaleString("en-US")}-share float
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
              Website (optional — linked from your ticker page, where every
              visitor lands)
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://yourproduct.com"
                inputMode="url"
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
          <p className="text-xs font-semibold text-terminal-amber">
            Your MRR comes straight from Stripe — never typed in. That&apos;s
            what the verified badge means.
          </p>

          {connected ? (
            <div className="flex items-start gap-2 rounded-md border border-terminal-up/30 bg-terminal-up/5 p-3">
              <Check size={14} className="mt-0.5 shrink-0 text-terminal-up" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-terminal-up">
                  Stripe connected — read-only
                </p>
                <p className="num font-mono text-[11px] text-terminal-muted">
                  {connected}
                </p>
                <p className="text-[11px] leading-relaxed text-terminal-muted">
                  We never received a key. You can revoke this from your ticker
                  page, or from Stripe, at any time.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* the two-click path, and the one almost everyone should take */}
              {connectAvailable && (
                <>
                  <button
                    type="button"
                    onClick={startConnect}
                    className="btn-buy w-full"
                  >
                    Connect with Stripe
                    <ArrowRight size={13} />
                  </button>
                  <p className="text-[11px] leading-relaxed text-terminal-muted">
                    Opens Stripe&apos;s own approval page. You grant{" "}
                    <b className="text-terminal-text">read-only</b> access and
                    come straight back — no key to create, copy, or paste.
                  </p>
                  {connectError && (
                    <p className="text-[11px] font-semibold text-terminal-down">
                      {connectError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="text-[11px] text-terminal-accent hover:underline"
                  >
                    {showKey ? "Hide" : "Paste a restricted key instead"}
                  </button>
                </>
              )}

              {/* kept for founders who want a narrower scope than read_only,
                  and as the whole flow when Connect isn't configured */}
              {(showKey || !connectAvailable) && (
                <div className="space-y-2 rounded-md border border-terminal-line bg-terminal-bg/40 p-3">
                  <a
                    href={STRIPE_KEY_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-ghost w-full text-xs"
                  >
                    <ExternalLink size={12} />
                    Open Stripe&apos;s key creator — permissions pre-filled
                  </a>
                  <p className="text-[11px] leading-relaxed text-terminal-muted">
                    Scoped to{" "}
                    <b className="text-terminal-text">Subscriptions: Read</b> and{" "}
                    <b className="text-terminal-text">Invoices: Read</b> only —
                    narrower than the OAuth grant above, if you prefer that.
                    Create it, then paste the{" "}
                    <span className="font-mono">rk_live_…</span> value here.
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
                      That&apos;s your SECRET key — never share it, with us or
                      anyone. We only accept restricted rk_ keys.
                    </p>
                  )}
                  <p className="text-[11px] leading-relaxed text-terminal-muted">
                    Verified read-only by a hidden write probe, stored
                    encrypted, never shown or logged, deleted if you disconnect.
                  </p>
                </div>
              )}
            </>
          )}

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
              disabled={!revenueReady}
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
          <input type="hidden" name="website" value={website.trim()} />
          <input type="hidden" name="stripe_key" value={stripeKey.trim()} />

          <dl className="space-y-1.5 text-sm">
            {[
              ["Ticker", `$${sym}`],
              ["Name", name.trim()],
              ["Pitch", pitch.trim()],
              ["Founder", `@${handle.trim().replace(/^@/, "")}`],
              ...(stripeKey.trim()
                ? [
                    [
                      "Stripe key",
                      `rk_…${stripeKey.trim().slice(-4)} (read-only, encrypted)`,
                    ] as [string, string],
                  ]
                : [["Stripe", "Connected — read-only access"] as [string, string]]),
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
            subscriptions, and set your opening price from it. Like a real
            IPO, the share count is picked so the first print lands near{" "}
            {fmtPrice(TARGET_OPENING_PRICE)} — more revenue means a bigger
            float, not a bigger number on the first candle. From there the
            market decides.
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

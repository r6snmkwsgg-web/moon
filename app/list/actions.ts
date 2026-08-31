"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeMrrFromStripe,
  encryptStripeKey,
  stripeVerificationConfigured,
  verifyRestrictedKey,
  type StripeAuth,
} from "@/lib/stripe";
import { clearConnectGrant, readConnectGrant } from "@/lib/connect-grant";
import { fairPrice, shareCountFor, valuationMultiple } from "@/lib/pricing";
import { currentMonthISO } from "@/lib/format";
import { MAX_LISTINGS_PER_USER } from "@/lib/config";
import { storeLogo } from "@/lib/logos";

export interface LogoResult {
  url?: string;
  error?: string;
}

/** Upload a logo file (wizard step 1) → public URL for the listing. */
export async function uploadLogo(formData: FormData): Promise<LogoResult> {
  const user = await getUser();
  if (!user) return { error: "Sign in first." };
  const admin = createSupabaseAdminClient();
  return storeLogo(admin, user.id, formData.get("logo"));
}

export interface ListingResult {
  error?: string;
  /** Set on success — powers the IPO-reveal celebration screen. */
  ok?: {
    symbol: string;
    name: string;
    mrr: number;
    ipoPrice: number;
    shares: number;
  };
}

/**
 * Self-serve listing. THE KEY IS THE TICKET: a valid read-only Stripe
 * restricted key is required, MRR is computed from Stripe on the spot
 * (never typed in), and the ticker goes live claimed + Stripe-verified
 * from birth. The pasted key is validated, encrypted, stored server-side,
 * and never echoed back or logged.
 */
export async function listStartup(
  _prev: ListingResult,
  formData: FormData
): Promise<ListingResult> {
  const user = await getUser();
  if (!user) return { error: "Sign in first." };
  if (!stripeVerificationConfigured()) {
    return {
      error:
        "Stripe verification isn't configured on this deployment yet (missing STRIPE_KEY_ENCRYPTION_SECRET).",
    };
  }

  const symbol = String(formData.get("symbol") ?? "").toUpperCase().trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const pitch = String(formData.get("pitch") ?? "").trim().slice(0, 140);
  const handle = String(formData.get("handle") ?? "")
    .trim()
    .replace(/^@/, "")
    .slice(0, 50);
  const logoUrl = String(formData.get("logo_url") ?? "").trim() || null;
  const stripeKey = String(formData.get("stripe_key") ?? "").trim();

  /*
   * Revenue comes from one of two places, and the rest of this action does
   * not care which: a Stripe Connect grant redeemed from the signed cookie
   * the callback set, or a restricted key typed into the form. The grant is
   * checked against this user so a cookie picked up elsewhere cannot verify
   * someone else's listing.
   */
  const grant = await readConnectGrant(user.id);
  if (!grant && !stripeKey) {
    return {
      error:
        "Connect Stripe (or paste a read-only key) — the MRR it reports is the listing ticket.",
    };
  }
  const auth: StripeAuth = grant
    ? { kind: "account", accountId: grant.accountId }
    : { kind: "key", key: stripeKey };

  if (!/^[A-Z]{2,6}$/.test(symbol)) {
    return { error: "Symbol must be 2–6 letters (like PRLA)." };
  }
  if (!name || !pitch) return { error: "Name and one-line pitch are required." };
  if (!/^[A-Za-z0-9_.]{1,50}$/.test(handle)) {
    return { error: "Enter your X/Threads handle (letters, numbers, _ or .)." };
  }
  if (logoUrl && !/^https:\/\/.+/.test(logoUrl)) {
    return { error: "Logo URL must start with https://" };
  }
  const admin = createSupabaseAdminClient();

  const { count: myListings } = await admin
    .from("tickers")
    .select("*", { count: "exact", head: true })
    .eq("listed_by", user.id);
  if ((myListings ?? 0) >= MAX_LISTINGS_PER_USER) {
    return { error: `You've hit the ${MAX_LISTINGS_PER_USER}-listing limit.` };
  }

  const { data: existing } = await admin
    .from("tickers")
    .select("id")
    .eq("symbol", symbol)
    .maybeSingle();
  if (existing) return { error: `$${symbol} is taken — pick another symbol.` };

  // A pasted key has to prove it is read-only before we will hold it. An
  // OAuth grant needs no such probe: read_only is the scope we asked Stripe
  // for, and Stripe, not the founder, is the one attesting to it.
  let livemode = grant?.livemode ?? false;
  if (!grant) {
    const check = await verifyRestrictedKey(stripeKey);
    if (!check.ok) return { error: check.error };
    livemode = check.livemode;
  }

  let mrr: number;
  try {
    mrr = await computeMrrFromStripe(auth);
  } catch {
    return { error: "Couldn't compute MRR from Stripe — try again in a minute." };
  }

  // day one: one month of record, so the ticker opens at the rookie multiple
  const openingMultiple = valuationMultiple([
    { month: currentMonthISO(), mrr },
  ]);
  // the IPO decision: how many shares this company is cut into. Sized so the
  // first print lands in the same band as everything else on the board.
  const shares = shareCountFor(mrr, openingMultiple);

  const row = {
    symbol,
    name,
    pitch,
    logo_url: logoUrl,
    founder_handle: handle,
    claimed: true,
    claimed_by: user.id,
    listed_by: user.id,
    stripe_verified: true,
    fixture: false,
    sentiment: 0,
    shares_outstanding: shares,
  };
  let { data: ticker, error: insertErr } = await admin
    .from("tickers")
    .insert(row)
    .select("id")
    .single();
  if (insertErr && /shares_outstanding/.test(insertErr.message)) {
    // 0004 hasn't been applied yet — list at the default float instead of
    // failing the founder's IPO over a column
    const { shares_outstanding: _drop, ...legacy } = row;
    ({ data: ticker, error: insertErr } = await admin
      .from("tickers")
      .insert(legacy)
      .select("id")
      .single());
  }
  if (insertErr || !ticker) {
    return { error: "Listing failed — the symbol may have just been taken." };
  }

  const openingPrice = fairPrice(mrr, openingMultiple, shares);
  const today = new Date().toISOString().slice(0, 10);
  await admin.from("mrr_updates").insert({
    ticker_id: ticker.id,
    month: currentMonthISO(),
    mrr,
    source: "stripe",
  });
  await admin.from("stripe_connections").insert({
    ticker_id: ticker.id,
    method: grant ? "oauth" : "key",
    // an OAuth connection stores no credential at all — just which account
    stripe_account_id: grant?.accountId ?? null,
    connect_scope: grant?.scope ?? null,
    encrypted_key: grant ? null : encryptStripeKey(stripeKey),
    key_last4: grant ? null : stripeKey.slice(-4),
    livemode,
    connected_by: user.id,
    last_synced_at: new Date().toISOString(),
    last_mrr: mrr,
  });
  if (grant) await clearConnectGrant();
  await admin.from("price_snapshots").upsert(
    {
      ticker_id: ticker.id,
      day: today,
      price: openingPrice,
      fair_price: openingPrice,
      sentiment: 0,
      mrr,
    },
    { onConflict: "ticker_id,day" }
  );

  revalidatePath("/");
  revalidatePath(`/t/${symbol}`);
  return {
    ok: { symbol, name, mrr, ipoPrice: openingPrice, shares },
  };
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeMrrFromStripe,
  encryptStripeKey,
  stripeVerificationConfigured,
  verifyRestrictedKey,
} from "@/lib/stripe";
import { fairPrice } from "@/lib/pricing";
import { currentMonthISO } from "@/lib/format";
import { MAX_LISTINGS_PER_USER } from "@/lib/config";

export interface ListingResult {
  error?: string;
}

/**
 * Self-serve listing. THE KEY IS THE TICKET: a valid read-only Stripe
 * restricted key is required, MRR is computed from Stripe on the spot
 * (never typed in), and the ticker goes live claimed + ⚡ Stripe-verified
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
  if (!stripeKey) {
    return { error: "The read-only Stripe key is required — it IS the listing ticket." };
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

  // Validate the key: format, readable subscriptions, write probe.
  const check = await verifyRestrictedKey(stripeKey);
  if (!check.ok) return { error: check.error };

  let mrr: number;
  try {
    mrr = await computeMrrFromStripe(stripeKey);
  } catch {
    return { error: "Couldn't compute MRR from Stripe — try again in a minute." };
  }

  const { data: ticker, error: insertErr } = await admin
    .from("tickers")
    .insert({
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
    })
    .select("id")
    .single();
  if (insertErr || !ticker) {
    return { error: "Listing failed — the symbol may have just been taken." };
  }

  const today = new Date().toISOString().slice(0, 10);
  await admin.from("mrr_updates").insert({
    ticker_id: ticker.id,
    month: currentMonthISO(),
    mrr,
    source: "stripe",
  });
  await admin.from("stripe_connections").insert({
    ticker_id: ticker.id,
    encrypted_key: encryptStripeKey(stripeKey),
    key_last4: stripeKey.slice(-4),
    livemode: check.livemode,
    connected_by: user.id,
    last_synced_at: new Date().toISOString(),
    last_mrr: mrr,
  });
  await admin.from("price_snapshots").upsert(
    {
      ticker_id: ticker.id,
      day: today,
      price: fairPrice(mrr),
      fair_price: fairPrice(mrr),
      sentiment: 0,
      mrr,
    },
    { onConflict: "ticker_id,day" }
  );

  revalidatePath("/");
  redirect(`/t/${symbol}?ipo=1`);
}

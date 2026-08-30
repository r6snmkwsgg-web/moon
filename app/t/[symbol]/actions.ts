"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordTickerSnapshot } from "@/lib/snapshot";

/**
 * Founder posts their own monthly MRR number (honor system, labeled
 * "self-reported"). Runs with the service role AFTER verifying the signed-in
 * user actually claimed this ticker. This is the "earnings report" moment —
 * the price anchor moves the instant the row lands, since prices always read
 * the latest MRR.
 */
export async function submitMrr(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");

  const tickerId = String(formData.get("ticker_id") ?? "");
  const month = String(formData.get("month") ?? ""); // "YYYY-MM"
  const mrr = Number(formData.get("mrr"));
  if (!tickerId || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(mrr) || mrr < 0 || mrr > 100_000_000) {
    throw new Error("Invalid MRR entry.");
  }

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can post MRR.");
  }

  const { error } = await admin.from("mrr_updates").upsert(
    {
      ticker_id: ticker.id,
      month: `${month}-01`,
      mrr,
      source: "self-reported",
    },
    { onConflict: "ticker_id,month" }
  );
  if (error) throw new Error("Could not save MRR.");

  // the anchor just moved — put the reprice on the chart immediately
  await recordTickerSnapshot(admin, ticker.id);

  revalidatePath(`/t/${ticker.symbol}`);
  revalidatePath("/");
}

/** Toggle the signed-in user's watchlist entry for a ticker. */
export async function toggleWatch(tickerId: string, symbol: string) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("watchlists")
    .select("ticker_id")
    .eq("ticker_id", tickerId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("watchlists")
      .delete()
      .eq("ticker_id", tickerId)
      .eq("user_id", user.id);
  } else {
    await supabase
      .from("watchlists")
      .insert({ ticker_id: tickerId, user_id: user.id });
  }
  revalidatePath(`/t/${symbol}`);
}

/** Cast or flip a bull/bear vote. */
export async function castVote(tickerId: string, symbol: string, vote: 1 | -1) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  if (vote !== 1 && vote !== -1) throw new Error("Invalid vote.");
  const supabase = await createSupabaseServerClient();
  await supabase.from("ticker_votes").upsert(
    {
      ticker_id: tickerId,
      user_id: user.id,
      vote,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,ticker_id" }
  );
  revalidatePath(`/t/${symbol}`);
}

/**
 * Founder submits the X/Threads post proving the handle is theirs
 * ("just listed $SYMB on …"). Admin approves in /admin → founder badge.
 */
export async function submitHandleProof(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const tickerId = String(formData.get("ticker_id") ?? "");
  const proofUrl = String(formData.get("proof_url") ?? "").trim();
  if (!/^https:\/\/(x\.com|twitter\.com|www\.threads\.net|threads\.net)\/.+/.test(proofUrl)) {
    throw new Error("Paste the URL of your X or Threads post.");
  }

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can verify the handle.");
  }
  await admin
    .from("tickers")
    .update({ handle_proof_url: proofUrl.slice(0, 300) })
    .eq("id", ticker.id);
  revalidatePath(`/t/${ticker.symbol}`);
}

/**
 * Founder of an already-listed ticker connects Stripe after the fact:
 * same validation as self-serve listing — read-only restricted key only,
 * MRR computed on the spot, verified badge on, monthly auto-sync from then on.
 */
export async function connectStripe(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const { verifyRestrictedKey, computeMrrFromStripe, encryptStripeKey, stripeVerificationConfigured } =
    await import("@/lib/stripe");
  if (!stripeVerificationConfigured()) {
    throw new Error("Stripe verification isn't configured on this deployment.");
  }

  const tickerId = String(formData.get("ticker_id") ?? "");
  const stripeKey = String(formData.get("stripe_key") ?? "").trim();

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can connect Stripe.");
  }

  const check = await verifyRestrictedKey(stripeKey);
  if (!check.ok) throw new Error(check.error ?? "Key rejected.");
  const mrr = await computeMrrFromStripe(stripeKey);

  await admin.from("stripe_connections").upsert(
    {
      ticker_id: ticker.id,
      encrypted_key: encryptStripeKey(stripeKey),
      key_last4: stripeKey.slice(-4),
      livemode: check.livemode,
      connected_by: user.id,
      last_synced_at: new Date().toISOString(),
      last_mrr: mrr,
      status: "active",
    },
    { onConflict: "ticker_id" }
  );
  await admin.from("mrr_updates").upsert(
    {
      ticker_id: ticker.id,
      month: `${new Date().toISOString().slice(0, 7)}-01`,
      mrr,
      source: "stripe",
    },
    { onConflict: "ticker_id,month" }
  );
  await admin
    .from("tickers")
    .update({ stripe_verified: true })
    .eq("id", ticker.id);

  // verified MRR just landed — reprice on the chart immediately
  await recordTickerSnapshot(admin, ticker.id, { mrr });

  revalidatePath(`/t/${ticker.symbol}`);
  revalidatePath("/");
}

/** Founder disconnects Stripe: the encrypted key is deleted, badge removed. */
export async function disconnectStripe(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const tickerId = String(formData.get("ticker_id") ?? "");

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can disconnect Stripe.");
  }
  await admin.from("stripe_connections").delete().eq("ticker_id", ticker.id);
  await admin
    .from("tickers")
    .update({ stripe_verified: false })
    .eq("id", ticker.id);
  revalidatePath(`/t/${ticker.symbol}`);
}

/** Founder asks for their ticker to be delisted; admin acts on it in /admin. */
export async function requestDelisting(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");

  const tickerId = String(formData.get("ticker_id") ?? "");
  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can request delisting.");
  }

  await admin.from("delist_requests").upsert(
    { ticker_id: ticker.id, user_id: user.id },
    { onConflict: "ticker_id,user_id", ignoreDuplicates: true }
  );

  revalidatePath(`/t/${ticker.symbol}`);
}

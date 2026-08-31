"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordTickerSnapshot } from "@/lib/snapshot";
import { storeLogo } from "@/lib/logos";

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

/**
 * Post a take on a ticker's discussion thread. RLS enforces ownership; the
 * app enforces a light rate limit (5 posts / 5 min) so raids stay boring.
 */
export async function addPost(
  tickerId: string,
  symbol: string,
  body: string,
  stance: 1 | -1 | null
) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length < 1 || text.length > 280) {
    throw new Error("Posts are 1–280 characters.");
  }
  if (stance !== null && stance !== 1 && stance !== -1) {
    throw new Error("Invalid stance.");
  }

  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
  if ((count ?? 0) >= 5) {
    throw new Error("Slow down — 5 posts per 5 minutes.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("posts").insert({
    ticker_id: tickerId,
    user_id: user.id,
    body: text,
    stance,
  });
  if (error) throw new Error("Could not post.");
  revalidatePath(`/t/${symbol}`);
}

/** Delete your own post (RLS scoped). */
export async function deletePost(postId: string, symbol: string) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const supabase = await createSupabaseServerClient();
  await supabase.from("posts").delete().eq("id", postId).eq("user_id", user.id);
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
  const mrr = await computeMrrFromStripe({ kind: "key", key: stripeKey });

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

/**
 * Founder disconnects Stripe: the connection is deleted and the badge comes
 * off. On an OAuth connection we also hand the grant back to Stripe, so the
 * authorization actually ends rather than just being forgotten on our side.
 */
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
  const { deauthorizeConnect } = await import("@/lib/stripe");
  const { data: conn } = await admin
    .from("stripe_connections")
    .select("*")
    .eq("ticker_id", ticker.id)
    .maybeSingle();

  if (conn?.method === "oauth" && conn.stripe_account_id) {
    try {
      await deauthorizeConnect(conn.stripe_account_id);
    } catch {
      // Stripe is unreachable or already revoked it — either way the founder
      // asked to be disconnected, so drop our side regardless and let them
      // finish the job from their dashboard if it mattered.
    }
  }
  await admin.from("stripe_connections").delete().eq("ticker_id", ticker.id);
  await admin
    .from("tickers")
    .update({ stripe_verified: false })
    .eq("id", ticker.id);
  revalidatePath(`/t/${ticker.symbol}`);
}

/** Founder uploads or replaces their ticker's logo. */
export async function updateLogo(formData: FormData) {
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
    throw new Error("Only the claimed founder can change the logo.");
  }

  const stored = await storeLogo(admin, user.id, formData.get("logo"));
  if (!stored.url) throw new Error(stored.error ?? "Upload failed.");

  await admin
    .from("tickers")
    .update({ logo_url: stored.url })
    .eq("id", ticker.id);
  revalidatePath(`/t/${ticker.symbol}`);
  revalidatePath("/");
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

"use server";

import { revalidatePath } from "next/cache";
import { getMarket } from "@/lib/data";
import { placeOrder } from "@/lib/trade";
import { GUIDANCE_STEPS } from "@/lib/calls";
import { normaliseWebsite } from "@/lib/website";
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

export type LikeKind = "post" | "trade";

/**
 * Like or unlike a thesis — a post on the floor or a note on a print. One
 * row per person per thesis; a second tap removes it. Returns the state the
 * server now holds so the button can snap to it.
 */
export async function toggleLike(
  kind: LikeKind,
  targetId: string,
  symbol: string
): Promise<{ liked: boolean; likes: number }> {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  if (kind !== "post" && kind !== "trade") throw new Error("Invalid kind.");
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) throw new Error("Invalid thesis.");

  const admin = createSupabaseAdminClient();
  const { data: mine } = await admin
    .from("thesis_likes")
    .select("user_id")
    .eq("kind", kind)
    .eq("target_id", targetId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mine) {
    await admin
      .from("thesis_likes")
      .delete()
      .eq("kind", kind)
      .eq("target_id", targetId)
      .eq("user_id", user.id);
  } else {
    const { error } = await admin
      .from("thesis_likes")
      .insert({ kind, target_id: targetId, user_id: user.id });
    if (error) throw new Error("Could not like that.");
  }
  const { count } = await admin
    .from("thesis_likes")
    .select("*", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("target_id", targetId);
  revalidatePath(`/t/${symbol}`);
  return { liked: !mine, likes: count ?? 0 };
}

/** The founder sets the company's website — the listing is a promotion. */
export async function updateWebsite(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");

  const tickerId = String(formData.get("ticker_id") ?? "");
  const website = normaliseWebsite(String(formData.get("website") ?? ""));

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can set the website.");
  }
  const { error } = await admin.from("tickers").update({ website }).eq("id", ticker.id);
  if (error) throw new Error("Could not save the website — has migration 0010 been run?");
  revalidatePath(`/t/${ticker.symbol}`);
}

/**
 * An earnings call: the founder tells the market what next month's MRR
 * will do, in their own words. Public, permanent, and judged by the next
 * real print — a call you cannot delete is what makes it a call.
 */
export async function postCall(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const tickerId = String(formData.get("ticker_id") ?? "");
  const body = String(formData.get("body") ?? "").replace(/\s+/g, " ").trim();
  const guidance = Number(formData.get("guidance"));
  if (body.length < 1 || body.length > 600) throw new Error("A call is 1–600 characters.");
  if (!GUIDANCE_STEPS.some((g) => Math.abs(g - guidance) < 1e-9)) throw new Error("Pick a guidance.");

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can hold an earnings call.");
  }
  const { count } = await admin
    .from("calls")
    .select("*", { count: "exact", head: true })
    .eq("ticker_id", ticker.id)
    .gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString());
  if ((count ?? 0) >= 1) throw new Error("One call a day — the market needs time to trade it.");
  const { error } = await admin.from("calls").insert({
    ticker_id: ticker.id,
    user_id: user.id,
    body,
    guidance,
  });
  if (error) throw new Error("Could not post the call — has migration 0012 been run?");
  // the floor sees it too, from the founder, marked as a call
  await admin.from("posts").insert({
    ticker_id: ticker.id,
    user_id: user.id,
    body: `📣 Earnings call — guiding ${guidance >= 0 ? "+" : ""}${Math.round(guidance * 100)}% next month: ${body}`.slice(0, 280),
    stance: guidance > 0 ? 1 : guidance < 0 ? -1 : null,
  });
  revalidatePath(`/t/${ticker.symbol}`);
}

/**
 * A buyback: the founder buys shares off the float with their own play
 * money at the curve's price, slippage and all, and retires them. The
 * float shrinks, every remaining share is a bigger slice of the same
 * company, and the tape shows "bought back".
 */
export async function buyBack(formData: FormData) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  const tickerId = String(formData.get("ticker_id") ?? "");
  const dollars = Number(formData.get("dollars"));
  if (!(dollars >= 10)) throw new Error("A buyback is at least $10.");

  const admin = createSupabaseAdminClient();
  const { data: ticker } = await admin
    .from("tickers")
    .select("id, symbol, claimed_by, shares_outstanding, sentiment, drift")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker || ticker.claimed_by !== user.id) {
    throw new Error("Only the claimed founder can buy back shares.");
  }
  // size the order off the live quote, then let placeOrder fill it honestly
  const quote = (await getMarket()).find((q) => q.ticker.id === ticker.id);
  if (!quote || !(quote.price > 0)) throw new Error("No price yet.");
  const shares = Math.max(1, Math.floor(dollars / (quote.price * 1.05)));
  const result = await placeOrder(admin, { userId: user.id, symbol: ticker.symbol, side: "buy", shares });
  if (!result.ok) throw new Error(result.error);
  await result.settle();
  const { data: trade } = await admin
    .from("trades")
    .select("id")
    .eq("user_id", user.id)
    .eq("ticker_id", ticker.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await admin.rpc("retire_shares", {
    p_ticker_id: ticker.id,
    p_user_id: user.id,
    p_shares: shares,
    p_trade_id: trade?.id ?? null,
  });
  if (error) {
    // the shares are bought and held; only the retirement failed — say so
    throw new Error(`Bought ${shares} shares but could not retire them: ${error.message}`);
  }
  revalidatePath(`/t/${ticker.symbol}`);
  revalidatePath("/");
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

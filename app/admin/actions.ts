"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/auth";
import { livePrice, valuationMultiple } from "@/lib/pricing";

/** Every admin action re-checks the env allowlist server-side. */
async function requireAdmin() {
  const user = await getUser();
  if (!isAdminUser(user)) throw new Error("Not authorized.");
  return user!;
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/admin");
}

export async function addTicker(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const symbol = String(formData.get("symbol") ?? "")
    .toUpperCase()
    .trim();
  const name = String(formData.get("name") ?? "").trim();
  const pitch = String(formData.get("pitch") ?? "").trim();
  const founderHandle =
    String(formData.get("founder_handle") ?? "").trim().replace(/^@/, "") ||
    null;
  const logoUrl = String(formData.get("logo_url") ?? "").trim() || null;
  const month = String(formData.get("month") ?? "");
  const mrr = Number(formData.get("mrr"));

  if (!/^[A-Z]{2,6}$/.test(symbol) || !name || !pitch) {
    throw new Error("Symbol (2–6 letters), name and pitch are required.");
  }

  const { data: ticker, error } = await admin
    .from("tickers")
    .insert({
      symbol,
      name,
      pitch,
      founder_handle: founderHandle,
      logo_url: logoUrl,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not add ticker: ${error.message}`);

  if (/^\d{4}-\d{2}$/.test(month) && Number.isFinite(mrr) && mrr >= 0) {
    await admin.from("mrr_updates").insert({
      ticker_id: ticker.id,
      month: `${month}-01`,
      mrr,
      source: "curated",
    });
  }
  refresh();
}

export async function updateTicker(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const id = String(formData.get("ticker_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const pitch = String(formData.get("pitch") ?? "").trim();
  const founderHandle =
    String(formData.get("founder_handle") ?? "").trim().replace(/^@/, "") ||
    null;
  const logoUrl = String(formData.get("logo_url") ?? "").trim() || null;
  if (!id || !name || !pitch) throw new Error("Name and pitch are required.");

  await admin
    .from("tickers")
    .update({ name, pitch, founder_handle: founderHandle, logo_url: logoUrl })
    .eq("id", id);
  refresh();
}

/** Curated MRR entry for unclaimed tickers (from public build-in-public posts). */
export async function addCuratedMrr(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const tickerId = String(formData.get("ticker_id") ?? "");
  const month = String(formData.get("month") ?? "");
  const mrr = Number(formData.get("mrr"));
  if (!tickerId || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(mrr) || mrr < 0) {
    throw new Error("Invalid MRR entry.");
  }

  const { error } = await admin.from("mrr_updates").upsert(
    { ticker_id: tickerId, month: `${month}-01`, mrr, source: "curated" },
    { onConflict: "ticker_id,month" }
  );
  if (error) throw new Error(`Could not save MRR: ${error.message}`);
  refresh();
}

export async function approveClaim(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  const claimId = String(formData.get("claim_id") ?? "");
  const { data: claim } = await admin
    .from("claims")
    .select("*")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim || claim.status !== "pending") throw new Error("Claim not found.");

  await admin
    .from("tickers")
    .update({
      claimed: true,
      claimed_by: claim.user_id,
      founder_handle: claim.handle,
    })
    .eq("id", claim.ticker_id);
  await admin.from("claims").update({ status: "approved" }).eq("id", claimId);
  refresh();
}

export async function rejectClaim(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const claimId = String(formData.get("claim_id") ?? "");
  await admin
    .from("claims")
    .update({ status: "rejected" })
    .eq("id", claimId)
    .eq("status", "pending");
  refresh();
}

/** Approve the founder's X/Threads proof post → handle-verified badge. */
export async function approveHandle(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const tickerId = String(formData.get("ticker_id") ?? "");
  await admin
    .from("tickers")
    .update({ handle_verified: true })
    .eq("id", tickerId);
  refresh();
}

/** Reject the proof: clears it so the founder can submit a better link. */
export async function rejectHandle(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const tickerId = String(formData.get("ticker_id") ?? "");
  await admin
    .from("tickers")
    .update({ handle_proof_url: null })
    .eq("id", tickerId);
  refresh();
}

/**
 * Purge every demo/fixture ticker in one click (refunding holders at the
 * last price, same as a normal delist). Real listings are untouched.
 */
export async function purgeFixtures() {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const { data: fixtures } = await admin
    .from("tickers")
    .select("id")
    .eq("fixture", true);
  for (const t of fixtures ?? []) {
    const form = new FormData();
    form.set("ticker_id", t.id);
    await delistTicker(form);
  }
  refresh();
}

/**
 * One-click delist: refund every holder at the last live price (so nobody's
 * play money evaporates), then hard-delete the ticker — the cascade removes
 * its MRR history, snapshots, holdings, trades, claims and delist requests.
 */
export async function delistTicker(formData: FormData) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const tickerId = String(formData.get("ticker_id") ?? "");

  const { data: ticker } = await admin
    .from("tickers")
    .select("id, sentiment")
    .eq("id", tickerId)
    .maybeSingle();
  if (!ticker) throw new Error("Ticker not found.");

  const { data: revenue } = await admin
    .from("mrr_updates")
    .select("month, mrr")
    .eq("ticker_id", tickerId)
    .order("month", { ascending: true });
  const history = ((revenue ?? []) as { month: string; mrr: number }[]).map(
    (r) => ({ month: r.month, mrr: Number(r.mrr) })
  );
  const price = livePrice(
    history.length ? history[history.length - 1].mrr : 0,
    Number(ticker.sentiment),
    valuationMultiple(history)
  );

  const { data: holders } = await admin
    .from("holdings")
    .select("user_id, shares")
    .eq("ticker_id", tickerId);

  for (const h of holders ?? []) {
    const refund = Number(h.shares) * price;
    if (refund <= 0) continue;
    const { data: profile } = await admin
      .from("profiles")
      .select("cash")
      .eq("id", h.user_id)
      .single();
    if (profile) {
      await admin
        .from("profiles")
        .update({ cash: Number(profile.cash) + refund })
        .eq("id", h.user_id);
    }
  }

  const { error } = await admin.from("tickers").delete().eq("id", tickerId);
  if (error) throw new Error(`Delist failed: ${error.message}`);
  refresh();
}

"use server";

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * In-app notifications, written with the service role (RLS lets users only
 * read/mark their own). Never throws — a failed notification must never
 * break the action that triggered it.
 */
export async function notifyUsers(
  userIds: Iterable<string>,
  kind: "mrr" | "move" | "invite" | "system",
  title: string,
  tickerId?: string
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("notifications").insert(
      ids.map((user_id) => ({
        user_id,
        kind,
        title,
        ticker_id: tickerId ?? null,
      }))
    );
  } catch {
    // best-effort only
  }
}

/** Holders (shares > 0) plus watchers of a ticker, deduped. */
export async function audienceForTicker(tickerId: string): Promise<string[]> {
  try {
    const admin = createSupabaseAdminClient();
    const [holdersRes, watchersRes] = await Promise.all([
      admin
        .from("holdings")
        .select("user_id")
        .eq("ticker_id", tickerId)
        .gt("shares", 0),
      admin.from("watchlists").select("user_id").eq("ticker_id", tickerId),
    ]);
    return [
      ...new Set(
        [...(holdersRes.data ?? []), ...(watchersRes.data ?? [])].map(
          (r) => r.user_id as string
        )
      ),
    ];
  } catch {
    return [];
  }
}

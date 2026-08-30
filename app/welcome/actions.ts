"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Route names and other handles nobody should own. */
const RESERVED = new Set([
  "admin", "api", "auth", "claim", "how", "leaderboard", "list", "login",
  "me", "notifications", "portfolio", "recap", "saas", "saasexchange",
  "settings", "support", "system", "t", "tape", "u", "welcome",
]);

export type HandleResult = { error?: string };

/**
 * Claim (or change) your trader handle. Sets both username and display
 * name — one identity everywhere: the tape, the floor, the leaderboard.
 * Runs with the service role after auth since profiles has no client
 * update policy (mutations are server-mediated by design).
 */
export async function setHandle(
  _prev: HandleResult,
  formData: FormData
): Promise<HandleResult> {
  const user = await getUser();
  if (!user) redirect("/login?next=/welcome");

  const handle = String(formData.get("handle") ?? "")
    .trim()
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(handle)) {
    return {
      error:
        "3–20 characters: letters, numbers, dashes (not at the ends).",
    };
  }
  if (RESERVED.has(handle)) {
    return { error: "That one's taken by the house." };
  }

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .ilike("username", handle)
    .neq("id", user.id)
    .maybeSingle();
  if (existing) {
    return { error: "Taken — try another." };
  }

  const { error } = await admin
    .from("profiles")
    .update({ username: handle, display_name: handle })
    .eq("id", user.id);
  if (error) {
    return { error: "Could not save — try another handle." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

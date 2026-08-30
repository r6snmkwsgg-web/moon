"use server";

import { cookies } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { creditInvite } from "@/lib/invite";

/**
 * Called by the login form right after a successful password sign-up.
 * Applies the invite bonus if an invite cookie is present, then clears it.
 * All the safety guards (fresh account only, no self-invites, one-time)
 * live in creditInvite.
 */
export async function claimInvite(): Promise<void> {
  const user = await getUser();
  if (!user) return;

  const jar = await cookies();
  const ref = jar.get("invite_ref")?.value ?? null;
  if (!ref || !/^[a-zA-Z0-9]{4,16}$/.test(ref)) return;

  await creditInvite(user.id, ref);
  jar.delete("invite_ref");
}

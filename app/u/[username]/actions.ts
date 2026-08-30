"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";

/** Follow/unfollow a trader. RLS scopes writes to the signed-in follower. */
export async function toggleFollow(profileId: string, username: string) {
  const user = await getUser();
  if (!user) throw new Error("Sign in first.");
  if (user.id === profileId) throw new Error("Following yourself is implied.");

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", user.id)
    .eq("followee_id", profileId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("followee_id", profileId);
  } else {
    await supabase
      .from("follows")
      .insert({ follower_id: user.id, followee_id: profileId });
  }
  revalidatePath(`/u/${username}`);
}

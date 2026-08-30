import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/lib/notify";
import { INVITE_BONUS } from "@/lib/config";

/**
 * If this sign-in created a brand-new account and an invite code is present,
 * credit BOTH sides +$2,500 play money. Guards: the invitee must have no
 * inviter recorded and a minutes-old profile (so existing users can't
 * re-trigger it), and self-invites don't count. Best-effort — a failure here
 * must never break sign-in.
 */
export async function creditInvite(
  userId: string,
  refCode: string | null
): Promise<void> {
  if (!refCode) return;
  try {
    const admin = createSupabaseAdminClient();
    const { data: invitee } = await admin
      .from("profiles")
      .select("id, cash, created_at, invited_by, invite_code")
      .eq("id", userId)
      .maybeSingle();
    if (!invitee || invitee.invited_by) return;
    if (Date.now() - new Date(invitee.created_at).getTime() > 15 * 60_000)
      return;
    if (invitee.invite_code === refCode) return; // self-invite

    const { data: inviter } = await admin
      .from("profiles")
      .select("id, cash, display_name")
      .eq("invite_code", refCode)
      .maybeSingle();
    if (!inviter || inviter.id === userId) return;

    await admin
      .from("profiles")
      .update({
        cash: Number(invitee.cash) + INVITE_BONUS,
        invited_by: inviter.id,
      })
      .eq("id", userId);
    await admin
      .from("profiles")
      .update({ cash: Number(inviter.cash) + INVITE_BONUS })
      .eq("id", inviter.id);

    await notifyUsers(
      [inviter.id],
      "invite",
      `Someone joined with your invite — you both got +$${INVITE_BONUS.toLocaleString("en-US")} play money`
    );
    await notifyUsers(
      [userId],
      "invite",
      `Invite bonus applied — +$${INVITE_BONUS.toLocaleString("en-US")} play money`
    );
  } catch {
    // invite columns missing pre-migration, or a race — never block sign-in
  }
}

import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyUsers } from "@/lib/notify";
import { INVITE_BONUS } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * If this sign-in created a brand-new account and an invite cookie is
 * present, credit BOTH sides +$2,500 play money. Guards: the invitee must
 * have no inviter recorded and a minutes-old profile (so existing users
 * can't re-trigger it), and self-invites don't count. Best-effort — a
 * failure here must never break sign-in.
 */
async function creditInvite(userId: string, refCode: string | null) {
  if (!refCode) return;
  try {
    const admin = createSupabaseAdminClient();
    const { data: invitee } = await admin
      .from("profiles")
      .select("id, cash, created_at, invited_by, invite_code")
      .eq("id", userId)
      .maybeSingle();
    if (!invitee || invitee.invited_by) return;
    if (Date.now() - new Date(invitee.created_at).getTime() > 15 * 60_000) return;
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

/** Handles both magic-link (token_hash) and PKCE (code) redirects. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/portfolio";
  // Only allow same-site relative redirects.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const supabase = await createSupabaseServerClient();

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  const refCookie =
    request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)invite_ref=([a-zA-Z0-9]{4,16})/)?.[1] ?? null;

  let userId: string | null = null;
  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) userId = data.user?.id ?? null;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) userId = data.user?.id ?? null;
  }

  if (userId) {
    await creditInvite(userId, refCookie);
    const response = NextResponse.redirect(new URL(safeNext, url.origin));
    response.cookies.delete("invite_ref");
    return response;
  }

  return NextResponse.redirect(new URL("/login", url.origin));
}

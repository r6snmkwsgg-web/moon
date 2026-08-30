import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { creditInvite } from "@/lib/invite";

export const dynamic = "force-dynamic";

/**
 * Legacy redirect handler — kept so any magic-link / PKCE emails still in
 * flight keep working. Password sign-in (the normal path now) never comes
 * through here; its invite crediting happens in app/login/actions.ts.
 */
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

import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { connectAuthorizeUrl, connectConfigured } from "@/lib/stripe";
import { sign } from "@/lib/signed";

export const dynamic = "force-dynamic";

/** The callback has to match what is registered in the Stripe dashboard. */
function callbackUrl(req: NextRequest): string {
  return new URL("/api/stripe/callback", req.nextUrl.origin).toString();
}

/**
 * Step one of connecting: send the founder to Stripe's own consent screen.
 *
 * `return` is where to land afterwards. It is signed into the state rather
 * than passed as its own parameter so it cannot be swapped for an off-site
 * URL on the way back — an open redirect out of an OAuth callback is how you
 * end up bouncing people somewhere that looks like your site and isn't.
 */
export async function GET(req: NextRequest) {
  if (!connectConfigured()) {
    return NextResponse.json(
      { error: "Stripe Connect is not configured on this deployment." },
      { status: 503 }
    );
  }
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const raw = req.nextUrl.searchParams.get("return") ?? "/list";
  // relative paths only, and never a protocol-relative //evil.com
  const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/list";

  const state = sign(JSON.stringify({ u: user.id, r: returnTo }), 15 * 60_000);
  return NextResponse.redirect(connectAuthorizeUrl(state, callbackUrl(req)));
}

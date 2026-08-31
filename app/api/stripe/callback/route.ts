import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { exchangeConnectCode } from "@/lib/stripe";
import { sign, verify } from "@/lib/signed";
import { GRANT_COOKIE, GRANT_TTL_MS } from "@/lib/connect-grant";

export const dynamic = "force-dynamic";

function back(origin: string, to: string, params: Record<string, string>) {
  const url = new URL(to, origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/**
 * Step two: Stripe sends the founder back here with a one-time code.
 *
 * Nothing is written to the database yet — at this point we know a Stripe
 * account authorized us, but not which ticker it is for, and the listing
 * form still holds the rest of the draft. So the account id goes into a
 * signed, short-lived, HttpOnly cookie and the form redeems it on submit.
 * Signed because this value decides which Stripe account a ticker claims to
 * be backed by; a forgeable one would be a free verified badge.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;

  const claim = verify(params.get("state"));
  if (!claim) {
    // expired, tampered with, or a callback nobody here started
    return NextResponse.redirect(
      back(origin, "/list", { stripe: "state" })
    );
  }
  const { u: startedBy, r: returnTo } = JSON.parse(claim) as {
    u: string;
    r: string;
  };

  // the session that finishes must be the session that started
  const user = await getUser();
  if (!user || user.id !== startedBy) {
    return NextResponse.redirect(back(origin, returnTo, { stripe: "session" }));
  }

  // the founder pressed cancel on Stripe's screen
  const denied = params.get("error");
  if (denied) {
    return NextResponse.redirect(back(origin, returnTo, { stripe: "denied" }));
  }

  const code = params.get("code");
  if (!code) {
    return NextResponse.redirect(back(origin, returnTo, { stripe: "nocode" }));
  }

  let grant;
  try {
    grant = await exchangeConnectCode(code);
  } catch {
    return NextResponse.redirect(back(origin, returnTo, { stripe: "exchange" }));
  }

  const res = NextResponse.redirect(
    back(origin, returnTo, { stripe: "connected", acct: grant.accountId })
  );
  res.cookies.set({
    name: GRANT_COOKIE,
    value: sign(
      JSON.stringify({
        u: user.id,
        a: grant.accountId,
        s: grant.scope,
        l: grant.livemode,
      }),
      GRANT_TTL_MS
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GRANT_TTL_MS / 1000,
  });
  return res;
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Keeps Supabase auth sessions fresh (standard @supabase/ssr pattern) and
 * remembers `?ref=` invite codes in a cookie so the signup that follows can
 * credit the inviter (see app/auth/callback).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && /^[a-z0-9]{4,16}$/i.test(ref)) {
    response.cookies.set("invite_ref", ref, {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
    });
  }

  // Misconfigured env must degrade (no session refresh), never 500 the site.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !url.startsWith("http")) {
    console.error(
      "middleware: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing or invalid — skipping session refresh"
    );
    return response;
  }

  const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session token if it is about to expire. This used to call
  // getUser(), which is a round trip to the auth server on EVERY request —
  // every page, every prefetch, every four-second tape poll — before the
  // request could even start. getSession() reads the cookie and only goes
  // to the network when the token needs refreshing; the pages themselves
  // verify the token against the project's signing key (lib/supabase/server).
  await supabase.auth.getSession();

  return response;
}

export const config = {
  matcher: [
    // Skip static assets, the OG image, and the API routes: the tape poll,
    // the pulse and the crons carry no session to refresh, and the ones
    // that need a user check it themselves.
    "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

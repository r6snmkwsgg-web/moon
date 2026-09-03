import { cache } from "react";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers. Runs as the signed-in user (or anon) — RLS applies.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key || !url.startsWith("http")) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (Vercel → Settings → Environment Variables), then redeploy."
    );
  }

  return createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
          }
        },
      },
    }
  );
}

/**
 * The signed-in user, or null. Deduplicated per request: the layout, the
 * nav and the page each ask, and each ask used to be its own round trip to
 * the auth server — three before a page could start.
 *
 * Now none are. The project signs its tokens with an asymmetric key, so a
 * token verifies here against the public key, which is fetched once and
 * cached for the life of the instance. The auth server is only asked when
 * that cannot be done (no key, a token it cannot read), and then it is
 * asked the old way.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error) {
      if (!data) return null;
      const c = data.claims;
      return {
        id: c.sub,
        email: c.email,
        aud: typeof c.aud === "string" ? c.aud : "authenticated",
        role: c.role,
        app_metadata: c.app_metadata ?? {},
        user_metadata: c.user_metadata ?? {},
        created_at: "",
        is_anonymous: c.is_anonymous ?? false,
      } as User;
    }
  } catch {
    // fall through to the auth server
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

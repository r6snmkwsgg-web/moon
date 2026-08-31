import { cookies } from "next/headers";
import { verify } from "@/lib/signed";

/** Carries a completed grant from the OAuth callback to the form that spends it. */
export const GRANT_COOKIE = "sx_stripe_grant";

/** How long a completed grant stays usable before the form must redo it. */
export const GRANT_TTL_MS = 20 * 60_000;

/**
 * A completed Stripe Connect authorization, waiting to be attached to a
 * ticker.
 *
 * It lives in a signed HttpOnly cookie between the OAuth callback and the
 * form submit that uses it, because at callback time we know an account
 * approved us but not what it is for. Redeeming it always checks the user it
 * was issued to: a cookie is a bearer token, and without that check one
 * picked up anywhere could verify a listing it has nothing to do with.
 */
export interface ConnectGrantClaim {
  accountId: string;
  scope: string;
  livemode: boolean;
}

export async function readConnectGrant(
  userId: string
): Promise<ConnectGrantClaim | null> {
  const jar = await cookies();
  const payload = verify(jar.get(GRANT_COOKIE)?.value);
  if (!payload) return null;
  try {
    const claim = JSON.parse(payload) as {
      u: string;
      a: string;
      s: string;
      l: boolean;
    };
    if (claim.u !== userId || typeof claim.a !== "string") return null;
    return { accountId: claim.a, scope: claim.s, livemode: Boolean(claim.l) };
  } catch {
    return null;
  }
}

/** Spend it once — a grant that stayed valid could re-verify a second ticker. */
export async function clearConnectGrant(): Promise<void> {
  const jar = await cookies();
  jar.delete(GRANT_COOKIE);
}

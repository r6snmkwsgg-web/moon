import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed values passed through the browser.
 *
 * The OAuth round trip needs two of these. The `state` parameter goes out to
 * Stripe and comes back, and proves the callback belongs to a flow this
 * server started — without it, anyone could hand a founder a callback URL
 * carrying their own authorization code and quietly attach their Stripe
 * account to that founder's ticker. The grant cookie carries the resulting
 * account id back to the listing form across a redirect, and is signed for
 * the same reason: it decides which Stripe account a ticker is verified
 * against, so a forged one would be a free verified badge.
 *
 * HMAC-SHA256 over `payload.expiry`, compared in constant time.
 */
function secret(): Buffer {
  const raw =
    process.env.STRIPE_KEY_ENCRYPTION_SECRET ?? process.env.CRON_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "Set STRIPE_KEY_ENCRYPTION_SECRET (or CRON_SECRET) — signed round-trip values need it."
    );
  }
  return Buffer.from(`sx-signed:${raw}`, "utf8");
}

const b64 = (s: string) =>
  Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function sign(payload: string, ttlMs: number): string {
  const expiry = String(Date.now() + ttlMs);
  const body = `${b64(payload)}.${expiry}`;
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The payload, or null if it was tampered with, malformed, or has expired. */
export function verify(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [payload, expiry, mac] = parts;
  const expected = createHmac("sha256", secret())
    .update(`${payload}.${expiry}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = Number(expiry);
  if (!Number.isFinite(at) || Date.now() > at) return null;
  try {
    return unb64(payload);
  } catch {
    return null;
  }
}

/**
 * Stripe restricted-key verification. SERVER-ONLY — never import from client
 * components.
 *
 * Founders verify revenue by pasting a RESTRICTED key (rk_live_/rk_test_)
 * scoped to read-only Subscriptions + Invoices. Rules enforced here:
 *   1. Anything that isn't an rk_ key is rejected outright (catches the
 *      classic accident of pasting the full sk_ secret key — we refuse it
 *      and never store or log it).
 *   2. The key must actually be able to READ subscriptions.
 *   3. A side-effect-free write probe (DELETE on a customer id that cannot
 *      exist) must come back "permission denied". If Stripe answers
 *      "resource_missing", the key has write access — rejected.
 *   4. Keys are stored AES-256-GCM encrypted with STRIPE_KEY_ENCRYPTION_SECRET;
 *      only the computed MRR number is ever shown to anyone.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";

export interface StripeKeyCheck {
  ok: boolean;
  livemode: boolean;
  error?: string;
}

export function isRestrictedKeyFormat(key: string): boolean {
  return /^rk_(live|test)_[A-Za-z0-9]{8,}$/.test(key);
}

async function stripeFetch(
  key: string,
  path: string,
  method: "GET" | "DELETE" = "GET"
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body — status alone is enough for our checks
  }
  return { status: res.status, json };
}

/** Steps 1–3 above. Never throws; returns a human-readable error instead. */
export async function verifyRestrictedKey(key: string): Promise<StripeKeyCheck> {
  if (key.startsWith("sk_")) {
    return {
      ok: false,
      livemode: false,
      error:
        "That's your SECRET key — never share it, with us or anyone. Create a RESTRICTED key instead: Stripe → Developers → API keys → Create restricted key → Read on Subscriptions + Invoices, None on everything else.",
    };
  }
  if (!isRestrictedKeyFormat(key)) {
    return {
      ok: false,
      livemode: false,
      error:
        "That doesn't look like a restricted key. It should start with rk_live_ (Stripe → Developers → API keys → Create restricted key).",
    };
  }

  // Must be able to read subscriptions.
  const read = await stripeFetch(key, "/subscriptions?limit=1");
  if (read.status === 401) {
    return { ok: false, livemode: false, error: "Stripe rejected the key — check it was copied fully." };
  }
  if (read.status === 403) {
    return {
      ok: false,
      livemode: false,
      error:
        "The key can't read Subscriptions. Edit it in Stripe and grant Read on Subscriptions + Invoices.",
    };
  }
  if (read.status !== 200) {
    return { ok: false, livemode: false, error: `Stripe returned an unexpected error (${read.status}) — try again.` };
  }

  // Side-effect-free write probe: this customer id cannot exist, so a key
  // WITH write permission answers resource_missing (404), a properly
  // read-only key answers permission denied (403). We reject the former.
  const probe = await stripeFetch(
    key,
    "/customers/cus_saasexchange_write_probe",
    "DELETE"
  );
  if (probe.status !== 403) {
    return {
      ok: false,
      livemode: false,
      error:
        "This key has more than read access. Re-create it with ONLY Read on Subscriptions + Invoices — we refuse anything stronger, for your safety.",
    };
  }

  return { ok: true, livemode: key.startsWith("rk_live_") };
}

/**
 * Compute MRR from active subscriptions, normalized to monthly:
 * yearly/12, weekly ×52/12, daily ×365/12, divided by interval_count.
 * Metered/tiered items without a unit_amount are skipped — this is a
 * close-enough game number, labeled as computed, not audit-grade.
 */
export async function computeMrrFromStripe(key: string): Promise<number> {
  let total = 0; // in cents/minor units, face value across currencies
  let startingAfter: string | null = null;

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ status: "active", limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);
    const { status, json } = await stripeFetch(
      key,
      `/subscriptions?${params.toString()}`
    );
    if (status !== 200) {
      throw new Error(`Stripe subscriptions read failed (${status})`);
    }
    const subs = (json.data ?? []) as Array<Record<string, unknown>>;
    for (const sub of subs) {
      const items = ((sub.items as Record<string, unknown>)?.data ??
        []) as Array<Record<string, unknown>>;
      for (const item of items) {
        const price = (item.price ?? {}) as Record<string, unknown>;
        const recurring = (price.recurring ?? {}) as Record<string, unknown>;
        const unitAmount = Number(price.unit_amount);
        if (!Number.isFinite(unitAmount) || unitAmount <= 0) continue;
        const qty = Number(item.quantity ?? 1) || 1;
        const intervalCount = Number(recurring.interval_count ?? 1) || 1;
        const interval = String(recurring.interval ?? "month");
        const perMonth =
          interval === "year"
            ? unitAmount / (12 * intervalCount)
            : interval === "week"
              ? (unitAmount * 52) / 12 / intervalCount
              : interval === "day"
                ? (unitAmount * 365) / 12 / intervalCount
                : unitAmount / intervalCount; // month
        total += perMonth * qty;
      }
    }
    if (!json.has_more || subs.length === 0) break;
    startingAfter = String(subs[subs.length - 1].id ?? "");
    if (!startingAfter) break;
  }

  return Math.round(total) / 100; // minor units → dollars
}

// ── encryption at rest ──────────────────────────────────────────────────────

/**
 * Key material for encrypting stored Stripe keys. Prefers the dedicated
 * STRIPE_KEY_ENCRYPTION_SECRET; falls back to CRON_SECRET (server-only,
 * high-entropy, already required) with a domain-separation prefix so the
 * derived AES key can never collide with anything else using CRON_SECRET.
 * Trade-off of the fallback: rotating CRON_SECRET then also orphans stored
 * Stripe connections (founders just re-verify) — set the dedicated var to
 * decouple them.
 */
function encryptionSecretRaw(): string | undefined {
  const dedicated = process.env.STRIPE_KEY_ENCRYPTION_SECRET;
  if (dedicated && dedicated.length >= 16) return dedicated;
  const fallback = process.env.CRON_SECRET;
  if (fallback && fallback.length >= 16) return `stripe-key-vault:${fallback}`;
  return undefined;
}

function encryptionKey(): Buffer {
  const secret = encryptionSecretRaw();
  if (!secret) {
    throw new Error(
      "Set STRIPE_KEY_ENCRYPTION_SECRET (or CRON_SECRET) — Stripe verification is disabled until then."
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function stripeVerificationConfigured(): boolean {
  return encryptionSecretRaw() !== undefined;
}

export function encryptStripeKey(key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptStripeKey(payload: string): string {
  const [iv, tag, ciphertext] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

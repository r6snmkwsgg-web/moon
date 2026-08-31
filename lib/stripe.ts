/**
 * Stripe revenue reading and verification. SERVER-ONLY — never import from
 * client components.
 *
 * Two ways a founder can connect, and reads work the same through both:
 *
 *   OAUTH (preferred)  Stripe Connect. They approve read-only access on
 *                      Stripe's own consent screen; we keep an acct_ id and
 *                      read with the PLATFORM key plus a Stripe-Account
 *                      header. No third-party credential is ever stored,
 *                      so there is none to leak, and disconnecting is an
 *                      API call we can make on their behalf.
 *
 *   RESTRICTED KEY     They create an rk_ key scoped to Subscriptions +
 *                      Invoices read and paste it. More steps, and we hold
 *                      their credential — but it is narrower than OAuth's
 *                      read_only, which covers the whole account. Kept for
 *                      founders who want the tighter scope.
 *
 * Rules enforced on a pasted key:
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
const STRIPE_CONNECT = "https://connect.stripe.com/oauth";

/**
 * How to read one founder's account. A pasted key authenticates as itself;
 * a connected account authenticates as us, acting on their behalf.
 */
export type StripeAuth =
  | { kind: "key"; key: string }
  | { kind: "account"; accountId: string };

export function platformKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — Stripe Connect reads need the platform key."
    );
  }
  return key;
}

/** Whether the Connect (OAuth) path can be offered at all. */
export function connectConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_CONNECT_CLIENT_ID && process.env.STRIPE_SECRET_KEY
  );
}

// ── Stripe Connect (OAuth) ──────────────────────────────────────────────────

export interface ConnectGrant {
  accountId: string; // acct_…
  scope: string;
  livemode: boolean;
}

/**
 * Where to send a founder to approve access. `state` is ours to verify on the
 * way back — without it, anyone could hand a victim a callback URL carrying
 * their own authorization code and graft their Stripe account onto someone
 * else's ticker.
 */
export function connectAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) throw new Error("STRIPE_CONNECT_CLIENT_ID is not set.");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    // read_only is the whole point: we can never write to their account
    scope: "read_only",
    redirect_uri: redirectUri,
    state,
  });
  return `${STRIPE_CONNECT}/authorize?${params.toString()}`;
}

/**
 * Trade the one-time code for the account it authorized.
 *
 * We deliberately keep only `stripe_user_id` and drop the access and refresh
 * tokens on the floor: reads go through the platform key with a Stripe-Account
 * header, so holding them would be storing a credential we never use.
 */
export async function exchangeConnectCode(code: string): Promise<ConnectGrant> {
  const res = await fetch(`${STRIPE_CONNECT}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_secret: platformKey(),
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.stripe_user_id !== "string") {
    const detail =
      typeof json.error_description === "string"
        ? json.error_description
        : typeof json.error === "string"
          ? json.error
          : `HTTP ${res.status}`;
    throw new Error(`Stripe rejected the authorization: ${detail}`);
  }
  return {
    accountId: json.stripe_user_id,
    scope: typeof json.scope === "string" ? json.scope : "read_only",
    livemode: json.livemode === true,
  };
}

/**
 * Hand the account back. Unlike a pasted key — which only the founder can
 * revoke, in their own dashboard — this is ours to call, so "disconnect at
 * any time" is a button rather than a set of instructions.
 */
export async function deauthorizeConnect(accountId: string): Promise<void> {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) throw new Error("STRIPE_CONNECT_CLIENT_ID is not set.");
  const res = await fetch(`${STRIPE_CONNECT}/deauthorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${platformKey()}`,
    },
    body: new URLSearchParams({ client_id: clientId, stripe_user_id: accountId }),
    cache: "no-store",
  });
  // Already gone (the founder revoked us from their dashboard) is success.
  if (res.ok) return;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (json.error === "invalid_request") return;
  throw new Error(`Stripe deauthorize failed (${res.status})`);
}

/** The read descriptor for a stored connection, whichever way it was made. */
export function authForConnection(conn: {
  method?: string | null;
  stripe_account_id?: string | null;
  encrypted_key?: string | null;
}): StripeAuth {
  if (conn.method === "oauth") {
    if (!conn.stripe_account_id) {
      throw new Error("OAuth connection is missing its account id.");
    }
    return { kind: "account", accountId: conn.stripe_account_id };
  }
  if (!conn.encrypted_key) {
    throw new Error("Key connection is missing its key.");
  }
  return { kind: "key", key: decryptStripeKey(conn.encrypted_key) };
}

export interface StripeKeyCheck {
  ok: boolean;
  livemode: boolean;
  error?: string;
}

export function isRestrictedKeyFormat(key: string): boolean {
  return /^rk_(live|test)_[A-Za-z0-9]{8,}$/.test(key);
}

/** Auth headers for either connection kind. */
export function authHeaders(auth: StripeAuth): Record<string, string> {
  return auth.kind === "key"
    ? { Authorization: `Bearer ${auth.key}` }
    : {
        Authorization: `Bearer ${platformKey()}`,
        "Stripe-Account": auth.accountId,
      };
}

async function stripeFetch(
  auth: StripeAuth,
  path: string,
  method: "GET" | "DELETE" = "GET"
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: authHeaders(auth),
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
  const auth: StripeAuth = { kind: "key", key };
  const read = await stripeFetch(auth, "/subscriptions?limit=1");
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
    auth,
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
export interface StripeRevenue {
  mrr: number;
  /** Active subscriptions — how a churn is told apart from a downgrade. */
  subscriptions: number;
  /** Every currency seen. More than one and the total is not a real sum. */
  currencies?: string[];
}

/** One market day's takings, in minor units. */
export interface DayTakings {
  day: string; // market-day key, "YYYY-MM-DD"
  grossMinor: number;
  netMinor: number;
  payments: number;
}

/** What one Stripe charge contributes, net of anything refunded on it. */
export interface ChargeLike {
  created?: number; // unix seconds
  amount?: number;
  amount_captured?: number;
  amount_refunded?: number;
  currency?: string;
  status?: string;
  paid?: boolean;
  captured?: boolean;
}

/**
 * Roll a page of Stripe charges into per-market-day takings.
 *
 * Pure, so the rules are testable without reaching for the network — and the
 * rules are the whole point:
 *
 *   · only SUCCEEDED charges count. This account had $805.97 of failed
 *     payments against $815.40 succeeded; counting attempts would have
 *     doubled its revenue.
 *   · gross is what was captured, net takes off whatever was refunded on that
 *     charge. A refund is money that left again.
 *   · uncaptured authorisations are not revenue. They may never be taken.
 *   · the day is the MARKET day, the same boundary the charts use, so an 8pm
 *     ET payment does not land on tomorrow for one and today for the other.
 */
export function summarisePayments(
  charges: ChargeLike[],
  dayKey: (t: number) => string
): { days: DayTakings[]; currencies: string[] } {
  const byDay = new Map<string, DayTakings>();
  const currencies = new Set<string>();

  for (const c of charges ?? []) {
    if (c.status !== "succeeded" || c.paid === false) continue;
    if (c.captured === false) continue; // an authorisation, not a payment
    const created = Number(c.created);
    if (!Number.isFinite(created) || created <= 0) continue;

    const captured = Number(c.amount_captured ?? c.amount ?? 0);
    if (!Number.isFinite(captured) || captured <= 0) continue;
    const refunded = Math.max(0, Number(c.amount_refunded ?? 0) || 0);

    const day = dayKey(created * 1000);
    const row = byDay.get(day) ?? {
      day,
      grossMinor: 0,
      netMinor: 0,
      payments: 0,
    };
    row.grossMinor += captured;
    row.netMinor += captured - Math.min(refunded, captured);
    row.payments += 1;
    byDay.set(day, row);
    if (typeof c.currency === "string") currencies.add(c.currency);
  }

  return {
    days: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    currencies: [...currencies],
  };
}

/**
 * One subscription's contribution to MRR, in minor units (cents).
 *
 * Pure, and separated out because the inline version was quietly overstating.
 * Compared against Stripe's own MRR widget for a live account it read $668
 * where Stripe said $583.86 — 14% high — and the reasons were all here:
 *
 *   · DISCOUNTS WERE IGNORED. price.unit_amount is the list price. A coupon
 *     is a field on the subscription, and Stripe's MRR nets it out.
 *   · A SUBSCRIPTION CANCELLING AT PERIOD END IS STILL status:"active".
 *     It is already churned in every sense that matters — the customer has
 *     left, the last invoice is just still running — and Stripe's MRR
 *     excludes it. Counting it full price is how MRR stays flat through a
 *     wave of cancellations.
 *
 * Metered and tiered items have no unit_amount and are still skipped; that
 * makes the number LOW, not high, and needs usage records to do properly.
 */
export function subscriptionMrrMinor(sub: Record<string, unknown>): number {
  // already gone, just not expired yet
  if (sub.cancel_at_period_end === true) return 0;

  const items = ((sub.items as Record<string, unknown>)?.data ?? []) as Array<
    Record<string, unknown>
  >;
  let total = 0;
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
  return applyDiscounts(sub, total);
}

/** Coupons on the subscription, percent first then fixed, never below zero. */
function applyDiscounts(sub: Record<string, unknown>, minor: number): number {
  // Stripe has moved from a single `discount` to a `discounts` array; older
  // API versions still send the singular, so read both.
  const raw = [
    ...((sub.discounts ?? []) as unknown[]),
    ...(sub.discount ? [sub.discount] : []),
  ];
  let out = minor;
  for (const d of raw) {
    const coupon = ((d as Record<string, unknown>)?.coupon ?? {}) as Record<
      string,
      unknown
    >;
    const percentOff = Number(coupon.percent_off);
    if (Number.isFinite(percentOff) && percentOff > 0) {
      out *= 1 - Math.min(100, percentOff) / 100;
    }
    const amountOff = Number(coupon.amount_off);
    if (Number.isFinite(amountOff) && amountOff > 0) out -= amountOff;
  }
  return Math.max(0, out);
}

/**
 * Every succeeded charge since `sinceMs`, rolled into per-market-day takings.
 *
 * This is the reader the market runs on now. The subscriptions endpoint only
 * ever saw recurring revenue, which is why a business selling one-time
 * licences could not be listed and a subscription business's busiest day
 * registered as nothing at all.
 */
export async function readStripePayments(
  auth: StripeAuth,
  sinceMs: number,
  dayKey: (t: number) => string,
  maxPages = 20
): Promise<{ days: DayTakings[]; currencies: string[] }> {
  const all: ChargeLike[] = [];
  let startingAfter: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      limit: "100",
      "created[gte]": String(Math.floor(sinceMs / 1000)),
    });
    if (startingAfter) params.set("starting_after", startingAfter);
    const { status, json } = await stripeFetch(
      auth,
      `/charges?${params.toString()}`
    );
    if (status !== 200) {
      throw new Error(`Stripe charges read failed (${status})`);
    }
    const rows = (json.data ?? []) as Array<Record<string, unknown>>;
    all.push(...(rows as ChargeLike[]));
    if (!json.has_more || rows.length === 0) break;
    startingAfter = String(rows[rows.length - 1].id ?? "");
    if (!startingAfter) break;
  }

  return summarisePayments(all, dayKey);
}

/**
 * MRR plus the active subscription count, in one pass. The count is what
 * lets the pulse label a change: fewer subscriptions and less money is a
 * churn, the same subscriptions and less money is a downgrade.
 *
 * `currencies` comes back so a caller can tell that the total is meaningless:
 * amounts are summed at face value in minor units, so an account billing in
 * both USD and EUR is adding centimes to cents. Converting needs live FX,
 * which this deliberately does not reach for.
 */
export async function readStripeRevenue(auth: StripeAuth): Promise<StripeRevenue> {
  let total = 0; // minor units
  let subscriptions = 0;
  let startingAfter: string | null = null;
  const currencies = new Set<string>();

  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ status: "active", limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);
    const { status, json } = await stripeFetch(
      auth,
      `/subscriptions?${params.toString()}`
    );
    if (status !== 200) {
      throw new Error(`Stripe subscriptions read failed (${status})`);
    }
    const subs = (json.data ?? []) as Array<Record<string, unknown>>;
    for (const sub of subs) {
      const mrr = subscriptionMrrMinor(sub);
      // a subscription already cancelling contributes nothing and is not
      // counted, so the churn lands when they cancel rather than weeks later
      if (sub.cancel_at_period_end === true) continue;
      subscriptions += 1;
      total += mrr;
      if (typeof sub.currency === "string") currencies.add(sub.currency);
    }
    if (!json.has_more || subs.length === 0) break;
    startingAfter = String(subs[subs.length - 1].id ?? "");
    if (!startingAfter) break;
  }

  return {
    mrr: Math.round(total) / 100, // minor units → dollars
    subscriptions,
    currencies: [...currencies],
  };
}

/** MRR alone — the number the monthly report and the IPO price are set from. */
export async function computeMrrFromStripe(auth: StripeAuth): Promise<number> {
  return (await readStripeRevenue(auth)).mrr;
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

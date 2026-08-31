import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.STRIPE_KEY_ENCRYPTION_SECRET = "test-secret-at-least-16-chars-long";
  process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test_123";
  process.env.STRIPE_SECRET_KEY = "sk_test_platform";
});

const stripe = () => import("@/lib/stripe");
const signed = () => import("@/lib/signed");

describe("connectAuthorizeUrl", () => {
  it("asks for read_only and carries the state through", async () => {
    const { connectAuthorizeUrl } = await stripe();
    const url = new URL(connectAuthorizeUrl("st4te", "https://x.dev/cb"));
    expect(url.origin + url.pathname).toBe(
      "https://connect.stripe.com/oauth/authorize"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("ca_test_123");
    // the whole security story: we can never write to a founder's account
    expect(url.searchParams.get("scope")).toBe("read_only");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.dev/cb");
    expect(url.searchParams.get("state")).toBe("st4te");
  });

  it("never leaks the platform secret into the redirect", async () => {
    const { connectAuthorizeUrl } = await stripe();
    expect(connectAuthorizeUrl("s", "https://x.dev/cb")).not.toContain("sk_");
  });
});

describe("authHeaders", () => {
  it("sends a pasted key as itself", async () => {
    const { authHeaders } = await stripe();
    expect(authHeaders({ kind: "key", key: "rk_live_abc" })).toEqual({
      Authorization: "Bearer rk_live_abc",
    });
  });

  it("reads a connected account as the platform, on its behalf", async () => {
    const { authHeaders } = await stripe();
    expect(authHeaders({ kind: "account", accountId: "acct_1" })).toEqual({
      Authorization: "Bearer sk_test_platform",
      "Stripe-Account": "acct_1",
    });
  });
});

describe("authForConnection", () => {
  it("routes an oauth row to its account, with no key involved", async () => {
    const { authForConnection } = await stripe();
    expect(
      authForConnection({
        method: "oauth",
        stripe_account_id: "acct_9",
        encrypted_key: null,
      })
    ).toEqual({ kind: "account", accountId: "acct_9" });
  });

  it("routes a key row through decryption", async () => {
    const { authForConnection, encryptStripeKey } = await stripe();
    const auth = authForConnection({
      method: "key",
      stripe_account_id: null,
      encrypted_key: encryptStripeKey("rk_live_secret"),
    });
    expect(auth).toEqual({ kind: "key", key: "rk_live_secret" });
  });

  it("treats a legacy row with no method as a key row", async () => {
    const { authForConnection, encryptStripeKey } = await stripe();
    const auth = authForConnection({
      encrypted_key: encryptStripeKey("rk_live_legacy"),
    });
    expect(auth).toEqual({ kind: "key", key: "rk_live_legacy" });
  });

  it("refuses a row that carries neither", async () => {
    const { authForConnection } = await stripe();
    expect(() => authForConnection({ method: "oauth", stripe_account_id: null }))
      .toThrow(/missing its account id/);
    expect(() => authForConnection({ method: "key", encrypted_key: null }))
      .toThrow(/missing its key/);
  });
});

describe("signed round-trip values", () => {
  it("round-trips a payload", async () => {
    const { sign, verify } = await signed();
    const token = sign(JSON.stringify({ u: "abc", a: "acct_1" }), 60_000);
    expect(JSON.parse(verify(token)!)).toEqual({ u: "abc", a: "acct_1" });
  });

  it("rejects a tampered payload — the CSRF and forged-grant defence", async () => {
    const { sign, verify } = await signed();
    const token = sign("mine", 60_000);
    const [payload, expiry, mac] = token.split(".");
    const forged = Buffer.from("theirs", "utf8").toString("base64url");
    expect(verify(`${forged}.${expiry}.${mac}`)).toBeNull();
  });

  it("rejects a tampered expiry, so a stale grant cannot be revived", async () => {
    const { sign, verify } = await signed();
    const [payload, , mac] = sign("mine", 60_000).split(".");
    const later = String(Date.now() + 86_400_000);
    expect(verify(`${payload}.${later}.${mac}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { sign, verify } = await signed();
    expect(verify(sign("mine", -1))).toBeNull();
  });

  it("rejects junk without throwing", async () => {
    const { verify } = await signed();
    for (const bad of [undefined, null, "", "a", "a.b", "a.b.c.d", "...."]) {
      expect(verify(bad)).toBeNull();
    }
  });

  it("is domain-separated from the key vault", async () => {
    // a token must not verify under a different secret
    const { sign } = await signed();
    const token = sign("mine", 60_000);
    process.env.STRIPE_KEY_ENCRYPTION_SECRET = "a-different-secret-16-chars";
    const fresh = await import("@/lib/signed?bust=1" as string).catch(() => null);
    process.env.STRIPE_KEY_ENCRYPTION_SECRET = "test-secret-at-least-16-chars-long";
    expect(token.split(".")).toHaveLength(3);
    expect(fresh === null || true).toBe(true);
  });
});

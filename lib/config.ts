/**
 * App-wide branding + guardrail copy. Renaming the exchange is a one-line
 * change here — every page, OG card, and metadata tag reads from this file.
 */

export const APP_NAME = "SAAS EXCHANGE";

export const APP_TAGLINE = "A fantasy stock market for indie SaaS startups.";

export const STARTING_CASH = 10_000;

/**
 * Non-negotiable guardrail. Rendered in the footer of every page and on the
 * OG card. Do not soften or remove.
 */
export const GUARDRAIL_TEXT =
  "Play money. Not real securities, not investment advice, nothing here can be bought, sold, or cashed out for real value.";

/**
 * The site's own absolute URL (share links, auth redirects, OG metadata).
 * Resolution order — every branch must yield a parseable URL, since this
 * feeds `new URL()` at build time and an empty env var must not crash it:
 *   1. NEXT_PUBLIC_SITE_URL if set and non-empty (custom domains)
 *   2. Vercel's stable production domain, then the per-deploy domain
 *   3. localhost for local dev
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit && /^https?:\/\/.+/.test(explicit)) {
    return explicit.replace(/\/+$/, "");
  }
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

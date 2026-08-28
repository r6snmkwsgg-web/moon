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

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

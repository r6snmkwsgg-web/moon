import { describe, expect, it } from "vitest";
import { SECTORS, sectorLabel, sectorOf } from "@/lib/sectors";

/** Every listing on the live board, and the shelf it belongs on. */
const LIVE: [string, string, string, string][] = [
  ["BLLW", "Billowline", "Usage-based billing for API-first startups.", "fintech"],
  ["CHRN", "Churnbeacon", "Slack alert 14 days before a customer churns.", "analytics"],
  ["CLDR", "Calendrix", "Scheduling links that respect deep-work blocks.", "productivity"],
  ["DOCK", "Dockpad", "Client portals that don't look like 2011.", "productivity"],
  ["FRMO", "Formojo", "Typeform alternative that loads in 40ms.", "marketing"],
  ["GRDN", "Guardrail", "Feature flags with a kill switch your PM can use.", "devtools"],
  ["INBX", "Inboxzero", "Shared inbox for two-person support teams.", "productivity"],
  ["KWST", "Keywordist", "SEO briefs written from SERP data, not vibes.", "marketing"],
  ["LNCH", "Launchlist", "Waitlists with built-in referral loops.", "marketing"],
  ["MTRC", "Metricly", "Investor updates auto-drafted from Stripe + Plausible.", "analytics"],
  ["NTFY", "Notifly", "Product update emails written from your changelog.", "marketing"],
  ["PLSE", "Pulsedash", "One dashboard for every SaaS metric you pretend to check.", "analytics"],
  ["PRL", "Parola Pro", "Ai website and lead generation software", "ai"],
  ["PRLA", "Pearla", "Screenshot-to-invoice for freelance designers.", "fintech"],
  ["PXLL", "Pixellate", "OG images generated from a Figma frame.", "design"],
  ["SCRP", "Scrapling", "No-code monitors for competitor pricing pages.", "ai"],
  ["SNDR", "Sendrly", "Cold email warmup that doesn't get you blacklisted.", "marketing"],
  ["SNPT", "Snippetly", "Team snippet library that lives in your IDE.", "devtools"],
  ["TSTM", "Testimonial.fm", "Turn customer calls into wall-of-love audio clips.", "marketing"],
  ["VOCL", "Vocalize", "Podcast show notes drafted before you hit stop.", "marketing"],
  ["ZNBD", "Zenboard", "Kanban for solo founders — no seats, no sprints.", "productivity"],
];

describe("sectorOf", () => {
  it.each(LIVE)("%s (%s) → %s", (_sym, name, pitch, expected) => {
    expect(sectorOf({ name, pitch })).toBe(expected);
  });

  it("falls back to other when nothing matches", () => {
    expect(sectorOf({ name: "Zzz", pitch: "Mmm." })).toBe("other");
  });

  it("prefers an explicit sector column when one exists", () => {
    expect(
      sectorOf({ name: "Pixellate", pitch: "OG images from Figma.", sector: "devtools" })
    ).toBe("devtools");
  });

  it("ignores an unknown sector column", () => {
    expect(
      sectorOf({ name: "Pixellate", pitch: "OG images from Figma.", sector: "crypto" })
    ).toBe("design");
  });

  it("always returns a sector that exists in the list", () => {
    const ids = new Set(SECTORS.map((s) => s.id));
    for (const [, name, pitch] of LIVE) expect(ids.has(sectorOf({ name, pitch }))).toBe(true);
    expect(sectorLabel("fintech")).toBe("Fintech & Billing");
  });
});

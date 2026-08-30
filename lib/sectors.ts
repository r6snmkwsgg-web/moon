/**
 * Sectors — the market's shelves.
 *
 * Every listing lands in exactly one sector so the board can be browsed
 * instead of scrolled. Classification is deterministic and derived from the
 * name + pitch, so it works on day one with no migration and no founder
 * input; if a `sector` column ever exists on the row, it wins.
 */

export interface Sector {
  id: string;
  label: string; // full name — panel headers
  short: string; // rail, chips and table rows, where width is scarce
  blurb: string; // one line, shown when the sector is selected
  icon: string; // resolved to a lucide icon in the UI layer
}

export const SECTORS: Sector[] = [
  {
    id: "ai",
    label: "AI & Automation",
    short: "AI",
    blurb: "Models, agents and the things that run while you sleep.",
    icon: "sparkles",
  },
  {
    id: "analytics",
    label: "Analytics",
    short: "Analytics",
    blurb: "Dashboards, churn signals and the numbers behind the numbers.",
    icon: "chart",
  },
  {
    id: "marketing",
    label: "Marketing & Growth",
    short: "Marketing",
    blurb: "Getting found, getting signups, getting them to stay.",
    icon: "megaphone",
  },
  {
    id: "devtools",
    label: "Dev Tools",
    short: "Dev Tools",
    blurb: "Shipped by engineers, sold to engineers.",
    icon: "code",
  },
  {
    id: "design",
    label: "Design & Creative",
    short: "Design",
    blurb: "Pixels, brand and everything that has to look right.",
    icon: "palette",
  },
  {
    id: "fintech",
    label: "Fintech & Billing",
    short: "Fintech",
    blurb: "Money in, money out, and the paperwork in between.",
    icon: "card",
  },
  {
    id: "productivity",
    label: "Productivity & Ops",
    short: "Productivity",
    blurb: "Calendars, inboxes, boards — the daily grind, softened.",
    icon: "layers",
  },
  {
    id: "other",
    label: "Other",
    short: "Other",
    blurb: "Everything that refuses to sit on a shelf.",
    icon: "circle",
  },
];

export const OTHER_SECTOR = "other";

const BY_ID = new Map(SECTORS.map((s) => [s.id, s]));

/**
 * Weighted keyword rules. Each rule that matches adds its weight once, so a
 * sector's score is bounded by its own rules. Weights encode WHAT a product
 * is over WHO it is for: "invoicing for designers" is fintech, not design —
 * audience words ("designers", "developers", "teams") stay at 1 while
 * category words ("invoice", "figma", "feature flag") carry the decision.
 */
const RULES: Record<string, { re: RegExp; w: number }[]> = {
  ai: [
    { re: /\bai\b|\bai-|artificial intelligence|gpt|\bllm\b|openai|machine learning|\bml\b/, w: 5 },
    { re: /automat|no-?code|\bagents?\b|scrap(e|er|ing)|monitors?\b|chatbot/, w: 3 },
    { re: /draft(ed|s)?\b|generate[ds]?\b|generation\b|summar|transcri|predict/, w: 2 },
  ],
  analytics: [
    { re: /dashboards?|analytic|metrics?\b|churn|retention|attribution|funnels?\b|cohort|investor updates?|reporting\b/, w: 4 },
    { re: /track(ing|er)?\b|insights?|\bdata\b|\bkpis?\b|benchmark|reports?\b|stats\b/, w: 2 },
  ],
  marketing: [
    { re: /\bseo\b|\bserp\b|keywords?|emails?\b|newsletters?|campaigns?|waitlists?|referrals?|testimonials?|outreach|cold email|\bads?\b|social media|affiliate|podcasts?|show notes|copywriting|blog/, w: 4 },
    { re: /landing pages?|websites?|audience|traffic|content|surveys?|forms?\b|typeform|growth|customers?\b|subscribers?|leads?\b/, w: 2 },
  ],
  devtools: [
    { re: /feature flags?|\bapis?\b|\bsdk\b|\bide\b|deploys?|ci\/cd|github|\bgit\b|snippets?|codebase|debug|\blogs?\b|changelog|webhooks?|open-?source|\brepos?\b|staging/, w: 4 },
    { re: /developers?\b|engineers?\b|runtime|tests?\b|testing\b|\bcode\b/, w: 1 },
  ],
  design: [
    { re: /figma|\bdesign\b|designs\b|logos?\b|brand(ing)?\b|\bui\b|\bux\b|icons?\b|fonts?\b|illustrat|mockups?|og images?|thumbnails?|wireframe/, w: 4 },
    { re: /images?\b|videos?\b|creative|templates?|screenshots?/, w: 2 },
    { re: /designers?\b/, w: 1 },
  ],
  fintech: [
    { re: /billing|invoic|payments?\b|payouts?|checkout|subscriptions?|payroll|accounting|\btax(es)?\b|expenses?|refunds?/, w: 5 },
    { re: /stripe|pricing|\bmrr\b|\brevenue\b|money|bank/, w: 2 },
  ],
  productivity: [
    { re: /kanban|calendars?|schedul|inbox|to-?dos?\b|tasks?\b|portals?|\bcrm\b|helpdesk|support\b|meetings?|project management|sprints?|wiki|knowledge base|standups?/, w: 4 },
    { re: /notes?\b|docs?\b|files?\b|organi[sz]|productivity/, w: 2 },
    { re: /teams?\b|clients?\b|founders?\b/, w: 1 },
  ],
};

/** The sector a listing belongs to. Deterministic — same input, same shelf. */
export function sectorOf(ticker: {
  name: string;
  pitch: string;
  sector?: string | null;
}): string {
  // an explicit column (if one is ever added) always wins
  const explicit = ticker.sector?.trim().toLowerCase();
  if (explicit && BY_ID.has(explicit)) return explicit;

  const text = `${ticker.name} ${ticker.pitch}`.toLowerCase();
  let best = OTHER_SECTOR;
  let bestScore = 0;
  for (const [id, rules] of Object.entries(RULES)) {
    let score = 0;
    for (const { re, w } of rules) if (re.test(text)) score += w;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

export function sectorMeta(id: string): Sector {
  return BY_ID.get(id) ?? SECTORS[SECTORS.length - 1];
}

export function sectorLabel(id: string): string {
  return sectorMeta(id).label;
}

/**
 * lib/personas.ts — a population of traders, generated, not written.
 *
 * Twelve bots were a roster. A thousand are a distribution: bankrolls from
 * a few dollars to six figures on a power law, activity from once a week to
 * a dozen times a day, a style MIX rather than one style, a holding habit,
 * a voice for the theses, and a handful of other bots each one follows.
 * Everything here is deterministic in (seed, index), so the same seed
 * produces the same population on every machine, and the persona stored on
 * the profile row is the source of truth once seeded.
 *
 * Client-safe: no database, no randomness at runtime beyond what a caller
 * hands in.
 */
import type { BotStyle } from "@/lib/bot-roster";

export type Voice = "degen" | "analyst" | "terse" | "emoji" | "founder";
export type Hold = "paper" | "swing" | "diamond";

export interface Persona {
  username: string;
  name: string;
  /** Style weights, summing to one — most people are a mix. */
  styles: Partial<Record<BotStyle, number>>;
  /** Starting stake, play money. */
  cash: number;
  /** Trades per day, on average, before the time-of-day curve. */
  activityPerDay: number;
  hold: Hold;
  voice: Voice;
  /** Chance a print carries a thesis. */
  thesisRate: number;
  /** Standalone theses per day, trade or no trade. */
  postRate: number;
  /** Usernames this one copies, with a delay. */
  follows: string[];
}

/* ── deterministic randomness ─────────────────────────────────────────── */

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A small xorshift generator; unit() in [0,1), gauss() standard normal. */
export function seededRng(seed: string) {
  let s = hash32(seed) || 1;
  const unit = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const gauss = () => {
    const u1 = Math.max(unit(), Number.MIN_VALUE);
    const u2 = unit();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(unit() * xs.length))];
  return { unit, gauss, pick };
}

/* ── names ────────────────────────────────────────────────────────────── */

const ADJ = [
  "quiet", "loud", "tiny", "mega", "lazy", "hungry", "sleepy", "based", "salty",
  "spicy", "frozen", "golden", "rusty", "silent", "wild", "humble", "cosmic",
  "neon", "velvet", "turbo", "crispy", "lucky", "broke", "stealth", "chill",
  "grumpy", "smol", "vivid", "feral", "mellow", "sharp", "soggy", "dusty",
  "iron", "paper", "diamond", "liquid", "midnight", "sunny", "cranky", "zen",
  "hyper", "slow", "rapid", "noble", "sneaky", "bold", "shy", "moody", "mint",
];
const NOUN = [
  "lobster", "goblin", "wizard", "otter", "panda", "falcon", "badger", "walrus",
  "cactus", "pickle", "noodle", "waffle", "taco", "bagel", "mango", "pretzel",
  "comet", "nebula", "pixel", "kernel", "cursor", "buffer", "socket", "widget",
  "capybara", "ferret", "gecko", "heron", "koala", "llama", "moose", "narwhal",
  "raccoon", "sloth", "toucan", "yak", "zebra", "viking", "pirate", "ninja",
  "monk", "baker", "farmer", "plumber", "pilot", "sailor", "chef", "barista",
  "trader", "hodler", "degen", "analyst", "founder", "intern", "janitor", "ceo",
  "apeman", "bull", "bear", "whale", "shrimp", "crab", "squid", "eel",
];
const SUFFIX = ["", "", "", "", "_", "x", "69", "420", "99", "007", "2k", "_io", "_hq", "2026"];
const FIRST = [
  "Priya", "Marcus", "Elena", "Tomas", "Aisha", "Kenji", "Lena", "Diego", "Noor",
  "Felix", "Ingrid", "Mateo", "Yara", "Oscar", "Hana", "Leo", "Zara", "Ivan",
  "Maya", "Rafael", "Sofia", "Jonas", "Amara", "Luca", "Nadia", "Theo", "Mei",
  "Arjun", "Chloe", "Samir", "Freya", "Kwame", "Olive", "Bruno", "Tara", "Emil",
];
const LAST_INITIAL = "ABCDEFGHJKLMNPRSTVW";

/* ── the population ───────────────────────────────────────────────────── */

export const DEFAULT_POPULATION_SEED = "saasexchange/population/1";

const STYLE_POOL: BotStyle[] = ["value", "momentum", "news", "noise"];

function styleMix(rng: ReturnType<typeof seededRng>, cash: number): Partial<Record<BotStyle, number>> {
  const u = rng.unit();
  const dominant: BotStyle =
    cash >= 25_000 && rng.unit() < 0.6
      ? "whale"
      : u < 0.32
        ? "value"
        : u < 0.62
          ? "momentum"
          : u < 0.78
            ? "news"
            : "noise";
  const others = STYLE_POOL.filter((s) => s !== dominant);
  const secondary = rng.pick(others);
  const w2 = 0.2 + rng.unit() * 0.3;
  return { [dominant]: 1 - w2, [secondary]: w2 };
}

/** One persona, deterministic in (seed, index). Usernames may collide across
 *  indices; generatePopulation resolves that. */
export function generatePersona(seed: string, index: number): Persona {
  const rng = seededRng(`${seed}#${index}`);

  // bankroll: log-normal around $200, a 1.5% whale tail on a power law,
  // a $25 floor because the cheapest share is about that
  let cash = Math.exp(Math.log(200) + 1.6 * rng.gauss());
  if (rng.unit() < 0.015) cash = 30_000 * Math.pow(1 - rng.unit() * 0.985, -0.8);
  cash = Math.round(Math.min(250_000, Math.max(25, cash)));

  // activity: most trade less than once a day; a few are always on
  let activity = Math.exp(Math.log(0.8) + 1.0 * rng.gauss());
  if (cash >= 25_000) activity *= 0.5;
  activity = Math.min(12, Math.max(0.05, activity));

  const hold: Hold = (() => {
    const h = rng.unit();
    return h < 0.35 ? "paper" : h < 0.8 ? "swing" : "diamond";
  })();
  const voice: Voice = (() => {
    const v = rng.unit();
    return v < 0.3 ? "degen" : v < 0.5 ? "analyst" : v < 0.75 ? "terse" : v < 0.9 ? "emoji" : "founder";
  })();

  const adj = rng.pick(ADJ);
  const noun = rng.pick(NOUN);
  const suffix = rng.pick(SUFFIX);
  const username = `${adj}${rng.unit() < 0.5 ? "_" : ""}${noun}${suffix}`.replace(/__/, "_");
  const name =
    rng.unit() < 0.4
      ? `${rng.pick(FIRST)} ${LAST_INITIAL[Math.floor(rng.unit() * LAST_INITIAL.length)]}.`
      : username;

  return {
    username,
    name,
    styles: styleMix(rng, cash),
    cash,
    activityPerDay: Number(activity.toFixed(3)),
    hold,
    voice,
    thesisRate: Number((0.1 + rng.unit() * 0.4).toFixed(2)),
    postRate: Number((0.05 + rng.unit() * 0.55).toFixed(2)),
    follows: [],
  };
}

/**
 * The whole population: unique usernames, and a follow graph — each one
 * copies three to fifteen others, weighted toward the big accounts, which
 * is what makes a move look like a crowd rather than a thousand coin flips.
 */
export function generatePopulation(
  n: number,
  seed = DEFAULT_POPULATION_SEED,
  taken: Iterable<string> = []
): Persona[] {
  const used = new Set<string>(taken);
  const out: Persona[] = [];
  for (let i = 0; out.length < n; i++) {
    const p = generatePersona(seed, i);
    let u = p.username;
    let bump = 2;
    while (used.has(u)) u = `${p.username}${bump++}`;
    used.add(u);
    out.push({ ...p, username: u, name: p.name === p.username ? u : p.name });
  }
  // the follow graph, weighted by stake: everyone watches the whales
  const weights = out.map((p) => Math.sqrt(p.cash));
  const total = weights.reduce((a, b) => a + b, 0);
  const rng = seededRng(`${seed}/follows`);
  for (const p of out) {
    const k = 3 + Math.floor(rng.unit() * 13);
    const set = new Set<string>();
    let guard = 0;
    while (set.size < k && guard++ < 200) {
      let r = rng.unit() * total;
      let j = 0;
      while (j < out.length - 1 && (r -= weights[j]) > 0) j++;
      if (out[j].username !== p.username) set.add(out[j].username);
    }
    p.follows = [...set];
  }
  return out;
}

/* ── the clock ────────────────────────────────────────────────────────── */

const ET_HOUR = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: false,
});

/**
 * How busy the tape is by hour, Eastern: near-dead at 4 AM, busiest through
 * the working day, easing off after dinner. Multiplies every bot's activity
 * so a thousand bots sleep when people do.
 */
export function timeOfDayFactor(t: number): number {
  const h = Number(ET_HOUR.format(new Date(t)).replace(/\D/g, "")) % 24;
  if (h < 6) return 0.3;
  if (h < 9) return 0.8;
  if (h < 17) return 1.35;
  if (h < 21) return 1.1;
  return 0.6;
}

/** Chance a persona acts in one interval of the poller. */
/**
 * activityPerDay was sized for a roster of twelve on one board. Spread a
 * thousand accounts over thirty listings at a print a day each and every
 * listing sees one trade an hour — an empty room. Everyone wakes this many
 * times more often than their activity says.
 */
export const WAKE_SCALE = 4;
/** Paper hands check the chart more often than diamond hands do. */
export const HOLD_TEMPO: Record<Hold, number> = { paper: 1.4, swing: 1, diamond: 0.7 };

export function actChance(p: Persona, t: number, intervalMs = 5 * 60_000): number {
  return Math.min(
    0.95,
    (p.activityPerDay * WAKE_SCALE * HOLD_TEMPO[p.hold] * intervalMs * timeOfDayFactor(t)) /
      86_400_000
  );
}

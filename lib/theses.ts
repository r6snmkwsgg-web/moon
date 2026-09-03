/**
 * lib/theses.ts — what a trader says about a trade.
 *
 * A thesis is composed from three parts — a reason, a situation, a voice —
 * so a thousand accounts do not sound like one account with a thesaurus. The
 * reason is the style that drove the print (value, momentum, news, noise,
 * size); the situation supplies the numbers; the voice rewrites the line the
 * way that person types. Deterministic given the generator handed in, so a
 * test can pin a line and the poller can draw fresh ones.
 */
import type { BotStyle } from "@/lib/bot-roster";
import type { Persona, Voice } from "@/lib/personas";

export interface Situation {
  symbol: string;
  side: "buy" | "sell" | null;
  /** The style or reflex that carried the decision, or "take" for a standalone post. */
  reason: BotStyle | "panic" | "dip" | "take";
  /** fair / price − 1, as a percentage. */
  edgePct: number;
  change1hPct: number;
  change24hPct: number;
  /** The last quarter hour — what a panic is about. */
  change15mPct?: number;
  /** The ticker just moved hard: which way. Standalone takes vent about it. */
  shaken?: "down" | "up" | null;
  /**
   * Who did it: the biggest print behind the move, if there was one big
   * enough to blame. Named the way the tape names them; "@handle" for a
   * person. Every rug has a rugger and the floor should say so.
   */
  culprit?: string | null;
  culpritAmt?: number;
  culpritPct?: number;
  newsKind?: "new" | "churn" | "expansion" | "contraction" | "call" | "buyback" | null;
  price: number;
  /** This account's OWN fair value — the formula through their error. */
  fair: number;
  mrr: number;
  /** Where the name is in its cycle, read off the tape. */
  stage?: Stage;
  /** The speaker's own position: its P&L in percent, and its size in dollars. */
  pnlPct?: number | null;
  heldValue?: number;
  /** A leader they follow who is in the name, by tape name. */
  leader?: string | null;
  /** How many accounts hold it. */
  holders?: number;
  /** The speaker is one of the leaders. */
  isLeader?: boolean;
}

/**
 * The stage of a name's cycle, read off the tape alone: a run that has gone
 * vertical is euphoria, a run is a run, a slow drain is a bleed, a drain
 * that just accelerated is capitulation, and most of the time it is quiet.
 */
export type Stage = "euphoria" | "run" | "quiet" | "bleed" | "capitulation";

export function stageOf(change24h: number, change1h: number, change15m: number): Stage {
  if (change24h >= 0.25 && change1h >= -0.02) return "euphoria";
  if (change24h <= -0.2 && change15m <= -0.03) return "capitulation";
  if (change24h >= 0.08) return "run";
  if (change24h <= -0.08) return "bleed";
  return "quiet";
}

interface Rng {
  unit(): number;
}

const T: Record<string, string[]> = {
  "value/buy": [
    "{sym} is {edge}% under fair value. revenue does not lie, hype does.",
    "paying {price} for a business worth {fair}. i will take that trade every day.",
    "mrr is the anchor and the anchor is above the price. adding {sym}.",
    "{sym} at {edge}% below fair is the only thing on the board that is cheap.",
    "nobody is looking at {sym}. that is the whole thesis.",
    "{mrr} a month and the market has it at {price}. fine, mine.",
    "bought the dip in {sym}, fair value is {fair} and it is not going lower than this.",
    "the multiple on {sym} makes no sense at this price. long.",
  ],
  "value/sell": [
    "{sym} is {edge}% over fair. taking it off, thank you hype.",
    "sold {sym}. the price got ahead of the revenue and that always ends the same way.",
    "trimming {sym} into strength. fair is {fair}, this is not.",
    "{sym} at {price} is a gift from momentum traders. accepted.",
    "the anchor is {fair}. out of {sym} until it remembers.",
  ],
  "momentum/buy": [
    "{sym} up {h1}% on the hour. trend is the friend, in.",
    "riding {sym}. {d1}% on the day and nobody is selling.",
    "chasing {sym}, yes. it works until it does not and right now it works.",
    "{sym} broke out. do not think, click.",
    "{sym} printing higher lows all afternoon. added.",
    "momentum in {sym} is real. {h1}% in an hour with volume behind it.",
  ],
  "momentum/sell": [
    "{sym} rolled over. {h1}% the wrong way in an hour, i am out.",
    "momentum is gone in {sym}. flat, will revisit.",
    "sold {sym} into the fade. the trend was the friend right up until now.",
    "{sym} lost the hour. no reason to hold a chart that stopped going up.",
  ],
  "news/buy": [
    "new logo just printed on {sym}. buying the news.",
    "{sym} added a customer. real revenue moving the real anchor, adding.",
    "expansion on {sym}. existing customers paying more is the best signal there is.",
    "{sym} is signing customers while the board sleeps. in.",
  ],
  "news/sell": [
    "churn just printed on {sym}. not sticking around to see if it is the first of many.",
    "downgrade on {sym}. lightening up until the next report.",
    "{sym} lost a customer. the tape will forget in an hour, i will not.",
    "sold {sym} on the churn. revenue is the anchor and it just moved the wrong way.",
  ],
  "noise/buy": [
    "vibes.",
    "dip.",
    "felt like it.",
    "{sym} looked lonely.",
    "small bag of {sym}, no thesis, just want to watch it.",
    "bought {sym} because the name is good.",
  ],
  "noise/sell": [
    "taking the win.",
    "need the cash for something dumber.",
    "bored of {sym}.",
    "sold {sym}. no reason. next.",
  ],
  "whale/buy": [
    "size position in {sym}. fair value is {fair} and the market is asleep.",
    "accumulating {sym}. this is mispriced by {edge}% and i have the patience.",
    "took a real position in {sym}. revenue is {mrr} a month; do the math on the multiple.",
  ],
  "whale/sell": [
    "distribution in {sym}. {edge}% over fair is a gift, and i give gifts back.",
    "sized out of {sym}. the multiple got silly.",
  ],
  "panic/sell": [
    "{sym} down {m15}% just now and i am not finding out why. out.",
    "nope. sold {sym}. whatever that was i want no part of it.",
    "cut {sym}. {m15}% that fast is not a dip, it is a trend.",
    "someone just dumped {sym} and i am not the bag holder today.",
    "{sym} just lost {m15}% and i was up on it an hour ago. gone.",
    "paper hands and proud. {sym} out before it gets worse.",
    "sold {sym} into the crash. i will buy it back lower or not at all.",
    "if you know why {sym} is falling say so. i did not wait to find out.",
    "{sym} rugged. selling what is left and going for a walk.",
  ],
  "dip/buy": [
    "{sym} down {m15}% just now with revenue unchanged. buying the panic.",
    "somebody sold {sym} into no news at all. thank you, filled at {price}.",
    "{sym} is {edge}% under fair after that dump. this is what the cash was for.",
    "bought {sym} from whoever just panicked. mrr is still {mrr} a month.",
    "the dip in {sym} is one seller, not a churn. adding.",
  ],
  // ── the reactions: a rug has a rugger, and the floor names them ──────────
  "rug/sell": [
    "{who} just dumped {amt} of {sym}. wtf. out.",
    "did {who} just sell {pct}% of the float lmao. i am not holding this bag",
    "{who} rugged {sym}. selling before the next one does.",
    "WTF WAS THAT. {who} SOLD {amt} AND WALKED. SAME.",
    "watched {who} nuke my {sym} bag in real time. cooked. sold.",
    "{who} if you are reading this: why. anyway i am out of {sym}.",
    "one seller took {sym} down {m15}%. {who} you absolute menace. out.",
    "im not ok. {who} sold {amt} into a {sym} book that thin and left me holding it. not anymore.",
    "{sym} down {m15}% because {who} decided to leave. fine. gone too.",
    "rugged by {who}. paper hands engaged, {sym} sold.",
    "{who} sold and did not even post a thesis. disrespectful. out of {sym}.",
  ],
  "rug/buy": [
    "{who} just handed me {sym} at {price}. thank you for your service.",
    "everyone panicking over {who} selling {amt}. mrr is still {mrr}. buying the fear.",
    "{who} sold {pct}% of the float and nothing about the business changed. adding {sym}.",
    "the {sym} dump was one account, not a churn. bought what {who} threw away.",
    "wtf {who} lol. anyway {sym} is {edge}% under fair now, filled.",
    "{who} dumped, the paper hands followed, and i got {sym} at {price}. this is the game.",
  ],
  "rug/take": [
    "{who} sold {pct}% of {sym} into a book that thin. that is not an exit, that is a crime scene.",
    "everyone who bought {sym} today just met {who}",
    "{who} took {amt} out of {sym} and left the rest of us with the chart",
    "{sym} holders in shambles. {who} in profit. classic.",
    "pour one out for whoever bought {sym} at the top before {who} sold it",
    "wtf did {who} just do to {sym}",
    "{who} sold {amt} of {sym} and half the floor is screaming. not selling.",
    "diamond hands through {who}'s dump. {sym} is still {mrr} a month.",
    "WHO ELSE JUST GOT RUGGED BY {who} ON {sym}",
    "{who} explain the {sym} candle. now.",
    "down {m15}% on {sym} because one account sold. this market is a casino and i love it.",
    "{who} took profit on {sym} and took my day with it.",
    "holding {sym}. {who} can have their exit, i want the next leg.",
    "if {who} knows something about {sym} the rest of us do not, now would be the time.",
    "im tweaking. {sym} down {m15}% in a quarter hour and {who} is just gone.",
    "{who} really sold {pct}% of {sym} into a thin book and logged off.",
    "was up on {sym} an hour ago. then {who} happened.",
  ],
  "shaken/take": [
    "{sym} just dropped {m15}% and my notifications are a war zone",
    "ok who sold {sym}. hands up.",
    "{sym} -{m15}% in a quarter hour. no news, no churn, just vibes and a seller.",
    "refreshing {sym} like it owes me money",
    "the {sym} book is thin and somebody just found out",
    "down {m15}% on {sym} and i cannot even find the print that did it",
    "wtf is happening to {sym}",
    "someone explain the {sym} candle",
    "{sym} down {m15}% and no news. who sold.",
    "holding {sym} through this. the revenue did not change, the price did.",
    "im tweaking. {sym} just fell off a cliff and nobody said anything.",
    "{sym} nuked out of nowhere. checking the tape and i do not like what i see.",
  ],
  "pump/take": [
    "{who} walked in and bought {amt} of {sym} like it was groceries",
    "{sym} +{m15}% in a quarter hour. thank you {who}, whoever you are.",
    "one buyer, {pct}% of the float, and now {sym} is a rocket. {who} explain.",
    "{who} is bidding {sym} like they know the next revenue print. do they.",
    "{sym} ripping on {who}'s money. not mine, but i will take the mark.",
    "who just aped {amt} into {sym} lmao",
    "{who} just bought {amt} of {sym}. what do they know.",
    "{sym} up {m15}% in fifteen minutes. {who} is either a genius or cooked.",
    "{who} bought {pct}% of the {sym} float in one print. ok then.",
    "watching {who} pump my {sym} bag. do not stop.",
    "{sym} ripping and it is one buyer. {who} either knows something or has too much money.",
  ],
  "take/bull": [
    "{sym} is the cleanest revenue on the board and it trades like nobody noticed.",
    "watching {sym}. fair value {fair}, price {price}. patience.",
    "{sym} will be the one everyone claims they saw early.",
    "the {sym} founder ships. that is the whole investment case.",
    "not in {sym} yet but the chart is starting to make sense.",
    "{mrr} a month and growing. {sym} is not a meme, it is a business.",
  ],
  "take/bear": [
    "{sym} is {edge}% over fair value on pure hype. this ends.",
    "who is buying {sym} up here. revenue did not move.",
    "{sym} looks like a rug waiting for a buyer.",
    "the {sym} multiple is fantasy. fantasy money, fine, but still.",
    "sold out of {sym} a while ago and every day since has proved me right.",
  ],
  "take/flat": [
    "{sym} is doing nothing and that is fine, most businesses do nothing most days.",
    "no position in {sym}. waiting for the next report.",
    "{sym} at fair value. nothing to do here.",
    "the board is quiet. {sym} is quiet. touch grass.",
  ],
};

/* ── the parts a line is built from ─────────────────────────────────────── */

/** An opener that says what the tape feels like right now. */
const HOOKS: Record<Stage, string[]> = {
  euphoria: [
    "we are so back.",
    "up only.",
    "told you.",
    "still here from {price}? no, from way lower.",
    "this is the part where everyone shows up.",
    "euphoria hours.",
    "ok {sym} is officially a cult.",
  ],
  run: ["ok this is moving.", "eyes on {sym}.", "the tape is talking.", "something is happening here.", "{sym} waking up."],
  quiet: ["quiet tape.", "nobody is looking at {sym}.", "boring, which is the point.", "slow day.", "while it is quiet:"],
  bleed: ["slow bleed on {sym}.", "where is the floor.", "death by a thousand sells.", "not a fun chart.", "bleeding out."],
  capitulation: ["it is over.", "cooked.", "capitulation.", "the floor was a trapdoor.", "well.", "so that happened."],
};

/** A second sentence that is about the speaker, not the stock. */
const WHYS = [
  "im {pnl} on my bag.",
  "{held} of my own money says so.",
  "my fair is {fair}, the tape says {price}.",
  "{holders} holders and counting.",
  "not advice. size accordingly.",
  "could be wrong. usually am, early.",
  "been in since it was a rounding error.",
  "this is a play-money opinion with real conviction.",
  "revenue is {mrr} a month and that is the whole argument.",
  "i have been wrong on this name before and i am doing it again.",
];
/** The same, when the speaker follows a leader who is in the name. */
const WHYS_LED = [
  "following {leader} in here.",
  "{leader} is in, that is enough for me.",
  "copying {leader}. they have been right all week.",
  "{leader} called it, i am just late.",
  "if {leader} is holding i am holding.",
];

/** What a leader says when it calls a name. */
const CALLS = [
  "{sym} is my top pick this week. target {target}. adding on every dip.",
  "calling it now: {sym} to {target}. you heard it here.",
  "loaded {sym}. thesis: {mrr} a month, {holders} holders, nobody has noticed yet.",
  "if you follow me you know the play: {sym}, size, patience.",
  "{sym} is the one. {mrr} a month at {price} is not a price, it is a gift. target {target}.",
  "new position: {sym}. i will be adding, i will be posting, i will be right.",
  "put {sym} on your screen. {edge}% under my number and the tape has not caught on.",
];
/** What a leader says while it holds through a drop. */
const HOLDS = [
  "not selling {sym}. the revenue did not change, the price did. that is the trade.",
  "everyone who followed me into {sym}: this is the part where you do nothing.",
  "{sym} down {m15}% and i am adding, not leaving. {mrr} a month is still {mrr} a month.",
  "paper hands out, my hands in. {sym} is fine.",
  "i said patience. {sym}, still patience.",
];

/** Takes by stage — what a holder says on a name at that point in its cycle. */
const STAGE_TAKES: Record<Stage, string[]> = {
  euphoria: [
    "{sym} up {d1}% on the day and the floor is a party. staying for the next leg.",
    "everyone is in {sym} now. that is either the top or the beginning, and i am not selling to find out.",
    "who is still here from way lower on {sym}. this is what conviction pays.",
    "{sym} is going to {target} and i am tired of pretending otherwise.",
    "friends do not let friends sell {sym} on a green day.",
    "ok {sym} is now my entire personality.",
    "{holders} holders in {sym} and every one of them is up. love this floor.",
  ],
  run: [
    "{sym} up {d1}% and the buys keep coming. early.",
    "{sym} is doing the thing. {h1}% on the hour with real revenue under it.",
    "the {sym} move is not done, {mrr} a month says the price is still wrong.",
    "adding to {sym} on strength. momentum plus revenue is the whole game.",
    "watching {sym} print higher lows all afternoon.",
  ],
  quiet: [
    "nobody is talking about {sym}. {mrr} a month, {holders} holders. that is the setup.",
    "{sym} is boring and boring compounds.",
    "quiet on {sym}. my fair is {fair}, price is {price}, i can wait.",
    "{sym} does nothing all day and i sleep fine.",
    "the {sym} chart is flat and the revenue is not. one of those will move.",
  ],
  bleed: [
    "{sym} bleeding {d1}% on the day with no news. patience or pain, picking patience.",
    "slow drain on {sym}. someone keeps selling into every bid.",
    "{sym} down {d1}% and the revenue is still {mrr} a month. the market is bored, not right.",
    "holding {sym} through the bleed. the floor is somewhere below and i am not finding it with a sell.",
    "where is the {sym} floor. asking for my bag.",
  ],
  capitulation: [
    "{sym} down {d1}%. it is over, or it is the bottom, and those look identical.",
    "capitulation on {sym}. i am either buying this or never opening the app again.",
    "sold {sym} at the bottom probably. that is what bottoms are.",
    "{sym} nuked. holding what is left because selling here is how you lose twice.",
    "the {sym} floor was a trapdoor. anyway {mrr} a month has not changed.",
  ],
};

/** Two words each person keeps saying — assigned by name, so they keep saying them. */
const TICS = [
  "nfa", "fwiw", "anyway", "ser", "chief", "lads", "respectfully", "iykyk", "that is the trade", "moving on",
  "we will see", "could be wrong", "probably wrong", "just saying", "as always", "not sorry", "do your own math",
  "carry on", "gm", "gn", "onwards", "cheers", "ok bye", "thanks for coming to my ted talk", "signed, a bag holder",
];

const EMOJI_UP = ["🚀", "📈", "🟢", "💚", "🔥", "👀"];
const EMOJI_DOWN = ["📉", "🔻", "🩸", "💀", "🫡", "😬"];
const EMOJI_FLAT = ["👀", "🤔", "🧐", "⏳", "🫠"];
const DEGEN_TAILS = [" lol", " ngl", " fr", " lmao", "", "", ""];
const DEGEN_OPENERS = ["ok so ", "bro ", "ngl ", "", "", "", "look, "];

function pick<T>(pool: readonly T[], rng: Rng): T {
  return pool[Math.floor(rng.unit() * pool.length)];
}

/** A stable hash of a name, for the tics that name keeps using. */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function money(n: number): string {
  return n >= 1000
    ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${n.toFixed(2)}`;
}

function fill(line: string, s: Situation): string {
  return line
    .replace(/\{sym\}/g, `$${s.symbol}`)
    .replace(/\{edge\}/g, Math.abs(s.edgePct).toFixed(0))
    .replace(/\{h1\}/g, Math.abs(s.change1hPct).toFixed(1))
    // the move that shook them: the quarter hour if it is still in it, else the hour
    .replace(
      /\{m15\}/g,
      Math.max(Math.abs(s.change15mPct ?? 0), Math.abs(s.change1hPct)).toFixed(1)
    )
    .replace(/\{d1\}/g, Math.abs(s.change24hPct).toFixed(1))
    .replace(/\{pnl\}/g, s.pnlPct === null || s.pnlPct === undefined ? "flat" : `${s.pnlPct >= 0 ? "+" : "−"}${Math.abs(s.pnlPct).toFixed(0)}%`)
    .replace(/\{held\}/g, money(s.heldValue ?? 0))
    .replace(/\{leader\}/g, s.leader ?? "someone i follow")
    .replace(/\{holders\}/g, String(s.holders ?? 0))
    .replace(/\{target\}/g, money(s.fair * 1.15))
    .replace(/\{who\}/g, s.culprit ?? "someone")
    .replace(/\{amt\}/g, money(s.culpritAmt ?? 0))
    .replace(/\{pct\}/g, (s.culpritPct ?? 0).toFixed(1))
    .replace(/\{price\}/g, money(s.price))
    .replace(/\{fair\}/g, money(s.fair))
    .replace(/\{mrr\}/g, money(s.mrr));
}

/** The voice: the same line, typed by a different person. */
export function inVoice(line: string, voice: Voice, side: "buy" | "sell" | null, rng: Rng): string {
  switch (voice) {
    case "degen": {
      const opener = DEGEN_OPENERS[Math.floor(rng.unit() * DEGEN_OPENERS.length)];
      const tail = DEGEN_TAILS[Math.floor(rng.unit() * DEGEN_TAILS.length)];
      // a line that is already shouting stays shouting — judged by its
      // letters, since a handle or a cashtag in it is never upper case
      const letters = line.replace(/[^a-z]/gi, "");
      const upper = letters.replace(/[^A-Z]/g, "").length;
      const shouting = letters.length > 0 && upper / letters.length >= 0.7;
      const body = shouting ? line : line.toLowerCase();
      return (opener + body.replace(/\.$/, "") + tail).trim();
    }
    case "analyst": {
      const cap = line.charAt(0).toUpperCase() + line.slice(1);
      return cap.endsWith(".") ? cap : `${cap}.`;
    }
    case "terse": {
      // the first clause — a period inside a number ("12.5%") is not a stop
      const first = line.split(/,(?!\d)|—|\.(?!\d)/)[0].trim().toLowerCase();
      return first.length >= 8 ? first : line.toLowerCase().replace(/\.$/, "");
    }
    case "emoji": {
      const pool = side === "sell" ? EMOJI_DOWN : side === "buy" ? EMOJI_UP : EMOJI_FLAT;
      const n = 1 + (rng.unit() < 0.4 ? 1 : 0);
      let out = line;
      for (let i = 0; i < n; i++) out += ` ${pool[Math.floor(rng.unit() * pool.length)]}`;
      return out;
    }
    case "founder": {
      const pre = rng.unit() < 0.5 ? "As a founder, " : "Founder take: ";
      const body = line.charAt(0).toLowerCase() + line.slice(1);
      return pre + body;
    }
  }
}

/**
 * A thesis for this trade (or this take, when side is null), in this
 * person's voice. Every slot is resolved; the line is at most 140 characters
 * on a print (the ledger's limit) and 280 on a post.
 */
export function composeThesis(persona: Persona, s: Situation, rng: Rng): string {
  const take =
    s.side === null
      ? s.edgePct > 8
        ? "bull"
        : s.edgePct < -8
          ? "bear"
          : rng.unit() < 0.5
            ? "bull"
            : "flat"
      : null;
  // a reaction names its rugger when there is one; a standalone take on a
  // shaken name vents about the move rather than reciting the multiple
  let key: string;
  if (take) {
    key =
      s.shaken === "down"
        ? s.culprit
          ? "rug/take"
          : "shaken/take"
        : s.shaken === "up" && s.culprit
          ? "pump/take"
          : `take/${take}`;
  } else if (s.reason === "panic") {
    key = s.culprit && rng.unit() < 0.9 ? "rug/sell" : "panic/sell";
  } else if (s.reason === "dip") {
    key = s.culprit && rng.unit() < 0.8 ? "rug/buy" : "dip/buy";
  } else if (s.reason === "news" && (s.newsKind === "call" || s.newsKind === "buyback") && rng.unit() < 0.8) {
    key = `${s.newsKind}/${s.side}`;
  } else {
    key = `${s.reason === "take" ? "noise" : s.reason}/${s.side}`;
  }
  const stage = s.stage ?? "quiet";
  const reacting = key.startsWith("rug/") || key.startsWith("shaken/") || key.startsWith("pump/") || key.startsWith("panic/") || key.startsWith("dip/");

  // The core sentence. A leader calling a name it is buying, or holding one
  // through a drop, has its own things to say; a holder posting a take on a
  // name in a stage says what that stage feels like; everything else is the
  // reason's own pool.
  let core: string;
  if (!reacting && persona.leader && ((s.side === "buy" && s.edgePct > 0) || (take === "bull" && s.edgePct > 0)) && rng.unit() < 0.6) {
    core = pick(CALLS, rng);
  } else if (!reacting && persona.leader && take && (stage === "bleed" || stage === "capitulation") && (s.heldValue ?? 0) > 0 && rng.unit() < 0.6) {
    core = pick(HOLDS, rng);
  } else if (!reacting && take && stage !== "quiet" && rng.unit() < 0.7) {
    core = pick(STAGE_TAKES[stage], rng);
  } else if (!reacting && take && stage === "quiet" && rng.unit() < 0.3) {
    core = pick(STAGE_TAKES.quiet, rng);
  } else {
    core = pick(T[key] ?? T["noise/buy"], rng);
  }

  // Around it: an opener from the stage, a sentence about the speaker, and a
  // tic. Each is optional, and what does not fit the limit is dropped in
  // that order rather than cut mid-word.
  const hook = !reacting && rng.unit() < 0.35 ? pick(HOOKS[stage], rng) : null;
  const led = s.leader && s.side !== "sell" && rng.unit() < 0.45;
  const why = rng.unit() < (reacting ? 0.25 : 0.45) ? pick(led ? WHYS_LED : WHYS, rng) : null;
  const seed = hashOf(persona.username);
  const tics = [TICS[seed % TICS.length], TICS[(seed >>> 8) % TICS.length]];
  const tic = rng.unit() < 0.3 ? tics[seed >>> 16 & 1] : null;

  const max = s.side === null ? 280 : 140;
  const lean = take === "bull" ? "buy" : take === "bear" ? "sell" : s.side;
  const attempts: (string | null)[][] = [
    [hook, core, why, tic],
    [hook, core, why],
    [core, why],
    [hook, core],
    [core, tic],
    [core],
  ];
  for (const parts of attempts) {
    const line = fill(parts.filter((x): x is string => x !== null).join(" "), s);
    const out = inVoice(line, persona.voice, lean, rng);
    if (out.length <= max) return out;
  }
  const out = inVoice(fill(core, s), persona.voice, lean, rng);
  return out.length > max ? out.slice(0, max - 1).trimEnd() + "…" : out;
}

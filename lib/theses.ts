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
  /** The style that carried the decision, or "take" for a standalone post. */
  reason: BotStyle | "take";
  /** fair / price − 1, as a percentage. */
  edgePct: number;
  change1hPct: number;
  change24hPct: number;
  newsKind?: "new" | "churn" | "expansion" | "contraction" | null;
  price: number;
  fair: number;
  mrr: number;
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

const EMOJI_UP = ["🚀", "📈", "🟢", "💚", "🔥", "👀"];
const EMOJI_DOWN = ["📉", "🔻", "🩸", "💀", "🫡", "😬"];
const EMOJI_FLAT = ["👀", "🤔", "🧐", "⏳", "🫠"];
const DEGEN_TAILS = [" lol", " ngl", " fr", " lmao", "", "", ""];
const DEGEN_OPENERS = ["ok so ", "bro ", "ngl ", "", "", "", "look, "];

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
    .replace(/\{d1\}/g, Math.abs(s.change24hPct).toFixed(1))
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
      return (opener + line.toLowerCase().replace(/\.$/, "") + tail).trim();
    }
    case "analyst": {
      const cap = line.charAt(0).toUpperCase() + line.slice(1);
      return cap.endsWith(".") ? cap : `${cap}.`;
    }
    case "terse": {
      const first = line.split(/[,.—]/)[0].trim().toLowerCase();
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
  const key = take ? `take/${take}` : `${s.reason === "take" ? "noise" : s.reason}/${s.side}`;
  const pool = T[key] ?? T["noise/buy"];
  const line = fill(pool[Math.floor(rng.unit() * pool.length)], s);
  // a bearish take gets the bear's emoji, not a rocket — the voice follows
  // the direction of what is being said, trade or no trade
  const lean = take === "bull" ? "buy" : take === "bear" ? "sell" : s.side;
  const out = inVoice(line, persona.voice, lean, rng);
  const max = s.side === null ? 280 : 140;
  return out.length > max ? out.slice(0, max - 1).trimEnd() + "…" : out;
}

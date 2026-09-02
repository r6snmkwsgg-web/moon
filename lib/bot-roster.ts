/**
 * lib/bot-roster.ts — who the AI traders are. Client-safe: no database, so
 * the tape, the holders table and the leaderboard can all tell a bot from a
 * person by username alone.
 */
export type BotStyle = "value" | "momentum" | "news" | "noise" | "whale";

export interface BotSpec {
  username: string;
  name: string;
  style: BotStyle;
  /** Starting stake, play money. */
  cash: number;
}

export const BOTS: BotSpec[] = [
  { username: "quantfox", name: "QuantFox", style: "value", cash: 50_000 },
  { username: "mrr_maxi", name: "MRR Maxi", style: "value", cash: 50_000 },
  { username: "fairvalue_frank", name: "Fair Value Frank", style: "value", cash: 50_000 },
  { username: "momo_mike", name: "Momo Mike", style: "momentum", cash: 50_000 },
  { username: "trendsurfer", name: "Trendsurfer", style: "momentum", cash: 50_000 },
  { username: "newsdesk", name: "Newsdesk", style: "news", cash: 50_000 },
  { username: "churnwatch", name: "Churnwatch", style: "news", cash: 50_000 },
  { username: "dipwizard", name: "Dip Wizard", style: "noise", cash: 50_000 },
  { username: "degen_dan", name: "Degen Dan", style: "noise", cash: 50_000 },
  { username: "paperhands_pat", name: "Paperhands Pat", style: "noise", cash: 50_000 },
  { username: "whale_wendy", name: "Whale Wendy", style: "whale", cash: 150_000 },
  { username: "bigfoot_capital", name: "Bigfoot Capital", style: "whale", cash: 150_000 },
];

const USERNAMES = new Set(BOTS.map((b) => b.username));

/** True for the AI traders. Their prints are real; their judgement is code. */
export function isBotUsername(username: string | null | undefined): boolean {
  return username !== null && username !== undefined && USERNAMES.has(username);
}

/** The mailbox a bot account is registered under. Nothing is ever sent to it. */
export function botEmail(username: string): string {
  return `${username}@bots.saasexchange.app`;
}

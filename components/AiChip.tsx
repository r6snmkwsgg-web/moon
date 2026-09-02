import { isBotUsername } from "@/lib/bot-roster";

/**
 * The label on an AI trader wherever a name shows. Their prints are real
 * prints; their judgement is code, and nobody should have to guess which.
 */
export default function AiChip({
  username,
  bot,
  className = "",
}: {
  username?: string | null;
  /** The flag off the profile row (0009); the roster is the fallback. */
  bot?: boolean;
  className?: string;
}) {
  if (!bot && !isBotUsername(username)) return null;
  return (
    <span
      title="An AI trader — its judgement is code, its trades are real"
      className={`inline-flex items-center rounded border border-terminal-accent/40 bg-terminal-accent/10 px-1 font-mono text-[9px] font-bold uppercase leading-4 tracking-wider text-terminal-accent ${className}`}
    >
      AI
    </span>
  );
}

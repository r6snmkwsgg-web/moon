import { Flame } from "lucide-react";
import { STREAK_FLAME_AT, type Streak } from "@/lib/xp";

/**
 * The daily trade streak — FOMO with honest numbers. Milestone at 5 days
 * puts the flame on the public profile; everything is cosmetic.
 */
export default function StreakCard({ streak }: { streak: Streak }) {
  const target = Math.max(
    STREAK_FLAME_AT,
    (Math.floor(streak.days / STREAK_FLAME_AT) + 1) * STREAK_FLAME_AT
  );
  const pips = Array.from({ length: target }, (_, i) => i < streak.days);

  return (
    <div className="panel space-y-2 border-terminal-amber/30 bg-gradient-to-br from-terminal-amber/10 to-transparent p-4">
      <div className="microlabel flex items-center gap-1 !text-terminal-amber">
        <Flame size={11} fill="currentColor" />
        Trade streak
      </div>
      <div className="flex items-baseline gap-2">
        <span className="num font-mono text-3xl font-bold">{streak.days}</span>
        <span className="text-sm font-semibold text-terminal-muted">
          day{streak.days === 1 ? "" : "s"}
        </span>
        {streak.days >= STREAK_FLAME_AT && (
          <span className="flex items-center gap-1 rounded bg-terminal-amber/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-terminal-amber">
            <Flame size={10} fill="currentColor" />
            FLAME ON YOUR PROFILE
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {pips.map((filled, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              filled ? "bg-terminal-amber" : "bg-terminal-line"
            }`}
          />
        ))}
      </div>
      <p className="text-[11px] leading-snug text-terminal-muted">
        {streak.days === 0
          ? `Make a trade to start one — ${STREAK_FLAME_AT} days puts the flame on your profile.`
          : streak.tradedToday
            ? `Locked in for today. Day ${target} is the next milestone.`
            : "Trade before midnight UTC to keep it alive."}
      </p>
    </div>
  );
}

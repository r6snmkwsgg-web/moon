import { tierFor } from "@/lib/xp";

/** Ranked-tier chip. Cosmetic status only — colors are data-driven, inline. */
export default function TierBadge({
  xp,
  showXp = false,
}: {
  xp: number;
  showXp?: boolean;
}) {
  const standing = tierFor(xp);
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide"
      style={{
        color: standing.tier.color,
        backgroundColor: `${standing.tier.color}1f`,
        border: `1px solid ${standing.tier.color}55`,
      }}
      title={`${standing.tier.name} · ${standing.xp.toLocaleString("en-US")} XP`}
    >
      <svg width="7" height="7" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M5 0 L10 5 L5 10 L0 5 Z" fill="currentColor" />
      </svg>
      {standing.tier.name}
      {showXp && (
        <span className="num font-semibold normal-case tracking-normal">
          {standing.xp.toLocaleString("en-US")} XP
        </span>
      )}
    </span>
  );
}

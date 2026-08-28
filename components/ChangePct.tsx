import { fmtPct } from "@/lib/format";

/** Green/red signed percent. */
export default function ChangePct({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const color =
    value > 0.0005
      ? "text-terminal-up"
      : value < -0.0005
        ? "text-terminal-down"
        : "text-terminal-muted";
  return (
    <span className={`num font-mono ${color} ${className}`}>
      {fmtPct(value)}
    </span>
  );
}

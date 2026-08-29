import { fmtPct } from "@/lib/format";

/** Green/red signed percent — plain text, or a tinted chip. */
export default function ChangePct({
  value,
  className = "",
  chip = false,
}: {
  value: number;
  className?: string;
  chip?: boolean;
}) {
  const dir = value > 0.0005 ? "up" : value < -0.0005 ? "down" : "flat";
  if (chip) {
    // literal class names so Tailwind's content scan keeps them
    const chipClass = { up: "chip-up", down: "chip-down", flat: "chip-flat" }[
      dir
    ];
    return <span className={`${chipClass} ${className}`}>{fmtPct(value)}</span>;
  }
  const color =
    dir === "up"
      ? "text-terminal-up"
      : dir === "down"
        ? "text-terminal-down"
        : "text-terminal-muted";
  return (
    <span className={`num font-mono ${color} ${className}`}>
      {fmtPct(value)}
    </span>
  );
}

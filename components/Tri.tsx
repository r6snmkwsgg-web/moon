/**
 * The classic market triangle — the one glyph emojis always butchered.
 * Inline SVG so it inherits currentColor and sits on the text baseline.
 */
export default function Tri({
  dir,
  size = 8,
  className = "",
}: {
  dir: "up" | "down";
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      {dir === "up" ? (
        <path d="M5 1.5 L9.5 8.5 H0.5 Z" fill="currentColor" />
      ) : (
        <path d="M5 8.5 L9.5 1.5 H0.5 Z" fill="currentColor" />
      )}
    </svg>
  );
}

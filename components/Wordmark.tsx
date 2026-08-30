import { APP_NAME } from "@/lib/config";

/** The mark: a price line breaking out of its box. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md bg-terminal-up/15 ring-1 ring-terminal-up/40"
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        viewBox="0 0 32 32"
        aria-hidden="true"
      >
        <path
          d="M5 22 L12 14 L17 18 L27 7"
          stroke="#22c55e"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 7 H27 V14"
          stroke="#22c55e"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Mark + letterspaced name, identical everywhere the brand appears. */
export default function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark size={compact ? 24 : 28} />
      <span
        className={`whitespace-nowrap font-mono font-bold text-terminal-text ${
          compact
            ? "text-[11px] tracking-[0.18em]"
            : "text-xs tracking-[0.18em] sm:text-sm sm:tracking-[0.22em]"
        }`}
      >
        {APP_NAME}
      </span>
    </span>
  );
}

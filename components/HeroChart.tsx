import Link from "next/link";
import type { TickerQuote } from "@/lib/types";
import { fmtPct, fmtPrice } from "@/lib/format";

/**
 * The landing fold's full-width chart — today's top mover drawn big beneath
 * the centered headline (the V2 "centered monument" hero). Real data: the
 * shape is whatever the market actually did.
 */
export default function HeroChart({ quote }: { quote: TickerQuote }) {
  const t = quote.ticker;
  const up = quote.dayChange >= 0;
  const color = up ? "#22c55e" : "#f43f5e";
  const spark = quote.spark;

  const W = 1440;
  const H = 380;
  const min = Math.min(...spark);
  const max = Math.max(...spark);
  const range = max - min || 1;
  const pts = spark.map((v, i) => {
    const x = (i / Math.max(spark.length - 1, 1)) * W;
    // leave the top quarter as air so the caption never collides
    const y = 90 + (1 - (v - min) / range) * (H - 110);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} ${W},${H} 0,${H}`;
  const last = pts[pts.length - 1];
  const captionNearTop = last[1] < H * 0.45;

  return (
    <div className="relative -mx-4 mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full sm:h-[300px] lg:h-[360px]"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#hero-area)" />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last[0]} cy={last[1]} r="7" fill={color} />
      </svg>

      {/* price caption docked near the line's end */}
      <Link
        href={`/t/${t.symbol}`}
        className={`absolute right-4 flex items-baseline gap-2.5 rounded-xl border bg-terminal-bg/90 px-3.5 py-2 backdrop-blur transition-colors hover:bg-terminal-raise sm:right-8 ${
          up ? "border-terminal-up/40" : "border-terminal-down/40"
        } ${captionNearTop ? "top-[52%]" : "top-[26%]"}`}
      >
        <span className="font-mono text-sm font-bold">${t.symbol}</span>
        <span className="num font-mono text-xl font-bold">
          {fmtPrice(quote.price)}
        </span>
        <span
          className="num font-mono text-xs font-semibold"
          style={{ color }}
        >
          {up ? "▲" : "▼"}
          {fmtPct(quote.dayChange)}
        </span>
      </Link>
    </div>
  );
}

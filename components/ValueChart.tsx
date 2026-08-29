import type { PortfolioSnapshot } from "@/lib/types";
import { STARTING_CASH } from "@/lib/config";
import { fmtMoney } from "@/lib/format";

/**
 * Portfolio value over time — server-rendered SVG with the $10,000 starting
 * stake drawn as a baseline so above/below reads at a glance.
 */
export default function ValueChart({
  history,
  liveValue,
}: {
  history: PortfolioSnapshot[];
  liveValue: number;
}) {
  const values = [...history.map((h) => Number(h.total_value)), liveValue];
  if (values.length < 2) {
    return (
      <div className="panel flex h-32 items-center justify-center text-xs text-terminal-muted">
        Your value chart starts after tonight&apos;s snapshot — every player is
        recorded daily.
      </div>
    );
  }

  const W = 720;
  const H = 150;
  const pad = 8;
  const padL = 56;
  const min = Math.min(...values, STARTING_CASH) * 0.99;
  const max = Math.max(...values, STARTING_CASH) * 1.01;
  const x = (i: number) =>
    padL + (i / (values.length - 1)) * (W - padL - pad);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (H - pad * 2);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= STARTING_CASH;
  const color = up ? "#22c55e" : "#f43f5e";

  return (
    <div className="panel p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Portfolio value history">
        <line
          x1={padL}
          x2={W - pad}
          y1={y(STARTING_CASH)}
          y2={y(STARTING_CASH)}
          stroke="#8494ab"
          strokeWidth="1"
          strokeDasharray="3 4"
          opacity="0.6"
        />
        <text x={padL - 6} y={y(STARTING_CASH) + 3} textAnchor="end" fill="#8494ab" fontSize="10" fontFamily="monospace">
          $10k
        </text>
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill={color} />
        <text x={W - pad} y={y(values[values.length - 1]) - 8} textAnchor="end" fill={color} fontSize="11" fontFamily="monospace">
          {fmtMoney(values[values.length - 1])}
        </text>
      </svg>
    </div>
  );
}

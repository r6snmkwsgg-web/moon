import type { MrrUpdate, PriceSnapshot } from "@/lib/types";
import { fmtCompact, fmtMonth, fmtPrice } from "@/lib/format";

/**
 * The big ticker-page chart: daily price line with the monthly MRR series
 * overlaid as step markers (separate scale, right axis). Pure SVG so it
 * server-renders fast and screenshots crisply — the chart IS the share bait.
 */
export default function PriceChart({
  snapshots,
  mrrHistory,
  livePrice,
}: {
  snapshots: PriceSnapshot[];
  mrrHistory: MrrUpdate[];
  livePrice: number;
}) {
  const W = 720;
  const H = 260;
  const padL = 44;
  const padR = 52;
  const padT = 14;
  const padB = 26;

  const prices = [...snapshots.map((s) => Number(s.price)), livePrice];
  if (prices.length < 2) {
    return (
      <div className="panel flex h-48 items-center justify-center text-sm text-terminal-muted">
        Chart appears after the first daily snapshot.
      </div>
    );
  }

  const days = [...snapshots.map((s) => s.day), new Date().toISOString().slice(0, 10)];
  const t0 = new Date(days[0]).getTime();
  const t1 = new Date(days[days.length - 1]).getTime() || t0 + 1;
  const span = t1 - t0 || 1;

  const pMin = Math.min(...prices) * 0.95;
  const pMax = Math.max(...prices) * 1.05 || 1;

  const x = (day: string) =>
    padL + ((new Date(day).getTime() - t0) / span) * (W - padL - padR);
  const yPrice = (p: number) =>
    padT + (1 - (p - pMin) / (pMax - pMin || 1)) * (H - padT - padB);

  const pricePts = days
    .map((d, i) => `${x(d).toFixed(1)},${yPrice(prices[i]).toFixed(1)}`)
    .join(" ");

  // MRR overlay on its own scale (right axis), only points inside the window.
  const mrrInWindow = mrrHistory.filter(
    (m) => new Date(m.month).getTime() >= t0 - 32 * 86400_000
  );
  const mrrVals = mrrInWindow.map((m) => Number(m.mrr));
  const mMax = Math.max(...mrrVals, 1) * 1.15;
  const yMrr = (v: number) => padT + (1 - v / mMax) * (H - padT - padB);

  const up = prices[prices.length - 1] >= prices[0];
  const lineColor = up ? "#22c55e" : "#f43f5e";
  const gridYs = [0.25, 0.5, 0.75].map(
    (f) => padT + f * (H - padT - padB)
  );

  return (
    <div className="panel overflow-x-auto p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[480px]"
        role="img"
        aria-label="Price history with MRR overlay"
      >
        {gridYs.map((gy) => (
          <line
            key={gy}
            x1={padL}
            x2={W - padR}
            y1={gy}
            y2={gy}
            stroke="#1c2533"
            strokeDasharray="3 5"
          />
        ))}

        {/* MRR overlay: amber steps + dots */}
        {mrrInWindow.map((m, i) => {
          const mx = Math.max(x(m.month), padL);
          const nextX =
            i < mrrInWindow.length - 1
              ? Math.max(x(mrrInWindow[i + 1].month), padL)
              : W - padR;
          const my = yMrr(Number(m.mrr));
          return (
            <g key={m.id}>
              <line
                x1={mx}
                x2={nextX}
                y1={my}
                y2={my}
                stroke="#fbbf24"
                strokeWidth="1.5"
                opacity="0.55"
              />
              <circle cx={mx} cy={my} r="3" fill="#fbbf24" opacity="0.9" />
            </g>
          );
        })}

        {/* price line */}
        <polyline
          points={pricePts}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={x(days[days.length - 1])}
          cy={yPrice(livePrice)}
          r="3.5"
          fill={lineColor}
        />

        {/* axes labels */}
        <text x={padL - 6} y={yPrice(pMax) + 10} textAnchor="end" fill="#8b98ab" fontSize="10" fontFamily="monospace">
          {fmtPrice(pMax)}
        </text>
        <text x={padL - 6} y={yPrice(pMin) - 2} textAnchor="end" fill="#8b98ab" fontSize="10" fontFamily="monospace">
          {fmtPrice(pMin)}
        </text>
        {mrrVals.length > 0 && (
          <text x={W - padR + 6} y={yMrr(mMax / 1.15) + 4} fill="#fbbf24" fontSize="10" fontFamily="monospace">
            {fmtCompact(mMax / 1.15)}
          </text>
        )}
        <text x={padL} y={H - 8} fill="#8b98ab" fontSize="10" fontFamily="monospace">
          {fmtMonth(days[0])}
        </text>
        <text x={W - padR} y={H - 8} textAnchor="end" fill="#8b98ab" fontSize="10" fontFamily="monospace">
          now
        </text>
      </svg>
      <div className="mt-1 flex gap-4 px-1 text-[11px] text-terminal-muted">
        <span>
          <span style={{ color: lineColor }}>▬</span> price (play money)
        </span>
        <span>
          <span className="text-terminal-amber">▬</span> MRR (right scale)
        </span>
      </div>
    </div>
  );
}

"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { MrrUpdate, PriceSnapshot } from "@/lib/types";
import { fairPrice } from "@/lib/pricing";
import { fmtMonth, fmtPrice } from "@/lib/format";

/**
 * The big ticker-page chart: daily price line over its fair-value anchor
 * (3× MRR / float — same units, ONE axis), with an area fill and a crosshair
 * tooltip. Pure SVG; this chart is the thing founders screenshot.
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
  const gradId = useId().replace(/[:]/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 280;
  const padL = 48;
  const padR = 16;
  const padT = 14;
  const padB = 26;

  const data = useMemo(() => {
    const latestMrr = mrrHistory.length
      ? Number(mrrHistory[mrrHistory.length - 1].mrr)
      : 0;
    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      ...snapshots.map((s) => ({
        day: s.day,
        price: Number(s.price),
        fair: Number(s.fair_price),
      })),
    ];
    if (rows.length === 0 || rows[rows.length - 1].day !== today) {
      rows.push({ day: today, price: livePrice, fair: fairPrice(latestMrr) });
    } else {
      rows[rows.length - 1] = {
        day: today,
        price: livePrice,
        fair: fairPrice(latestMrr),
      };
    }
    return rows;
  }, [snapshots, mrrHistory, livePrice]);

  if (data.length < 2) {
    return (
      <div className="panel flex h-52 items-center justify-center text-sm text-terminal-muted">
        Chart appears after the first daily snapshot.
      </div>
    );
  }

  const t0 = new Date(data[0].day).getTime();
  const t1 = new Date(data[data.length - 1].day).getTime() || t0 + 1;
  const span = t1 - t0 || 1;

  const values = data.flatMap((d) => [d.price, d.fair]).filter((v) => v > 0);
  const vMin = Math.min(...values) * 0.94;
  const vMax = Math.max(...values) * 1.06 || 1;

  const x = (day: string) =>
    padL + ((new Date(day).getTime() - t0) / span) * (W - padL - padR);
  const y = (v: number) =>
    padT + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - padT - padB);

  const xs = data.map((d) => x(d.day));
  const pricePts = data
    .map((d, i) => `${xs[i].toFixed(1)},${y(d.price).toFixed(1)}`)
    .join(" ");
  const fairPts = data
    .map((d, i) => `${xs[i].toFixed(1)},${y(d.fair).toFixed(1)}`)
    .join(" ");
  const areaPts = `${pricePts} ${xs[xs.length - 1].toFixed(1)},${(H - padB).toFixed(1)} ${xs[0].toFixed(1)},${(H - padB).toFixed(1)}`;

  const up = data[data.length - 1].price >= data[0].price;
  const lineColor = up ? "#22c55e" : "#f43f5e";
  const gridYs = [0.25, 0.5, 0.75].map((f) => padT + f * (H - padT - padB));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    }
    setHover(best);
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className="panel p-3">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label="Price history with fair-value anchor"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridYs.map((gy) => (
            <line
              key={gy}
              x1={padL}
              x2={W - padR}
              y1={gy}
              y2={gy}
              stroke="#182236"
              strokeDasharray="3 5"
            />
          ))}

          <polygon points={areaPts} fill={`url(#area-${gradId})`} />

          {/* fair-value anchor: same dollar scale as price */}
          <polyline
            points={fairPts}
            fill="none"
            stroke="#fbbf24"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            opacity="0.75"
          />

          <polyline
            points={pricePts}
            fill="none"
            stroke={lineColor}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={xs[xs.length - 1]}
            cy={y(data[data.length - 1].price)}
            r="3.5"
            fill={lineColor}
          />

          {/* crosshair */}
          {hover !== null && (
            <g>
              <line
                x1={xs[hover]}
                x2={xs[hover]}
                y1={padT}
                y2={H - padB}
                stroke="#8494ab"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <circle
                cx={xs[hover]}
                cy={y(data[hover].price)}
                r="4"
                fill={lineColor}
                stroke="#070b12"
                strokeWidth="2"
              />
              <circle
                cx={xs[hover]}
                cy={y(data[hover].fair)}
                r="3"
                fill="#fbbf24"
                stroke="#070b12"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* axis labels */}
          <text x={padL - 6} y={padT + 10} textAnchor="end" fill="#8494ab" fontSize="10" fontFamily="monospace">
            {fmtPrice(vMax)}
          </text>
          <text x={padL - 6} y={H - padB} textAnchor="end" fill="#8494ab" fontSize="10" fontFamily="monospace">
            {fmtPrice(vMin)}
          </text>
          <text x={padL} y={H - 8} fill="#8494ab" fontSize="10" fontFamily="monospace">
            {fmtMonth(data[0].day)}
          </text>
          <text x={W - padR} y={H - 8} textAnchor="end" fill="#8494ab" fontSize="10" fontFamily="monospace">
            now
          </text>
        </svg>

        {h && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-terminal-line bg-terminal-bg/95 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed shadow-lg"
            style={{
              left: `${Math.min(Math.max((xs[hover!] / W) * 100, 12), 88)}%`,
            }}
          >
            <div className="text-terminal-muted">{h.day}</div>
            <div className="num text-terminal-text">
              price {fmtPrice(h.price)}
            </div>
            <div className="num text-terminal-amber">
              fair {fmtPrice(h.fair)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-4 px-1 text-[11px] text-terminal-muted">
        <span>
          <span style={{ color: lineColor }}>▬</span> price (play money)
        </span>
        <span>
          <span className="text-terminal-amber">▬</span> fair value · 3× MRR ÷
          10k shares
        </span>
      </div>
    </div>
  );
}

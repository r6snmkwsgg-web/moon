"use client";

import { useState } from "react";
import {
  fairPrice,
  livePrice,
  marketCap,
  SHARES_OUTSTANDING,
} from "@/lib/pricing";
import { fmtCompact, fmtPrice } from "@/lib/format";

/** Live playground running the REAL lib/pricing.ts — not a copy of it. */
export default function PricingPlayground() {
  const [mrr, setMrr] = useState(10_000);
  const [sentiment, setSentiment] = useState(0.15);

  return (
    <div className="panel space-y-4 p-4">
      <div className="microlabel">Try it — this runs the real formula</div>
      <label className="block text-xs text-terminal-muted">
        MRR: <span className="num font-mono text-terminal-amber">{fmtCompact(mrr)}</span>
        <input
          type="range"
          min={500}
          max={100_000}
          step={500}
          value={mrr}
          onChange={(e) => setMrr(Number(e.target.value))}
          className="mt-1 w-full accent-[#fbbf24]"
        />
      </label>
      <label className="block text-xs text-terminal-muted">
        Hype (sentiment):{" "}
        <span
          className={`num font-mono ${sentiment >= 0 ? "text-terminal-up" : "text-terminal-down"}`}
        >
          {((Math.exp(sentiment) - 1) * 100).toFixed(0)}%
        </span>
        <input
          type="range"
          min={-1.2}
          max={1.2}
          step={0.01}
          value={sentiment}
          onChange={(e) => setSentiment(Number(e.target.value))}
          className="mt-1 w-full accent-[#22c55e]"
        />
      </label>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-terminal-amber/30 bg-terminal-amber/5 px-2 py-2">
          <div className="microlabel">Fair value</div>
          <div className="num mt-0.5 font-mono text-sm font-semibold text-terminal-amber">
            {fmtPrice(fairPrice(mrr))}
          </div>
        </div>
        <div className="rounded-md border border-terminal-up/30 bg-terminal-up/5 px-2 py-2">
          <div className="microlabel">Live price</div>
          <div className="num mt-0.5 font-mono text-sm font-semibold text-terminal-up">
            {fmtPrice(livePrice(mrr, sentiment))}
          </div>
        </div>
        <div className="rounded-md border border-terminal-line px-2 py-2">
          <div className="microlabel">Mkt cap</div>
          <div className="num mt-0.5 font-mono text-sm font-semibold">
            {fmtCompact(marketCap(mrr, sentiment))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-terminal-muted">
        fair = (MRR × 12 × multiple) ÷ this ticker&apos;s{" "}
        {SHARES_OUTSTANDING.toLocaleString("en-US")}-share float · live = fair
        × (1 + hype) · hype decays 10% toward zero nightly
      </p>
    </div>
  );
}

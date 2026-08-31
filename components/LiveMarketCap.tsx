"use client";

import { useEffect, useMemo, useState } from "react";
import { makePriceAt } from "@/lib/candles";
import { fmtCompact } from "@/lib/format";
import type { ChartPoint } from "@/lib/types";
import type { RevenueEvent } from "@/lib/pricing";

/**
 * Market cap is price × float, so a server-rendered one goes stale exactly
 * as the headline price did — and sitting a few inches apart, the two
 * disagreeing is obvious. It runs its own second-clock rather than sharing
 * the header's: cap is shown to the nearest $100, which is far coarser than
 * a tick, so being a beat out of phase can never show.
 */
export default function LiveMarketCap({
  symbol,
  mrr,
  sentiment,
  series,
  multiple,
  shares,
  events,
  drift,
  renderedAt,
}: {
  symbol: string;
  mrr: number;
  sentiment: number;
  series: ChartPoint[];
  multiple: number;
  shares: number;
  events: RevenueEvent[];
  /** The recorded weather, handed over because it cannot be derived. */
  drift: number;
  renderedAt: number;
}) {
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  const priceAt = useMemo(
    () =>
      makePriceAt(symbol, mrr, sentiment, series, multiple, shares, events, drift),
    [symbol, mrr, sentiment, series, multiple, shares, events, drift]
  );

  return <>{fmtCompact(priceAt(now) * shares)}</>;
}

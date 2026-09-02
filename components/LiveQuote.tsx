"use client";

import { useEffect, useMemo, useState } from "react";
import { makePriceAt } from "@/lib/candles";
import { fmtCompact, fmtPrice } from "@/lib/format";
import type { ChartPoint } from "@/lib/types";
import type { RevenueEvent } from "@/lib/pricing";
import ChangePct from "@/components/ChangePct";
import { useLiveSentiment } from "@/lib/live";

/**
 * The headline price, on the chart's clock.
 *
 * It used to render a server value that only moved when LiveRefresh re-fetched
 * the page every 15 seconds, while the chart under it recomputed every second
 * from the same function. Same formula, different instant — so the two numbers
 * on one screen disagreed by however far the price had drifted since the last
 * refresh, and the header looked frozen.
 *
 * Now both read makePriceAt on the same tick, so they cannot disagree.
 */
export default function LiveQuote({
  symbol,
  mrr,
  sentiment: sentimentProp,
  series,
  multiple,
  shares,
  events,
  drift,
  dayBasePrice,
  renderedAt,
}: {
  symbol: string;
  mrr: number;
  sentiment: number;
  series: ChartPoint[];
  multiple: number;
  shares: number;
  events: RevenueEvent[];
  /** The recorded weather. The client cannot derive it — it is a draw, not a
   *  function of the clock — so the server hands it over. */
  drift: number;
  dayBasePrice: number;
  /** The server's instant, so the first client render matches it exactly. */
  renderedAt: number;
}) {
  const [now, setNow] = useState(renderedAt);
  // your own fill moves this number the moment it comes back
  const sentiment = useLiveSentiment(symbol, sentimentProp);

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

  const price = priceAt(now);
  const change = dayBasePrice > 0 ? (price - dayBasePrice) / dayBasePrice : 0;

  return (
    <>
      <div className="num font-mono text-2xl font-bold">{fmtPrice(price)}</div>
      <ChangePct value={change} chip className="text-sm" />
      <span className="sr-only">
        Market cap {fmtCompact(price * shares)}
      </span>
    </>
  );
}

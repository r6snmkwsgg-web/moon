import Link from "next/link";
import { getMarket } from "@/lib/data";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { TickerQuote } from "@/lib/types";

function TapeItem({ quote, dup }: { quote: TickerQuote; dup?: boolean }) {
  const up = quote.dayChange > 0.0005;
  const down = quote.dayChange < -0.0005;
  return (
    <Link
      href={`/t/${quote.ticker.symbol}`}
      tabIndex={dup ? -1 : undefined}
      className="flex shrink-0 items-baseline gap-1.5 px-4 font-mono text-[11px] hover:bg-terminal-raise"
    >
      <span className="font-bold text-terminal-text">
        ${quote.ticker.symbol}
      </span>
      <span className="num text-terminal-muted">{fmtPrice(quote.price)}</span>
      <span
        className={`num ${
          up
            ? "text-terminal-up"
            : down
              ? "text-terminal-down"
              : "text-terminal-muted"
        }`}
      >
        {up ? "▲" : down ? "▼" : "·"} {fmtPct(quote.dayChange)}
      </span>
    </Link>
  );
}

/**
 * The scrolling tape under the nav — every listed ticker with live price and
 * 24h change, on an infinite CSS marquee. The content is rendered twice so the
 * -50% translate loops seamlessly; pauses on hover, static for reduced motion.
 */
export default async function TickerTape() {
  const market = await getMarket();
  if (market.length === 0) return null;

  return (
    <div
      className="overflow-hidden border-b border-terminal-line bg-terminal-panel/60"
      aria-hidden="true"
    >
      <div className="tape-track flex py-1.5">
        {market.map((q) => (
          <TapeItem key={q.ticker.id} quote={q} />
        ))}
        {market.map((q) => (
          <TapeItem key={`${q.ticker.id}-dup`} quote={q} dup />
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { getMarket } from "@/lib/data";
import { fmtCompact, fmtPrice } from "@/lib/format";
import { APP_TAGLINE } from "@/lib/config";
import Sparkline from "@/components/Sparkline";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import type { TickerQuote } from "@/lib/types";

export const dynamic = "force-dynamic";

function MoverCard({ quote }: { quote: TickerQuote }) {
  return (
    <Link
      href={`/t/${quote.ticker.symbol}`}
      className="panel flex min-w-[136px] flex-col gap-1 px-3 py-2 hover:border-terminal-muted"
    >
      <span className="font-mono text-xs font-bold text-terminal-text">
        ${quote.ticker.symbol}
      </span>
      <span className="num font-mono text-sm">{fmtPrice(quote.price)}</span>
      <ChangePct value={quote.dayChange} className="text-xs" />
    </Link>
  );
}

export default async function ExchangePage() {
  const market = await getMarket();
  const movers = [...market]
    .filter((q) => q.spark.length > 2)
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg font-bold tracking-wide">
          The Exchange
        </h1>
        <p className="text-sm text-terminal-muted">{APP_TAGLINE}</p>
      </div>

      {movers.length > 0 && (
        <section aria-label="Top movers">
          <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-terminal-muted">
            Top movers · 24h
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {movers.map((q) => (
              <MoverCard key={q.ticker.id} quote={q} />
            ))}
          </div>
        </section>
      )}

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-terminal-line text-left font-mono text-[11px] uppercase tracking-wider text-terminal-muted">
              <th className="px-3 py-2.5">Ticker</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5 text-right">24h</th>
              <th className="hidden px-3 py-2.5 text-right sm:table-cell">7d</th>
              <th className="hidden px-3 py-2.5 text-right sm:table-cell">MRR</th>
              <th className="px-3 py-2.5 text-right">Mkt cap</th>
              <th className="px-3 py-2.5 text-right">30d</th>
            </tr>
          </thead>
          <tbody>
            {market.map((q) => (
              <tr
                key={q.ticker.id}
                className="border-b border-terminal-line/50 last:border-0 hover:bg-terminal-bg/60"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/t/${q.ticker.symbol}`}
                    className="flex items-center gap-2.5"
                  >
                    <LogoTile
                      symbol={q.ticker.symbol}
                      logoUrl={q.ticker.logo_url}
                      size={30}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-mono font-bold">
                        ${q.ticker.symbol}
                        {q.ticker.claimed && (
                          <span
                            title="Claimed by founder"
                            className="rounded bg-terminal-accent/15 px-1 text-[10px] font-semibold text-terminal-accent"
                          >
                            ✓
                          </span>
                        )}
                      </span>
                      <span className="block max-w-[140px] truncate text-xs text-terminal-muted sm:max-w-[200px]">
                        {q.ticker.name}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="num px-3 py-2.5 text-right font-mono">
                  {fmtPrice(q.price)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <ChangePct value={q.dayChange} className="text-xs" />
                </td>
                <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                  <ChangePct value={q.weekChange} className="text-xs" />
                </td>
                <td className="num hidden px-3 py-2.5 text-right font-mono text-terminal-amber sm:table-cell">
                  {fmtCompact(q.latestMrr)}
                </td>
                <td className="num px-3 py-2.5 text-right font-mono text-terminal-muted">
                  {fmtCompact(q.marketCap)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end">
                    <Sparkline values={q.spark} up={q.weekChange >= 0} />
                  </div>
                </td>
              </tr>
            ))}
            {market.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-10 text-center text-terminal-muted"
                >
                  No tickers listed yet. Run <code>npm run seed</code> to load
                  the fixtures.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

import Link from "next/link";
import { getMarket } from "@/lib/data";
import { fmtCompact, fmtPrice } from "@/lib/format";
import { APP_TAGLINE } from "@/lib/config";
import Sparkline from "@/components/Sparkline";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import TickerBadges from "@/components/TickerBadges";
import type { TickerQuote } from "@/lib/types";

export const dynamic = "force-dynamic";

const IPO_WINDOW_MS = 24 * 3600_000;

function MoverCard({ quote }: { quote: TickerQuote }) {
  const up = quote.dayChange >= 0;
  return (
    <Link
      href={`/t/${quote.ticker.symbol}`}
      className={`panel flex min-w-[150px] flex-col gap-1 px-3 py-2.5 transition-colors hover:bg-terminal-raise ${
        up ? "border-terminal-up/25" : "border-terminal-down/25"
      }`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-bold text-terminal-text">
          ${quote.ticker.symbol}
        </span>
        <ChangePct value={quote.dayChange} chip />
      </span>
      <span className="num font-mono text-base font-semibold">
        {fmtPrice(quote.price)}
      </span>
      <Sparkline
        values={quote.spark.slice(-14)}
        width={120}
        height={22}
        up={up}
        stretch
      />
    </Link>
  );
}

export default async function ExchangePage() {
  const market = await getMarket();
  const movers = [...market]
    .filter((q) => q.spark.length > 2)
    .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange))
    .slice(0, 4);

  const freshIpos = market.filter(
    (q) =>
      !q.ticker.fixture &&
      Date.now() - new Date(q.ticker.listed_at).getTime() < IPO_WINDOW_MS
  );

  return (
    <div className="space-y-6">
      {freshIpos.map((q) => (
        <Link
          key={q.ticker.id}
          href={`/t/${q.ticker.symbol}`}
          className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 border-terminal-up/40 bg-terminal-up/10 px-4 py-2.5 hover:bg-terminal-up/15"
        >
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            🔔 New listing
          </span>
          <span className="font-mono font-bold">${q.ticker.symbol}</span>
          <span className="min-w-0 truncate text-sm text-terminal-muted">
            {q.ticker.name} — {q.ticker.pitch}
          </span>
          <span className="num ml-auto font-mono text-sm">
            {fmtPrice(q.price)}
          </span>
        </Link>
      ))}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-wide">
            The Exchange
          </h1>
          <p className="text-sm text-terminal-muted">{APP_TAGLINE}</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="microlabel">
            {market.length} listed ·{" "}
            {fmtCompact(market.reduce((s, q) => s + q.marketCap, 0))}{" "}
            play-money cap
          </p>
          <Link
            href="/list"
            className="whitespace-nowrap rounded-md border border-terminal-amber/50 bg-terminal-amber/10 px-2.5 py-1 text-xs font-semibold text-terminal-amber hover:bg-terminal-amber/20"
          >
            ⚡ List your startup
          </Link>
        </div>
      </div>

      {movers.length > 0 && (
        <section aria-label="Top movers">
          <h2 className="microlabel mb-2">Top movers · 24h</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {movers.map((q) => (
              <MoverCard key={q.ticker.id} quote={q} />
            ))}
          </div>
        </section>
      )}

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[600px] text-[13px]">
          <thead>
            <tr className="border-b border-terminal-line text-left">
              {["Ticker", "Price", "24h", "7d", "MRR", "Mkt cap", "30d"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`microlabel px-3 py-2.5 font-normal ${
                      i === 0 ? "" : "text-right"
                    } ${i === 3 || i === 4 ? "hidden sm:table-cell" : ""}`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {market.map((q) => (
              <tr
                key={q.ticker.id}
                className="border-b border-terminal-line/40 transition-colors last:border-0 hover:bg-terminal-raise/60"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/t/${q.ticker.symbol}`}
                    className="flex items-center gap-2.5"
                  >
                    <LogoTile
                      symbol={q.ticker.symbol}
                      logoUrl={q.ticker.logo_url}
                      size={28}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-mono font-bold">
                        ${q.ticker.symbol}
                        <TickerBadges ticker={q.ticker} compact />
                      </span>
                      <span className="block max-w-[150px] truncate text-xs text-terminal-muted sm:max-w-[210px]">
                        {q.ticker.name}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="num px-3 py-2 text-right font-mono font-semibold">
                  {fmtPrice(q.price)}
                </td>
                <td className="px-3 py-2 text-right">
                  <ChangePct value={q.dayChange} chip />
                </td>
                <td className="hidden px-3 py-2 text-right sm:table-cell">
                  <ChangePct value={q.weekChange} className="text-xs" />
                </td>
                <td className="num hidden px-3 py-2 text-right font-mono text-terminal-amber sm:table-cell">
                  {fmtCompact(q.latestMrr)}
                </td>
                <td className="num px-3 py-2 text-right font-mono text-terminal-muted">
                  {fmtCompact(q.marketCap)}
                </td>
                <td className="px-3 py-2">
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

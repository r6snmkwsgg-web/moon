import Link from "next/link";
import {
  getFeedEvents,
  getMarket,
  getTrending,
  type FeedFilter,
} from "@/lib/data";
import { Bell, ChartNoAxesColumn, Zap } from "lucide-react";
import { changeFraction } from "@/lib/pricing";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import ChangePct from "@/components/ChangePct";
import TickerBadges from "@/components/TickerBadges";

export const dynamic = "force-dynamic";

export const metadata = { title: "The Feed" };

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All activity" },
  { key: "trades", label: "Trades" },
  { key: "earnings", label: "Earnings" },
  { key: "listings", label: "Listings" },
];

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: filterParam } = await searchParams;
  const filter: FeedFilter =
    filterParam === "trades" || filterParam === "earnings" || filterParam === "listings"
      ? filterParam
      : "all";

  const market = await getMarket();
  const [events, trending] = await Promise.all([
    getFeedEvents(market, filter),
    getTrending(market, 5),
  ]);
  const bySymbol = new Map(market.map((q) => [q.ticker.symbol, q]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-mono text-lg font-bold">The Feed</h1>
        <p className="text-sm text-terminal-muted">
          Everything happening on the exchange — trades, earnings, IPOs — as it
          happens.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/tape" : `/tape?filter=${f.key}`}
            className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold ${
              filter === f.key
                ? "border-terminal-up/60 bg-terminal-up/10 text-terminal-up"
                : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* the feed */}
        <section className="flex flex-col gap-2.5">
          {events.map((e, i) => {
            if (e.kind === "trade") {
              const t = e.trade;
              return (
                <div
                  key={`t-${t.id}`}
                  className="panel flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm"
                >
                  <span
                    className={`font-mono text-[11px] font-bold uppercase ${
                      t.side === "buy" ? "text-terminal-up" : "text-terminal-down"
                    }`}
                  >
                    {t.side}
                  </span>
                  {t.username ? (
                    <Link
                      href={`/u/${t.username}`}
                      className="font-mono font-semibold hover:text-terminal-accent"
                    >
                      {t.trader}
                    </Link>
                  ) : (
                    <span className="font-mono font-semibold">{t.trader}</span>
                  )}
                  <span className="text-terminal-muted">
                    {t.side === "buy" ? "bought" : "sold"}
                  </span>
                  <span className="num font-mono">
                    {t.shares.toLocaleString("en-US")}
                  </span>
                  <Link
                    href={`/t/${t.symbol}`}
                    className="font-mono font-bold hover:text-terminal-accent"
                  >
                    ${t.symbol}
                  </Link>
                  <span className="text-terminal-muted">@</span>
                  <span className="num font-mono">{fmtPrice(t.price)}</span>
                  <span className="ml-auto font-mono text-[11px] text-terminal-muted">
                    {timeAgo(t.created_at)}
                  </span>
                </div>
              );
            }
            if (e.kind === "earnings") {
              const ev = e.earnings;
              const mom =
                ev.prevMrr && ev.prevMrr > 0
                  ? changeFraction(ev.prevMrr, ev.mrr)
                  : null;
              const quote = bySymbol.get(ev.symbol);
              return (
                <div
                  key={`e-${i}`}
                  className="panel space-y-1.5 border-terminal-amber/25 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="self-center text-terminal-amber">
                      {ev.source === "stripe" ? (
                        <Zap size={13} fill="currentColor" strokeWidth={0} />
                      ) : (
                        <ChartNoAxesColumn size={13} />
                      )}
                    </span>
                    <Link
                      href={`/t/${ev.symbol}`}
                      className="font-mono font-bold hover:text-terminal-accent"
                    >
                      ${ev.symbol}
                    </Link>
                    <span className="text-terminal-muted">reported</span>
                    <span className="num font-mono font-bold text-terminal-amber">
                      {fmtCompact(ev.mrr)} MRR
                    </span>
                    {mom !== null && (
                      <span
                        className={`num font-mono font-semibold ${
                          mom >= 0 ? "text-terminal-up" : "text-terminal-down"
                        }`}
                      >
                        {fmtPct(mom)} MoM {mom >= 0 ? "beat" : "miss"}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-terminal-muted">
                      {timeAgo(ev.at)}
                    </span>
                  </div>
                  <div className="text-[11px] text-terminal-muted">
                    {ev.source === "stripe"
                      ? "Computed from active Stripe subscriptions — the anchor repriced instantly."
                      : ev.source === "self-reported"
                        ? "Self-reported by the founder (honor system)."
                        : "Curated from public build-in-public posts."}
                    {quote && (
                      <>
                        {" "}
                        Stock today: <ChangePct value={quote.dayChange} className="text-[11px]" />
                      </>
                    )}
                  </div>
                </div>
              );
            }
            const q = e.quote;
            return (
              <Link
                key={`l-${q.ticker.id}`}
                href={`/t/${q.ticker.symbol}`}
                className="panel flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-terminal-up/25 px-4 py-3 text-sm hover:bg-terminal-raise"
              >
                <span className="flex items-center gap-1 self-center font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
                  <Bell size={11} />
                  IPO
                </span>
                <span className="font-mono font-bold">${q.ticker.symbol}</span>
                <TickerBadges ticker={q.ticker} compact />
                <span className="min-w-0 truncate text-terminal-muted">
                  {q.ticker.name} — {q.ticker.pitch}
                </span>
                <span className="ml-auto font-mono text-[11px] text-terminal-muted">
                  {timeAgo(e.at)}
                </span>
              </Link>
            );
          })}
          {events.length === 0 && (
            <div className="panel px-4 py-10 text-center text-sm text-terminal-muted">
              Nothing here yet — the feed fills up as the market moves.
            </div>
          )}
        </section>

        {/* trending rail */}
        <div className="flex flex-col gap-4 self-start">
          <section className="panel">
            <div className="border-b border-terminal-line px-3 py-2">
              <span className="microlabel font-bold text-terminal-text">
                Trending now
              </span>
            </div>
            <ul className="divide-y divide-terminal-line/40">
              {trending.map((row, i) => (
                <li key={row.quote.ticker.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="font-mono text-xs font-bold text-terminal-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/t/${row.quote.ticker.symbol}`}
                      className="font-mono text-[13px] font-bold hover:text-terminal-accent"
                    >
                      ${row.quote.ticker.symbol}
                    </Link>
                    <div className="text-[10.5px] text-terminal-muted">
                      {row.trades24h} trade{row.trades24h === 1 ? "" : "s"} · 24h
                      {row.votes > 0 && ` · ${row.votes} votes`}
                    </div>
                  </div>
                  <span className="ml-auto">
                    <ChangePct value={row.quote.dayChange} chip />
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <p className="px-1 text-[11px] leading-relaxed text-terminal-muted">
            The feed shows real activity only — every print is a real
            play-money trade, every report a real MRR update.
          </p>
        </div>
      </div>
    </div>
  );
}

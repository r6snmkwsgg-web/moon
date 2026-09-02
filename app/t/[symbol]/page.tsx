import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getFollowedIds,
  getHolders,
  getRecentTrades,
  getTickerPage,
  getTickerPosts,
  getVoteGauge,
  tickerExists,
} from "@/lib/data";
import { getUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { fmtCompact, fmtMonth, currentMonthISO } from "@/lib/format";
import { APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { changeFraction } from "@/lib/pricing";
import { openingTimeframe } from "@/lib/candles";
import { realizedPnl } from "@/lib/equity";
import { nextEarningsDate } from "@/lib/xp";
import { Bell, BadgeCheck, Eye, Zap } from "lucide-react";
import PulseKeeper from "@/components/PulseKeeper";
import Discussion from "@/components/Discussion";
import TradingChart from "@/components/TradingChart";
import ThesisFeed from "@/components/ThesisFeed";
import HoldersTable from "@/components/HoldersTable";
import LiveQuote from "@/components/LiveQuote";
import TradePanel, { type OwnPrint } from "@/components/TradePanel";
import AboutCard from "@/components/AboutCard";
import ShareButton from "@/components/ShareButton";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import TickerBadges from "@/components/TickerBadges";
import WatchStar from "@/components/WatchStar";
import VoteBar from "@/components/VoteBar";
import TradesList from "@/components/TradesList";
import {
  connectStripe,
  disconnectStripe,
  requestDelisting,
  submitHandleProof,
  submitMrr,
  updateLogo,
} from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ ipo?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  // Metadata resolves BEFORE the body streams, so this is the last place a
  // 404 status can still be set. Without the check here the page rendered
  // the not-found screen under a 200 and a real-looking "$NOPE" title, and
  // crawlers would happily index every mistyped ticker as a live company.
  if (!(await tickerExists(sym))) notFound();
  return {
    title: `$${sym}`,
    description: `$${sym} on ${APP_NAME} — a fantasy stock market for indie SaaS. ${GUARDRAIL_TEXT}`,
  };
}

function nextReportLabel(latestMonth: string): string {
  const d = new Date(latestMonth);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export default async function TickerPage({ params, searchParams }: Props) {
  const [{ symbol }, { ipo }] = await Promise.all([params, searchParams]);
  const data = await getTickerPage(symbol);
  if (!data) notFound();
  // one instant for every time-dependent number this render produces
  const renderedAt = Date.now();

  const {
    quote,
    mrrHistory,
    holdersCount,
    watchersCount,
    series,
    dayStats,
    floatHeld,
    tradePoints,
    earliest,
    revenueEvents,
  } = data;
  const t = quote.ticker;
  const user = await getUser();
  const isFounder = user !== null && t.claimed_by === user.id;

  const [gauge, recentTrades, posts, theses, holders, followedIds] =
    await Promise.all([
      getVoteGauge(t.id),
      getRecentTrades(10, t.id),
      getTickerPosts(t.id, quote.price),
      getRecentTrades(15, t.id, undefined, true),
      getHolders(t.id, quote.price, quote.shares),
      user ? getFollowedIds(user.id) : Promise.resolve([] as string[]),
    ]);

  // Signed-in extras (own rows only — RLS applies).
  let cash: number | null = null;
  let sharesHeld = 0;
  let avgCost = 0;
  let realized = 0;
  let history: OwnPrint[] = [];
  let delistRequested = false;
  let watching = false;
  let myVote: 1 | -1 | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const [profileRes, holdingRes, myTradesRes, delistRes, watchRes, voteRes] =
      await Promise.all([
        supabase.from("profiles").select("cash").eq("id", user.id).maybeSingle(),
        supabase
          .from("holdings")
          .select("shares, avg_cost")
          .eq("user_id", user.id)
          .eq("ticker_id", t.id)
          .maybeSingle(),
        // every print of mine in this name, for the P&L already booked
        supabase
          .from("trades")
          .select("side, shares, price, total, created_at")
          .eq("user_id", user.id)
          .eq("ticker_id", t.id)
          .order("created_at", { ascending: true })
          .limit(2000),
        isFounder
          ? supabase
              .from("delist_requests")
              .select("id")
              .eq("ticker_id", t.id)
              .eq("user_id", user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("watchlists")
          .select("ticker_id")
          .eq("ticker_id", t.id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("ticker_votes")
          .select("vote")
          .eq("ticker_id", t.id)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
    cash = profileRes.data ? Number(profileRes.data.cash) : null;
    sharesHeld = holdingRes.data ? Number(holdingRes.data.shares) : 0;
    avgCost = holdingRes.data ? Number(holdingRes.data.avg_cost) : 0;
    history = (
      (myTradesRes.data ?? []) as {
        side: "buy" | "sell";
        shares: number;
        price: number;
        total: number;
        created_at: string;
      }[]
    )
      .map((tr) => ({
        side: tr.side,
        shares: Number(tr.shares),
        price: Number(tr.price),
        total: Number(tr.total),
        at: Date.parse(tr.created_at),
      }))
      .reverse();
    realized = realizedPnl(
      (
        (myTradesRes.data ?? []) as {
          side: "buy" | "sell";
          shares: number;
          price: number;
          total: number;
          created_at: string;
        }[]
      ).map((tr) => ({
        t: Date.parse(tr.created_at),
        symbol: t.symbol,
        side: tr.side,
        shares: Number(tr.shares),
        price: Number(tr.price),
        total: Number(tr.total),
        note: null,
      }))
    );
    delistRequested = Boolean(delistRes.data);
    watching = Boolean(watchRes.data);
    myVote = voteRes.data ? (Number(voteRes.data.vote) as 1 | -1) : null;
  }

  const latestUpdate = mrrHistory[mrrHistory.length - 1];
  const prevUpdate = mrrHistory[mrrHistory.length - 2];
  const mom =
    latestUpdate && prevUpdate
      ? changeFraction(Number(prevUpdate.mrr), Number(latestUpdate.mrr))
      : null;
  const shareUrl = `${siteUrl()}/t/${t.symbol}`;

  return (
    <div className="space-y-6">
      {ipo === "1" && (
        <div className="panel flex flex-wrap items-center gap-3 border-terminal-up/40 bg-terminal-up/10 px-4 py-3">
          <span className="flex items-center gap-1.5 font-mono text-sm font-bold text-terminal-up">
            <Bell size={14} />${t.symbol} is live — you just IPO&apos;d.
          </span>
          <span className="text-xs text-terminal-muted">
            Share the chart on X/Threads — the link unfurls into your ticker
            card.
          </span>
          <div className="ml-auto">
            <ShareButton url={shareUrl} />
          </div>
        </div>
      )}

      {/* header */}
      <div className="flex flex-wrap items-start gap-3">
        <LogoTile symbol={t.symbol} logoUrl={t.logo_url} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-bold">
            ${t.symbol}
            <TickerBadges ticker={t} />
            {!t.claimed && (
              <Link
                href={`/claim/${t.symbol}`}
                className="rounded border border-terminal-line px-1.5 py-0.5 text-[11px] font-normal text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
              >
                unclaimed — is this you?
              </Link>
            )}
          </h1>
          <p className="text-sm text-terminal-text">{t.name}</p>
          <p className="text-sm text-terminal-muted">{t.pitch}</p>
          {t.founder_handle && (
            <p className="mt-1 text-xs text-terminal-muted">
              founder:{" "}
              <span className="font-mono text-terminal-accent">
                @{t.founder_handle}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <LiveQuote
            symbol={t.symbol}
            mrr={quote.liveMrr}
            sentiment={Number(t.sentiment)}
            series={series}
            multiple={quote.multiple}
            shares={quote.shares}
            events={revenueEvents}
            drift={quote.drift}
            dayBasePrice={quote.dayBasePrice}
            renderedAt={renderedAt}
          />
          <span className="flex items-center gap-1.5">
            <WatchStar
              tickerId={t.id}
              symbol={t.symbol}
              watching={watching}
              signedIn={user !== null}
            />
            {watchersCount > 0 && (
              <span className="flex items-center gap-1 font-mono text-[11px] text-terminal-muted">
                <Eye size={11} />
                {watchersCount}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* every ticker, not just the Stripe-verified ones: the walk has to be
          advanced for fixtures too, or their tape stops when the cron does */}
      <PulseKeeper symbol={t.symbol} />

      {/* split rail: chart + market data left, a permanent trade rail right */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-4">
          <TradingChart
            symbol={t.symbol}
            mrr={quote.liveMrr}
            sentiment={Number(t.sentiment)}
            series={series}
            fairPrice={quote.fairPrice}
            multiple={quote.multiple}
            shares={quote.shares}
            events={revenueEvents}
            drift={quote.drift}
            trades={tradePoints}
            earliest={earliest}
            initialTimeframe={openingTimeframe(renderedAt - earliest)}
          />

        </div>

        {/* the rail — trading is always in reach */}
        <div className="space-y-3 lg:sticky lg:top-20">
          <TradePanel
            symbol={t.symbol}
            mrr={quote.liveMrr}
            sentiment={Number(t.sentiment)}
            multiple={quote.multiple}
            outstanding={quote.shares}
            events={revenueEvents}
            drift={quote.drift}
            driftAt={t.drift_at ?? null}
            dayBasePrice={quote.dayBasePrice}
            floatHeld={floatHeld}
            quotedAt={renderedAt}
            signedIn={user !== null}
            cash={cash}
            sharesHeld={sharesHeld}
            avgCost={avgCost}
            realized={realized}
            history={history}
          />
          <AboutCard
            ticker={t}
            series={series}
            events={revenueEvents}
            liveMrr={quote.liveMrr}
            sentiment={Number(t.sentiment)}
            multiple={quote.multiple}
            shares={quote.shares}
            drift={quote.drift}
            price={quote.price}
            arr={quote.arr}
            revenueSource={quote.revenueSource}
            latestReport={
              latestUpdate
                ? {
                    month: latestUpdate.month,
                    mrr: Number(latestUpdate.mrr),
                    source: latestUpdate.source,
                  }
                : null
            }
            mom={mom}
            dayStats={dayStats}
            floatHeld={floatHeld}
            holders={holdersCount}
            earliest={earliest}
            renderedAt={renderedAt}
            nextEarningsAt={t.stripe_verified ? nextEarningsDate().toISOString() : null}
          />
          <VoteBar
            tickerId={t.id}
            symbol={t.symbol}
            bulls={gauge.bulls}
            bears={gauge.bears}
            myVote={myVote}
            signedIn={user !== null}
          />
          <section className="panel">
            <div className="flex items-baseline justify-between border-b border-terminal-line px-3 py-2">
              <h2 className="microlabel">Recent trades</h2>
              <Link href="/tape" className="text-[11px] text-terminal-accent">
                full tape →
              </Link>
            </div>
            <TradesList
              trades={recentTrades}
              showSymbol={false}
              signedIn={user !== null}
              showNotes={false}
            />
          </section>
          <ShareButton url={shareUrl} />
        </div>
      </div>

      {/* the social floor — full width, and below the rail on mobile so
          trading is always the first thing you reach */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <HoldersTable
            rows={holders.rows}
            total={holders.total}
            symbol={t.symbol}
            followedIds={followedIds}
            viewerId={user?.id ?? null}
            signedIn={user !== null}
            now={renderedAt}
          />
          <Discussion
            posts={posts}
            tickerId={t.id}
            symbol={t.symbol}
            signedIn={user !== null}
            viewerId={user?.id ?? null}
          />
        </div>
        <ThesisFeed theses={theses} />
      </div>

      {/* founder tools */}
      {isFounder && (
        <section className="panel space-y-4 p-4">
          <h2 className="font-mono text-sm font-bold text-terminal-amber">
            Founder tools
          </h2>

          {t.stripe_verified ? (
            <div className="space-y-2">
              <p className="text-xs text-terminal-muted">
                MRR syncs from Stripe automatically each month — your earnings
                report posts itself. Manual entry is off while connected.
              </p>
              <form action={disconnectStripe}>
                <input type="hidden" name="ticker_id" value={t.id} />
                <button className="text-xs text-terminal-muted underline-offset-2 hover:text-terminal-down hover:underline">
                  Disconnect Stripe (deletes the stored key, removes the
                  verified badge)
                </button>
              </form>
            </div>
          ) : (
            <>
              <form
                action={connectStripe}
                className="space-y-2 rounded-md border border-terminal-amber/30 bg-terminal-amber/5 p-3"
              >
                <input type="hidden" name="ticker_id" value={t.id} />
                <label className="block text-xs font-semibold text-terminal-amber">
                  Verify MRR with Stripe (read-only restricted key)
                  <input
                    name="stripe_key"
                    required
                    placeholder="rk_live_…"
                    autoComplete="off"
                    className="input mt-1.5 font-mono"
                  />
                </label>
                <p className="text-[11px] text-terminal-muted">
                  Stripe → Developers → API keys → Create restricted key →
                  Read on Subscriptions + Invoices, None on everything else.
                  Stored encrypted; only the MRR number is ever public.
                </p>
                <button className="btn-ghost text-xs">
                  <Zap size={12} className="text-terminal-amber" />
                  Verify &amp; connect
                </button>
              </form>

              <form action={submitMrr} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="ticker_id" value={t.id} />
                <label className="text-xs text-terminal-muted">
                  Month
                  <input
                    type="month"
                    name="month"
                    defaultValue={currentMonthISO().slice(0, 7)}
                    required
                    className="input mt-1"
                  />
                </label>
                <label className="text-xs text-terminal-muted">
                  MRR (USD)
                  <input
                    type="number"
                    name="mrr"
                    min={0}
                    step={1}
                    placeholder="12500"
                    required
                    className="input num mt-1 w-32 font-mono"
                  />
                </label>
                <button type="submit" className="btn-ghost">
                  Post MRR update
                </button>
                <p className="w-full text-[11px] text-terminal-muted">
                  Posting reprices ${t.symbol} immediately — labeled
                  “self-reported”.
                </p>
              </form>
            </>
          )}

          {!t.handle_verified && (
            <div className="border-t border-terminal-line pt-3">
              {t.handle_proof_url ? (
                <p className="flex items-center gap-1 text-xs text-terminal-muted">
                  <BadgeCheck size={12} className="text-terminal-accent" />
                  Handle verification submitted — awaiting review.
                </p>
              ) : (
                <form
                  action={submitHandleProof}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="ticker_id" value={t.id} />
                  <label className="min-w-0 flex-1 text-xs text-terminal-muted">
                    Verify your handle: post “listing ${t.symbol} on{" "}
                    {APP_NAME}” on X/Threads, paste the post URL
                    <input
                      name="proof_url"
                      required
                      placeholder="https://x.com/you/status/…"
                      className="input mt-1"
                    />
                  </label>
                  <button className="btn-ghost text-xs">
                    Submit for the badge
                  </button>
                </form>
              )}
            </div>
          )}

          <form
            action={updateLogo}
            className="flex flex-wrap items-end gap-2 border-t border-terminal-line pt-3"
          >
            <input type="hidden" name="ticker_id" value={t.id} />
            <label className="min-w-0 flex-1 text-xs text-terminal-muted">
              {t.logo_url ? "Replace logo" : "Add a logo"} (PNG/JPG/WebP,
              under 1MB — shows on the board and your share card)
              <input
                type="file"
                name="logo"
                required
                accept="image/png,image/jpeg,image/webp"
                className="input mt-1 file:mr-2 file:rounded file:border-0 file:bg-terminal-raise file:px-2 file:py-1 file:font-sans file:text-xs file:text-terminal-text"
              />
            </label>
            <button className="btn-ghost text-xs">Upload</button>
          </form>

          <div className="border-t border-terminal-line pt-3">
            {delistRequested ? (
              <p className="text-xs text-terminal-muted">
                Delisting requested — the admin will remove this ticker and all
                its data shortly.
              </p>
            ) : (
              <form action={requestDelisting}>
                <input type="hidden" name="ticker_id" value={t.id} />
                <button
                  type="submit"
                  className="text-xs text-terminal-down underline-offset-2 hover:underline"
                >
                  Request delisting (removes this ticker and all its data)
                </button>
              </form>
            )}
          </div>
        </section>
      )}


      {/* MRR history */}
      {mrrHistory.length > 0 && (
        <section className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-terminal-line text-left">
                <th className="microlabel px-3 py-2 font-normal">Month</th>
                <th className="microlabel px-3 py-2 text-right font-normal">MRR</th>
                <th className="microlabel px-3 py-2 text-right font-normal">MoM</th>
                <th className="microlabel px-3 py-2 text-right font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {[...mrrHistory].reverse().map((m, i, arr) => {
                const prev = arr[i + 1];
                const rowMom = prev
                  ? changeFraction(Number(prev.mrr), Number(m.mrr))
                  : null;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-terminal-line/50 last:border-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {fmtMonth(m.month)}
                    </td>
                    <td className="num px-3 py-2 text-right font-mono text-terminal-amber">
                      {fmtCompact(Number(m.mrr))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {rowMom !== null ? (
                        <ChangePct value={rowMom} className="text-xs" />
                      ) : (
                        <span className="text-xs text-terminal-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-terminal-muted">
                      {m.source === "stripe" ? (
                        <span className="inline-flex items-center gap-1 text-terminal-amber">
                          <Zap size={10} fill="currentColor" strokeWidth={0} />
                          Stripe-verified
                        </span>
                      ) : m.source === "self-reported" ? (
                        "self-reported"
                      ) : (
                        "curated — founder hasn't claimed this ticker yet"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

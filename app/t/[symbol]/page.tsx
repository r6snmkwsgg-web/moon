import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getTickerPage,
  getVoteGauge,
  tickerExists,
} from "@/lib/data";
import { getUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { currentMonthISO, fmtCompact, fmtMoney, fmtMonth } from "@/lib/format";
import { APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { changeFraction } from "@/lib/pricing";
import { openingTimeframe } from "@/lib/candles";
import { realizedPnl } from "@/lib/equity";
import { nextEarningsDate } from "@/lib/xp";
import { Bell, BadgeCheck, Eye, Zap } from "lucide-react";
import PulseKeeper from "@/components/PulseKeeper";
import ThesisCard from "@/components/ThesisCard";
import TradingChart from "@/components/TradingChart";
import { Suspense } from "react";
import Floor, { FloorSkeleton } from "./Floor";
import LiveQuote from "@/components/LiveQuote";
import TradePanel, { type OwnPrint } from "@/components/TradePanel";
import AboutCard from "@/components/AboutCard";
import EarningsCallCard from "@/components/EarningsCallCard";
import ShareButton from "@/components/ShareButton";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import TickerBadges from "@/components/TickerBadges";
import WatchStar from "@/components/WatchStar";
import VoteBar from "@/components/VoteBar";
import {
  connectStripe,
  disconnectStripe,
  requestDelisting,
  submitHandleProof,
  submitMrr,
  updateLogo,
  updateWebsite,
  postCall,
  buyBack,
  GUIDANCE_STEPS,
} from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ ipo?: string; min?: string }>;
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
  const [{ symbol }, { ipo, min: minParam }] = await Promise.all([params, searchParams]);
  // the floor's size filter — applied in the query, so it is a URL, not a state
  const minSize = minParam && Number(minParam) > 0 ? Number(minParam) : null;
  // the viewer and the ticker load together — one round trip, not two
  const [data, user] = await Promise.all([getTickerPage(symbol), getUser()]);
  if (!data) notFound();
  // one instant for every time-dependent number this render produces
  const renderedAt = Date.now();

  const {
    quote,
    mrrHistory,
    watchersCount,
    series,
    floatHeld,
    topTenShares,
    holdersCount,
    calls,
    dividend,
    buybacks,
    tradePoints,
    earliest,
    revenueEvents,
    flow24h,
  } = data;
  const t = quote.ticker;
  const isFounder = user !== null && t.claimed_by === user.id;

  // the gauge does not depend on the viewer, so it loads beside the viewer's own rows
  const gaugeP = getVoteGauge(t.id);

  // Signed-in extras (own rows only — RLS applies).
  let cash: number | null = null;
  let author: { name: string; username: string | null } | null = null;
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
        supabase
          .from("profiles")
          .select("cash, display_name, username")
          .eq("id", user.id)
          .maybeSingle(),
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
    author = profileRes.data
      ? {
          name: String(profileRes.data.display_name ?? "you"),
          username: (profileRes.data.username as string | null) ?? null,
        }
      : null;
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

  // the strip over the chart: what fomo-style pages put first
  const gauge = await gaugeP;
  const topTen = topTenShares;
  const topTenPct = quote.shares > 0 ? Math.min(100, (topTen / quote.shares) * 100) : 0;
  const vol24h = flow24h.reduce((sum, p) => sum + p.total, 0);

  const latestUpdate = mrrHistory[mrrHistory.length - 1];
  const prevUpdate = mrrHistory[mrrHistory.length - 2];
  const mom =
    latestUpdate && prevUpdate
      ? changeFraction(Number(prevUpdate.mrr), Number(latestUpdate.mrr))
      : null;
  const shareUrl = `${siteUrl()}/t/${t.symbol}`;

  return (
    <div className="space-y-3">
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

      {/* header: one line for the name, one strip for the numbers */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LogoTile symbol={t.symbol} logoUrl={t.logo_url} size={34} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-lg font-bold leading-tight">
            ${t.symbol}
            <TickerBadges ticker={t} />
            <span className="font-sans text-sm font-normal text-terminal-text">
              {t.name}
            </span>
            {!t.claimed && (
              <Link
                href={`/claim/${t.symbol}`}
                className="rounded border border-terminal-line px-1.5 py-0.5 text-[11px] font-normal text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
              >
                unclaimed — is this you?
              </Link>
            )}
          </h1>
          <p className="truncate text-xs text-terminal-muted">
            {t.pitch}
            {t.founder_handle && (
              <>
                {" "}
                · founder{" "}
                <span className="font-mono text-terminal-accent">@{t.founder_handle}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
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
          </div>
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

      <div className="panel flex flex-wrap divide-x divide-terminal-line overflow-hidden">
        {(
          [
            ["Mkt cap", fmtCompact(quote.marketCap)],
            ["24H change", <ChangePct key="chg" value={quote.dayChange} className="text-[13px]" />],
            ["24H vol", vol24h > 0 ? fmtCompact(vol24h) : "$0"],
            [
              quote.revenueSource === "payments" ? "Revenue / mo" : "MRR",
              quote.liveMrr > 0 ? fmtCompact(quote.liveMrr) : "—",
            ],
            ["Multiple", `${quote.multiple.toFixed(1)}×`],
            ["Holders", holdersCount.toLocaleString("en-US")],
            ["Top 10 holding", `${topTenPct.toFixed(topTenPct >= 10 ? 0 : 1)}%`],
          ] as [string, React.ReactNode][]
        ).map(([label, value]) => (
          <div key={label} className="min-w-[96px] flex-1 px-3 py-1.5">
            <div className="microlabel !text-[9px]">{label}</div>
            <div className="num mt-0.5 font-mono text-[13px] font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {/* every ticker, not just the Stripe-verified ones: the walk has to be
          advanced for fixtures too, or their tape stops when the cron does */}
      <PulseKeeper symbol={t.symbol} />

      {/* split rail: the chart and the floor left, the ticket and the card right */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <TradingChart
            heightClass="h-[340px] sm:h-[440px] lg:h-[540px] 2xl:h-[620px]"
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
            calls={calls.map((c) => ({ at: Date.parse(c.createdAt), guidance: c.guidance }))}
            earliest={earliest}
            initialTimeframe={openingTimeframe(renderedAt - earliest)}
          />

          {/* the floor: who holds it, and the tape — streamed in under the
              chart, so the chart and the ticket never wait on it */}
          <Suspense fallback={<FloorSkeleton />}>
            <Floor
              tickerId={t.id}
              symbol={t.symbol}
              price={quote.price}
              shares={quote.shares}
              viewerId={user?.id ?? null}
              renderedAt={renderedAt}
              min={minSize}
              pricing={{
                mrr: quote.liveMrr,
                sentiment: Number(t.sentiment),
                multiple: quote.multiple,
                shares: quote.shares,
                events: revenueEvents,
                drift: quote.drift,
              }}
            />
          </Suspense>
        </div>

        {/* the rail — trading is always in reach */}
        <div className="space-y-3">
          <TradePanel
            author={author}
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
          <ThesisCard
            tickerId={t.id}
            symbol={t.symbol}
            signedIn={user !== null}
            author={author}
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
            flow={flow24h}
            floatHeld={floatHeld}
            earliest={earliest}
            renderedAt={renderedAt}
            nextEarningsAt={t.stripe_verified ? nextEarningsDate().toISOString() : null}
            dividend={dividend}
            buybacks={buybacks}
          />
          <EarningsCallCard calls={calls} symbol={t.symbol} />
          <VoteBar
            tickerId={t.id}
            symbol={t.symbol}
            bulls={gauge.bulls}
            bears={gauge.bears}
            myVote={myVote}
            signedIn={user !== null}
          />
          <ShareButton url={shareUrl} />
        </div>
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

          {/* an earnings call: guidance the next real print will judge */}
          <form action={postCall} className="space-y-2 border-t border-terminal-line pt-3">
            <input type="hidden" name="ticker_id" value={t.id} />
            <div className="text-xs text-terminal-muted">
              Earnings call — tell the market what next month looks like. The AI
              traders price it at a discount, the next real report marks it beat,
              met or missed, and your record is your credibility. One a day; it
              cannot be deleted.
            </div>
            <textarea
              name="body"
              required
              maxLength={600}
              rows={2}
              placeholder="Shipped the annual plan, two enterprise trials in the pipe, churn flat…"
              className="input w-full text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-terminal-muted">
                Guiding next month
                <select name="guidance" defaultValue="0.05" className="input py-1 font-mono text-xs">
                  {GUIDANCE_STEPS.map((g) => (
                    <option key={g} value={g}>
                      {g >= 0 ? "+" : ""}
                      {Math.round(g * 100)}% MRR
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn-ghost text-xs">Hold the call</button>
            </div>
          </form>

          {/* a buyback: the founder's own money, off the float, retired */}
          <form action={buyBack} className="flex flex-wrap items-end gap-2 border-t border-terminal-line pt-3">
            <input type="hidden" name="ticker_id" value={t.id} />
            <label className="min-w-0 flex-1 text-xs text-terminal-muted">
              Buy back shares — bought at the live price with your play money
              ({cash !== null ? fmtMoney(cash) : "—"} available) and retired. The
              float shrinks; every remaining share is a bigger slice.
              <input
                type="number"
                name="dollars"
                min={10}
                step={10}
                placeholder="500"
                className="input mt-1 font-mono"
              />
            </label>
            <button className="btn-ghost text-xs">Buy back</button>
          </form>

          <form
            action={updateWebsite}
            className="flex flex-wrap items-end gap-2 border-t border-terminal-line pt-3"
          >
            <input type="hidden" name="ticker_id" value={t.id} />
            <label className="min-w-0 flex-1 text-xs text-terminal-muted">
              Website — shown on the About card, where every visitor lands
              <input
                type="text"
                name="website"
                defaultValue={t.website ?? ""}
                placeholder="https://yourproduct.com"
                className="input mt-1"
              />
            </label>
            <button className="btn-ghost text-xs">Save</button>
          </form>

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

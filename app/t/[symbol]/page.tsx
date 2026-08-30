import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getRecentTrades,
  getTickerPage,
  getTickerPosts,
  getVoteGauge,
} from "@/lib/data";
import { getUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { fmtCompact, fmtMonth, fmtPct, fmtPrice, currentMonthISO } from "@/lib/format";
import { APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { changeFraction, fairPrice, SHARES_OUTSTANDING } from "@/lib/pricing";
import { nextEarningsDate } from "@/lib/xp";
import type { ChartEvent } from "@/lib/types";
import { Bell, BadgeCheck, Eye, Zap } from "lucide-react";
import CountdownChip from "@/components/CountdownChip";
import Discussion from "@/components/Discussion";
import InteractiveChart from "@/components/InteractiveChart";
import ThesisFeed from "@/components/ThesisFeed";
import LivePrice from "@/components/LivePrice";
import TradePanel from "@/components/TradePanel";
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

  const {
    quote,
    mrrHistory,
    holdersCount,
    watchersCount,
    series,
    fairSeries,
    dayStats,
    floatHeld,
  } = data;
  const t = quote.ticker;
  const user = await getUser();
  const isFounder = user !== null && t.claimed_by === user.id;

  const [gauge, recentTrades, posts, theses] = await Promise.all([
    getVoteGauge(t.id),
    getRecentTrades(10, t.id),
    getTickerPosts(t.id, quote.price),
    getRecentTrades(15, t.id, undefined, true),
  ]);

  // Signed-in extras (own rows only — RLS applies).
  let cash: number | null = null;
  let sharesHeld = 0;
  let delistRequested = false;
  let watching = false;
  let myVote: 1 | -1 | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const [profileRes, holdingRes, delistRes, watchRes, voteRes] =
      await Promise.all([
        supabase.from("profiles").select("cash").eq("id", user.id).maybeSingle(),
        supabase
          .from("holdings")
          .select("shares")
          .eq("user_id", user.id)
          .eq("ticker_id", t.id)
          .maybeSingle(),
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
          <div className="font-mono text-2xl font-bold">
            <LivePrice value={quote.price} formatted={fmtPrice(quote.price)} />
          </div>
          <ChangePct value={quote.dayChange} chip className="text-sm" />
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

      {/* the microstructure block — all of it real, none of it decorative */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Mkt cap", fmtCompact(quote.marketCap)],
          ["MRR", latestUpdate ? fmtCompact(Number(latestUpdate.mrr)) : "—"],
          ["Prev close", dayStats.open !== null ? fmtPrice(dayStats.open) : "—"],
          [
            "Day range",
            dayStats.low !== null && dayStats.high !== null
              ? `${fmtPrice(dayStats.low)} – ${fmtPrice(dayStats.high)}`
              : "—",
          ],
          [
            "Volume today",
            dayStats.volumeShares > 0
              ? `${dayStats.volumeShares.toLocaleString("en-US")} shs`
              : "0",
          ],
          [
            "Trades today",
            String(dayStats.trades),
          ],
          ["Holders", String(holdersCount)],
          [
            "Float held",
            `${Math.min(100, Math.round((floatHeld / SHARES_OUTSTANDING) * 100))}% of ${(SHARES_OUTSTANDING / 1000).toFixed(0)}k`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="panel px-3 py-2">
            <div className="microlabel">{label}</div>
            <div className="num mt-0.5 font-mono text-sm font-semibold">
              {value}
            </div>
          </div>
        ))}
      </div>

      {latestUpdate && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-terminal-muted">
          <span>
            Latest MRR ({fmtMonth(latestUpdate.month)}):{" "}
            {latestUpdate.source === "stripe" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-terminal-amber">
                <Zap size={11} fill="currentColor" strokeWidth={0} />
                Stripe-verified — computed from active subscriptions, refreshed
                monthly
              </span>
            ) : latestUpdate.source === "self-reported" ? (
              <span className="text-terminal-amber">
                self-reported by the founder (honor system)
              </span>
            ) : (
              <span>
                curated from public build-in-public posts — founder hasn&apos;t
                claimed this ticker yet
              </span>
            )}
          </span>
          {mom !== null && (
            <span
              className={`num font-mono ${mom >= 0 ? "text-terminal-up" : "text-terminal-down"}`}
            >
              {fmtPct(mom)} MoM {mom >= 0 ? "beat" : "miss"}
            </span>
          )}
          {t.stripe_verified ? (
            <CountdownChip
              target={nextEarningsDate().toISOString()}
              prefix="next report in"
            />
          ) : (
            <span className="font-mono">
              next report ~{nextReportLabel(latestUpdate.month)}
            </span>
          )}
        </div>
      )}

      {/* chart + trade column */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <InteractiveChart
          series={series}
          fair={fairSeries}
          events={mrrHistory.slice(-6).map((m): ChartEvent => {
            const at =
              m.source === "curated"
                ? Date.parse(`${m.month}T06:00:00Z`)
                : Date.parse(m.created_at);
            return {
              t: at,
              price: fairPrice(Number(m.mrr)),
              label: `${fmtCompact(Number(m.mrr))} MRR`,
              tone: "revenue",
            };
          })}
          symbol={t.symbol}
          variant="panel"
          defaultRange="30D"
        />
        <div className="space-y-3">
          <TradePanel
            symbol={t.symbol}
            price={quote.price}
            mrr={quote.latestMrr}
            sentiment={Number(t.sentiment)}
            signedIn={user !== null}
            cash={cash}
            sharesHeld={sharesHeld}
          />
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

      {/* the floor + theses + recent trades */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Discussion
          posts={posts}
          tickerId={t.id}
          symbol={t.symbol}
          signedIn={user !== null}
          viewerId={user?.id ?? null}
        />
        <div className="space-y-4">
          <ThesisFeed theses={theses} />
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
        </div>
      </div>

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

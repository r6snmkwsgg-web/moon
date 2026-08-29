import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTickerPage } from "@/lib/data";
import { getUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { fmtCompact, fmtMonth, fmtPrice, currentMonthISO } from "@/lib/format";
import { APP_NAME, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { SHARES_OUTSTANDING } from "@/lib/pricing";
import PriceChart from "@/components/PriceChart";
import TradePanel from "@/components/TradePanel";
import ShareButton from "@/components/ShareButton";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import { requestDelisting, submitMrr } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  return {
    title: `$${sym}`,
    description: `$${sym} on ${APP_NAME} — a fantasy stock market for indie SaaS. ${GUARDRAIL_TEXT}`,
  };
}

export default async function TickerPage({ params }: Props) {
  const { symbol } = await params;
  const data = await getTickerPage(symbol);
  if (!data) notFound();

  const { quote, mrrHistory, snapshots, holdersCount } = data;
  const t = quote.ticker;
  const user = await getUser();
  const isFounder = user !== null && t.claimed_by === user.id;

  // Signed-in extras (own rows only — RLS applies).
  let cash: number | null = null;
  let sharesHeld = 0;
  let delistRequested = false;
  if (user) {
    const supabase = await createSupabaseServerClient();
    const [profileRes, holdingRes, delistRes] = await Promise.all([
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
    ]);
    cash = profileRes.data ? Number(profileRes.data.cash) : null;
    sharesHeld = holdingRes.data ? Number(holdingRes.data.shares) : 0;
    delistRequested = Boolean(delistRes.data);
  }

  const latestUpdate = mrrHistory[mrrHistory.length - 1];
  const shareUrl = `${siteUrl()}/t/${t.symbol}`;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-start gap-3">
        <LogoTile symbol={t.symbol} logoUrl={t.logo_url} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-bold">
            ${t.symbol}
            {t.claimed ? (
              <span className="rounded bg-terminal-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-terminal-accent">
                ✓ claimed by founder
              </span>
            ) : (
              <Link
                href={`/claim/${t.symbol}`}
                className="rounded border border-terminal-line px-1.5 py-0.5 text-[11px] text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
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
        <div className="flex flex-col items-end gap-1">
          <div className="num font-mono text-2xl font-bold">
            {fmtPrice(quote.price)}
          </div>
          <ChangePct value={quote.dayChange} chip className="text-sm" />
        </div>
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Mkt cap", fmtCompact(quote.marketCap)],
          [
            "MRR",
            latestUpdate ? fmtCompact(Number(latestUpdate.mrr)) : "—",
          ],
          ["Holders", String(holdersCount)],
          ["Float", SHARES_OUTSTANDING.toLocaleString("en-US")],
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
        <p className="text-xs text-terminal-muted">
          Latest MRR ({fmtMonth(latestUpdate.month)}):{" "}
          {latestUpdate.source === "self-reported" ? (
            <span className="text-terminal-amber">
              self-reported by the founder (honor system)
            </span>
          ) : (
            <span>
              curated from public build-in-public posts — founder hasn&apos;t
              claimed this ticker yet
            </span>
          )}
        </p>
      )}

      {/* chart + trade */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <PriceChart
          snapshots={snapshots}
          mrrHistory={mrrHistory}
          livePrice={quote.price}
        />
        <div className="space-y-3">
          <TradePanel
            symbol={t.symbol}
            price={quote.price}
            signedIn={user !== null}
            cash={cash}
            sharesHeld={sharesHeld}
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
          </form>
          <p className="text-[11px] text-terminal-muted">
            Posting reprices ${t.symbol} immediately — this is your earnings
            report. Numbers are labeled “self-reported”.
          </p>
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
              <tr className="border-b border-terminal-line text-left font-mono text-[11px] uppercase tracking-wider text-terminal-muted">
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">MRR</th>
                <th className="px-3 py-2 text-right">Source</th>
              </tr>
            </thead>
            <tbody>
              {[...mrrHistory].reverse().map((m) => (
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
                  <td className="px-3 py-2 text-right text-[11px] text-terminal-muted">
                    {m.source === "self-reported"
                      ? "self-reported"
                      : "curated — founder hasn't claimed this ticker yet"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

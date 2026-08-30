import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/auth";
import { fmtCompact, currentMonthISO, fmtMonth } from "@/lib/format";
import type { Claim, DelistRequest, MrrUpdate, Ticker } from "@/lib/types";
import {
  addCuratedMrr,
  addTicker,
  approveClaim,
  approveHandle,
  delistTicker,
  purgeFixtures,
  rejectClaim,
  rejectHandle,
  updateTicker,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await getUser();
  if (!isAdminUser(user)) notFound(); // admins only; everyone else sees a 404

  const admin = createSupabaseAdminClient();
  const [tickersRes, claimsRes, delistRes, mrrRes] = await Promise.all([
    admin.from("tickers").select("*").order("symbol"),
    admin
      .from("claims")
      .select("*")
      .eq("status", "pending")
      .order("created_at"),
    admin.from("delist_requests").select("*").order("created_at"),
    admin.from("mrr_updates").select("*").order("month", { ascending: true }),
  ]);

  const tickers = (tickersRes.data ?? []) as Ticker[];
  const claims = (claimsRes.data ?? []) as Claim[];
  const delistRequests = (delistRes.data ?? []) as DelistRequest[];
  const latestMrr = new Map<string, MrrUpdate>();
  for (const m of (mrrRes.data ?? []) as MrrUpdate[]) {
    latestMrr.set(m.ticker_id, m);
  }
  const bySymbol = new Map(tickers.map((t) => [t.id, t.symbol]));
  const defaultMonth = currentMonthISO().slice(0, 7);

  return (
    <div className="space-y-8">
      <h1 className="font-mono text-lg font-bold text-terminal-amber">
        Admin console
      </h1>

      {/* pending claims */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-terminal-muted">
          Pending claims ({claims.length})
        </h2>
        {claims.length === 0 ? (
          <p className="text-sm text-terminal-muted">Nothing pending.</p>
        ) : (
          claims.map((c) => (
            <div
              key={c.id}
              className="panel flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="font-mono font-bold">
                ${bySymbol.get(c.ticker_id) ?? "?"}
              </span>
              <span className="font-mono text-terminal-accent">
                @{c.handle}
              </span>
              <span className="text-xs text-terminal-muted">
                {new Date(c.created_at).toLocaleDateString("en-US")}
              </span>
              <div className="ml-auto flex gap-2">
                <form action={approveClaim}>
                  <input type="hidden" name="claim_id" value={c.id} />
                  <button className="btn-buy px-2 py-1 text-xs">Approve</button>
                </form>
                <form action={rejectClaim}>
                  <input type="hidden" name="claim_id" value={c.id} />
                  <button className="btn-ghost px-2 py-1 text-xs">Reject</button>
                </form>
              </div>
            </div>
          ))
        )}
      </section>

      {/* handle verifications */}
      {tickers.some((t) => t.handle_proof_url && !t.handle_verified) && (
        <section className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-terminal-muted">
            Handle verifications
          </h2>
          {tickers
            .filter((t) => t.handle_proof_url && !t.handle_verified)
            .map((t) => (
              <div
                key={t.id}
                className="panel flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="font-mono font-bold">${t.symbol}</span>
                <span className="font-mono text-terminal-accent">
                  @{t.founder_handle}
                </span>
                <a
                  href={t.handle_proof_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-[280px] truncate text-xs text-terminal-accent underline-offset-2 hover:underline"
                >
                  {t.handle_proof_url}
                </a>
                <div className="ml-auto flex gap-2">
                  <form action={approveHandle}>
                    <input type="hidden" name="ticker_id" value={t.id} />
                    <button className="btn-buy px-2 py-1 text-xs">
                      Approve
                    </button>
                  </form>
                  <form action={rejectHandle}>
                    <input type="hidden" name="ticker_id" value={t.id} />
                    <button className="btn-ghost px-2 py-1 text-xs">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
        </section>
      )}

      {/* fixtures */}
      {tickers.some((t) => t.fixture) && (
        <section className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-terminal-muted">
            Demo fixtures ({tickers.filter((t) => t.fixture).length})
          </h2>
          <form
            action={purgeFixtures}
            className="panel flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
          >
            <span className="text-terminal-muted">
              Wipe every demo ticker (refunds holders at last price, deletes
              all their data). Real listings are untouched.
            </span>
            <button className="btn-sell ml-auto px-2 py-1 text-xs">
              Purge all fixtures
            </button>
          </form>
        </section>
      )}

      {/* delist requests */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-terminal-muted">
          Delist requests ({delistRequests.length})
        </h2>
        {delistRequests.length === 0 ? (
          <p className="text-sm text-terminal-muted">None.</p>
        ) : (
          delistRequests.map((d) => (
            <div
              key={d.id}
              className="panel flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="font-mono font-bold">
                ${bySymbol.get(d.ticker_id) ?? "(already delisted)"}
              </span>
              {bySymbol.has(d.ticker_id) && (
                <form action={delistTicker} className="ml-auto">
                  <input type="hidden" name="ticker_id" value={d.ticker_id} />
                  <button className="btn-sell px-2 py-1 text-xs">
                    Delist now (refunds holders, deletes all data)
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </section>

      {/* add ticker */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-terminal-muted">
          Add ticker
        </h2>
        <form
          action={addTicker}
          className="panel grid gap-3 p-4 sm:grid-cols-2"
        >
          <label className="text-xs text-terminal-muted">
            Symbol (2–6 letters)
            <input name="symbol" required placeholder="PRLA" className="input mt-1 font-mono uppercase" />
          </label>
          <label className="text-xs text-terminal-muted">
            Startup name
            <input name="name" required placeholder="Pearla" className="input mt-1" />
          </label>
          <label className="text-xs text-terminal-muted sm:col-span-2">
            One-line pitch
            <input name="pitch" required placeholder="Screenshot-to-invoice for freelancers" className="input mt-1" />
          </label>
          <label className="text-xs text-terminal-muted">
            Founder handle (public MRR poster)
            <input name="founder_handle" placeholder="@founder" className="input mt-1 font-mono" />
          </label>
          <label className="text-xs text-terminal-muted">
            Logo URL (optional)
            <input name="logo_url" placeholder="https://…" className="input mt-1" />
          </label>
          <label className="text-xs text-terminal-muted">
            First MRR month
            <input type="month" name="month" defaultValue={defaultMonth} className="input mt-1" />
          </label>
          <label className="text-xs text-terminal-muted">
            First MRR (curated, USD)
            <input type="number" name="mrr" min={0} placeholder="8500" className="input num mt-1 font-mono" />
          </label>
          <button type="submit" className="btn-ghost sm:col-span-2">
            List ticker
          </button>
          <p className="text-[11px] text-terminal-muted sm:col-span-2">
            Only list startups whose founders already share MRR publicly.
          </p>
        </form>
      </section>

      {/* manage tickers */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-terminal-muted">
          Tickers ({tickers.length})
        </h2>
        {tickers.map((t) => {
          const latest = latestMrr.get(t.id);
          return (
            <details key={t.id} className="panel px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-mono font-bold">${t.symbol}</span>
                <span className="text-terminal-muted">{t.name}</span>
                {t.stripe_verified && (
                  <span className="text-[10px] text-terminal-amber">
                    stripe
                  </span>
                )}
                {t.claimed && (
                  <span className="text-[10px] text-terminal-accent">
                    claimed
                  </span>
                )}
                {t.fixture && (
                  <span className="text-[10px] text-terminal-muted">demo</span>
                )}
                <span className="ml-auto font-mono text-xs text-terminal-amber">
                  {latest
                    ? `${fmtCompact(Number(latest.mrr))} · ${fmtMonth(latest.month)} · ${latest.source}`
                    : "no MRR yet"}
                </span>
                <Link
                  href={`/t/${t.symbol}`}
                  className="text-xs text-terminal-accent"
                >
                  view →
                </Link>
              </summary>

              <div className="mt-3 space-y-4 border-t border-terminal-line pt-3">
                <form
                  action={addCuratedMrr}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="ticker_id" value={t.id} />
                  <label className="text-xs text-terminal-muted">
                    Month
                    <input type="month" name="month" defaultValue={defaultMonth} required className="input mt-1" />
                  </label>
                  <label className="text-xs text-terminal-muted">
                    Curated MRR (USD)
                    <input type="number" name="mrr" min={0} required className="input num mt-1 w-28 font-mono" />
                  </label>
                  <button className="btn-ghost text-xs">Save MRR</button>
                </form>

                <form
                  action={updateTicker}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <input type="hidden" name="ticker_id" value={t.id} />
                  <input name="name" defaultValue={t.name} className="input" />
                  <input
                    name="founder_handle"
                    defaultValue={t.founder_handle ?? ""}
                    placeholder="founder handle"
                    className="input font-mono"
                  />
                  <input
                    name="pitch"
                    defaultValue={t.pitch}
                    className="input sm:col-span-2"
                  />
                  <input
                    name="logo_url"
                    defaultValue={t.logo_url ?? ""}
                    placeholder="logo URL"
                    className="input sm:col-span-2"
                  />
                  <button className="btn-ghost text-xs">Save edits</button>
                </form>

                <form action={delistTicker}>
                  <input type="hidden" name="ticker_id" value={t.id} />
                  <button className="text-xs text-terminal-down underline-offset-2 hover:underline">
                    Delist ${t.symbol} — refunds holders at last price, then
                    deletes the ticker and ALL its data
                  </button>
                </form>
              </div>
            </details>
          );
        })}
      </section>
    </div>
  );
}

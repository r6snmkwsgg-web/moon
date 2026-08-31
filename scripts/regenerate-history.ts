/**
 * One-off: redraw every ticker's recorded past with the CURRENT market model.
 *
 * The old history was written by a deterministic noise field that oscillated
 * around fair value with a three-day pull. It measured lag-1 return
 * autocorrelation -0.22 and a variance ratio of 0.58 — a real market sits at
 * 0.00 and 1.0 — so every chart was a sawtooth of evenly sized humps joined by
 * ruled diagonals. No renderer fixes that; the data itself has to be a walk.
 *
 * So each ticker's daily snapshots are re-priced against a fresh path drawn
 * from the real drift walk (lib/flow), and the last few days are backfilled
 * into flow_ticks at five-minute resolution so recent charts read off a
 * recorded tape instead of an interpolation.
 *
 * WHAT IS PRESERVED, exactly:
 *   · mrr, sentiment and fair_price on every row — those are the real inputs,
 *     and only the weather on top of them is being redrawn.
 *   · today's price. The path is pinned to end at the ticker's live drift, so
 *     nobody's position changes value when this runs.
 *   · every recorded trade. The path is pinned at each print too, so the fill
 *     you got still sits on the curve instead of hanging off it.
 *
 *   npx tsx scripts/regenerate-history.ts [--dry]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  fairPrice,
  floatOf,
  settledPrice,
  valuationMultiple,
  FLOW_CAP,
  type RevenuePoint,
} from "../lib/pricing";
import {
  advanceFlow,
  cryptoRandom,
  initialFlowState,
  FLOW_TICK_MS,
} from "../lib/flow";

config({ path: ".env.local" });
const DRY = process.argv.includes("--dry");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAY = 86_400_000;
const TICKS_PER_DAY = DAY / FLOW_TICK_MS;
/** How much recent tape to lay down at five-minute resolution. */
const TAPE_DAYS = 3;

/**
 * Pin a free walk to known values without flattening it.
 *
 * Between two pins, the accumulated error is spread linearly across the
 * segment — the standard way to turn a free path into a bridge. The walk's
 * own increments carry the shape; the correction only slides it into place.
 */
function pinPath(free: number[], pins: Map<number, number>): number[] {
  const idx = [...pins.keys()].sort((a, b) => a - b);
  if (idx.length === 0) return free;
  const out = free.slice();
  const err = (i: number) => pins.get(i)! - free[i];

  for (let k = 0; k < idx.length - 1; k++) {
    const i0 = idx[k];
    const i1 = idx[k + 1];
    const e0 = err(i0);
    const e1 = err(i1);
    for (let i = i0; i <= i1; i++) {
      out[i] = free[i] + e0 + ((e1 - e0) * (i - i0)) / (i1 - i0 || 1);
    }
  }
  // outside the pinned range, carry the nearest pin's offset
  for (let i = 0; i < idx[0]; i++) out[i] = free[i] + err(idx[0]);
  const last = idx[idx.length - 1];
  for (let i = last + 1; i < free.length; i++) out[i] = free[i] + err(last);
  return out;
}

/** A free drift path, one value per step, straight from the production walk. */
function freeWalk(steps: number, ticksPer: number, mrr: number): number[] {
  const rng = cryptoRandom();
  let state = initialFlowState();
  // burn in so the path starts from the walk's own distribution, not from 0
  state = advanceFlow(state, mrr, 20 * TICKS_PER_DAY, rng);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    state = advanceFlow(state, mrr, ticksPer, rng);
    out.push(state.drift);
  }
  return out;
}

async function main() {
  const [{ data: tickers }, { data: mrrRows }] = await Promise.all([
    admin.from("tickers").select("*"),
    admin.from("mrr_updates").select("*").order("month", { ascending: true }),
  ]);
  if (!tickers?.length) throw new Error("no tickers");
  if (!("drift" in (tickers[0] as object))) {
    throw new Error("0007_market_drift has not been applied — run it first.");
  }

  const revenue = new Map<string, RevenuePoint[]>();
  for (const u of (mrrRows ?? []) as { ticker_id: string; month: string; mrr: number }[]) {
    const list = revenue.get(u.ticker_id) ?? [];
    list.push({ month: u.month, mrr: Number(u.mrr) });
    revenue.set(u.ticker_id, list);
  }

  const now = Date.now();
  const todayUTC = new Date(now).toISOString().slice(0, 10);
  let snapsWritten = 0;
  let ticksWritten = 0;

  for (const t of tickers as Record<string, unknown>[]) {
    const id = t.id as string;
    const symbol = t.symbol as string;
    const liveDrift = Number(t.drift ?? 0);
    const shares = floatOf(t.shares_outstanding as number | null);

    const [{ data: snaps }, { data: trades }] = await Promise.all([
      admin
        .from("price_snapshots")
        .select("day, price, sentiment, mrr")
        .eq("ticker_id", id)
        .order("day", { ascending: true }),
      admin
        .from("trades")
        .select("created_at, price")
        .eq("ticker_id", id)
        .order("created_at", { ascending: true }),
    ]);
    const rows = (snaps ?? []) as {
      day: string;
      price: number;
      sentiment: number;
      mrr: number;
    }[];
    if (rows.length < 2) continue;

    const record = revenue.get(id) ?? [];
    const multipleOn = (day: string) =>
      valuationMultiple(record.filter((p) => p.month <= day));
    // the anchor each day's weather sits on top of
    const anchorOf = (r: (typeof rows)[number]) =>
      fairPrice(Number(r.mrr), multipleOn(r.day), shares) *
      Math.exp(Number(r.sentiment));

    // ── the daily path ─────────────────────────────────────────────────────
    const latestMrr = record.length ? record[record.length - 1].mrr : 0;
    const free = freeWalk(rows.length, TICKS_PER_DAY, latestMrr);

    const pins = new Map<number, number>();
    // BOTH ENDS. With only today pinned, the whole path is shifted by one
    // constant to reach it — and a shift of, say, +1.0 in log space walks the
    // middle of the history straight into the cap, which is how the first run
    // of this printed a ticker at four times fair value for a month. Pinning
    // the start as well spreads the correction instead of translating it.
    const startAnchor = anchorOf(rows[0]);
    if (startAnchor > 0 && Number(rows[0].price) > 0) {
      pins.set(0, Math.log(Number(rows[0].price) / startAnchor));
    }
    // today ends where the live price already is, so no position changes value
    pins.set(rows.length - 1, liveDrift);
    // and every print stays on the curve it was filled at
    for (const tr of (trades ?? []) as { created_at: string; price: number }[]) {
      const day = tr.created_at.slice(0, 10);
      const i = rows.findIndex((r) => r.day === day);
      if (i < 0) continue;
      const anchor = anchorOf(rows[i]);
      if (anchor > 0 && Number(tr.price) > 0) {
        pins.set(i, Math.log(Number(tr.price) / anchor));
      }
    }
    const path = pinPath(free, pins).map((d) =>
      Math.max(-FLOW_CAP, Math.min(FLOW_CAP, d))
    );

    const updates = rows.map((r, i) => ({
      ticker_id: id,
      day: r.day,
      price: Number(
        settledPrice(
          Number(r.mrr),
          Number(r.sentiment),
          Date.parse(`${r.day}T06:00:00Z`),
          multipleOn(r.day),
          shares,
          [],
          path[i]
        ).toFixed(6)
      ),
      fair_price: Number(
        fairPrice(Number(r.mrr), multipleOn(r.day), shares).toFixed(6)
      ),
      sentiment: Number(r.sentiment),
      mrr: Number(r.mrr),
    }));

    // ── the recent tape, at five-minute resolution ─────────────────────────
    const { data: existing } = await admin
      .from("flow_ticks")
      .select("at")
      .eq("ticker_id", id)
      .order("at", { ascending: true })
      .limit(1);
    const firstReal = existing?.length ? Date.parse(existing[0].at) : now;
    const tapeFrom = Math.max(now - TAPE_DAYS * DAY, Date.parse(rows[0].day));
    const tapeSteps = Math.max(0, Math.floor((firstReal - tapeFrom) / FLOW_TICK_MS));

    const tape: { ticker_id: string; at: string; drift: number; price: number }[] = [];
    if (tapeSteps > 1) {
      const last = rows[rows.length - 1];
      const mult = multipleOn(last.day);
      const freeTape = freeWalk(tapeSteps, 1, latestMrr);
      // start where the daily path was at tapeFrom, end where the first real
      // recorded tick already is — so the seam is invisible either side
      const startDrift = path[Math.max(0, rows.length - 1 - TAPE_DAYS)];
      const endDrift = liveDrift;
      const tapePath = pinPath(
        freeTape,
        new Map([
          [0, startDrift],
          [tapeSteps - 1, endDrift],
        ])
      );
      for (let i = 0; i < tapeSteps; i++) {
        const at = tapeFrom + i * FLOW_TICK_MS;
        tape.push({
          ticker_id: id,
          at: new Date(at).toISOString(),
          drift: Number(tapePath[i].toFixed(8)),
          price: Number(
            settledPrice(
              Number(last.mrr),
              Number(last.sentiment),
              at,
              mult,
              shares,
              [],
              tapePath[i]
            ).toFixed(6)
          ),
        });
      }
    }

    // report the newest CHARTED day: today's row is excluded from every chart,
    // and the live price comes off tickers.drift, which this never touches
    const ci = rows.findIndex((r) => r.day === todayUTC);
    const j = (ci === -1 ? rows.length : ci) - 1;
    const lo = Math.min(...path);
    const hi = Math.max(...path);
    console.log(
      `${symbol.padEnd(5)} ${String(rows.length).padStart(3)}d  ${String(tape.length).padStart(4)} ticks  ` +
        `last charted $${Number(rows[j]?.price ?? 0).toFixed(2)} → $${(updates[j]?.price ?? 0).toFixed(2)}  ` +
        `weather ${(Math.exp(lo)).toFixed(2)}x–${(Math.exp(hi)).toFixed(2)}x fair`
    );

    if (DRY) continue;
    for (let i = 0; i < updates.length; i += 200) {
      const { error } = await admin
        .from("price_snapshots")
        .upsert(updates.slice(i, i + 200), { onConflict: "ticker_id,day" });
      if (error) throw new Error(`${symbol} snapshots: ${error.message}`);
    }
    snapsWritten += updates.length;
    for (let i = 0; i < tape.length; i += 500) {
      const { error } = await admin
        .from("flow_ticks")
        .upsert(tape.slice(i, i + 500), { onConflict: "ticker_id,at" });
      if (error) throw new Error(`${symbol} ticks: ${error.message}`);
    }
    ticksWritten += tape.length;
  }

  console.log(
    DRY
      ? "\ndry run — nothing written"
      : `\n${snapsWritten} snapshots redrawn, ${ticksWritten} ticks laid down`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

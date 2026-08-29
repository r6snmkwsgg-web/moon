import { ImageResponse } from "next/og";
import { changeFraction, livePrice } from "@/lib/pricing";
import { APP_NAME } from "@/lib/config";

export const runtime = "edge";
export const alt = "Weekly market recap";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0a0e14";
const PANEL = "#0f1520";
const LINE = "#1c2533";
const TEXT = "#e6edf3";
const MUTED = "#8b98ab";
const UP = "#22c55e";
const DOWN = "#f43f5e";

async function rest<T>(path: string): Promise<T | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function OgImage() {
  // Public tables only (edge + anon key): compute week change per ticker.
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [tickers, mrrRows, snaps] = await Promise.all([
    rest<{ id: string; symbol: string; sentiment: number; listed_at: string }[]>(
      "tickers?select=id,symbol,sentiment,listed_at"
    ),
    rest<{ ticker_id: string; mrr: number; month: string }[]>(
      "mrr_updates?select=ticker_id,mrr,month&order=month.asc"
    ),
    rest<{ ticker_id: string; price: number; day: string }[]>(
      `price_snapshots?select=ticker_id,price,day&day=gte.${weekAgo}&order=day.asc`
    ),
  ]);

  const latestMrr = new Map<string, number>();
  for (const m of mrrRows ?? []) latestMrr.set(m.ticker_id, Number(m.mrr));
  const firstSnap = new Map<string, number>();
  for (const s of snaps ?? []) {
    if (!firstSnap.has(s.ticker_id)) firstSnap.set(s.ticker_id, Number(s.price));
  }

  const rows = (tickers ?? [])
    .map((t) => {
      const price = livePrice(latestMrr.get(t.id) ?? 0, Number(t.sentiment));
      const base = firstSnap.get(t.id) ?? 0;
      return { symbol: t.symbol, change: changeFraction(base, price), listed_at: t.listed_at };
    })
    .filter((r) => Number.isFinite(r.change))
    .sort((a, b) => b.change - a.change);

  const gainer = rows[0];
  const loser = rows.length > 1 ? rows[rows.length - 1] : null;
  const newCount = (tickers ?? []).filter(
    (t) => new Date(t.listed_at).getTime() > Date.now() - 7 * 86400_000
  ).length;

  const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: BG,
          padding: "56px 64px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 30, color: MUTED, letterSpacing: 6 }}>
          {"WEEKLY RECAP"}
        </div>
        <div style={{ fontSize: 62, fontWeight: 800, color: TEXT, marginTop: 6 }}>
          This week on the exchange
        </div>

        <div style={{ display: "flex", gap: 28, marginTop: 44, flex: 1 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: PANEL,
              border: `2px solid ${LINE}`,
              borderRadius: 18,
              padding: "28px 32px",
            }}
          >
            <div style={{ fontSize: 24, color: MUTED }}>🏆 gainer of the week</div>
            <div style={{ fontSize: 58, fontWeight: 800, color: TEXT, marginTop: 8 }}>
              {gainer ? `$${gainer.symbol}` : "—"}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, color: UP, marginTop: 4 }}>
              {gainer ? pct(gainer.change) : ""}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              backgroundColor: PANEL,
              border: `2px solid ${LINE}`,
              borderRadius: 18,
              padding: "28px 32px",
            }}
          >
            <div style={{ fontSize: 24, color: MUTED }}>🧊 rough week</div>
            <div style={{ fontSize: 58, fontWeight: 800, color: TEXT, marginTop: 8 }}>
              {loser ? `$${loser.symbol}` : "—"}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, color: DOWN, marginTop: 4 }}>
              {loser ? pct(loser.change) : ""}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 26,
            marginTop: 36,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", fontSize: 28, fontWeight: 700, color: UP, letterSpacing: 4 }}>
            <svg width="30" height="30" viewBox="0 0 32 32" style={{ marginRight: 14 }}>
              <path d="M5 22 L12 14 L17 18 L27 7" stroke={UP} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 7 H27 V14" stroke={UP} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {APP_NAME}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
            {`${newCount} new listing${newCount === 1 ? "" : "s"} · play money — not real securities`}
          </div>
        </div>
      </div>
    ),
    size
  );
}

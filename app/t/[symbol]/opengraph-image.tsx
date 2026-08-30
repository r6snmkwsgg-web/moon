import { ImageResponse } from "next/og";
import { changeFraction, livePrice, valuationMultiple } from "@/lib/pricing";
import { APP_NAME } from "@/lib/config";

export const runtime = "edge";
export const alt = "Ticker chart card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The ad. When a founder shares their ticker link on X/Threads, this card is
 * what people see: symbol, price, change %, sparkline, dark terminal styling.
 * Public-read tables via the anon key — no service role on the edge.
 */

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

function fmtPrice(v: number): string {
  const decimals = v > 0 && v < 1 ? 4 : 2;
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);

  const tickers = await rest<
    {
      id: string;
      symbol: string;
      name: string;
      sentiment: number;
      stripe_verified?: boolean;
      listed_at?: string;
    }[]
  >(`tickers?select=*&symbol=eq.${sym}&limit=1`);
  const ticker = tickers?.[0];
  const verified = Boolean(ticker?.stripe_verified);
  const isNew = ticker?.listed_at
    ? Date.now() - new Date(ticker.listed_at).getTime() < 7 * 86400_000
    : false;

  let price = 0;
  let change = 0;
  let spark: number[] = [];

  if (ticker) {
    const since = new Date(Date.now() - 30 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const [mrrRows, snapRows] = await Promise.all([
      rest<{ month: string; mrr: number }[]>(
        `mrr_updates?select=month,mrr&ticker_id=eq.${ticker.id}&order=month.asc`
      ),
      rest<{ price: number }[]>(
        `price_snapshots?select=price&ticker_id=eq.${ticker.id}&day=gte.${since}&order=day.asc`
      ),
    ]);
    const history = (mrrRows ?? []).map((r) => ({
      month: r.month,
      mrr: Number(r.mrr),
    }));
    const mrr = history.length ? history[history.length - 1].mrr : 0;
    price = livePrice(
      mrr,
      Number(ticker.sentiment),
      valuationMultiple(history)
    );
    spark = [...(snapRows ?? []).map((s) => Number(s.price)), price];
    if (spark.length >= 2) change = changeFraction(spark[0], price);
  }

  const up = change >= 0;
  const accent = up ? UP : DOWN;
  const changeLabel = `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;

  // Sparkline geometry
  const CW = 1080;
  const CH = 240;
  const min = spark.length ? Math.min(...spark) : 0;
  const max = spark.length ? Math.max(...spark) : 1;
  const range = max - min || 1;
  const points = spark
    .map((v, i) => {
      const x = (i / Math.max(spark.length - 1, 1)) * CW;
      const y = 8 + (1 - (v - min) / range) * (CH - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: BG,
          padding: "48px 60px",
          fontFamily: "sans-serif",
        }}
      >
        {/* header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  fontSize: 84,
                  fontWeight: 800,
                  color: TEXT,
                  letterSpacing: 2,
                }}
              >
                {/* satori: keep text as ONE child node (no `$…{expr}` mixing) */}
                {"$" + (ticker ? ticker.symbol : sym)}
              </div>
              {verified && (
                <div
                  style={{
                    display: "flex",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#fbbf24",
                    border: "2px solid rgba(251,191,36,0.45)",
                    backgroundColor: "rgba(251,191,36,0.10)",
                    borderRadius: 10,
                    padding: "4px 14px",
                    marginLeft: 22,
                    letterSpacing: 2,
                  }}
                >
                  STRIPE-VERIFIED MRR
                </div>
              )}
              {isNew && !verified && (
                <div
                  style={{
                    display: "flex",
                    fontSize: 22,
                    fontWeight: 700,
                    color: UP,
                    border: `2px solid ${UP}`,
                    borderRadius: 10,
                    padding: "4px 14px",
                    marginLeft: 22,
                    letterSpacing: 2,
                  }}
                >
                  JUST LISTED
                </div>
              )}
            </div>
            <div style={{ fontSize: 30, color: MUTED, marginTop: 4 }}>
              {ticker ? ticker.name : "not listed"}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
            }}
          >
            <div style={{ fontSize: 72, fontWeight: 800, color: TEXT }}>
              {fmtPrice(price)}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 36,
                fontWeight: 700,
                color: accent,
                backgroundColor: PANEL,
                border: `2px solid ${LINE}`,
                borderRadius: 12,
                padding: "4px 18px",
                marginTop: 8,
              }}
            >
              {/* satori's bundled font has no ▲/▼ — draw the triangle */}
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                style={{ marginRight: 12 }}
              >
                <path
                  d={up ? "M12 5 L21 19 L3 19 Z" : "M12 19 L21 5 L3 5 Z"}
                  fill={accent}
                />
              </svg>
              {changeLabel}
            </div>
          </div>
        </div>

        {/* sparkline */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 20,
          }}
        >
          {spark.length >= 2 ? (
            <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}>
              <polyline
                points={points}
                fill="none"
                stroke={accent}
                strokeWidth="5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <div style={{ display: "flex", fontSize: 30, color: MUTED }}>
              chart loading…
            </div>
          )}
        </div>

        {/* footer row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 28,
              fontWeight: 700,
              color: UP,
              letterSpacing: 4,
            }}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 32 32"
              style={{ marginRight: 14 }}
            >
              <path
                d="M5 22 L12 14 L17 18 L27 7"
                stroke={UP}
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 7 H27 V14"
                stroke={UP}
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {"listed on " + APP_NAME}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
            play money — not real securities
          </div>
        </div>
      </div>
    ),
    size
  );
}

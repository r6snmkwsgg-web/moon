import { ImageResponse } from "next/og";
import { getPublicProfile } from "@/lib/data";
import { APP_NAME, STARTING_CASH } from "@/lib/config";

// Node runtime (not edge): profile data crosses user rows, so it comes
// through the same service-role path the page uses — never the anon key.
export const alt = "Trader portfolio card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0a0e14";
const PANEL = "#0f1520";
const LINE = "#1c2533";
const TEXT = "#e6edf3";
const MUTED = "#8b98ab";
const UP = "#22c55e";
const DOWN = "#f43f5e";

function fmtUsd(v: number): string {
  return (
    "$" +
    v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  );
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  let name = username;
  let value = 0;
  let pnlPct = 0;
  let rank: number | null = null;
  let spark: number[] = [];

  try {
    const data = await getPublicProfile(username);
    if (data) {
      name = data.profile.display_name;
      value = data.valuation.totalValue;
      pnlPct = data.valuation.totalPnl / STARTING_CASH;
      rank = data.rank;
      spark = [
        ...data.history.map((h) => Number(h.total_value)),
        data.valuation.totalValue,
      ];
    }
  } catch {
    // render the shell
  }

  const up = pnlPct >= 0;
  const accent = up ? UP : DOWN;
  const CW = 1080;
  const CH = 210;
  const min = spark.length ? Math.min(...spark, STARTING_CASH) : 0;
  const max = spark.length ? Math.max(...spark, STARTING_CASH) : 1;
  const range = max - min || 1;
  const points = spark
    .map((v, i) => {
      const x = (i / Math.max(spark.length - 1, 1)) * CW;
      const y = 8 + (1 - (v - min) / range) * (CH - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const baseY = 8 + (1 - (STARTING_CASH - min) / range) * (CH - 16);

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 64, fontWeight: 800, color: TEXT }}>
              {name}
            </div>
            <div style={{ fontSize: 28, color: MUTED, marginTop: 4 }}>
              {rank ? `rank #${rank} on the exchange` : "trader"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 64, fontWeight: 800, color: TEXT }}>
              {fmtUsd(value)}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 34,
                fontWeight: 700,
                color: accent,
                backgroundColor: PANEL,
                border: `2px solid ${LINE}`,
                borderRadius: 12,
                padding: "4px 18px",
                marginTop: 8,
              }}
            >
              {`${up ? "+" : ""}${(pnlPct * 100).toFixed(1)}% all-time`}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", marginTop: 16 }}>
          {spark.length >= 2 ? (
            <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}>
              <line x1="0" x2={CW} y1={baseY} y2={baseY} stroke={MUTED} strokeWidth="2" strokeDasharray="6 8" opacity="0.5" />
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
            <div style={{ display: "flex", fontSize: 28, color: MUTED }}>
              fresh $10,000 — history starts tonight
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${LINE}`,
            paddingTop: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", fontSize: 28, fontWeight: 700, color: UP, letterSpacing: 4 }}>
            <svg width="30" height="30" viewBox="0 0 32 32" style={{ marginRight: 14 }}>
              <path d="M5 22 L12 14 L17 18 L27 7" stroke={UP} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 7 H27 V14" stroke={UP} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {"trading on " + APP_NAME}
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

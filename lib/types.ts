/** Row shapes for the Supabase tables (see supabase/migrations/0001_init.sql). */

export type MrrSource = "self-reported" | "curated" | "stripe";

export interface Ticker {
  id: string;
  symbol: string; // stored without the $ — display as `$${symbol}`
  name: string;
  pitch: string;
  logo_url: string | null;
  founder_handle: string | null; // X/Threads handle, no @
  claimed: boolean;
  claimed_by: string | null;
  sentiment: number;
  listed_at: string;
  // 0002_market_depth — may be undefined until the migration runs
  fixture?: boolean;
  stripe_verified?: boolean;
  handle_verified?: boolean;
  handle_proof_url?: string | null;
  listed_by?: string | null;
  // 0004_float — the ticker's own share count; falls back to the default
  shares_outstanding?: number | null;
}

export interface MrrUpdate {
  id: string;
  ticker_id: string;
  month: string; // first-of-month date, e.g. "2026-08-01"
  mrr: number;
  source: MrrSource;
  created_at: string;
}

export interface PriceSnapshot {
  id: string;
  ticker_id: string;
  day: string; // "2026-08-28"
  price: number;
  fair_price: number;
  sentiment: number;
  mrr: number;
}

export interface Profile {
  id: string;
  display_name: string;
  cash: number;
  created_at: string;
  // 0002_market_depth — may be undefined until the migration runs
  username?: string;
  invite_code?: string;
  invited_by?: string | null;
}

export interface Trade {
  id: string;
  user_id: string;
  ticker_id: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  total: number;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  ticker_id: string | null;
  kind: "mrr" | "move" | "invite" | "system";
  title: string;
  read: boolean;
  created_at: string;
}

export interface PortfolioSnapshot {
  user_id: string;
  day: string;
  total_value: number;
  cash: number;
  holdings_value: number;
}

export interface Holding {
  user_id: string;
  ticker_id: string;
  shares: number;
  avg_cost: number;
}

export interface Claim {
  id: string;
  ticker_id: string;
  user_id: string;
  handle: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface DelistRequest {
  id: string;
  ticker_id: string;
  user_id: string;
  created_at: string;
}

/** One point on a price chart — real prints and snapshots, epoch ms. */
export interface ChartPoint {
  t: number;
  price: number;
}

/** An annotated moment on a chart — always something that actually happened. */
export interface ChartEvent {
  t: number;
  price: number;
  label: string;
  tone: "revenue" | "trade" | "high";
}

/** A ticker joined with everything the exchange table / ticker page needs. */
export interface TickerQuote {
  ticker: Ticker;
  latestMrr: number;
  arr: number; // latestMrr × 12
  multiple: number; // quality-adjusted ARR multiple this ticker earns
  shares: number; // this ticker's float — set at IPO, not global
  price: number;
  fairPrice: number;
  marketCap: number;
  dayChange: number; // fraction, e.g. 0.052
  weekChange: number;
  spark: number[]; // recent snapshot prices, oldest → newest
}

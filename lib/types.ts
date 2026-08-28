/** Row shapes for the Supabase tables (see supabase/migrations/0001_init.sql). */

export type MrrSource = "self-reported" | "curated";

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

/** A ticker joined with everything the exchange table / ticker page needs. */
export interface TickerQuote {
  ticker: Ticker;
  latestMrr: number;
  price: number;
  fairPrice: number;
  marketCap: number;
  dayChange: number; // fraction, e.g. 0.052
  weekChange: number;
  spark: number[]; // recent snapshot prices, oldest → newest
}

"use client";

import { useSyncExternalStore } from "react";
import type { TradeSide } from "@/lib/pricing";

/**
 * lib/live.ts — what just happened on this page, before the server says so.
 *
 * A fill returns the curve's new sentiment. Everything on the page that
 * prices off sentiment — the chart, the header, the ticket's mark, the
 * holders' marks — reads it from here first, so your own print moves the
 * chart the instant the order comes back rather than after a refresh
 * re-renders the route. The tape gets the print the same way. A refresh,
 * whenever it lands, hands back server truth and this store defers to it.
 */
export interface LiveFill {
  id: string;
  symbol: string;
  side: TradeSide;
  shares: number;
  price: number;
  total: number;
  trader: string;
  username: string | null;
  created_at: string;
  /** A note on the print, when the poll brought one. */
  note?: string | null;
  bot?: boolean;
}

type State = {
  sentiment: Map<string, { value: number; at: number }>;
  fills: LiveFill[];
};

const state: State = { sentiment: new Map(), fills: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A fill just came back: the curve moved to `sentiment`, and this printed. */
export function publishFill(symbol: string, sentiment: number, fill: LiveFill | null): void {
  publishFills(symbol, sentiment, fill ? [fill] : []);
}

/**
 * The poll brought prints: the curve stands at `sentiment` now, and these
 * landed since the last look. Newest first, no duplicates, eighty kept.
 */
export function publishFills(symbol: string, sentiment: number | null, fills: LiveFill[]): void {
  if (sentiment !== null) state.sentiment.set(symbol, { value: sentiment, at: Date.now() });
  if (fills.length > 0) {
    const known = new Set(state.fills.map((f) => f.id));
    const fresh = fills.filter((f) => !known.has(f.id));
    if (fresh.length > 0) {
      state.fills = [...fresh, ...state.fills]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 80);
    }
  }
  emit();
}

/** How long the page trusts its own number over a stale server prop. */
const LIVE_TTL_MS = 60_000;

/**
 * The sentiment to price with: the store's, if we moved it more recently
 * than the server prop could have been rendered; else the prop.
 */
export function useLiveSentiment(symbol: string, serverValue: number): number {
  const snap = useSyncExternalStore(
    subscribe,
    () => state.sentiment.get(symbol) ?? null,
    () => null
  );
  if (!snap) return serverValue;
  if (Date.now() - snap.at > LIVE_TTL_MS) return serverValue;
  return snap.value;
}

/** Prints made from this page that the server list may not carry yet. */
export function useLiveFills(symbol: string): LiveFill[] {
  const fills = useSyncExternalStore(
    subscribe,
    () => state.fills,
    () => state.fills
  );
  return fills.filter((f) => f.symbol === symbol);
}

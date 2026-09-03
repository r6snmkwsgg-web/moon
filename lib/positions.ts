/**
 * lib/positions.ts — the round trips in a ledger.
 *
 * A position opens on the first buy from flat and closes on the sell that
 * takes it back to zero; what happened in between is one trade with a
 * result. Read straight off the prints, so it cannot disagree with them.
 */
import type { EquityTrade } from "@/lib/equity";

export interface ClosedPosition {
  symbol: string;
  openedAt: number;
  closedAt: number;
  /** the most shares held at once during the round trip */
  peakShares: number;
  bought: number;
  sold: number;
  pnl: number;
  /** pnl over what was bought, as a fraction */
  pnlPct: number;
  trades: number;
}

export function closedPositions(trades: EquityTrade[]): ClosedPosition[] {
  const out: ClosedPosition[] = [];
  const open = new Map<
    string,
    { shares: number; peak: number; bought: number; sold: number; openedAt: number; trades: number }
  >();
  for (const tr of [...trades].sort((a, b) => a.t - b.t)) {
    const s = open.get(tr.symbol) ?? { shares: 0, peak: 0, bought: 0, sold: 0, openedAt: tr.t, trades: 0 };
    if (s.shares <= 0 && tr.side === "buy") {
      s.openedAt = tr.t;
      s.bought = 0;
      s.sold = 0;
      s.peak = 0;
      s.trades = 0;
    }
    s.trades++;
    if (tr.side === "buy") {
      s.shares += tr.shares;
      s.bought += tr.total;
      s.peak = Math.max(s.peak, s.shares);
    } else {
      s.shares = Math.max(0, s.shares - tr.shares);
      s.sold += tr.total;
      if (s.shares <= 1e-9 && s.bought > 0) {
        out.push({
          symbol: tr.symbol,
          openedAt: s.openedAt,
          closedAt: tr.t,
          peakShares: s.peak,
          bought: s.bought,
          sold: s.sold,
          pnl: s.sold - s.bought,
          pnlPct: (s.sold - s.bought) / s.bought,
          trades: s.trades,
        });
        s.shares = 0;
      }
    }
    open.set(tr.symbol, s);
  }
  return out.sort((a, b) => b.closedAt - a.closedAt);
}

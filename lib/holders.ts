/**
 * lib/holders.ts — who holds a name, read off the ledger.
 *
 * A holder's row is mostly arithmetic on their holding (shares, average cost)
 * against the live price. Two things need the trade history instead, and
 * this module derives them so the page and the tests read the same rule:
 *
 *   · how long the CURRENT position has been open — the moment it last went
 *     from nothing to something. Selling out and buying back starts the
 *     clock again; trimming does not.
 *   · their latest written thesis on the name, with the print it rode in on.
 */

export interface HolderTrade {
  /** The trade's row id — a note on it can be liked by it. */
  id?: string;
  userId: string;
  side: "buy" | "sell";
  shares: number;
  /** epoch ms */
  at: number;
  note: string | null;
}

export interface HolderActivity {
  /** epoch ms the open position started, or null if the ledger has no buy. */
  heldSince: number | null;
  thesis: string | null;
  thesisAt: number | null;
  /** The print the thesis rode in on, when it is one. */
  thesisTradeId: string | null;
  lastTradeAt: number | null;
}

export function summariseHolderTrades(
  trades: HolderTrade[]
): Map<string, HolderActivity> {
  const book = new Map<string, HolderActivity & { position: number }>();
  for (const tr of [...trades].sort((a, b) => a.at - b.at)) {
    const s = book.get(tr.userId) ?? {
      position: 0,
      heldSince: null,
      thesis: null,
      thesisAt: null,
      thesisTradeId: null,
      lastTradeAt: null,
    };
    if (tr.side === "buy") {
      if (s.position <= 0) s.heldSince = tr.at;
      s.position += tr.shares;
    } else {
      s.position = Math.max(0, s.position - tr.shares);
      if (s.position === 0) s.heldSince = null;
    }
    if (tr.note && tr.note.trim()) {
      s.thesis = tr.note.trim();
      s.thesisAt = tr.at;
      s.thesisTradeId = tr.id ?? null;
    }
    s.lastTradeAt = tr.at;
    book.set(tr.userId, s);
  }
  const out = new Map<string, HolderActivity>();
  for (const [id, s] of book) {
    out.set(id, {
      heldSince: s.heldSince,
      thesis: s.thesis,
      thesisAt: s.thesisAt,
      thesisTradeId: s.thesisTradeId,
      lastTradeAt: s.lastTradeAt,
    });
  }
  return out;
}

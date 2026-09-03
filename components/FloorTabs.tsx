"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";
import type { FeedTrade, TickerPost } from "@/lib/data";
import { MIN_SIZE_PRESETS, minSizeLabel, passesMinSize } from "@/lib/min-size";
import { useLiveFills } from "@/lib/live";
import TradesList from "@/components/TradesList";
import ThesesPane from "@/components/ThesesPane";

// remembered per ticker: a whale-watch on one name must not silently empty
// the next name's floor, where every print is smaller
const storageKey = (symbol: string) => `sx:floor-min-size:${symbol}`;

/**
 * The floor's two tabs — the tape and the theses — with one filter over
 * both: the size behind what you are reading. A print filters on its own
 * notional; a thesis on the poster's live position in the name. So ">$10K"
 * is "what are the whales saying", and "All" is everyone.
 */
export default function FloorTabs({
  trades,
  posts,
  theses,
  symbol,
  signedIn,
  viewerId,
}: {
  trades: FeedTrade[];
  posts: TickerPost[];
  theses: FeedTrade[];
  symbol: string;
  signedIn: boolean;
  viewerId: string | null;
}) {
  const [tab, setTab] = useState<"trades" | "theses">("trades");
  const [min, setMin] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  // remembered per browser — a whale-watcher stays a whale-watcher
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(symbol));
      if (raw !== null) setMin(raw === "" ? null : Number(raw));
    } catch {
      // storage unavailable
    }
  }, [symbol]);
  const choose = (v: number | null) => {
    setMin(v);
    setOpen(false);
    try {
      localStorage.setItem(storageKey(symbol), v === null ? "" : String(v));
    } catch {
      // storage unavailable
    }
  };

  // your own prints, ahead of the server's copy of the tape; once a refresh
  // carries the real row (same side, size and name) the live one steps aside
  const liveFills = useLiveFills(symbol);
  const allTrades = useMemo(() => {
    const fresh = liveFills.filter(
      (f) =>
        !trades.some(
          (t) =>
            t.side === f.side &&
            t.shares === f.shares &&
            (t.username ?? null) === (f.username ?? null) &&
            Math.abs(Date.parse(t.created_at) - Date.parse(f.created_at)) < 120_000
        )
    );
    const rows: FeedTrade[] = fresh.map((f) => ({
      id: f.id,
      side: f.side,
      shares: f.shares,
      price: f.price,
      total: f.total,
      created_at: f.created_at,
      trader: f.trader,
      username: f.username,
      symbol: f.symbol,
      note: null,
      bot: false,
      likes: 0,
      likedByMe: false,
    }));
    return [...rows, ...trades];
  }, [liveFills, trades]);
  const shownTrades = useMemo(() => allTrades.filter((t) => passesMinSize(t.total, min)), [allTrades, min]);
  const shownPosts = useMemo(() => posts.filter((p) => passesMinSize(p.positionValue, min)), [posts, min]);
  const shownTheses = useMemo(() => theses.filter((t) => passesMinSize(t.total, min)), [theses, min]);

  const tabCls = (k: "trades" | "theses") =>
    `microlabel px-3 py-2.5 transition-colors ${
      tab === k ? "!text-terminal-text" : "hover:!text-terminal-text"
    }`;

  return (
    <section className="panel">
      <div className="relative flex items-center border-b border-terminal-line">
        <button type="button" onClick={() => setTab("trades")} className={tabCls("trades")}>
          Trades · {shownTrades.length}
        </button>
        <button type="button" onClick={() => setTab("theses")} className={tabCls("theses")}>
          Theses · {shownPosts.length + shownTheses.length}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`ml-auto mr-2 flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] transition-colors ${
            min !== null ? "text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"
          }`}
          title="Only show what is backed by at least this much"
        >
          <Filter size={11} />
          {minSizeLabel(min)}
          <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
            <div className="absolute right-2 top-full z-20 mt-1 w-40 rounded-md border border-terminal-line bg-terminal-panel p-1 shadow-lg">
              {MIN_SIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => choose(p.value)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-terminal-raise ${
                    min === p.value ? "text-terminal-text" : "text-terminal-muted"
                  }`}
                >
                  {p.label}
                  {min === p.value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              <form
                className="mt-1 flex items-center gap-1 border-t border-terminal-line pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(custom.replace(/[^0-9.]/g, ""));
                  if (n > 0) choose(n);
                }}
              >
                <span className="pl-2 font-mono text-xs text-terminal-muted">$</span>
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  inputMode="numeric"
                  placeholder="Custom"
                  aria-label="Custom minimum size"
                  className="input min-w-0 flex-1 px-1 py-1 font-mono text-xs"
                />
              </form>
            </div>
          </>
        )}
      </div>

      {/* the lists scroll inside the panel, so the floor keeps its height */}
      <div className="max-h-[560px] overflow-y-auto">
        {tab === "trades" ? (
          <>
            <TradesList trades={shownTrades} showSymbol={false} signedIn={signedIn} showNotes={false} />
            {shownTrades.length === 0 && allTrades.length > 0 && (
              <Hidden count={allTrades.length} min={min} onClear={() => choose(null)} what="prints" />
            )}
          </>
        ) : (
          shownPosts.length + shownTheses.length === 0 && posts.length + theses.length > 0 ? (
            <Hidden
              count={posts.length + theses.length}
              min={min}
              onClear={() => choose(null)}
              what="theses"
            />
          ) : (
            <ThesesPane
              posts={shownPosts}
              theses={shownTheses}
              symbol={symbol}
              viewerId={viewerId}
              signedIn={signedIn}
            />
          )
        )}
      </div>
    </section>
  );
}

/** The filter is hiding everything — say so, with the count, and a way out. */
function Hidden({
  count,
  min,
  onClear,
  what,
}: {
  count: number;
  min: number | null;
  onClear: () => void;
  what: "prints" | "theses";
}) {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 px-3 py-4 text-center font-mono text-[11px] text-terminal-muted">
      <span>
        {count} {what} here, none over {minSizeLabel(min).replace("Min size (>", "").replace(")", "")}
      </span>
      <button type="button" onClick={onClear} className="text-terminal-accent hover:underline">
        show all
      </button>
    </p>
  );
}

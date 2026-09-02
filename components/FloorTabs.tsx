"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Filter } from "lucide-react";
import type { FeedTrade, TickerPost } from "@/lib/data";
import { MIN_SIZE_PRESETS, minSizeLabel, passesMinSize } from "@/lib/min-size";
import TradesList from "@/components/TradesList";
import ThesesPane from "@/components/ThesesPane";

const STORAGE_KEY = "sx:floor-min-size";

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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) setMin(raw === "" ? null : Number(raw));
    } catch {
      // storage unavailable
    }
  }, []);
  const choose = (v: number | null) => {
    setMin(v);
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, v === null ? "" : String(v));
    } catch {
      // storage unavailable
    }
  };

  const shownTrades = useMemo(() => trades.filter((t) => passesMinSize(t.total, min)), [trades, min]);
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

      {tab === "trades" ? (
        <>
          <TradesList trades={shownTrades} showSymbol={false} signedIn={signedIn} showNotes={false} />
          {shownTrades.length === 0 && trades.length > 0 && (
            <p className="px-3 py-4 text-center font-mono text-[11px] text-terminal-muted">
              nothing that size recently — lower the filter
            </p>
          )}
          <Link
            href="/tape"
            className="block border-t border-terminal-line px-3 py-1.5 font-mono text-[11px] text-terminal-accent hover:underline"
          >
            full tape →
          </Link>
        </>
      ) : (
        <ThesesPane
          posts={shownPosts}
          theses={shownTheses}
          symbol={symbol}
          viewerId={viewerId}
          signedIn={signedIn}
          filtered={min !== null && posts.length + theses.length > 0}
        />
      )}
    </section>
  );
}

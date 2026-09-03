"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Filter } from "lucide-react";
import type { FeedTrade, TickerPost } from "@/lib/data";
import { MIN_SIZE_PRESETS, minSizeLabel, passesMinSize } from "@/lib/min-size";
import { publishFills, useLiveFills, type LiveFill } from "@/lib/live";
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
  tickerId,
  signedIn,
  viewerId,
  serverMin = null,
}: {
  trades: FeedTrade[];
  posts: TickerPost[];
  theses: FeedTrade[];
  symbol: string;
  /** For the poll — the tape route takes the id. */
  tickerId?: string;
  signedIn: boolean;
  viewerId: string | null;
  /** The filter the server already applied to these rows (from the URL). */
  serverMin?: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<"trades" | "theses">("trades");
  const [min, setMin] = useState<number | null>(serverMin);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  // remembered per browser — a whale-watcher stays a whale-watcher
  // The filter is applied where the rows are — in the query — so a choice
  // goes into the URL and the floor re-renders with every print over the
  // size, not just the ones that happened to be in the last sixty. The
  // client filter below still applies instantly to what is on screen.
  const navigate = (v: number | null) => {
    router.replace(v === null ? pathname : `${pathname}?min=${v}`, { scroll: false });
  };
  useEffect(() => {
    if (serverMin !== null) return; // the URL already says
    try {
      const raw = localStorage.getItem(storageKey(symbol));
      if (raw !== null && raw !== "") {
        const v = Number(raw);
        setMin(v);
        navigate(v);
      }
    } catch {
      // storage unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  const choose = (v: number | null) => {
    setMin(v);
    setOpen(false);
    try {
      localStorage.setItem(storageKey(symbol), v === null ? "" : String(v));
    } catch {
      // storage unavailable
    }
    navigate(v);
  };

  // The tape fills in as the market prints. Every few seconds the open
  // page asks for prints since the newest one it knows and the curve as it
  // stands; they land here ahead of the server's copy, and the chart, the
  // header and the ticket move on the curve they came with. Once a refresh
  // carries the real rows, the live copies step aside.
  const liveFills = useLiveFills(symbol);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const newest = useMemo(() => {
    const times = [...trades, ...liveFills.filter((f) => !f.id.startsWith("live-"))].map((t) => Date.parse(t.created_at));
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }, [trades, liveFills]);
  const newestRef = useRef(newest);
  newestRef.current = newest;
  useEffect(() => {
    if (!tickerId) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || document.hidden) return;
      try {
        const qs = new URLSearchParams({ ticker: tickerId });
        if (newestRef.current) qs.set("since", newestRef.current);
        const res = await fetch(`/api/tape?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { trades: FeedTrade[]; sentiment: number | null };
        const fills: LiveFill[] = json.trades.map((t) => ({
          id: t.id,
          symbol,
          side: t.side,
          shares: t.shares,
          price: t.price,
          total: t.total,
          trader: t.trader,
          username: t.username,
          created_at: t.created_at,
          note: t.note,
          bot: t.bot,
        }));
        publishFills(symbol, json.sentiment, fills);
        if (fills.length > 0) {
          setFreshIds(new Set(fills.map((f) => f.id)));
          setTimeout(() => setFreshIds(new Set()), 2_500);
        }
      } catch {
        // a missed poll is the next poll's problem
      }
    };
    const id = setInterval(tick, 4_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerId, symbol]);

  const allTrades = useMemo(() => {
    const serverIds = new Set(trades.map((t) => t.id));
    const fresh = liveFills.filter(
      (f) =>
        !serverIds.has(f.id) &&
        !trades.some(
          (t) =>
            f.id.startsWith("live-") &&
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
      note: f.note ?? null,
      bot: f.bot ?? false,
      likes: 0,
      likedByMe: false,
      buyback: false,
    }));
    return [...rows, ...trades];
  }, [liveFills, trades]);
  // a live print with a note is a thesis too
  const allTheses = useMemo(() => {
    const serverIds = new Set(theses.map((t) => t.id));
    const live = allTrades.filter((t) => t.note && !serverIds.has(t.id) && !trades.some((s) => s.id === t.id));
    return [...live, ...theses];
  }, [allTrades, theses, trades]);
  const shownTrades = useMemo(() => allTrades.filter((t) => passesMinSize(t.total, min)), [allTrades, min]);
  const shownPosts = useMemo(() => posts.filter((p) => passesMinSize(p.positionValue, min)), [posts, min]);
  const shownTheses = useMemo(() => allTheses.filter((t) => passesMinSize(t.total, min)), [allTheses, min]);

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

      {min !== null && (
        <p className="flex items-center justify-between gap-2 border-b border-terminal-line/60 px-3 py-1 font-mono text-[10px] text-terminal-muted">
          <span>
            {tab === "trades" ? "prints" : "theses backed by"} over {minSizeLabel(min).replace("Min size (>", "").replace(")", "")}
            {" · "}last 200 on the tape
          </span>
          <button type="button" onClick={() => choose(null)} className="text-terminal-accent hover:underline">
            show all
          </button>
        </p>
      )}
      {/* the lists scroll inside the panel, so the floor keeps its height */}
      <div className="max-h-[560px] overflow-y-auto">
        {tab === "trades" ? (
          <>
            <TradesList
              trades={shownTrades}
              showSymbol={false}
              signedIn={signedIn}
              showNotes={false}
              freshIds={freshIds}
            />
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

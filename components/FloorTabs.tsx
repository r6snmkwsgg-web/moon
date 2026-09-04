"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Filter } from "lucide-react";
import type { FeedTrade, TickerPost } from "@/lib/data";
import { MIN_SIZE_PRESETS, minSizeLabel, passesMinSize } from "@/lib/min-size";
import { publishFills, useLiveFills, type LiveFill } from "@/lib/live";
import TradesList from "@/components/TradesList";
import ThesesPane from "@/components/ThesesPane";

/** Rows per page when scrolling back through the history. */
const PAGE = 60;

type Tab = "trades" | "theses";

/** What has been paged in below the server's rows, per list. */
interface Older {
  trades: FeedTrade[];
  theses: FeedTrade[];
  posts: TickerPost[];
}
const NONE: Older = { trades: [], theses: [], posts: [] };
const OPEN = { trades: false, theses: false, posts: false };

function oldestOf(rows: { created_at: string }[]): string | null {
  let best: string | null = null;
  for (const r of rows) if (best === null || r.created_at < best) best = r.created_at;
  return best;
}

function dedupe<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/**
 * The floor's two tabs — the tape and the theses — with one filter over
 * both: the size behind what you are reading. A print filters on its own
 * notional; a thesis on the poster's live position in the name. So ">$10K"
 * is "what are the whales saying", and "All" is everyone.
 *
 * Nothing here ever goes away. The server sends the newest page; the poll
 * adds what prints while the page is open; and scrolling to the bottom
 * pages back through the whole history, one page at a time, until the
 * first print on the name. A thesis written on a trade stays on the floor
 * whether or not its author is still in the name.
 */
export default function FloorTabs({
  trades,
  posts,
  theses,
  symbol,
  tickerId,
  price = 0,
  counts,
  signedIn,
  viewerId,
  serverMin = null,
}: {
  trades: FeedTrade[];
  posts: TickerPost[];
  theses: FeedTrade[];
  symbol: string;
  /** For the poll and the paging — the tape route takes the id. */
  tickerId?: string;
  /** The live price — a paged-in post's position is valued at it. */
  price?: number;
  /** How many prints and theses the name has in total — the tab labels. */
  counts?: { trades: number; theses: number };
  signedIn: boolean;
  viewerId: string | null;
  /** The filter the server already applied to these rows (from the URL). */
  serverMin?: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>("trades");
  const [min, setMin] = useState<number | null>(serverMin);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  // The filter is applied where the rows are — in the query — so a choice
  // goes into the URL and the floor re-renders with every print over the
  // size. It lives in the URL and nowhere else: a fresh visit starts at
  // "All", so a filter picked last week cannot quietly hide today's floor.
  const navigate = (v: number | null) => {
    router.replace(v === null ? pathname : `${pathname}?min=${v}`, { scroll: false });
  };
  const choose = (v: number | null) => {
    setMin(v);
    setOpen(false);
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

  // what has been paged in below the server's rows, and whether there is more
  const [older, setOlder] = useState<Older>(NONE);
  const [done, setDone] = useState(OPEN);
  const [loading, setLoading] = useState(false);

  // Nothing shown is ever dropped. The server's page is the newest sixty
  // at each refresh, so on a busy name the sixty-first print — the one you
  // were reading — used to fall off the list every thirty seconds. Every
  // row that has ever reached this page (a server page, a paged-in page,
  // a live print) is kept here and merged with the next, newest first; a
  // server row wins over a live copy of the same print, since it carries
  // the hearts and the buyback flag, and a placeholder for your own fill
  // steps aside once the real print arrives.
  const knownTrades = useRef(new Map<string, FeedTrade>());
  const knownTheses = useRef(new Map<string, FeedTrade>());
  const knownPosts = useRef(new Map<string, TickerPost>());
  /** The oldest post the pager has READ. Under a size filter most rows are
   *  dropped, so paging from the oldest row still on screen re-reads the
   *  same window forever. */
  const oldestScanned = useRef<string | null>(null);
  const byNewest = (a: { created_at: string }, b: { created_at: string }) =>
    b.created_at.localeCompare(a.created_at);

  const allTrades = useMemo(() => {
    const known = knownTrades.current;
    for (const t of [...older.trades, ...trades]) known.set(t.id, t);
    // a live placeholder matched by a real print goes
    for (const f of liveFills) {
      if (!f.id.startsWith("live-")) continue;
      const matched = trades.some(
        (t) =>
          t.side === f.side &&
          t.shares === f.shares &&
          (t.username ?? null) === (f.username ?? null) &&
          Math.abs(Date.parse(t.created_at) - Date.parse(f.created_at)) < 120_000
      );
      if (matched) known.delete(f.id);
    }
    for (const f of liveFills) {
      if (known.has(f.id)) continue;
      if (f.id.startsWith("live-")) {
        const matched = trades.some(
          (t) =>
            t.side === f.side &&
            t.shares === f.shares &&
            (t.username ?? null) === (f.username ?? null) &&
            Math.abs(Date.parse(t.created_at) - Date.parse(f.created_at)) < 120_000
        );
        if (matched) continue;
      }
      known.set(f.id, {
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
      });
    }
    return [...known.values()].sort(byNewest);
  }, [liveFills, trades, older.trades]);
  // a live print with a note is a thesis too
  const allTheses = useMemo(() => {
    const known = knownTheses.current;
    for (const t of [...older.theses, ...theses]) known.set(t.id, t);
    for (const t of allTrades) if (t.note && !known.has(t.id)) known.set(t.id, t);
    return [...known.values()].sort(byNewest);
  }, [allTrades, theses, older.theses]);
  const allPosts = useMemo(() => {
    const known = knownPosts.current;
    // Reconcile, do not just accumulate. The server's page is authoritative
    // over the window it covers, so anything inside that window which the
    // server no longer returns has been deleted — otherwise deleting your
    // own thesis left the row on the floor until a hard reload.
    if (posts.length > 0) {
      const oldest = posts[posts.length - 1].created_at;
      const live = new Set(posts.map((p) => p.id));
      for (const [id, p] of known) {
        if (p.created_at >= oldest && !live.has(id)) known.delete(id);
      }
    }
    for (const p of [...older.posts, ...posts]) known.set(p.id, p);
    return [...known.values()].sort(byNewest);
  }, [posts, older.posts]);
  // ── paging back through the history ────────────────────────────────────
  // the pages were fetched under one filter; a new filter starts over
  useEffect(() => {
    setOlder(NONE);
    setDone(OPEN);
    knownTrades.current.clear();
    knownTheses.current.clear();
    knownPosts.current.clear();
    oldestScanned.current = null;
  }, [serverMin, tickerId]);

  const fetchPage = useCallback(
    async (kind: "trades" | "theses" | "posts", before: string | null) => {
      const qs = new URLSearchParams({ ticker: tickerId ?? "", kind, limit: String(PAGE) });
      if (before) qs.set("before", before);
      if (serverMin !== null && serverMin > 0) qs.set("min", String(serverMin));
      if (kind === "posts") qs.set("price", String(price));
      const res = await fetch(`/api/tape?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`tape ${res.status}`);
      return (await res.json()) as {
        trades?: FeedTrade[];
        posts?: TickerPost[];
        /** posts read before the size filter — exhaustion keys off this, not
         *  off how many survived it */
        scanned?: number;
        exhausted?: boolean;
      };
    },
    [tickerId, serverMin, price]
  );

  const loadMore = useCallback(async () => {
    if (loading || !tickerId) return;
    const wants =
      tab === "trades" ? !done.trades : !done.theses || !done.posts;
    if (!wants) return;
    setLoading(true);
    try {
      if (tab === "trades") {
        const before = oldestOf(allTrades.filter((t) => !t.id.startsWith("live-")));
        const { trades: rows = [] } = await fetchPage("trades", before);
        setOlder((o) => ({ ...o, trades: dedupe([...o.trades, ...rows]) }));
        if (rows.length < PAGE) setDone((d) => ({ ...d, trades: true }));
      } else {
        // the two lists on the theses tab page on their own clocks
        await Promise.all([
          done.theses
            ? null
            : fetchPage("theses", oldestOf(allTheses.filter((t) => !t.id.startsWith("live-")))).then(({ trades: rows = [] }) => {
                setOlder((o) => ({ ...o, theses: dedupe([...o.theses, ...rows]) }));
                if (rows.length < PAGE) setDone((d) => ({ ...d, theses: true }));
              }),
          done.posts
            ? null
            : fetchPage("posts", oldestScanned.current ?? oldestOf(allPosts)).then(
                ({ posts: rows = [], exhausted }) => {
                  setOlder((o) => ({ ...o, posts: dedupe([...o.posts, ...rows]) }));
                  if (rows.length > 0) oldestScanned.current = rows[rows.length - 1].created_at;
                  if (exhausted) setDone((d) => ({ ...d, posts: true }));
                }
              ),
        ]);
      }
    } catch {
      // the next scroll tries again
    } finally {
      setLoading(false);
    }
  }, [loading, tickerId, tab, done, allTrades, allTheses, allPosts, fetchPage]);

  // The bottom of the list asks for the next page as it comes into view.
  //
  // loadMore closes over the accumulated rows, so it is a new function on
  // every render — and rebuilding the observer with it meant a fresh
  // observer fired an immediate "is intersecting" callback on every render,
  // including the one caused by the page it had just loaded. The floor paged
  // itself to the beginning of time without anyone scrolling. The callback
  // reads the latest loadMore through a ref instead, and the observer is
  // built once per scroll container.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    let armed = false;
    const io = new IntersectionObserver(
      (entries) => {
        // the observer always reports once on connect; that first report is
        // the current state, not a scroll
        if (!armed) {
          armed = true;
          return;
        }
        if (entries.some((e) => e.isIntersecting)) void loadMoreRef.current();
      },
      { root, rootMargin: "120px 0px" }
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  const shownTrades = useMemo(() => allTrades.filter((t) => passesMinSize(t.total, min)), [allTrades, min]);
  const shownPosts = useMemo(() => allPosts.filter((p) => passesMinSize(p.positionValue, min)), [allPosts, min]);
  const shownTheses = useMemo(() => allTheses.filter((t) => passesMinSize(t.total, min)), [allTheses, min]);

  // the label counts the whole history as of the last refresh, plus what
  // has printed since; under a filter it counts what the filter lets through
  const serverNewest = trades[0]?.created_at ?? "";
  const liveExtra = allTrades.filter((t) => t.created_at > serverNewest).length;
  const tradesCount = min === null && counts ? counts.trades + liveExtra : shownTrades.length;
  const newestThesis = [theses[0]?.created_at ?? "", posts[0]?.created_at ?? ""].sort().reverse()[0];
  const liveTheses = allTheses.filter((t) => t.created_at > newestThesis).length;
  const thesesCount =
    min === null && counts ? counts.theses + liveTheses : shownPosts.length + shownTheses.length;
  const more = tab === "trades" ? !done.trades : !done.theses || !done.posts;

  const tabCls = (k: Tab) =>
    `microlabel px-3 py-2.5 transition-colors ${
      tab === k ? "!text-terminal-text" : "hover:!text-terminal-text"
    }`;

  return (
    <section className="panel">
      <div className="relative flex items-center border-b border-terminal-line">
        <button type="button" onClick={() => setTab("trades")} className={tabCls("trades")}>
          Trades · {tradesCount.toLocaleString("en-US")}
        </button>
        <button type="button" onClick={() => setTab("theses")} className={tabCls("theses")}>
          Theses · {thesesCount.toLocaleString("en-US")}
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
            {" · "}scroll for older
          </span>
          <button type="button" onClick={() => choose(null)} className="text-terminal-accent hover:underline">
            show all
          </button>
        </p>
      )}
      {/* the lists scroll inside the panel, so the floor keeps its height;
          the bottom of the scroll pages the history in */}
      <div ref={scrollRef} className="max-h-[560px] overflow-y-auto">
        {tab === "trades" ? (
          <>
            {!(shownTrades.length === 0 && min !== null) && (
              <TradesList
                trades={shownTrades}
                showSymbol={false}
                signedIn={signedIn}
                showNotes={false}
                freshIds={freshIds}
              />
            )}
            {shownTrades.length === 0 && min !== null && (
              <Hidden count={allTrades.length} min={min} onClear={() => choose(null)} what="prints" />
            )}
          </>
        ) : (
          shownPosts.length + shownTheses.length === 0 && min !== null ? (
            <Hidden
              count={allPosts.length + allTheses.length}
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
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        {tickerId && (more || loading) && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="w-full border-t border-terminal-line/40 px-3 py-2 text-center font-mono text-[11px] text-terminal-muted transition-colors hover:text-terminal-text disabled:opacity-60"
          >
            {loading ? "loading…" : "older"}
          </button>
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
        {count > 0
          ? `${count} ${what} here, none over ${minSizeLabel(min).replace("Min size (>", "").replace(")", "")}`
          : `nothing over ${minSizeLabel(min).replace("Min size (>", "").replace(")", "")} on this name`}
      </span>
      <button type="button" onClick={onClear} className="text-terminal-accent hover:underline">
        show all
      </button>
    </p>
  );
}

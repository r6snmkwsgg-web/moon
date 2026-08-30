"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ChevronDown,
  Circle,
  Code2,
  CreditCard,
  Layers,
  Megaphone,
  Palette,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { TickerQuote } from "@/lib/types";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import { SECTORS, sectorMeta, sectorOf } from "@/lib/sectors";
import ChangePct from "@/components/ChangePct";
import LivePrice from "@/components/LivePrice";
import LogoTile from "@/components/LogoTile";
import Sparkline from "@/components/Sparkline";
import TickerBadges from "@/components/TickerBadges";
import Tri from "@/components/Tri";

/* ── the filter model ──────────────────────────────────────────────── */

type SortKey = "cap" | "price" | "day" | "week" | "mrr" | "mult" | "symbol" | "new";
type Trust = "any" | "verified" | "founder";
type MrrBand = "any" | "micro" | "small" | "mid" | "large";
type ValueBand = "any" | "value" | "fair" | "premium";
type Move = "any" | "up" | "down" | "big";

interface Filters {
  q: string;
  trust: Trust;
  mrr: MrrBand;
  value: ValueBand;
  move: Move;
  hideDemo: boolean;
  newOnly: boolean;
}

const BLANK: Filters = {
  q: "",
  trust: "any",
  mrr: "any",
  value: "any",
  move: "any",
  hideDemo: false,
  newOnly: false,
};

const NEW_WINDOW_MS = 7 * 86400_000;

const SORTS: Record<SortKey, (a: TickerQuote, b: TickerQuote) => number> = {
  cap: (a, b) => b.marketCap - a.marketCap,
  price: (a, b) => b.price - a.price,
  day: (a, b) => b.dayChange - a.dayChange,
  week: (a, b) => b.weekChange - a.weekChange,
  mrr: (a, b) => b.latestMrr - a.latestMrr,
  mult: (a, b) => b.multiple - a.multiple,
  symbol: (a, b) => a.ticker.symbol.localeCompare(b.ticker.symbol),
  new: (a, b) => b.ticker.listed_at.localeCompare(a.ticker.listed_at),
};

const TRUSTS: { v: Trust; label: string }[] = [
  { v: "any", label: "Any" },
  { v: "verified", label: "Stripe-verified" },
  { v: "founder", label: "Founder on it" },
];

const MRRS: { v: MrrBand; label: string; test: (q: TickerQuote) => boolean }[] = [
  { v: "any", label: "Any", test: () => true },
  { v: "micro", label: "< $1k", test: (q) => q.latestMrr < 1_000 },
  { v: "small", label: "$1k–10k", test: (q) => q.latestMrr >= 1_000 && q.latestMrr < 10_000 },
  { v: "mid", label: "$10k–50k", test: (q) => q.latestMrr >= 10_000 && q.latestMrr < 50_000 },
  { v: "large", label: "$50k+", test: (q) => q.latestMrr >= 50_000 },
];

const VALUES: { v: ValueBand; label: string; test: (q: TickerQuote) => boolean }[] = [
  { v: "any", label: "Any", test: () => true },
  { v: "value", label: "Under 2.5×", test: (q) => q.multiple < 2.5 },
  { v: "fair", label: "2.5–4×", test: (q) => q.multiple >= 2.5 && q.multiple < 4 },
  { v: "premium", label: "4×+", test: (q) => q.multiple >= 4 },
];

const MOVES: { v: Move; label: string; test: (q: TickerQuote) => boolean }[] = [
  { v: "any", label: "Any", test: () => true },
  { v: "up", label: "Green today", test: (q) => q.dayChange > 0 },
  { v: "down", label: "Red today", test: (q) => q.dayChange < 0 },
  { v: "big", label: "Moved 5%+", test: (q) => Math.abs(q.dayChange) >= 0.05 },
];

const SORT_LABELS: { v: SortKey; label: string }[] = [
  { v: "cap", label: "Market cap" },
  { v: "price", label: "Price" },
  { v: "day", label: "24h" },
  { v: "week", label: "7d" },
  { v: "mrr", label: "MRR" },
  { v: "mult", label: "Multiple" },
  { v: "symbol", label: "A–Z" },
  { v: "new", label: "Newest" },
];

const SECTOR_ICONS: Record<string, typeof Circle> = {
  sparkles: Sparkles,
  chart: BarChart3,
  megaphone: Megaphone,
  code: Code2,
  palette: Palette,
  card: CreditCard,
  layers: Layers,
  circle: Circle,
};

function isNew(q: TickerQuote): boolean {
  return Date.now() - new Date(q.ticker.listed_at).getTime() < NEW_WINDOW_MS;
}

/** Everything except the sector cut — so the rail can show honest counts. */
function passesFilters(q: TickerQuote, f: Filters): boolean {
  const needle = f.q.trim().toLowerCase().replace(/^\$/, "");
  if (needle) {
    const hay = `${q.ticker.symbol} ${q.ticker.name} ${q.ticker.pitch}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (f.trust === "verified" && !q.ticker.stripe_verified) return false;
  if (f.trust === "founder" && !(q.ticker.claimed || q.ticker.handle_verified))
    return false;
  if (f.hideDemo && q.ticker.fixture) return false;
  if (f.newOnly && !isNew(q)) return false;
  if (!MRRS.find((b) => b.v === f.mrr)!.test(q)) return false;
  if (!VALUES.find((b) => b.v === f.value)!.test(q)) return false;
  if (!MOVES.find((b) => b.v === f.move)!.test(q)) return false;
  return true;
}

/** The chips shown when the filter drawer is shut — one per active filter. */
function activeChips(f: Filters): { key: string; label: string; clear: Partial<Filters> }[] {
  const out: { key: string; label: string; clear: Partial<Filters> }[] = [];
  if (f.q.trim())
    out.push({ key: "q", label: `“${f.q.trim()}”`, clear: { q: "" } });
  if (f.trust !== "any")
    out.push({
      key: "trust",
      label: TRUSTS.find((t) => t.v === f.trust)!.label,
      clear: { trust: "any" },
    });
  if (f.mrr !== "any")
    out.push({
      key: "mrr",
      label: `MRR ${MRRS.find((b) => b.v === f.mrr)!.label}`,
      clear: { mrr: "any" },
    });
  if (f.value !== "any")
    out.push({
      key: "value",
      label: `${VALUES.find((b) => b.v === f.value)!.label} ARR`,
      clear: { value: "any" },
    });
  if (f.move !== "any")
    out.push({
      key: "move",
      label: MOVES.find((b) => b.v === f.move)!.label,
      clear: { move: "any" },
    });
  if (f.hideDemo)
    out.push({ key: "demo", label: "No demo listings", clear: { hideDemo: false } });
  if (f.newOnly)
    out.push({ key: "new", label: "Listed this week", clear: { newOnly: false } });
  return out;
}

/* ── small controls ────────────────────────────────────────────────── */

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="microlabel mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
              value === o.v
                ? "border-terminal-accent/60 bg-terminal-accent/15 text-terminal-accent"
                : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
        on
          ? "border-terminal-accent/60 bg-terminal-accent/15 text-terminal-accent"
          : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-[2px] border ${
          on ? "border-terminal-accent bg-terminal-accent" : "border-terminal-muted/60"
        }`}
      />
      {children}
    </button>
  );
}

/* ── the board ─────────────────────────────────────────────────────── */

/**
 * The market: sectors down the left, the board on the right, and every
 * filter tucked behind one button so the default view stays a table of
 * prices instead of a control panel.
 */
export default function MarketBoard({ quotes }: { quotes: TickerQuote[] }) {
  const [sector, setSector] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Filters>(BLANK);
  const [sort, setSort] = useState<{ key: SortKey; flip: boolean }>({
    key: "cap",
    flip: false,
  });

  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));

  // sector per ticker, computed once
  const withSector = useMemo(
    () => quotes.map((q) => ({ q, sector: sectorOf(q.ticker) })),
    [quotes]
  );

  // everything except the sector cut — the rail's counts come off this
  const filtered = useMemo(
    () => withSector.filter(({ q }) => passesFilters(q, f)),
    [withSector, f]
  );

  const facets = useMemo(() => {
    const map = new Map<string, { n: number; cap: number; weighted: number }>();
    for (const { q, sector: id } of filtered) {
      const cur = map.get(id) ?? { n: 0, cap: 0, weighted: 0 };
      cur.n += 1;
      cur.cap += q.marketCap;
      cur.weighted += q.weekChange * q.marketCap;
      map.set(id, cur);
    }
    return map;
  }, [filtered]);

  // only sectors that exist on the board at all get a rail row
  const present = useMemo(() => {
    const ids = new Set(withSector.map((r) => r.sector));
    return SECTORS.filter((s) => ids.has(s.id));
  }, [withSector]);

  const rows = useMemo(() => {
    const cut =
      sector === "all" ? filtered : filtered.filter((r) => r.sector === sector);
    const sorted = [...cut].sort((a, b) => SORTS[sort.key](a.q, b.q));
    return sort.flip ? sorted.reverse() : sorted;
  }, [filtered, sector, sort]);

  const shownCap = rows.reduce((s, r) => s + r.q.marketCap, 0);
  const totalCap = filtered.reduce((s, r) => s + r.q.marketCap, 0);
  const chips = activeChips(f);
  const meta = sector === "all" ? null : sectorMeta(sector);

  function clickSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key ? { key, flip: !cur.flip } : { key, flip: false }
    );
  }

  function railRow(
    id: string,
    label: string,
    title: string,
    Icon: typeof Circle,
    n: number,
    cap: number,
    week: number
  ) {
    const on = sector === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setSector(id)}
        title={title}
        className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-2 text-left transition-colors ${
          on
            ? "border-terminal-accent bg-terminal-accent/10"
            : "border-transparent hover:bg-terminal-raise/60"
        } ${n === 0 ? "opacity-40" : ""}`}
      >
        <Icon
          size={13}
          className={on ? "text-terminal-accent" : "text-terminal-muted"}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[12px] font-semibold ${
              on ? "text-terminal-text" : "text-terminal-muted"
            }`}
          >
            {label}
          </span>
          <span className="num block font-mono text-[10px] text-terminal-muted/80">
            {n} · {fmtCompact(cap)}
          </span>
        </span>
        <span
          className={`num font-mono text-[10px] ${
            week >= 0 ? "text-terminal-up" : "text-terminal-down"
          }`}
        >
          {n === 0 ? "" : fmtPct(week)}
        </span>
      </button>
    );
  }

  // `at` gates a column to wider screens — the widest ones earn extra signal
  const headers: { key: SortKey | null; label: string; at?: string }[] = [
    { key: "symbol", label: "Ticker" },
    { key: "price", label: "Price" },
    { key: "day", label: "24h" },
    { key: "week", label: "7d", at: "hidden sm:table-cell" },
    { key: "mrr", label: "MRR", at: "hidden sm:table-cell" },
    { key: "mult", label: "× ARR", at: "hidden lg:table-cell" },
    { key: "cap", label: "Mkt cap" },
    { key: null, label: "30d" },
  ];

  return (
    <section className="grid items-start gap-3 xl:grid-cols-[184px_1fr]">
      {/* sector rail — the shelves */}
      <aside className="panel hidden self-start overflow-hidden xl:sticky xl:top-[68px] xl:block">
        <div className="microlabel border-b border-terminal-line px-2.5 py-2">
          Sectors
        </div>
        <div className="divide-y divide-terminal-line/40">
          {railRow(
            "all",
            "All listings",
            "Every sector",
            Layers,
            filtered.length,
            totalCap,
            totalCap
              ? filtered.reduce((s, r) => s + r.q.weekChange * r.q.marketCap, 0) /
                totalCap
              : 0
          )}
          {present.map((s) => {
            const stat = facets.get(s.id) ?? { n: 0, cap: 0, weighted: 0 };
            return railRow(
              s.id,
              s.short,
              s.label,
              SECTOR_ICONS[s.icon] ?? Circle,
              stat.n,
              stat.cap,
              stat.cap ? stat.weighted / stat.cap : 0
            );
          })}
        </div>
      </aside>

      {/* sector chips — the rail, folded up for small screens */}
      <div className="-mx-4 overflow-x-auto px-4 xl:hidden">
        <div className="flex min-w-max gap-1.5 pb-0.5">
          {[{ id: "all", short: "All", icon: "layers" }, ...present].map((s) => {
            const on = sector === s.id;
            const n =
              s.id === "all" ? filtered.length : (facets.get(s.id)?.n ?? 0);
            const Icon = SECTOR_ICONS[s.icon] ?? Circle;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSector(s.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
                  on
                    ? "border-terminal-accent/60 bg-terminal-accent/15 text-terminal-accent"
                    : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
                }`}
              >
                <Icon size={12} />
                {s.short}
                <span className="num font-mono text-[10px] opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel min-w-0 self-start">
        {/* header: what you're looking at, and the one filter button */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-terminal-line px-3 py-2.5">
          <span className="microlabel font-bold !text-terminal-text">
            {meta ? meta.label : "The board"}
          </span>
          <span className="microlabel">
            {rows.length} listed · {fmtCompact(shownCap)} cap
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] font-semibold transition-colors ${
                open || chips.length
                  ? "border-terminal-accent/60 bg-terminal-accent/10 text-terminal-accent"
                  : "border-terminal-line text-terminal-muted hover:border-terminal-muted hover:text-terminal-text"
              }`}
            >
              <SlidersHorizontal size={11} />
              Filters
              {chips.length > 0 && (
                <span className="num rounded-full bg-terminal-accent px-1.5 text-[10px] font-bold text-black">
                  {chips.length}
                </span>
              )}
              <ChevronDown
                size={11}
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
            <Link
              href="/list"
              className="flex items-center gap-1 whitespace-nowrap rounded-md border border-terminal-accent/50 bg-terminal-accent/10 px-2 py-1 font-mono text-[11px] font-semibold text-terminal-accent hover:bg-terminal-accent/20"
            >
              <Plus size={11} strokeWidth={2.5} />
              List yours
            </Link>
          </div>
        </div>

        {meta && (
          <div className="border-b border-terminal-line/60 px-3 py-1.5 text-[12px] text-terminal-muted">
            {meta.blurb}
          </div>
        )}

        {/* the drawer: every filter, all at once, only when asked for */}
        {open && (
          <div className="space-y-3 border-b border-terminal-line bg-terminal-bg/40 px-3 py-3">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-terminal-muted">
                <Search size={13} />
              </span>
              <input
                value={f.q}
                onChange={(e) => set({ q: e.target.value })}
                placeholder="Filter these rows — symbol, name or pitch"
                aria-label="Filter listings"
                className="w-full rounded-md border border-terminal-line bg-terminal-bg py-1.5 pl-8 pr-3 text-[13px] text-terminal-text placeholder:text-terminal-muted/60 focus:border-terminal-accent focus:outline-none"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Seg
                label="Trust"
                value={f.trust}
                options={TRUSTS}
                onChange={(v) => set({ trust: v })}
              />
              <Seg
                label="Monthly revenue"
                value={f.mrr}
                options={MRRS}
                onChange={(v) => set({ mrr: v })}
              />
              <Seg
                label="Valuation (× ARR)"
                value={f.value}
                options={VALUES}
                onChange={(v) => set({ value: v })}
              />
              <Seg
                label="Today"
                value={f.move}
                options={MOVES}
                onChange={(v) => set({ move: v })}
              />
              <Seg
                label="Sort by"
                value={sort.key}
                options={SORT_LABELS}
                onChange={(v) => setSort({ key: v, flip: false })}
              />
              <div>
                <div className="microlabel mb-1.5">Listing</div>
                <div className="flex flex-wrap gap-1">
                  <Toggle
                    on={f.hideDemo}
                    onClick={() => set({ hideDemo: !f.hideDemo })}
                  >
                    Hide demo listings
                  </Toggle>
                  <Toggle
                    on={f.newOnly}
                    onClick={() => set({ newOnly: !f.newOnly })}
                  >
                    Listed this week
                  </Toggle>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setF(BLANK);
                  setSector("all");
                }}
                className="font-mono text-[11px] text-terminal-muted hover:text-terminal-text"
              >
                Reset all
              </button>
              <span className="num ml-auto font-mono text-[11px] text-terminal-muted">
                {rows.length} of {quotes.length} listings
              </span>
            </div>
          </div>
        )}

        {/* what's on, when the drawer is shut */}
        {!open && chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-terminal-line/60 px-3 py-2">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => set(c.clear)}
                className="flex items-center gap-1 rounded border border-terminal-accent/40 bg-terminal-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-terminal-accent hover:bg-terminal-accent/20"
              >
                {c.label}
                <X size={10} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setF(BLANK)}
              className="font-mono text-[11px] text-terminal-muted hover:text-terminal-text"
            >
              clear
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead>
              <tr className="border-b border-terminal-line text-left">
                {headers.map((h, i) => (
                  <th
                    key={h.label}
                    className={`px-3 py-2 font-normal ${
                      i === 0 ? "" : "text-right"
                    } ${h.at ?? ""}`}
                  >
                    {h.key ? (
                      <button
                        type="button"
                        onClick={() => clickSort(h.key!)}
                        className={`microlabel inline-flex items-center gap-1 transition-colors hover:!text-terminal-text ${
                          sort.key === h.key ? "!text-terminal-text" : ""
                        }`}
                      >
                        {h.label}
                        {sort.key === h.key && (
                          <Tri dir={sort.flip ? "up" : "down"} size={5} />
                        )}
                      </button>
                    ) : (
                      <span className="microlabel">{h.label}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ q, sector: id }) => (
                <tr
                  key={q.ticker.id}
                  className="row-hover border-b border-terminal-line/40 last:border-0"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/t/${q.ticker.symbol}`}
                      className="flex items-center gap-2.5"
                    >
                      <LogoTile
                        symbol={q.ticker.symbol}
                        logoUrl={q.ticker.logo_url}
                        size={28}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-mono font-bold">
                          ${q.ticker.symbol}
                          <TickerBadges ticker={q.ticker} compact />
                        </span>
                        <span className="block max-w-[150px] truncate text-xs text-terminal-muted sm:max-w-[220px]">
                          {q.ticker.name}
                          {sector === "all" && (
                            <span className="hidden text-terminal-muted/60 sm:inline">
                              {" · "}
                              {sectorMeta(id).short}
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    <LivePrice value={q.price} formatted={fmtPrice(q.price)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ChangePct value={q.dayChange} chip />
                  </td>
                  <td className="hidden px-3 py-2 text-right sm:table-cell">
                    <ChangePct value={q.weekChange} className="text-xs" />
                  </td>
                  <td className="num hidden px-3 py-2 text-right font-mono text-terminal-amber sm:table-cell">
                    {fmtCompact(q.latestMrr)}
                  </td>
                  <td
                    className="num hidden px-3 py-2 text-right font-mono text-terminal-muted lg:table-cell"
                    title="The ARR multiple this ticker's revenue record earns"
                  >
                    {q.multiple.toFixed(1)}×
                  </td>
                  <td className="num px-3 py-2 text-right font-mono text-terminal-muted">
                    {fmtCompact(q.marketCap)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Sparkline values={q.spark} up={q.weekChange >= 0} />
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-10 text-center text-sm text-terminal-muted"
                  >
                    {quotes.length === 0 ? (
                      <>
                        No tickers listed yet.{" "}
                        <Link href="/list" className="text-terminal-accent">
                          Be the first →
                        </Link>
                      </>
                    ) : (
                      <>
                        Nothing matches those filters.{" "}
                        <button
                          type="button"
                          onClick={() => {
                            setF(BLANK);
                            setSector("all");
                          }}
                          className="text-terminal-accent hover:underline"
                        >
                          Reset
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

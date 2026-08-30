"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Zap } from "lucide-react";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { SearchTicker, SearchTrader } from "@/app/api/search/route";
import LogoTile from "@/components/LogoTile";
import Tri from "@/components/Tri";

interface Results {
  tickers: SearchTicker[];
  traders: SearchTrader[];
}

const EMPTY: Results = { tickers: [], traders: [] };

/**
 * Site-wide search: tickers by symbol, name or pitch, and traders by handle.
 * ⌘K / Ctrl-K from anywhere, arrow keys through the results, Enter to go.
 */
export default function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results>(EMPTY);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flat: { href: string; key: string }[] = [
    ...results.tickers.map((t) => ({ href: `/t/${t.symbol}`, key: t.symbol })),
    ...results.traders.map((t) => ({
      href: `/u/${t.username}`,
      key: t.username,
    })),
  ];

  // ⌘K from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // click-away
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const run = useCallback((value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length === 0) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const json = (await res.json()) as Results;
        setResults(json);
        setCursor(0);
      } catch {
        setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 180);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = flat[cursor];
      if (target) {
        setOpen(false);
        setQ("");
        setResults(EMPTY);
        router.push(target.href);
      }
    }
  }

  const showPanel = open && q.trim().length > 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-xs">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-terminal-muted">
        <Search size={14} />
      </span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          run(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search tickers, founders, traders…"
        aria-label="Search"
        className="w-full rounded-md border border-terminal-line bg-terminal-panel py-1.5 pl-8 pr-8 text-sm text-terminal-text placeholder:text-terminal-muted/70 focus:border-terminal-accent focus:outline-none"
      />
      {q.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setResults(EMPTY);
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-2 flex items-center text-terminal-muted hover:text-terminal-text"
          aria-label="Clear search"
        >
          <X size={13} />
        </button>
      ) : (
        <span className="pointer-events-none absolute inset-y-0 right-2 hidden items-center font-mono text-[10px] text-terminal-muted/70 lg:flex">
          ⌘K
        </span>
      )}

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-md border border-terminal-line bg-terminal-panel shadow-2xl">
          {flat.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-terminal-muted">
              {loading ? "searching…" : `Nothing matches “${q.trim()}”.`}
            </p>
          ) : (
            <>
              {results.tickers.length > 0 && (
                <div>
                  <div className="microlabel border-b border-terminal-line/60 px-3 py-1.5">
                    Tickers
                  </div>
                  {results.tickers.map((t, i) => (
                    <button
                      key={t.symbol}
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => {
                        setOpen(false);
                        setQ("");
                        router.push(`/t/${t.symbol}`);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        cursor === i ? "bg-terminal-raise" : ""
                      }`}
                    >
                      <LogoTile
                        symbol={t.symbol}
                        logoUrl={t.logo_url}
                        size={24}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 font-mono text-[13px] font-bold">
                          ${t.symbol}
                          {t.verified && (
                            <Zap
                              size={9}
                              className="text-terminal-amber"
                              fill="currentColor"
                              strokeWidth={0}
                            />
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-terminal-muted">
                          {t.name}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="num block font-mono text-[12px] font-semibold">
                          {fmtPrice(t.price)}
                        </span>
                        <span
                          className={`num flex items-center justify-end gap-0.5 font-mono text-[10px] ${
                            t.dayChange >= 0
                              ? "text-terminal-up"
                              : "text-terminal-down"
                          }`}
                        >
                          <Tri
                            dir={t.dayChange >= 0 ? "up" : "down"}
                            size={5}
                          />
                          {fmtPct(t.dayChange)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {results.traders.length > 0 && (
                <div>
                  <div className="microlabel border-y border-terminal-line/60 px-3 py-1.5">
                    Traders
                  </div>
                  {results.traders.map((t, i) => {
                    const idx = results.tickers.length + i;
                    return (
                      <button
                        key={t.username}
                        type="button"
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => {
                          setOpen(false);
                          setQ("");
                          router.push(`/u/${t.username}`);
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                          cursor === idx ? "bg-terminal-raise" : ""
                        }`}
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-terminal-line font-mono text-[10px] font-bold text-terminal-accent">
                          {t.display_name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-mono text-[13px]">
                            {t.display_name}
                          </span>
                          <span className="block truncate text-[11px] text-terminal-muted">
                            @{t.username}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

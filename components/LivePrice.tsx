"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that notices when it changes: on a live refresh the cell flashes
 * green/red and the value ticks from old to new over ~400ms. Renders the
 * server-formatted string until the first change, so there is never a
 * hydration mismatch.
 */
export default function LivePrice({
  value,
  formatted,
  format = "price",
  className = "",
}: {
  value: number;
  formatted: string; // server-rendered display for this value
  format?: "price" | "money" | "compact";
  className?: string;
}) {
  const prev = useRef(value);
  const raf = useRef<number | null>(null);
  const [display, setDisplay] = useState<string | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const from = prev.current;
    if (from === value) return;
    prev.current = value;

    const dir = value > from ? "up" : "down";
    setFlash(null);
    // restart the CSS animation on consecutive moves
    requestAnimationFrame(() => setFlash(dir));

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduced) {
      setDisplay(null); // fall through to the fresh server string
      return;
    }

    const t0 = performance.now();
    const dur = 400;
    const fmt = (v: number) => {
      if (format === "money" || format === "compact") {
        return v >= 1000
          ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : `$${v.toFixed(2)}`;
      }
      return v >= 100 ? `$${v.toFixed(2)}` : `$${v.toFixed(v < 1 ? 4 : 2)}`;
    };
    const step = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - (1 - p) * (1 - p);
      setDisplay(fmt(from + (value - from) * eased));
      if (p < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        setDisplay(null); // settle on the exact server formatting
      }
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, format]);

  return (
    <span
      className={`num inline-block ${flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""} ${className}`}
      onAnimationEnd={() => setFlash(null)}
    >
      {display ?? formatted}
    </span>
  );
}

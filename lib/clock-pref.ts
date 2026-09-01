"use client";

import { useEffect, useState } from "react";

/**
 * 12- or 24-hour clock, remembered per browser.
 *
 * A display preference, so it lives in localStorage rather than the database:
 * it needs no account, it needs to apply before the first paint, and nobody
 * should have to be signed in to read a chart the way they like. The market's
 * TIMEZONE is not negotiable and is not stored here — an exchange has one
 * clock and it is Eastern; this only changes how that clock is written.
 */
const KEY = "sx.clock";
const EVENT = "sx:clock";

export type ClockPref = "12h" | "24h";
export const DEFAULT_CLOCK: ClockPref = "12h";

export function readClock(): ClockPref {
  try {
    return localStorage.getItem(KEY) === "24h" ? "24h" : DEFAULT_CLOCK;
  } catch {
    // private mode, blocked storage — the default is always safe
    return DEFAULT_CLOCK;
  }
}

export function writeClock(v: ClockPref): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // unstorable: the choice still applies for this page's lifetime
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * The current preference, live.
 *
 * Starts at the default on every render so the server's HTML and the client's
 * first paint agree — reading localStorage during render is a hydration
 * mismatch waiting to happen. The real value lands in an effect, one frame
 * later, which nobody can see.
 */
export function useClockPref(): [ClockPref, (v: ClockPref) => void] {
  const [pref, setPref] = useState<ClockPref>(DEFAULT_CLOCK);

  useEffect(() => {
    const sync = () => setPref(readClock());
    sync();
    window.addEventListener(EVENT, sync);
    // another tab changing it counts too
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [pref, writeClock];
}

/** Display helpers — formatting only, no pricing math (that's lib/pricing.ts). */

export function fmtMoney(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Prices under a dollar get extra precision so small caps don't read as $0.00. */
export function fmtPrice(value: number): string {
  return fmtMoney(value, value > 0 && value < 1 ? 4 : 2);
}

/** Compact money for market caps / MRR: $12.4k, $1.2M. */
export function fmtCompact(value: number): string {
  return (
    "$" +
    value.toLocaleString("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    })
  );
}

/** Signed percent from a fraction: 0.052 → "+5.2%". */
export function fmtPct(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * One chart bar's own move. fmtPct's single decimal is right for a day change
 * and wrong here: a 15-second bucket moves a few hundredths of a percent, and
 * rounding every one of them to "+0.0%" makes the readout look broken.
 */
export function fmtBarPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return "0.00%";
  const pct = fraction * 100;
  const shown = pct.toFixed(Math.abs(pct) < 1 ? 2 : 1);
  // "-0.00%" reads as a bug rather than as "flat"
  if (Number(shown) === 0) return "0.00%";
  return `${Number(shown) > 0 ? "+" : ""}${shown}%`;
}

/** "2026-08-01" → "Aug 2026" */
export function fmtMonth(isoDate: string): string {
  const d = new Date(isoDate + (isoDate.length === 7 ? "-01" : ""));
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** First day of the current month in ISO (UTC) — the default MRR month. */
export function currentMonthISO(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

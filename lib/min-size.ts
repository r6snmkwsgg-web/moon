/**
 * The floor's size filter — fomo's "Min size (>$10K)". A thesis is worth
 * reading in proportion to what is behind it: a post rides on the poster's
 * live position, a print on its own notional. `null` is "All".
 */
export const MIN_SIZE_PRESETS = [
  { label: "All", value: null },
  { label: ">$1K", value: 1_000 },
  { label: ">$5K", value: 5_000 },
  { label: ">$10K", value: 10_000 },
] as const;

export function passesMinSize(amount: number, min: number | null): boolean {
  return min === null || amount >= min;
}

/** "Min size (>$10K)" / "Min size" — the button's label. */
export function minSizeLabel(min: number | null): string {
  if (min === null) return "Min size";
  const preset = MIN_SIZE_PRESETS.find((p) => p.value === min);
  if (preset) return `Min size (${preset.label})`;
  return `Min size (>$${min >= 1000 ? `${Math.round(min / 100) / 10}K` : min})`;
}

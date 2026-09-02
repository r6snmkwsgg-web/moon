import { describe, expect, it } from "vitest";
import { MIN_SIZE_PRESETS, minSizeLabel, passesMinSize } from "@/lib/min-size";

describe("the floor's size filter", () => {
  it("All lets everything through, a preset is a floor", () => {
    expect(passesMinSize(12, null)).toBe(true);
    expect(passesMinSize(999, 1_000)).toBe(false);
    expect(passesMinSize(1_000, 1_000)).toBe(true);
    expect(passesMinSize(25_000, 10_000)).toBe(true);
  });

  it("labels itself the way fomo does", () => {
    expect(minSizeLabel(null)).toBe("Min size");
    expect(minSizeLabel(10_000)).toBe("Min size (>$10K)");
    expect(minSizeLabel(2_500)).toBe("Min size (>$2.5K)");
    expect(minSizeLabel(300)).toBe("Min size (>$300)");
    expect(MIN_SIZE_PRESETS.map((p) => p.value)).toEqual([null, 1_000, 5_000, 10_000]);
  });
});

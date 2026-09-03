import { describe, expect, it } from "vitest";
import { CROWDED_FRACTION, FLOOR_PRICE, REVERSE_FACTOR, SPLIT_COOLDOWN_MS, SPLIT_PRICE, splitFactor } from "@/lib/splits";

const base = { price: 25, heldFraction: 0.2, demand: 0.1, lastSplitAt: null, now: 1_800_000_000_000 };

describe("the float follows demand", () => {
  it("leaves a quiet, cheap, roomy name alone", () => {
    expect(splitFactor(base)).toBeNull();
  });

  it("cuts an expensive share back toward twenty dollars", () => {
    expect(splitFactor({ ...base, price: SPLIT_PRICE })).toBe(2);
    expect(splitFactor({ ...base, price: 200 })).toBe(5);
    expect(splitFactor({ ...base, price: 500 })).toBe(10);
  });

  it("doubles a crowded float, and one in heavy demand that is filling", () => {
    expect(splitFactor({ ...base, heldFraction: CROWDED_FRACTION })).toBe(2);
    expect(splitFactor({ ...base, heldFraction: 0.45, demand: 0.6 })).toBe(2);
    expect(splitFactor({ ...base, heldFraction: 0.2, demand: 0.6 })).toBeNull(); // demand alone is not a crowd
  });

  it("lets a share fall under a dollar but never under a cent", () => {
    expect(splitFactor({ ...base, price: 0.5, heldFraction: 0.7 })).toBe(2); // to $0.25, fine
    expect(splitFactor({ ...base, price: 0.015, heldFraction: 0.7 })).toBeNull(); // would cross the floor
    expect(splitFactor({ ...base, price: FLOOR_PRICE / 2 })).toBe(REVERSE_FACTOR); // consolidated a hundred to one
  });

  it("waits out the cooldown", () => {
    expect(splitFactor({ ...base, price: 200, lastSplitAt: base.now - SPLIT_COOLDOWN_MS / 2 })).toBeNull();
    expect(splitFactor({ ...base, price: 200, lastSplitAt: base.now - SPLIT_COOLDOWN_MS - 1 })).toBe(5);
  });
});

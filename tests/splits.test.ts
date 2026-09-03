import { describe, expect, it } from "vitest";
import { CROWDED_FRACTION, FLOOR_PRICE, FULL_FRACTION, REVERSE_FACTOR, SPLIT_COOLDOWN_MS, SPLIT_PRICE, splitFactor } from "@/lib/splits";

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

  it("doubles a full float at once, cooldown or not — a float nobody can buy is not a market", () => {
    const justSplit = base.now - 60_000;
    expect(splitFactor({ ...base, heldFraction: FULL_FRACTION, lastSplitAt: justSplit })).toBe(2);
    expect(splitFactor({ ...base, heldFraction: 0.97, price: 300, lastSplitAt: justSplit })).toBe(2);
    // short of full, the cooldown still holds
    expect(splitFactor({ ...base, heldFraction: CROWDED_FRACTION + 0.1, lastSplitAt: justSplit })).toBeNull();
  });

  it("waits out the cooldown", () => {
    expect(splitFactor({ ...base, price: 200, lastSplitAt: base.now - SPLIT_COOLDOWN_MS / 2 })).toBeNull();
    expect(splitFactor({ ...base, price: 200, lastSplitAt: base.now - SPLIT_COOLDOWN_MS - 1 })).toBe(5);
  });
});

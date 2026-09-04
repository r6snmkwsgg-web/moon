import { describe, expect, it } from "vitest";
import { fmtShares } from "@/lib/format";

describe("fmtShares", () => {
  it("prints whole shares whole and fractions to four places", () => {
    expect(fmtShares(12)).toBe("12");
    expect(fmtShares(1200)).toBe("1,200");
    expect(fmtShares(0.4551)).toBe("0.4551");
    expect(fmtShares(12.5)).toBe("12.5");
    expect(fmtShares(2.00001)).toBe("2");
  });
});

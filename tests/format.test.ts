import { describe, expect, it } from "vitest";
import { fmtBarPct, fmtPct } from "@/lib/format";

describe("fmtBarPct — the hovered bar's own move", () => {
  it("keeps two decimals under a percent, where the small bars live", () => {
    // fmtPct would render every one of these as "+0.0%" / "-0.0%"
    expect(fmtBarPct(0.0004)).toBe("+0.04%");
    expect(fmtBarPct(-0.0031)).toBe("-0.31%");
    // the reason this helper exists: fmtPct rounds this away to flat
    expect(fmtPct(0.0004)).toBe("0.0%");
  });

  it("never signs a move that rounded away to nothing", () => {
    // "-0.0%" reads as a loss and "+0.0%" as a gain; neither happened
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtPct(-0.0003)).toBe("0.0%");
    expect(fmtPct(0.0003)).toBe("0.0%");
    expect(fmtPct(-0.0006)).toBe("-0.1%");
    expect(fmtPct(0.0006)).toBe("+0.1%");
  });

  it("drops to one decimal once the move is big enough to read", () => {
    expect(fmtBarPct(0.042)).toBe("+4.2%");
    expect(fmtBarPct(-0.155)).toBe("-15.5%");
  });

  it("never shows a signed zero", () => {
    expect(fmtBarPct(0)).toBe("0.00%");
    expect(fmtBarPct(-0.00001)).toBe("0.00%"); // rounds to zero, not "-0.00%"
    expect(fmtBarPct(0.00001)).toBe("0.00%");
  });

  it("survives a bar with no open to divide by", () => {
    expect(fmtBarPct(NaN)).toBe("0.00%");
    expect(fmtBarPct(Infinity)).toBe("0.00%");
  });
});

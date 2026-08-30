import { describe, expect, it } from "vitest";
import { classify } from "@/lib/pulse";

describe("classifying a revenue change", () => {
  it("reads a new customer from the subscription count", () => {
    expect(classify(1_000, 1_200, 10, 11)).toBe("new");
  });

  it("reads a churn the same way", () => {
    expect(classify(1_200, 1_000, 11, 10)).toBe("churn");
  });

  it("calls a same-count increase an expansion, not a signup", () => {
    expect(classify(1_000, 1_400, 10, 10)).toBe("expansion");
    expect(classify(1_400, 1_000, 10, 10)).toBe("contraction");
  });

  it("falls back to the direction when the count is unknown", () => {
    expect(classify(1_000, 1_200, null, 11)).toBe("new");
    expect(classify(1_200, 1_000, null, 10)).toBe("churn");
  });

  it("trusts the count over the money on a mixed day", () => {
    // one $50 customer left, one $200 customer arrived: money up, and a real
    // signup happened — the count is what says which
    expect(classify(1_000, 1_150, 10, 10)).toBe("expansion");
    expect(classify(1_000, 1_150, 10, 11)).toBe("new");
  });
});

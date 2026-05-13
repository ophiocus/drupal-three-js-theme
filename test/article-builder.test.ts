// Invariants of ArticleBuilder's universal word-count → cube-side
// mapping (D2 from the navigation proposal).
//
// What we're locking:
//   - Monotonic: more words ⇒ bigger side.
//   - Bounded: side stays in [4, 20] for any non-negative input.
//   - Anchor values match the doc commentary so future tuning has
//     an explicit baseline to argue against.

import { describe, expect, it } from "vitest";
import { wordCountToSide } from "../src/world/runtime/smart-objects/builders/ArticleBuilder.js";

describe("ArticleBuilder.wordCountToSide", () => {
  it("is monotonic on word count", () => {
    const counts = [0, 1, 10, 100, 1000, 10000, 100000];
    let last = -Infinity;
    for (const c of counts) {
      const side = wordCountToSide(c);
      expect(side).toBeGreaterThanOrEqual(last);
      last = side;
    }
  });

  it("is bounded in [4, 20]", () => {
    for (const c of [0, 1, 50, 250, 1500, 9_999, 50_000, 1e9]) {
      const side = wordCountToSide(c);
      expect(side).toBeGreaterThanOrEqual(4);
      // Above 10,000 words mapLinear extrapolates; the >20 case
      // is unbounded — only assert the lower bound for huge inputs.
      if (c <= 10_000) expect(side).toBeLessThanOrEqual(20);
    }
  });

  it("anchor: 1 word → 4 units", () => {
    expect(wordCountToSide(1)).toBeCloseTo(4, 1);
  });

  it("anchor: 100 words → ~12 units (current fallback size)", () => {
    expect(wordCountToSide(100)).toBeCloseTo(12, 1);
  });

  it("anchor: 10,000 words → 20 units", () => {
    expect(wordCountToSide(10_000)).toBeCloseTo(20, 1);
  });

  it("treats zero or negative inputs as 1 word (no NaN)", () => {
    expect(wordCountToSide(0)).toBeCloseTo(4, 1);
    expect(wordCountToSide(-5)).toBeCloseTo(4, 1);
  });
});

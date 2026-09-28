import { describe, expect, it } from "vitest";
import { rankSummary } from "./rankSummary.ts";

/** A 14-team distribution from the given leading probabilities, zeros after. */
function distribution(...leading: number[]) {
  return [...leading, ...Array(14 - leading.length).fill(0)];
}

describe("rankSummary most likely rank", () => {
  it("is the rank with the highest probability", () => {
    expect(rankSummary(distribution(0.1, 0.2, 0.4, 0.2, 0.1)).mostLikely).toBe(3);
  });

  it("takes the better rank on a tie", () => {
    expect(rankSummary(distribution(0.1, 0.3, 0.2, 0.3, 0.1)).mostLikely).toBe(2);
  });
});

describe("rankSummary middle 80%", () => {
  it("runs from the first rank reaching 10% cumulative to the first reaching 90%", () => {
    const summary = rankSummary(distribution(0.02, 0.05, 0.13, 0.3, 0.3, 0.08, 0.07, 0.05));
    expect(summary.low).toBe(3);
    expect(summary.high).toBe(7);
  });

  it("includes a bound whose cumulative probability lands exactly on 10% and on 90%", () => {
    // cumulative 0.1 after 2nd, 0.9 after 6th
    const summary = rankSummary(distribution(0.05, 0.05, 0.2, 0.3, 0.2, 0.1, 0.05, 0.05));
    expect(summary.low).toBe(2);
    expect(summary.high).toBe(6);
  });

  it("holds the bounds at the boundaries despite floating-point sums", () => {
    // 0.1 + 0.2 + 0.3 + ... sums drift below the exact value
    const summary = rankSummary(distribution(0.1, 0.2, 0.3, 0.2, 0.1, 0.1));
    expect(summary.low).toBe(1);
    expect(summary.high).toBe(5);
  });

  it("gives the exact share the range covers", () => {
    const summary = rankSummary(distribution(0.02, 0.05, 0.13, 0.3, 0.3, 0.08, 0.07, 0.05));
    expect(summary.share).toBeCloseTo(0.88, 12);
    const wide = rankSummary(distribution(0.12, 0.5, 0.3, 0.08));
    expect(wide.low).toBe(1);
    expect(wide.high).toBe(3);
    expect(wide.share).toBeCloseTo(0.92, 12);
  });
});

describe("rankSummary text", () => {
  it("names the most likely rank and the middle 80%", () => {
    const summary = rankSummary(distribution(0, 0.15, 0.2, 0.3, 0.2, 0.04, 0.05, 0.06));
    expect(summary.text).toBe("Most likely 4th · 80% between 2nd and 7th");
  });

  it("reads a single-rank range as 80% at that rank", () => {
    expect(rankSummary(distribution(0, 0, 0.95, 0.05)).text).toBe("Most likely 3rd · 80% at 3rd");
  });

  it("reads a rank with probability 1 as certain", () => {
    const summary = rankSummary(distribution(0, 0, 1));
    expect(summary.text).toBe("3rd in every simulated Season");
    expect(summary.share).toBe(1);
  });

  it("uses English ordinals, including 11th to 13th and 21st", () => {
    const text = rankSummary([...Array(10).fill(0), 0.2, 0.3, 0.3, 0.2]).text;
    expect(text).toBe("Most likely 12th · 80% between 11th and 14th");
    expect(rankSummary([...Array(20).fill(0), 1]).text).toBe("21st in every simulated Season");
  });
});

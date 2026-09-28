import { describe, expect, it } from "vitest";
import { rankBars } from "./rankHistogram.ts";

describe("rankBars", () => {
  it("labels each rank with its ordinal and whole percent, and colors it by Cut Line zone", () => {
    const distribution = [0.5, 0.25, 0.125, 0.0625, 0.0625, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const bars = rankBars(distribution);
    expect(bars).toHaveLength(14);
    expect(bars.slice(0, 5).map((bar) => bar.label)).toEqual(["1st: 50%", "2nd: 25%", "3rd: 13%", "4th: 6%", "5th: 6%"]);
    expect(bars.map((bar) => bar.zone)).toEqual([
      ...Array(6).fill("playoffs"),
      ...Array(4).fill("play-in"),
      ...Array(4).fill("eliminated"),
    ]);
  });

  it("uses the ordinals 11th, 12th, 13th and 21st correctly", () => {
    const labels = rankBars(Array(22).fill(0)).map((bar) => bar.label.split(":")[0]);
    expect(labels.slice(10, 13)).toEqual(["11th", "12th", "13th"]);
    expect(labels[20]).toBe("21st");
  });

  it("scales bars to the team's own highest bar", () => {
    const bars = rankBars([0.2, 0.4, 0.1, 0.3]);
    [0.5, 1, 0.25, 0.75].forEach((height, index) => expect(bars[index]!.height).toBeCloseTo(height, 12));
  });

  it("uses the existing percent formatter for remote and near-certain ranks", () => {
    const bars = rankBars([0.999, 0.001, 0]);
    expect(bars.map((bar) => bar.label)).toEqual(["1st: >99%", "2nd: <1%", "3rd: 0%"]);
  });

  it("marks only the bar at the projected rank", () => {
    const bars = rankBars([0.2, 0.4, 0.1, 0.3], 3);
    expect(bars.map((bar) => bar.projected)).toEqual([false, false, true, false]);
  });

  it("marks no bar when no projected rank is given", () => {
    expect(rankBars([0.5, 0.5]).map((bar) => bar.projected)).toEqual([false, false]);
  });

  it("gives no height to a distribution with no chance anywhere", () => {
    expect(rankBars([0, 0]).map((bar) => bar.height)).toEqual([0, 0]);
  });

  describe("against a Real Projection", () => {
    const whatIf = [0.5, 0.3, 0, 0.2];
    const real = [0.4, 0.3, 0.1, 0.2];

    it("caps each rank with a real chance and scales both to the higher peak", () => {
      const bars = rankBars(whatIf, undefined, [0.25, 0.3, 0.1, 0]);
      expect(bars.map((bar) => bar.height)).toEqual([1, 0.6, 0, 0.4]);
      expect(bars.map((bar) => bar.cap)).toEqual([0.5, 0.6, 0.2, null]);
    });

    it("scales to the real peak when it is the higher", () => {
      const bars = rankBars([0.2, 0.1], undefined, [0.4, 0.1]);
      expect(bars.map((bar) => bar.height)).toEqual([0.5, 0.25]);
      expect(bars.map((bar) => bar.cap)).toEqual([1, 0.25]);
    });

    it("floats a cap over a rank with a What-If chance of 0", () => {
      expect(rankBars(whatIf, undefined, real)[2]).toMatchObject({ height: 0, cap: 0.2 });
    });

    it("labels each bar with its real chance, except a rank at 0 in both", () => {
      const bars = rankBars([0.5, 0.5, 0], undefined, [0.25, 0.75, 0]);
      expect(bars.map((bar) => bar.label)).toEqual(["1st: 50% (real 25%)", "2nd: 50% (real 75%)", "3rd: 0%"]);
    });

    it("labels a rank with no real chance", () => {
      expect(rankBars([0.5, 0.5], undefined, [1, 0])[1]!.label).toBe("2nd: 50% (real 0%)");
    });

    it("draws no caps, and keeps plain labels and own-peak scaling, when the distributions are equal", () => {
      const bars = rankBars([0.2, 0.4], undefined, [0.2, 0.4]);
      expect(bars.map((bar) => bar.cap)).toEqual([null, null]);
      expect(bars.map((bar) => bar.label)).toEqual(["1st: 20%", "2nd: 40%"]);
      expect(bars.map((bar) => bar.height)).toEqual([0.5, 1]);
    });

    it("draws no caps without a real distribution", () => {
      expect(rankBars(whatIf, undefined, null).every((bar) => bar.cap === null)).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { formatPercent, winSplit } from "./winSplit.ts";
import type { OutcomeProbabilities } from "../domain/outcomes.ts";

function outcomes(regulationWin: number, overtimeOrShootoutWin: number, overtimeOrShootoutLoss: number, regulationLoss: number): OutcomeProbabilities {
  return { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss, regulationLoss };
}

/** The two printed figures as a number pair, "<1" and ">99" counting as 0 and 100. */
function printedTotal(split: ReturnType<typeof winSplit>) {
  const value = (label: string) => (label === "<1" ? 0 : label === ">99" ? 100 : Number(label));
  return value(split.home.label) + value(split.away.label);
}

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0.416)).toBe("42");
  });

  it("keeps a remote chance from reading as impossible or certain", () => {
    expect(formatPercent(0.003)).toBe("<1");
    expect(formatPercent(0.997)).toBe(">99");
    expect(formatPercent(0)).toBe("0");
    expect(formatPercent(1)).toBe("100");
  });

  it("does not round a chance short of certain up to 100", () => {
    expect(formatPercent(0.995)).toBe(">99");
  });
});

describe("winSplit", () => {
  it("adds regulation and OT/SO wins for the home side and gives the away side the complement", () => {
    const split = winSplit(outcomes(0.3, 0.126, 0.1, 0.474));
    expect(split.home.label).toBe("43");
    expect(split.away.label).toBe("57");
  });

  it("always prints a pair adding up to 100", () => {
    for (const home of [0.2, 0.333, 0.4149, 0.5, 0.6666, 0.8]) {
      const split = winSplit(outcomes(home * 0.7, home * 0.3, (1 - home) * 0.3, (1 - home) * 0.7));
      expect(printedTotal(split)).toBe(100);
    }
  });

  it("still adds up to 100 when both sides sit on a .5 boundary", () => {
    // 12.5 % and 87.5 % would each round up on their own, printing 13 and 88
    const split = winSplit(outcomes(0.1, 0.025, 0.1, 0.775));
    expect(split.home.label).toBe("13");
    expect(split.away.label).toBe("87");
  });

  it("prints a remote home chance as <1 against >99", () => {
    const split = winSplit(outcomes(0.002, 0.001, 0.2, 0.797));
    expect(split.home.label).toBe("<1");
    expect(split.away.label).toBe(">99");
  });

  it("prints a near-certain home win as >99 against <1", () => {
    const split = winSplit(outcomes(0.7, 0.297, 0.001, 0.002));
    expect(split.home.label).toBe(">99");
    expect(split.away.label).toBe("<1");
  });

  it("is not exact for an ordinary or remote split", () => {
    expect(winSplit(outcomes(0.3, 0.2, 0.2, 0.3)).home.exact).toBe(false);
    const remote = winSplit(outcomes(0.002, 0.001, 0.2, 0.797));
    expect(remote.home.exact).toBe(false);
    expect(remote.away.exact).toBe(false);
  });

  it("flags an exact 0 home win, and the exact 100 away win with it", () => {
    const split = winSplit(outcomes(0, 0, 0.4, 0.6));
    expect(split.home).toEqual({ label: "0", exact: true });
    expect(split.away).toEqual({ label: "100", exact: true });
  });

  it("flags an exact 100 home win, and the exact 0 away win with it", () => {
    const split = winSplit(outcomes(0.6, 0.4, 0, 0));
    expect(split.home).toEqual({ label: "100", exact: true });
    expect(split.away).toEqual({ label: "0", exact: true });
  });
});

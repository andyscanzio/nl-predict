import { describe, expect, it } from "vitest";
import { splitFormRatesOf } from "./splitFormRate.ts";

describe("Split Form Rate: splitFormRatesOf", () => {
  it("gives each venue its own Form", () => {
    expect(splitFormRatesOf(2.4, 1.2)).toEqual({ home: 2.4, away: 1.2 });
  });

  it("borrows the other venue's Form for an empty Form Window", () => {
    expect(splitFormRatesOf(null, 1.2)).toEqual({ home: 1.2, away: 1.2 });
    expect(splitFormRatesOf(2.4, null)).toEqual({ home: 2.4, away: 2.4 });
  });

  it("earns nothing with neither Form", () => {
    expect(splitFormRatesOf(null, null)).toEqual({ home: 0, away: 0 });
  });
});

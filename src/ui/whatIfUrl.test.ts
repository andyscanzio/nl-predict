import { describe, expect, it } from "vitest";
import { urlWithWhatIf, whatIfFromUrl } from "./whatIfUrl.ts";
import { urlWithModel } from "./modelUrl.ts";
import { eloModel } from "../domain/eloModel.ts";
import type { WhatIf, WhatIfOutcome } from "../domain/project.ts";

const PAGE = "https://andyscanzio.github.io/nl-predict/";

describe("whatIfFromUrl", () => {
  it("reads all four outcome codes", () => {
    expect([...whatIfFromUrl(`${PAGE}?whatif=1.H,2.HOT,3.AOT,4.A`)]).toEqual([
      ["1", "regulationWin"],
      ["2", "overtimeOrShootoutWin"],
      ["3", "overtimeOrShootoutLoss"],
      ["4", "regulationLoss"],
    ]);
  });

  it("is empty without the parameter or with an empty one", () => {
    expect(whatIfFromUrl(PAGE).size).toBe(0);
    expect(whatIfFromUrl(`${PAGE}?whatif=`).size).toBe(0);
  });

  it("drops malformed entries and keeps the good ones", () => {
    const parsed = whatIfFromUrl(`${PAGE}?whatif=1.H,junk,2.X,.H,3.,4.hot,5.A.H,6.A`);
    expect([...parsed]).toEqual([
      ["1", "regulationWin"],
      ["6", "regulationLoss"],
    ]);
  });

  it("keeps the last entry of a duplicated Game id", () => {
    expect([...whatIfFromUrl(`${PAGE}?whatif=1.H,2.A,1.AOT`)]).toEqual([
      ["1", "overtimeOrShootoutLoss"],
      ["2", "regulationLoss"],
    ]);
  });
});

describe("urlWithWhatIf", () => {
  const whatIf: WhatIf = new Map<string, WhatIfOutcome>([
    ["20271105000001", "regulationWin"],
    ["20271105000002", "overtimeOrShootoutLoss"],
  ]);

  it("writes the What-If", () => {
    expect(urlWithWhatIf(PAGE, whatIf)).toBe(`${PAGE}?whatif=20271105000001.H%2C20271105000002.AOT`);
  });

  it("round-trips through whatIfFromUrl", () => {
    expect([...whatIfFromUrl(urlWithWhatIf(PAGE, whatIf))]).toEqual([...whatIf]);
    for (const outcome of ["regulationWin", "overtimeOrShootoutWin", "overtimeOrShootoutLoss", "regulationLoss"] as const) {
      const one = new Map([["7", outcome]]);
      expect([...whatIfFromUrl(urlWithWhatIf(PAGE, one))]).toEqual([...one]);
    }
  });

  it("removes the parameter for an empty What-If", () => {
    expect(urlWithWhatIf(`${PAGE}?whatif=1.H`, new Map())).toBe(PAGE);
  });

  it("keeps the model, other parameters and the hash", () => {
    expect(urlWithWhatIf(`${urlWithModel(PAGE, eloModel)}&x=1#table`, whatIf)).toBe(
      `${PAGE}?model=elo&x=1&whatif=20271105000001.H%2C20271105000002.AOT#table`,
    );
  });

  it("replaces a previous What-If", () => {
    expect(urlWithWhatIf(`${PAGE}?whatif=9.A`, new Map([["1", "regulationWin"]]))).toBe(`${PAGE}?whatif=1.H`);
  });

  it("does not let urlWithModel drop the What-If", () => {
    expect(whatIfFromUrl(urlWithModel(urlWithWhatIf(PAGE, whatIf), eloModel)).size).toBe(2);
  });
});

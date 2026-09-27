import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, modelFromUrl, PROJECTION_MODELS, urlWithModel } from "./modelUrl.ts";
import { eloModel } from "../domain/eloModel.ts";
import { matchupModel } from "../domain/matchupModel.ts";
import { seasonRate } from "../domain/seasonRate.ts";
import { splitFormRate } from "../domain/splitFormRate.ts";

const PAGE = "https://andyscanzio.github.io/nl-predict/";

describe("modelFromUrl", () => {
  it("offers the four Projection Models, in picker order", () => {
    expect(PROJECTION_MODELS).toEqual([splitFormRate, seasonRate, matchupModel, eloModel]);
  });

  it.each([
    ["split-form-rate", splitFormRate],
    ["season-rate", seasonRate],
    ["matchup", matchupModel],
    ["elo", eloModel],
  ])("reads ?model=%s", (id, model) => {
    expect(modelFromUrl(`${PAGE}?model=${id}`)).toBe(model);
  });

  it("defaults to the Elo Model", () => {
    expect(DEFAULT_MODEL).toBe(eloModel);
  });

  it("uses the Default Model without a model parameter", () => {
    expect(modelFromUrl(PAGE)).toBe(DEFAULT_MODEL);
  });

  it("uses the Default Model for an unknown or empty model", () => {
    expect(modelFromUrl(`${PAGE}?model=crystal-ball`)).toBe(DEFAULT_MODEL);
    expect(modelFromUrl(`${PAGE}?model=`)).toBe(DEFAULT_MODEL);
  });
});

describe("urlWithModel", () => {
  it("puts the model in the URL", () => {
    expect(urlWithModel(PAGE, eloModel)).toBe(`${PAGE}?model=elo`);
  });

  it("replaces a previous model and keeps other parameters and the hash", () => {
    expect(urlWithModel(`${PAGE}?model=elo&x=1#table`, matchupModel)).toBe(`${PAGE}?model=matchup&x=1#table`);
  });

  it("names the Default Model too, so a shared link keeps its model if the default changes", () => {
    expect(urlWithModel(PAGE, DEFAULT_MODEL)).toBe(`${PAGE}?model=${DEFAULT_MODEL.id}`);
  });

  it("round-trips through modelFromUrl", () => {
    for (const model of PROJECTION_MODELS) expect(modelFromUrl(urlWithModel(PAGE, model))).toBe(model);
  });
});

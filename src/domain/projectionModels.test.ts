import { describe, expect, it } from "vitest";
import { eloLevelStartModel, eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import { ALL_MODELS, DEFAULT_MODEL, pickerModelOf, PROJECTION_MODELS } from "./projectionModels.ts";
import { seasonRate } from "./seasonRate.ts";
import { splitFormRate } from "./splitFormRate.ts";

describe("PROJECTION_MODELS", () => {
  it("offers the four Projection Models, in picker order", () => {
    expect(PROJECTION_MODELS).toEqual([eloModel, seasonRate, matchupModel, splitFormRate]);
  });

  it("gives every model its own id", () => {
    const ids = PROJECTION_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DEFAULT_MODEL", () => {
  it("is the Elo Model", () => {
    expect(DEFAULT_MODEL).toBe(eloModel);
  });

  it("is one of the listed models", () => {
    expect(PROJECTION_MODELS).toContain(DEFAULT_MODEL);
  });
});

describe("ALL_MODELS", () => {
  it("adds the Elo Model's Level Start to the picker's models", () => {
    expect(ALL_MODELS).toEqual([...PROJECTION_MODELS, eloLevelStartModel]);
  });

  it("gives every model and variant its own id", () => {
    const ids = ALL_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pickerModelOf", () => {
  it("is the Elo Model for its Level Start", () => {
    expect(pickerModelOf(eloLevelStartModel)).toBe(eloModel);
  });

  it("is the model itself for every model in the picker", () => {
    for (const model of PROJECTION_MODELS) expect(pickerModelOf(model)).toBe(model);
  });
});

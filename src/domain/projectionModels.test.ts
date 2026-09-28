import { describe, expect, it } from "vitest";
import { eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import { DEFAULT_MODEL, PROJECTION_MODELS } from "./projectionModels.ts";
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

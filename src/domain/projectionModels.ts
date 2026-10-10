import { eloLevelStartModel, eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import type { ProjectionModel } from "./project.ts";
import { seasonRate } from "./seasonRate.ts";
import { splitFormRate } from "./splitFormRate.ts";

/** The Projection Models a visitor can pick, in picker order: the Default Model first, Points-only Split Form Rate last. */
export const PROJECTION_MODELS = [eloModel, seasonRate, matchupModel, splitFormRate] as const;

/** The ids of the picker's Projection Models: "elo", "season-rate", "matchup" and "split-form-rate". */
export type PickerModelId = (typeof PROJECTION_MODELS)[number]["id"];

/**
 * Every model a visitor can be shown, so every model to look up by id (the URL, Projection History): the picker's
 * Projection Models plus the Elo Model's Level Start, a variant switched to inside the Elo Model's row.
 */
export const ALL_MODELS = [...PROJECTION_MODELS, eloLevelStartModel] as const;

/** The ids of every model a visitor can be shown: the picker's, plus "elo-level". */
export type ProjectionModelId = (typeof ALL_MODELS)[number]["id"];

/** The picker's row that shows `model`: the Elo Model for its Level Start, else the model itself. */
export function pickerModelOf(model: ProjectionModel<ProjectionModelId>): ProjectionModel<PickerModelId> {
  return model.id === eloLevelStartModel.id ? eloModel : (model as ProjectionModel<PickerModelId>);
}

/**
 * The Default Model: what a visitor sees unless they pick another.
 * Chosen from the Back-Test (#13, `npm run backtest`): best Brier score, and best Points MAE incl. Split Form Rate.
 * Provisional while the Season has few Played Games; revisit as they grow.
 */
export const DEFAULT_MODEL: ProjectionModel<PickerModelId> = eloModel;

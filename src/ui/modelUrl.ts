import { eloModel } from "../domain/eloModel.ts";
import { matchupModel } from "../domain/matchupModel.ts";
import type { ProjectionModel } from "../domain/project.ts";
import { seasonRate } from "../domain/seasonRate.ts";
import { splitFormRate } from "../domain/splitFormRate.ts";

/** The Projection Models a visitor can pick, in picker order. */
export const PROJECTION_MODELS: readonly ProjectionModel[] = [splitFormRate, seasonRate, matchupModel, eloModel];

/**
 * The Default Model: what a visitor sees unless they pick another.
 * Chosen from the Back-Test (#13, `npm run backtest`): best Brier score, and best Points MAE incl. Split Form Rate.
 * Provisional while the Season has few Played Games; revisit as they grow.
 */
export const DEFAULT_MODEL: ProjectionModel = eloModel;

/** The query parameter naming the picked model by its id, e.g. `?model=elo`. */
const MODEL_PARAM = "model";

/** The model a URL names, or the Default Model when it names none or an unknown one. */
export function modelFromUrl(url: string | URL): ProjectionModel {
  const id = new URL(url).searchParams.get(MODEL_PARAM);
  return PROJECTION_MODELS.find((model) => model.id === id) ?? DEFAULT_MODEL;
}

/** The URL with its model set to `model`, keeping everything else; the Default Model is named too, so links stay stable. */
export function urlWithModel(url: string | URL, model: ProjectionModel): string {
  const next = new URL(url);
  next.searchParams.set(MODEL_PARAM, model.id);
  return next.href;
}

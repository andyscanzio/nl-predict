import { eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import type { ProjectionModel } from "./project.ts";
import { seasonRate } from "./seasonRate.ts";
import { splitFormRate } from "./splitFormRate.ts";

/** The Projection Models a visitor can pick, in picker order: the Default Model first, Points-only Split Form Rate last. */
export const PROJECTION_MODELS = [eloModel, seasonRate, matchupModel, splitFormRate] as const;

/** The ids of the listed Projection Models: "elo", "season-rate", "matchup" and "split-form-rate". */
export type ProjectionModelId = (typeof PROJECTION_MODELS)[number]["id"];

/**
 * The Default Model: what a visitor sees unless they pick another.
 * Chosen from the Back-Test (#13, `npm run backtest`): best Brier score, and best Points MAE incl. Split Form Rate.
 * Provisional while the Season has few Played Games; revisit as they grow.
 */
export const DEFAULT_MODEL: ProjectionModel<ProjectionModelId> = eloModel;

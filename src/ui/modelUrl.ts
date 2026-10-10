import type { ProjectionModel } from "../domain/project.ts";
import { ALL_MODELS, DEFAULT_MODEL, type ProjectionModelId } from "../domain/projectionModels.ts";

/** The query parameter naming the picked model by its id, e.g. `?model=elo`. */
const MODEL_PARAM = "model";

/** The model a URL names, the Elo Model's Level Start included, or the Default Model when it names none or an unknown one. */
export function modelFromUrl(url: string | URL): ProjectionModel<ProjectionModelId> {
  const id = new URL(url).searchParams.get(MODEL_PARAM);
  return ALL_MODELS.find((model) => model.id === id) ?? DEFAULT_MODEL;
}

/** The URL with its model set to `model`, keeping everything else; the Default Model is named too, so links stay stable. */
export function urlWithModel(url: string | URL, model: ProjectionModel<ProjectionModelId>): string {
  const next = new URL(url);
  next.searchParams.set(MODEL_PARAM, model.id);
  return next.href;
}

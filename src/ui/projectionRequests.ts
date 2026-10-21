import { project, type Projection, type ProjectionModel, type WhatIf, type WhatIfOutcome } from "../domain/project.ts";
import { ALL_MODELS, type ProjectionModelId } from "../domain/projectionModels.ts";
import type { Game } from "../domain/types.ts";

/** What the page asks the projection worker for: the picked model and What-If, as of `now`. */
export interface ProjectionRequest {
  modelId: ProjectionModelId;
  whatIf: [gameId: string, outcome: WhatIfOutcome][];
  /** The As-Of Date, as an ISO string. */
  now: string;
}

/** A picked model and What-If, as the page holds them. */
export interface Picks {
  model: ProjectionModel<ProjectionModelId>;
  whatIf: WhatIf;
}

/** The request for `picks`, in a form that crosses to a worker: model functions and Maps don't need to. */
export function projectionRequest(picks: Picks, now: Date): ProjectionRequest {
  return { modelId: picks.model.id, whatIf: [...picks.whatIf], now: now.toISOString() };
}

/**
 * Answers projection requests over the Season's Games, with the Post-Season, as the page shows them. Each model's Real
 * Projection is kept per As-Of Date, so a What-If reruns only its own Season Simulation.
 */
export function projectionAnswerer(games: Game[]): (request: ProjectionRequest) => Projection {
  const real = new Map<string, Projection>();
  return ({ modelId, whatIf, now }) => {
    const model = ALL_MODELS.find((candidate) => candidate.id === modelId)!;
    const asOf = new Date(now);
    const key = `${modelId} ${now}`;
    let realProjection = real.get(key);
    if (!realProjection) {
      realProjection = project(games, asOf, model, undefined, undefined, { postSeason: true });
      real.set(key, realProjection);
    }
    return project(games, asOf, model, new Map(whatIf), realProjection, { postSeason: true });
  };
}

/** The part of a Worker the client uses, so tests can stand in for it. */
export interface ProjectionPort {
  postMessage(request: ProjectionRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<Projection>) => void): void;
}

/**
 * Sends picks to the projection worker one at a time, and only the newest of those made while it is busy: a run of quick
 * taps costs at most two Season Simulations, and an answer arrives only for picks still wanted.
 */
export function projectionClient(port: ProjectionPort, now: Date, onProjection: (picks: Picks, projection: Projection) => void) {
  let inFlight: Picks | undefined;
  let waiting: Picks | undefined;
  const send = (picks: Picks) => {
    inFlight = picks;
    port.postMessage(projectionRequest(picks, now));
  };
  port.addEventListener("message", (event) => {
    const answered = inFlight!;
    inFlight = undefined;
    if (waiting) {
      const next = waiting;
      waiting = undefined;
      send(next);
    } else {
      onProjection(answered, event.data);
    }
  });
  return {
    request(picks: Picks) {
      if (inFlight) waiting = picks;
      else send(picks);
    },
  };
}

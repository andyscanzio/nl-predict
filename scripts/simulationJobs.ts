import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createEloModel, ELO_HOME_ADVANTAGE, ELO_K, ELO_RATING_UNCERTAINTY } from "../src/domain/eloModel.ts";
import { createLearnedModel, type LearnedWeights } from "../src/domain/learnedModel.ts";
import type { OutcomesProjectionModel, SeasonSimulationScore } from "../src/domain/seasonBackTest.ts";
import type { Snapshot } from "../src/domain/types.ts";

/** A model to Season-Simulation-Back-Test, as plain data so it can cross to a worker thread. */
export type ModelSpec =
  | { kind: "elo"; startingRatings: { teamId: number; rating: number }[] }
  | { kind: "learned"; weights: LearnedWeights };

/** The Elo Model at the production values with Rating Uncertainty σ = 50, or the Learned Model, from a spec. */
export function modelOf(spec: ModelSpec): OutcomesProjectionModel {
  return spec.kind === "elo"
    ? (createEloModel({
        k: ELO_K,
        homeAdvantage: ELO_HOME_ADVANTAGE,
        startingRatings: new Map(spec.startingRatings.map(({ teamId, rating }) => [teamId, rating])),
        ratingUncertainty: ELO_RATING_UNCERTAINTY,
      }) as OutcomesProjectionModel)
    : (createLearnedModel(spec.weights) as OutcomesProjectionModel);
}

export interface SimulationJob {
  spec: ModelSpec;
  season: number;
  runs: number;
}

export const readSeason = async (dir: string, season: number) =>
  JSON.parse(await readFile(join(dir, `season-${season}.json`), "utf8")) as Snapshot;

/**
 * Runs Season Simulation Back-Tests on a pool of worker threads. Every simulation is seeded from its own forecast point
 * and model id, so the rows do not depend on which worker runs a job or in what order.
 */
export class SimulationPool {
  private readonly workers: Worker[];
  private readonly idle: Worker[] = [];
  private readonly queue: { job: SimulationJob; resolve: (rows: SeasonSimulationScore[]) => void; reject: (error: Error) => void }[] = [];
  private readonly running = new Map<Worker, { resolve: (rows: SeasonSimulationScore[]) => void; reject: (error: Error) => void }>();

  constructor(size: number, dir: string) {
    this.workers = Array.from({ length: size }, () => {
      const worker = new Worker(new URL("./simulationWorker.ts", import.meta.url), { workerData: { dir } });
      worker.on("message", (rows: SeasonSimulationScore[]) => this.finish(worker, (task) => task.resolve(rows)));
      worker.on("error", (error) => {
        // A worker that errored is dead: reject its job and do not hand it another.
        const task = this.running.get(worker);
        this.running.delete(worker);
        task?.reject(error as Error);
      });
      return worker;
    });
    this.idle.push(...this.workers);
  }

  run(job: SimulationJob): Promise<SeasonSimulationScore[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.dispatch();
    });
  }

  private dispatch() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const { job, resolve, reject } = this.queue.shift()!;
      this.running.set(worker, { resolve, reject });
      worker.postMessage(job);
    }
  }

  private finish(worker: Worker, settle: (task: { resolve: (rows: SeasonSimulationScore[]) => void; reject: (error: Error) => void }) => void) {
    const task = this.running.get(worker);
    this.running.delete(worker);
    this.idle.push(worker);
    if (task) settle(task);
    this.dispatch();
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

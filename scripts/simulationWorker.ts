import { parentPort, workerData } from "node:worker_threads";
import { seasonSimulationBackTest } from "../src/domain/seasonBackTest.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { modelOf, readSeason, type SimulationJob } from "./simulationJobs.ts";

/** One thread of the study's SimulationPool: runs the Season Simulation Back-Test of the jobs it is sent. */
const games = new Map<number, Snapshot["games"]>();
parentPort!.on("message", async ({ spec, season, runs }: SimulationJob) => {
  if (!games.has(season)) games.set(season, (await readSeason(workerData.dir, season)).games);
  parentPort!.postMessage(seasonSimulationBackTest(games.get(season)!, [modelOf(spec)], runs)[0]!.rows);
});

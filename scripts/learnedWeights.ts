/**
 * Writes data/learned-weights.json: the Learned Model's ordered-logit weights for the Season in data/games.json, fitted
 * on every finished Season in data/local/seasons/ from 2021/22 on, with Ratings from the warm-up chain (2017/18 on). Run
 * by hand once per Season, after `npm run starting-ratings` (the file records the Starting Ratings it was fitted against).
 *
 *   npm run learned-weights
 *   npm run learned-weights -- --first-training-season 2021
 *
 * The features take their default hyperparameters and there is no L2 penalty. Strength Uncertainty τ is tuned by an inner
 * walk-forward: each finished Season after the first training Season is projected (the Season Simulation Back-Test, --runs
 * runs per forecast point) with weights fitted only on the Seasons before it, from the Starting Ratings the warm-up chain
 * gave it, and τ is the grid value that minimises pooled Rank RPS over those Seasons. The grid runs from 0 to 1.0 in steps
 * of 0.025 on the logit scale and is extended past 1.0 while the optimum is on its edge; a tie goes to the smaller τ.
 * Deterministic: the same data gives the same bytes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ELO_CARRY_OVER, ELO_HOME_ADVANTAGE, ELO_K, STARTING_RATINGS } from "../src/domain/eloModel.ts";
import type { PlayedGame } from "../src/domain/form.ts";
import { createLearnedModel, type LearnedWeights } from "../src/domain/learnedModel.ts";
import {
  DEFAULT_LEARNED_FEATURE_PARAMETERS,
  LEARNED_FEATURE_NAMES,
  learnedFeatures,
} from "../src/domain/learnedFeatures.ts";
import { fitOrderedLogit, ordinalOutcomeOf, type OrderedLogitRow } from "../src/domain/orderedLogit.ts";
import { seasonLabel } from "../src/domain/season.ts";
import { seasonSimulationBackTest } from "../src/domain/seasonBackTest.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { chainStartingRatings, warmUpRatings, WARM_UP_FIRST_SEASON } from "./warmUp.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    games: { type: "string", default: "data/games.json" },
    out: { type: "string", default: "data/learned-weights.json" },
    "first-training-season": { type: "string", default: "2021" },
    runs: { type: "string", default: "200" },
  },
});

const readSnapshot = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Snapshot;
const upcoming = await readSnapshot(values.games);
const lastSeason = upcoming.season - 1;
const firstTrainingSeason = Number(values["first-training-season"]);
if (firstTrainingSeason < WARM_UP_FIRST_SEASON) throw new Error("Training cannot start before the warm-up chain");
if (STARTING_RATINGS.season !== upcoming.season) {
  throw new Error(`data/starting-ratings.json is for ${seasonLabel(STARTING_RATINGS.season)}; run npm run starting-ratings first`);
}

const chain = await warmUpRatings(lastSeason, values.dir);
const snapshots = new Map<number, Snapshot>();
for (let season = firstTrainingSeason; season <= lastSeason; season++) {
  snapshots.set(season, await readSnapshot(join(values.dir, `season-${season}.json`)));
}
// A finished Season may hold Games that were never played (COVID cancellations in 2021/22): no row, but still on the schedule.
const playedGamesOf = (season: number) => snapshots.get(season)!.games.filter((game): game is PlayedGame => game.result !== undefined);

/** The training rows of the Seasons, in order. */
const rowsOf = (seasons: readonly number[]): OrderedLogitRow[] =>
  seasons.flatMap((season) => {
    const snapshot = snapshots.get(season)!;
    return playedGamesOf(season).map((game) => {
      const { homeRating, awayRating } = chain.get(game.id)!;
      return {
        features: learnedFeatures(game, { homeRating, awayRating }, playedGamesOf(season), snapshot.games, DEFAULT_LEARNED_FEATURE_PARAMETERS),
        outcome: ordinalOutcomeOf(game),
      };
    });
  });

// Rounded so the file is the same on any machine's floating point, and the model serves exactly what is committed.
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const seasonsFrom = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

function weightsFor(season: number, fromSeasons: number[], startingRatings: LearnedWeights["startingRatings"], tau: number) {
  const fit = fitOrderedLogit(rowsOf(fromSeasons));
  const weights: LearnedWeights = {
    season,
    fromSeasons,
    elo: { k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE, carryOver: ELO_CARRY_OVER },
    startingRatings,
    features: LEARNED_FEATURE_NAMES,
    featureParameters: DEFAULT_LEARNED_FEATURE_PARAMETERS,
    coefficients: fit.coefficients.map(round),
    cutPoints: fit.cutPoints.map(round) as LearnedWeights["cutPoints"],
    tau,
  };
  return { weights, games: fromSeasons.reduce((sum, s) => sum + playedGamesOf(s).length, 0) };
}

const startingRatingsOf = (season: number) => chainStartingRatings(chain, playedGamesOf(season));

// Inner walk-forward: weights per test Season, fitted on the Seasons before it only. They do not depend on τ.
const testSeasons = seasonsFrom(firstTrainingSeason + 1, lastSeason);
const folds = testSeasons.map((season) => ({
  season,
  base: weightsFor(season, seasonsFrom(firstTrainingSeason, season - 1), startingRatingsOf(season), 0).weights,
}));
const runs = Number(values.runs);

const TAU_STEP = 0.025;
const TAU_GRID_END = 1;
const pooledRankRps = new Map<number, number>();
/** Pooled Rank RPS over the test Seasons at τ = step × index. */
function scoreAt(index: number): number {
  const tau = round(index * TAU_STEP);
  if (!pooledRankRps.has(tau)) {
    let sum = 0;
    let count = 0;
    for (const { season, base } of folds) {
      const { rows } = seasonSimulationBackTest(snapshots.get(season)!.games, [createLearnedModel({ ...base, tau })], runs)[0]!;
      for (const row of rows) sum += row.rankRps;
      count += rows.length;
    }
    pooledRankRps.set(tau, sum / count);
    console.error(`  τ ${tau.toFixed(3)}  pooled Rank RPS ${(sum / count).toFixed(5)}`);
  }
  return pooledRankRps.get(tau)!;
}

let bestIndex = 0;
let triedUpTo = Math.round(TAU_GRID_END / TAU_STEP);
for (let index = 0; index <= triedUpTo; index++) if (scoreAt(index) < scoreAt(bestIndex)) bestIndex = index;
// Extend while the optimum is on the edge of what has been tried.
while (bestIndex === triedUpTo) {
  triedUpTo++;
  if (scoreAt(triedUpTo) < scoreAt(bestIndex)) bestIndex = triedUpTo;
}
const tau = round(bestIndex * TAU_STEP);

const fromSeasons = seasonsFrom(firstTrainingSeason, lastSeason);
const { weights, games } = weightsFor(
  upcoming.season,
  fromSeasons,
  STARTING_RATINGS.ratings.map(({ teamId, rating }) => ({ teamId, rating })),
  tau,
);
await writeFile(values.out, JSON.stringify(weights, null, 2) + "\n");
console.log(`Learned weights for ${seasonLabel(upcoming.season)}, fitted on ${games} Games of ${fromSeasons.map(seasonLabel).join(", ")}:`);
LEARNED_FEATURE_NAMES.forEach((name, i) => console.log(`  ${name.padEnd(16)}${weights.coefficients[i]!.toFixed(4)}`));
console.log(`  cut points      ${weights.cutPoints.map((c) => c.toFixed(4)).join(", ")}`);
console.log(`  τ               ${tau} (pooled Rank RPS ${pooledRankRps.get(tau)!.toFixed(5)} over ${testSeasons.map(seasonLabel).join(", ")}; τ 0: ${pooledRankRps.get(0)!.toFixed(5)})`);
console.log(`Wrote ${values.out}`);

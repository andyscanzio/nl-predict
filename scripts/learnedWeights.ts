/**
 * Writes data/learned-weights.json: the Learned Model's ordered-logit weights for the Season in data/games.json, fitted
 * on every finished Season in data/local/seasons/ from 2021/22 on, with Ratings from the warm-up chain (2017/18 on). Run
 * by hand once per Season, after `npm run starting-ratings` (the file records the Starting Ratings it was fitted against).
 *
 *   npm run learned-weights
 *   npm run learned-weights -- --first-training-season 2021
 *
 * The features take their default hyperparameters, there is no L2 penalty and τ is 0. Deterministic: the same data gives
 * the same bytes.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ELO_CARRY_OVER, ELO_HOME_ADVANTAGE, ELO_K, STARTING_RATINGS } from "../src/domain/eloModel.ts";
import type { PlayedGame } from "../src/domain/form.ts";
import type { LearnedWeights } from "../src/domain/learnedModel.ts";
import {
  DEFAULT_LEARNED_FEATURE_PARAMETERS,
  LEARNED_FEATURE_NAMES,
  learnedFeatures,
} from "../src/domain/learnedFeatures.ts";
import { fitOrderedLogit, ordinalOutcomeOf, type OrderedLogitRow } from "../src/domain/orderedLogit.ts";
import { seasonLabel } from "../src/domain/season.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { warmUpRatings, WARM_UP_FIRST_SEASON } from "./warmUp.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    games: { type: "string", default: "data/games.json" },
    out: { type: "string", default: "data/learned-weights.json" },
    "first-training-season": { type: "string", default: "2021" },
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
const rows: OrderedLogitRow[] = [];
const fromSeasons: number[] = [];
for (let season = firstTrainingSeason; season <= lastSeason; season++) {
  const snapshot = await readSnapshot(join(values.dir, `season-${season}.json`));
  // A finished Season may hold Games that were never played (COVID cancellations in 2021/22): no row, but still on the schedule.
  const playedGames = snapshot.games.filter((game): game is PlayedGame => game.result !== undefined);
  for (const game of playedGames) {
    const { homeRating, awayRating } = chain.get(game.id)!;
    rows.push({
      features: learnedFeatures(game, { homeRating, awayRating }, playedGames, snapshot.games, DEFAULT_LEARNED_FEATURE_PARAMETERS),
      outcome: ordinalOutcomeOf(game),
    });
  }
  fromSeasons.push(season);
}

// Rounded so the file is the same on any machine's floating point, and the model serves exactly what is committed.
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const fit = fitOrderedLogit(rows);
const weights: LearnedWeights = {
  season: upcoming.season,
  fromSeasons,
  elo: { k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE, carryOver: ELO_CARRY_OVER },
  startingRatings: STARTING_RATINGS.ratings.map(({ teamId, rating }) => ({ teamId, rating })),
  features: LEARNED_FEATURE_NAMES,
  featureParameters: DEFAULT_LEARNED_FEATURE_PARAMETERS,
  coefficients: fit.coefficients.map(round),
  cutPoints: fit.cutPoints.map(round) as LearnedWeights["cutPoints"],
  tau: 0,
};
await writeFile(values.out, JSON.stringify(weights, null, 2) + "\n");
console.log(`Learned weights for ${seasonLabel(upcoming.season)}, fitted on ${rows.length} Games of ${fromSeasons.map(seasonLabel).join(", ")}:`);
LEARNED_FEATURE_NAMES.forEach((name, i) => console.log(`  ${name.padEnd(16)}${weights.coefficients[i]!.toFixed(4)}`));
console.log(`  cut points      ${weights.cutPoints.map((c) => c.toFixed(4)).join(", ")}`);
console.log(`Wrote ${values.out}`);

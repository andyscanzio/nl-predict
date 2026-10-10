/**
 * Back-Tests every Projection Model against the snapshot's Played Games and prints a score per model.
 *
 *   npm run backtest                        data/games.json
 *   npm run backtest -- --in path/to.json   another snapshot
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { backTest } from "../src/domain/backTest.ts";
import { eloLevelStartModel, eloModelFor, STARTING_RATINGS } from "../src/domain/eloModel.ts";
import { PROJECTION_MODELS } from "../src/domain/projectionModels.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { seasonLabel } from "../src/domain/season.ts";

const { values } = parseArgs({ options: { in: { type: "string", default: "data/games.json" } } });
const snapshot = JSON.parse(await readFile(values.in, "utf8")) as Snapshot;

// The Starting Ratings belong to one Season; the Elo Model starts any other level, so only that Season gets a Level Start
// row. It runs last, for comparison only: it never competes for the Default Model.
const withLevelStart = snapshot.season === STARTING_RATINGS.season;
const models = [
  ...PROJECTION_MODELS.map((model) => (model.id === "elo" ? eloModelFor(snapshot.season) : model)),
  ...(withLevelStart ? [eloLevelStartModel] : []),
];
const scores = backTest(snapshot.games, new Date(snapshot.snapshotAt), models);
if (scores[0]?.games === 0) {
  console.log(`No Played Games in ${values.in} yet; nothing to Back-Test.`);
  process.exit(0);
}

console.log(`Back-Test of Season ${seasonLabel(snapshot.season)}: ${scores[0]!.games} Played Games up to ${snapshot.snapshotAt}`);
if (!withLevelStart) {
  console.log(`The Starting Ratings are for ${seasonLabel(STARTING_RATINGS.season)}, so the Elo Model starts this Season level.`);
}
console.log("Brier score: lower is better (0–2); Points MAE: mean error in Points per team per Game.");
if (withLevelStart) console.log(`${eloLevelStartModel.name} is for comparison only, not a candidate for the Default Model.`);
console.log();
console.table(
  scores.map(({ model, brierScore, pointsMae }) => ({
    Model: model,
    "Brier score": brierScore === null ? "—" : brierScore.toFixed(4),
    "Points MAE": pointsMae.toFixed(4),
  })),
);

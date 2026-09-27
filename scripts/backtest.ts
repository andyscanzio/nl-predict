/**
 * Back-Tests every Projection Model against the snapshot's Played Games and prints a score per model.
 *
 *   npm run backtest                        data/games.json
 *   npm run backtest -- --in path/to.json   another snapshot
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { backTest } from "../src/domain/backTest.ts";
import { eloModel } from "../src/domain/eloModel.ts";
import { matchupModel } from "../src/domain/matchupModel.ts";
import { seasonRate } from "../src/domain/seasonRate.ts";
import { splitFormRate } from "../src/domain/splitFormRate.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { seasonLabel } from "../src/domain/season.ts";

const { values } = parseArgs({ options: { in: { type: "string", default: "data/games.json" } } });
const snapshot = JSON.parse(await readFile(values.in, "utf8")) as Snapshot;

const scores = backTest(snapshot.games, new Date(snapshot.snapshotAt), [splitFormRate, seasonRate, matchupModel, eloModel]);
if (scores[0]?.games === 0) {
  console.log(`No Played Games in ${values.in} yet; nothing to Back-Test.`);
  process.exit(0);
}

console.log(`Back-Test of Season ${seasonLabel(snapshot.season)}: ${scores[0]!.games} Played Games up to ${snapshot.snapshotAt}`);
console.log("Brier score: lower is better (0–2); Points MAE: mean error in Points per team per Game.\n");
console.table(
  scores.map(({ model, brierScore, pointsMae }) => ({
    Model: model,
    "Brier score": brierScore === null ? "—" : brierScore.toFixed(4),
    "Points MAE": pointsMae.toFixed(4),
  })),
);

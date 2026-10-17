/**
 * Learned Model study (#148): does a layer of weights fitted to finished Seasons on top of the Elo Model's Ratings
 * predict each Game better than the Elo Model? Writes a text report under data/local/learned-model-study/ so study
 * results never end up in the repo.
 *
 *   npm run study:learned
 *
 * Tickets #153 and #154 cover rungs 1–3 of the ladder and the per-Game metrics. The later rungs and the Season Simulation
 * metrics are added to this script by their own tickets; the rules below are fixed for all of them before the first run.
 *
 * Folds: walk-forward, testing 2023/24, 2024/25 and 2025/26. Each fold trains on every earlier Season from 2021/22, and
 * the Elo chain is warmed from 2017/18 (the warm-up chain, scripts/warmUp.ts).
 *
 * Elo baseline: one shared Elo chain at the production values (K 10, Home Advantage 60, carry-over 1). It feeds both the
 * Rating-difference feature and the Elo Model baseline. Those values were tuned on the same test Seasons (ADR 0004), a
 * leak that favours both sides equally; the report says so.
 *
 * Tuning: the Prior-Games count, the back-to-back rule and the regularisation are tuned only on each fold's training
 * Seasons, by an inner time split that trains on the earlier training Seasons and validates on the last training Season
 * (per-Game Brier). Where the thin inner split can't separate the options, the simplest setting wins: an option is
 * separated from the best only if it is within one standard error of the best's paired per-Game difference, and among
 * the options that are not separated the one earliest in the grid's simplicity order is chosen (default features first,
 * no regularisation first).
 *
 * The ladder, fixed in advance. Each rung must beat the rung below it on pooled per-Game Brier *and* in at least 2 of 3
 * test Seasons:
 *   1. ordered logit on Rating difference only (the baseline);
 *   2. ordered logit on the agreed features (goal difference, back-to-back flags, learned intercept): the ladder's root;
 *   3. + non-proportional OT/SO (partial proportional odds on a closeness term);
 *   4. the richer-input swaps and additions, nested in this order: regulation goal difference (an OT/SO Game counts as
 *      0); goal difference over periods 1–2; + shot-share difference, SOG for / (for + against); + special-teams net
 *      difference, PP goals for − PP goals against per Game;
 *   5. nonlinear learners (small MLP, then GBM) on the best linear feature set, each required to beat the best linear
 *      rung.
 * The highest rung reached is the Learned Model. Rung 1 is always reached. Selecting a rung makes its test score somewhat
 * optimistic, and the report says so.
 *
 * Reported, not gating: per-Game Brier, log loss, four-outcome RPS and OT/SO calibration by closeness third. Every Δ
 * against Elo gets a paired cluster bootstrap 95% interval (scripts/studyStats.ts), clustered by Match Day for per-Game
 * metrics (and by Season × team for Rank metrics, once those are added).
 *
 * Picker rule: the Learned Model joins the picker if it meets the inference caps (Projection History build adds at most
 * the Elo Model's ~3 s, weights ≤ ~50 KB, one prediction per Remaining Game per projection). Its score against Elo
 * doesn't matter here.
 *
 * Default rule (ADR 0004's rule): against the Elo Model, the Learned Model must be better on pooled per-Game Brier and
 * in at least 2 of 3 test Seasons, better on pooled Rank RPS and in at least 2 of 3 test Seasons, and have early-Season
 * Outer Tenths ≤ 25% at the Strength Uncertainty τ tuned on training Seasons. A failed guard means no Default, never a
 * retune. Significance isn't required.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { ELO_HOME_ADVANTAGE, expectedHomeScore } from "../src/domain/eloModel.ts";
import type { PlayedGame } from "../src/domain/form.ts";
import { DEFAULT_LEARNED_FEATURE_PARAMETERS, learnedFeatures } from "../src/domain/learnedFeatures.ts";
import {
  fitOrderedLogit,
  linearPredictor,
  ordinalOutcomeOf,
  outcomeProbabilitiesOf,
  type OrdinalOutcome,
} from "../src/domain/orderedLogit.ts";
import { otsoRate, outcomesFromExpectedPoints, type OutcomeProbabilities } from "../src/domain/outcomes.ts";
import { seasonLabel } from "../src/domain/season.ts";
import { swissCalendarDay } from "../src/domain/swissDay.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { clusterBootstrap } from "./studyStats.ts";
import { warmUpRatings } from "./warmUp.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    resamples: { type: "string", default: "10000" },
    seed: { type: "string", default: "153" },
    out: { type: "string", default: "data/local/learned-model-study/learned-model.txt" },
  },
});
const resamples = Number(values.resamples);
const seed = Number(values.seed);

const FIRST_TRAINING_SEASON = 2021;
const TEST_SEASONS = [2023, 2024, 2025];
const LAST_SEASON = TEST_SEASONS[TEST_SEASONS.length - 1]!;

/** The tuning grids, each led by its simplest setting (the default features, no regularisation). */
const GRID_PRIOR_GAMES = [DEFAULT_LEARNED_FEATURE_PARAMETERS.priorGames, 5, 20, 40];
const GRID_BACK_TO_BACK_DAYS = [DEFAULT_LEARNED_FEATURE_PARAMETERS.backToBackDays, 2];
const GRID_L2 = [0, 10, 100, 1000];

// ---------------------------------------------------------------------------------------------------------------------
// Data: one row per Played Game, with the shared Elo chain's Ratings and the Elo Model's prediction.
// ---------------------------------------------------------------------------------------------------------------------

/** Outcome Probabilities in ordinal order: regulation loss, OT/SO loss, OT/SO win, regulation win. */
type OutcomeVector = [number, number, number, number];
const vectorOf = (p: OutcomeProbabilities): OutcomeVector => [
  p.regulationLoss,
  p.overtimeOrShootoutLoss,
  p.overtimeOrShootoutWin,
  p.regulationWin,
];

interface GameRow {
  game: PlayedGame;
  season: number;
  /** Season × Swiss calendar day: the bootstrap's cluster. */
  matchDay: string;
  outcome: OrdinalOutcome;
  homeRating: number;
  awayRating: number;
  elo: OutcomeVector;
}

const chain = await warmUpRatings(LAST_SEASON, values.dir);
const snapshots = new Map<number, Snapshot>();
const rowsBySeason = new Map<number, GameRow[]>();
for (let season = FIRST_TRAINING_SEASON; season <= LAST_SEASON; season++) {
  const snapshot = JSON.parse(await readFile(join(values.dir, `season-${season}.json`), "utf8")) as Snapshot;
  snapshots.set(season, snapshot);
  // A finished Season may hold Games never played (COVID cancellations in 2021/22): no row, but still on the schedule.
  const played = snapshot.games
    .filter((game): game is PlayedGame => game.result !== undefined)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  rowsBySeason.set(
    season,
    played.map((game) => {
      const { homeRating, awayRating } = chain.get(game.id)!;
      // As the Back-Test does: the OT/SO Rate from the Games that started before this one.
      const before = played.filter((other) => Date.parse(other.startsAt) < Date.parse(game.startsAt));
      const expected = expectedHomeScore(homeRating, awayRating, ELO_HOME_ADVANTAGE);
      return {
        game,
        season,
        matchDay: `${season}|${swissCalendarDay(Date.parse(game.startsAt))}`,
        outcome: ordinalOutcomeOf(game),
        homeRating,
        awayRating,
        elo: vectorOf(outcomesFromExpectedPoints(3 * expected, otsoRate(before))),
      };
    }),
  );
}

/** The feature vectors of a Season's rows under feature hyperparameters, cached. */
const featureCache = new Map<string, number[][]>();
function featuresOf(season: number, priorGames: number, backToBackDays: number): number[][] {
  const key = `${season}|${priorGames}|${backToBackDays}`;
  if (!featureCache.has(key)) {
    const rows = rowsBySeason.get(season)!;
    const played = rows.map((row) => row.game);
    const parameters = { ...DEFAULT_LEARNED_FEATURE_PARAMETERS, priorGames, backToBackDays };
    featureCache.set(
      key,
      rows.map((row) => learnedFeatures(row.game, row, played, snapshots.get(season)!.games, parameters)),
    );
  }
  return featureCache.get(key)!;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------------------------------------------------

const brierOf = (p: OutcomeVector, outcome: number) => p.reduce((sum, x, k) => sum + (x - Number(k === outcome)) ** 2, 0);
const logLossOf = (p: OutcomeVector, outcome: number) => -Math.log(Math.max(p[outcome]!, 1e-12));
/** Ranked probability score over the four ordered outcomes: squared cumulative errors, averaged over the 3 cut points. */
function rpsOf(p: OutcomeVector, outcome: number): number {
  let cumulative = 0;
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    cumulative += p[k]!;
    sum += (cumulative - Number(outcome <= k)) ** 2;
  }
  return sum / 3;
}
const METRICS = [
  { name: "Brier", score: brierOf },
  { name: "log loss", score: logLossOf },
  { name: "RPS", score: rpsOf },
] as const;

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

// ---------------------------------------------------------------------------------------------------------------------
// Rungs, tuning and folds
// ---------------------------------------------------------------------------------------------------------------------

interface Rung {
  name: string;
  /** Which of the feature vector's columns the rung uses. */
  columns: number[];
  /** Whether the Prior-Games count and the back-to-back rule enter the rung's features. */
  tunesFeatures: boolean;
  /** Whether the OT/SO cut points move with closeness |η| (partial proportional odds). */
  closeness?: boolean;
}
const RUNGS: Rung[] = [
  { name: "Rung 1: Rating difference", columns: [0], tunesFeatures: false },
  { name: "Rung 2: agreed features", columns: [0, 1, 2, 3], tunesFeatures: true },
  { name: "Rung 3: non-proportional OT/SO", columns: [0, 1, 2, 3], tunesFeatures: true, closeness: true },
];

interface Setting {
  priorGames: number;
  backToBackDays: number;
  l2: number;
}
const settingLabel = (s: Setting, rung: Rung) =>
  `${rung.tunesFeatures ? `Prior Games ${s.priorGames}, back-to-back ${s.backToBackDays} day${s.backToBackDays > 1 ? "s" : ""}, ` : ""}L2 ${s.l2}`;

/** Every setting a rung tunes over, simplest first: regularisation is the slowest-moving index. */
function settingsOf(rung: Rung): Setting[] {
  const priors = rung.tunesFeatures ? GRID_PRIOR_GAMES : [DEFAULT_LEARNED_FEATURE_PARAMETERS.priorGames];
  const days = rung.tunesFeatures ? GRID_BACK_TO_BACK_DAYS : [DEFAULT_LEARNED_FEATURE_PARAMETERS.backToBackDays];
  return GRID_L2.flatMap((l2) => days.flatMap((backToBackDays) => priors.map((priorGames) => ({ priorGames, backToBackDays, l2 }))));
}

const fitOn = (rung: Rung, setting: Setting, seasons: readonly number[]) =>
  fitOrderedLogit(
    seasons.flatMap((season) => {
      const features = featuresOf(season, setting.priorGames, setting.backToBackDays);
      return rowsBySeason.get(season)!.map((row, i) => ({
        features: rung.columns.map((c) => features[i]![c]!),
        outcome: row.outcome,
      }));
    }),
    { l2: setting.l2, closeness: rung.closeness },
  );

function predictWith(rung: Rung, setting: Setting, fit: ReturnType<typeof fitOn>, season: number): OutcomeVector[] {
  const features = featuresOf(season, setting.priorGames, setting.backToBackDays);
  return features.map((x) =>
    vectorOf(outcomeProbabilitiesOf(linearPredictor(fit.coefficients, rung.columns.map((c) => x[c]!)), fit.cutPoints, fit.closeness)),
  );
}

interface Tuned {
  setting: Setting;
  /** Settings the inner split could not tell from the best one (within one standard error), the chosen one included. */
  unseparated: number;
  options: number;
  /** The chosen setting's mean per-Game Brier on the validation Season. */
  validationBrier: number;
  bestValidationBrier: number;
  validationSeason: number;
}

/** Trains on the training Seasons but the last, validates on the last; the simplest setting not separated from the best wins. */
function tune(rung: Rung, trainSeasons: readonly number[]): Tuned {
  const validationSeason = trainSeasons[trainSeasons.length - 1]!;
  const innerTrain = trainSeasons.slice(0, -1);
  const rows = rowsBySeason.get(validationSeason)!;
  const settings = settingsOf(rung);
  const briers = settings.map((setting) => {
    const predicted = predictWith(rung, setting, fitOn(rung, setting, innerTrain), validationSeason);
    return rows.map((row, i) => brierOf(predicted[i]!, row.outcome));
  });
  const means = briers.map(mean);
  const best = means.indexOf(Math.min(...means));
  const unseparated = settings.map((_, s) => {
    const diffs = briers[s]!.map((b, i) => b - briers[best]![i]!);
    const m = mean(diffs);
    const variance = diffs.reduce((sum, d) => sum + (d - m) ** 2, 0) / (diffs.length - 1);
    return m <= Math.sqrt(variance / diffs.length);
  });
  const chosen = unseparated.indexOf(true);
  return {
    setting: settings[chosen]!,
    unseparated: unseparated.filter(Boolean).length,
    options: settings.length,
    validationBrier: means[chosen]!,
    bestValidationBrier: means[best]!,
    validationSeason,
  };
}

interface FoldRung {
  tuned: Tuned;
  fit: ReturnType<typeof fitOn>;
  predicted: OutcomeVector[];
}
const foldRungs = new Map<string, FoldRung>();
for (const test of TEST_SEASONS) {
  const trainSeasons = Array.from({ length: test - FIRST_TRAINING_SEASON }, (_, i) => FIRST_TRAINING_SEASON + i);
  for (const rung of RUNGS) {
    const tuned = tune(rung, trainSeasons);
    const fit = fitOn(rung, tuned.setting, trainSeasons);
    foldRungs.set(`${test}|${rung.name}`, { tuned, fit, predicted: predictWith(rung, tuned.setting, fit, test) });
    console.error(`${seasonLabel(test)} ${rung.name}: ${settingLabel(tuned.setting, rung)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The test rows, scored
// ---------------------------------------------------------------------------------------------------------------------

const MODELS = ["Elo Model", ...RUNGS.map((rung) => rung.name)];
const shortName = (model: string) => model.split(":")[0]!;
const testRows = TEST_SEASONS.flatMap((season) => rowsBySeason.get(season)!);
const predictions = new Map<string, OutcomeVector[]>([
  ["Elo Model", testRows.map((row) => row.elo)],
  ...RUNGS.map((rung): [string, OutcomeVector[]] => [
    rung.name,
    TEST_SEASONS.flatMap((season) => foldRungs.get(`${season}|${rung.name}`)!.predicted),
  ]),
]);
/** A model's per-Game score of one metric over the test rows. */
const scoresOf = (model: string, metric: (typeof METRICS)[number]) =>
  testRows.map((row, i) => metric.score(predictions.get(model)![i]!, row.outcome));
const indexesOf = (season?: number) => testRows.flatMap((row, i) => (season === undefined || row.season === season ? [i] : []));
const meanOver = (scores: readonly number[], indexes: readonly number[]) => mean(indexes.map((i) => scores[i]!));

/** Challenger − baseline: pooled over the indexes, with the cluster bootstrap's interval (negative favours the challenger). */
function delta(challenger: string, baseline: string, metric: (typeof METRICS)[number], indexes: readonly number[]) {
  const a = scoresOf(challenger, metric);
  const b = scoresOf(baseline, metric);
  return clusterBootstrap(
    indexes.map((i) => a[i]! - b[i]!),
    indexes.map((i) => testRows[i]!.matchDay),
    { resamples, seed },
  );
}
const fmt = (x: number, digits = 5) => (x >= 0 ? "+" : "") + x.toFixed(digits);
const deltaText = (d: ReturnType<typeof delta>, baselineScore: number) =>
  `${fmt(d.mean)} (${fmt((100 * d.mean) / baselineScore, 2)}%)  95% [${fmt(d.low)}, ${fmt(d.high)}]`;

// ---------------------------------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------------------------------

const lines: string[] = [];
const out = (line = "") => lines.push(line);
const seasonsText = TEST_SEASONS.map(seasonLabel).join(", ");

out("Learned Model study: rungs 1–3 and per-Game metrics (#153, #154)");
out(`Test Seasons ${seasonsText}; folds are walk-forward, each trained on every earlier Season from ${seasonLabel(FIRST_TRAINING_SEASON)}.`);
out(`Elo chain warmed from 2017/18. Bootstrap: ${resamples} resamples of Match Days, seed ${seed}. Negative Δ favours the challenger.`);
out();
out("Caveats");
out("  - The Elo values (K 10, Home Advantage 60, carry-over 1) were tuned on these same test Seasons (ADR 0004). That leak favours");
out("    the Elo Model and the Rating-difference feature equally, since both read the same chain.");
out("  - Selecting a rung by its test score makes that score somewhat optimistic.");
out();

out("Hyperparameters chosen on each fold's training Seasons only");
for (const test of TEST_SEASONS) {
  const first = foldRungs.get(`${test}|${RUNGS[0]!.name}`)!.tuned;
  const trained = `${seasonLabel(FIRST_TRAINING_SEASON)}–${seasonLabel(test - 1)}`;
  out(`  ${seasonLabel(test)} (trained on ${trained}; inner split validates on ${seasonLabel(first.validationSeason)}):`);
  for (const rung of RUNGS) {
    const { tuned, fit } = foldRungs.get(`${test}|${rung.name}`)!;
    out(`    ${rung.name}: ${settingLabel(tuned.setting, rung)}`);
    out(
      `      validation Brier ${tuned.validationBrier.toFixed(5)} (best of ${tuned.options}: ${tuned.bestValidationBrier.toFixed(5)}); ` +
        `${tuned.unseparated} of ${tuned.options} settings not separated from the best`,
    );
    out(
      `      fitted: coefficients ${fit.coefficients.map((c) => c.toPrecision(4)).join(", ")}; cut points ${fit.cutPoints.map((c) => c.toFixed(4)).join(", ")}` +
        (fit.closeness ? `; closeness effect on the OT/SO cut points ${fit.closeness.map((c) => c.toFixed(4)).join(", ")}` : ""),
    );
  }
}
out();

out("Per-Game scores (mean over Games; lower is better)");
for (const metric of METRICS) {
  out(`  ${metric.name}`);
  out(`    ${"".padEnd(14)}${[...TEST_SEASONS.map(seasonLabel), "pooled"].map((h) => h.padStart(10)).join("")}`);
  for (const model of MODELS) {
    const scores = scoresOf(model, metric);
    const cells = [...TEST_SEASONS.map((s) => indexesOf(s)), indexesOf()].map((indexes) => meanOver(scores, indexes).toFixed(5).padStart(10));
    out(`    ${shortName(model).padEnd(14)}${cells.join("")}`);
  }
}
out(`  Games: ${[...TEST_SEASONS.map((s) => indexesOf(s).length), testRows.length].join(", ")} (${[...TEST_SEASONS.map(seasonLabel), "pooled"].join(", ")})`);
out();

const comparisons: [string, string][] = [
  [RUNGS[0]!.name, "Elo Model"],
  [RUNGS[1]!.name, "Elo Model"],
  [RUNGS[1]!.name, RUNGS[0]!.name],
  [RUNGS[2]!.name, "Elo Model"],
  [RUNGS[2]!.name, RUNGS[1]!.name],
];
out("Paired differences, challenger − baseline, with the Match Day cluster bootstrap");
for (const [challenger, baseline] of comparisons) {
  out(`  ${challenger} vs ${baseline}`);
  for (const metric of METRICS) {
    const baselineScores = scoresOf(baseline, metric);
    for (const [label, indexes] of [["pooled", indexesOf()] as const, ...TEST_SEASONS.map((s) => [seasonLabel(s), indexesOf(s)] as const)]) {
      out(`    ${metric.name.padEnd(9)}${label.padEnd(9)}${deltaText(delta(challenger, baseline, metric, indexes), meanOver(baselineScores, indexes))}`);
    }
  }
}
out();

const brier = METRICS[0];
out("Ladder verdict so far");
out(`  Rung 1 (Rating difference only): always reached.`);
let highest = 1;
for (let r = 1; r < RUNGS.length; r++) {
  const [rung, below] = [RUNGS[r]!.name, RUNGS[r - 1]!.name];
  const pooled = delta(rung, below, brier, indexesOf());
  const seasons = TEST_SEASONS.filter((s) => delta(rung, below, brier, indexesOf(s)).mean < 0);
  const reached = highest === r && pooled.mean < 0 && seasons.length >= 2;
  if (reached) highest = r + 1;
  out(
    `  Rung ${r + 1} vs rung ${r}: pooled Brier ${fmt(pooled.mean)}, better in ${seasons.length} of ${TEST_SEASONS.length} test Seasons` +
      `${seasons.length ? ` (${seasons.map(seasonLabel).join(", ")})` : ""} → rung ${r + 1} ${reached ? "reached" : highest < r ? "not tried (a lower rung was not reached)" : "not reached"}.`,
  );
}
out(`  Highest rung reached so far: ${highest}. Rungs 4–5 are not run yet. Selecting it makes its test score somewhat optimistic.`);
out();

const brierElo = scoresOf("Elo Model", brier);
out("Against the Elo Model, pooled per-Game Brier (the Default rule's per-Game half; the Rank RPS half is not run yet)");
for (const rung of RUNGS) {
  const better = TEST_SEASONS.filter((s) => meanOver(scoresOf(rung.name, brier), indexesOf(s)) < meanOver(brierElo, indexesOf(s)));
  const pooled = delta(rung.name, "Elo Model", brier, indexesOf());
  out(`  ${rung.name}: ${fmt(pooled.mean)}; better in ${better.length} of ${TEST_SEASONS.length} test Seasons`);
}
out();

// OT/SO calibration: terciles of the Elo Model's closeness, |P(home win) − ½|, so every model is read on the same Games.
const closeness = testRows.map((row) => Math.abs(row.elo[2] + row.elo[3] - 0.5));
const order = closeness.map((_, i) => i).sort((a, b) => closeness[a]! - closeness[b]!);
const thirds = [0, 1, 2].map((t) => order.slice(Math.floor((t * order.length) / 3), Math.floor(((t + 1) * order.length) / 3)));
out("OT/SO calibration by closeness third (closeness = |Elo's home win chance − 50%|; mean predicted OT/SO chance vs observed rate)");
out(`    ${"".padEnd(24)}${["Games", "observed", ...MODELS.map(shortName)].map((h) => h.padStart(13)).join("")}`);
["closest third", "middle third", "widest third"].forEach((label, t) => {
  const indexes = thirds[t]!;
  const observed = mean(indexes.map((i) => Number(testRows[i]!.outcome === 1 || testRows[i]!.outcome === 2)));
  const range = `${closeness[indexes[0]!]!.toFixed(2)}–${closeness[indexes[indexes.length - 1]!]!.toFixed(2)}`;
  const predicted = MODELS.map((model) => mean(indexes.map((i) => predictions.get(model)![i]![1]! + predictions.get(model)![i]![2]!)));
  out(
    `    ${`${label} (${range})`.padEnd(24)}${[String(indexes.length), observed.toFixed(4), ...predicted.map((p) => p.toFixed(4))]
      .map((c) => c.padStart(13))
      .join("")}`,
  );
});

await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nWrote ${values.out}`);

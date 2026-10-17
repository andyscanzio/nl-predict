/**
 * Learned Model study (#148): does a layer of weights fitted to finished Seasons on top of the Elo Model's Ratings
 * predict each Game better than the Elo Model? Writes a text report under data/local/learned-model-study/ so study
 * results never end up in the repo.
 *
 *   npm run study:learned
 *
 * Tickets #153 and #154 cover rungs 1–3 of the ladder and the per-Game metrics; #155 the Season Simulation half (Strength
 * Uncertainty τ, Rank metrics against Elo, the picker and Default verdicts, the sensitivity runs) for the highest rung
 * reached. The later rungs are added to this script by their own tickets, and a rerun picks them up automatically; the
 * rules below are fixed for all of them before the first run.
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
 * metrics and by Season × team for Rank metrics.
 *
 * Strength Uncertainty τ (the Learned Model only, constant): tuned per fold on that fold's training Seasons only, by an
 * inner walk-forward (each training Season after the first is projected with weights fitted only on the Seasons before
 * it), to minimise pooled Rank RPS on the grid 0 to 1.0 in steps of 0.025, extended while the optimum is on its edge. The
 * Elo baseline uses its production Rating Uncertainty σ = 50.
 *
 * Picker rule: the Learned Model joins the picker if it meets the inference caps (Projection History build adds at most
 * the Elo Model's ~3 s, weights ≤ ~50 KB, one prediction per Remaining Game per projection). Its score against Elo
 * doesn't matter here.
 *
 * Default rule (ADR 0004's rule): against the Elo Model, the Learned Model must be better on pooled per-Game Brier and
 * in at least 2 of 3 test Seasons, better on pooled Rank RPS and in at least 2 of 3 test Seasons, and have early-Season
 * Outer Tenths ≤ 25% at the Strength Uncertainty τ tuned on training Seasons. A failed guard means no Default, never a
 * retune. Significance isn't required.
 *
 * Sensitivity runs (report only; same rung and hyperparameters as the main run, weights refitted, τ re-tuned where the
 * inner walk-forward has a Season to tune on): add 2017/18–2019/20 as training rows (2020/21 left out), and drop the
 * 2021/22 rows. If either flips the Default verdict, the report says so and hands the Default decision to the human.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  eloModel,
  ELO_HOME_ADVANTAGE,
  ELO_K,
  ELO_RATING_UNCERTAINTY,
  expectedHomeScore,
  STARTING_RATINGS,
} from "../src/domain/eloModel.ts";
import type { PlayedGame } from "../src/domain/form.ts";
import { DEFAULT_LEARNED_FEATURE_PARAMETERS, LEARNED_FEATURE_NAMES, learnedFeatures } from "../src/domain/learnedFeatures.ts";
import type { LearnedWeights } from "../src/domain/learnedModel.ts";
import {
  fitOrderedLogit,
  linearPredictor,
  ordinalOutcomeOf,
  outcomeProbabilitiesOf,
  type OrdinalOutcome,
} from "../src/domain/orderedLogit.ts";
import { otsoRate, outcomesFromExpectedPoints, type OutcomeProbabilities } from "../src/domain/outcomes.ts";
import { projectionModelInput } from "../src/domain/project.ts";
import { projectionHistory } from "../src/domain/projectionHistory.ts";
import { seasonLabel } from "../src/domain/season.ts";
import type { SeasonSimulationScore } from "../src/domain/seasonBackTest.ts";
import { swissCalendarDay } from "../src/domain/swissDay.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { clusterBootstrap } from "./studyStats.ts";
import { modelOf, SimulationPool, type ModelSpec } from "./simulationJobs.ts";
import { chainStartingRatings, WARM_UP_FIRST_SEASON, warmUpRatings } from "./warmUp.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    resamples: { type: "string", default: "10000" },
    seed: { type: "string", default: "153" },
    runs: { type: "string", default: "500" },
    "tune-runs": { type: "string", default: "200" },
    workers: { type: "string", default: String(Math.max(1, availableParallelism() - 1)) },
    out: { type: "string", default: "data/local/learned-model-study/learned-model.txt" },
  },
});
const resamples = Number(values.resamples);
const seed = Number(values.seed);
/** Season Simulation runs per forecast point: for scoring, and for tuning τ (fewer, since the grid has 41+ values). */
const simulationRuns = Number(values.runs);
const tuneRuns = Number(values["tune-runs"]);

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
// From the start of the warm-up chain: the sensitivity run that adds 2017/18–2019/20 trains on those Seasons' rows.
for (let season = WARM_UP_FIRST_SEASON; season <= LAST_SEASON; season++) {
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

out("Learned Model study: rungs 1–3, per-Game metrics, Season Simulation metrics and verdicts (#153, #154, #155)");
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
out("Against the Elo Model, pooled per-Game Brier (the Default rule's per-Game half)");
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

// ---------------------------------------------------------------------------------------------------------------------
// Season Simulation half (#155): the Learned Model is the highest rung reached
// ---------------------------------------------------------------------------------------------------------------------

const learnedRung = RUNGS[highest - 1]!;
const PHASES = ["1–13", "14–26", "27–39", "40–52"];
/** The band of a forecast by the team's Played Games; the first band is the early Season. */
const phaseOf = (gamesPlayed: number) => Math.min(PHASES.length - 1, Math.max(0, Math.ceil(gamesPlayed / 13) - 1));
const EARLY_OUTER_TENTHS_LIMIT = 0.25;
const TAU_STEP = 0.025;
const TAU_GRID_END = 1;
/** A stop for extending the grid, in case Rank RPS never turns. */
const TAU_GRID_LIMIT = 5;
const tauAt = (index: number) => Math.round(index * TAU_STEP * 1e6) / 1e6;

const playedOf = (season: number) => rowsBySeason.get(season)!.map((row) => row.game);
const startingRatingsOf = (season: number) => chainStartingRatings(chain, playedOf(season));
const seasonsFrom = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

/** The Elo Model of a Season at the production values and its chain Starting Ratings, with Rating Uncertainty σ = 50. */
const eloSpec = (season: number): ModelSpec => ({ kind: "elo", startingRatings: startingRatingsOf(season) });

const fitCache = new Map<string, ReturnType<typeof fitOn>>();
function fitFor(rung: Rung, setting: Setting, train: readonly number[]) {
  const key = [rung.name, settingLabel(setting, rung), train.join()].join("|");
  if (!fitCache.has(key)) fitCache.set(key, fitOn(rung, setting, train));
  return fitCache.get(key)!;
}

/** The Learned Model's weights for a Season: the rung's fit padded with zeros for the columns it leaves out. */
function weightsOf(rung: Rung, setting: Setting, train: readonly number[], season: number, tau: number): LearnedWeights {
  const fit = fitFor(rung, setting, train);
  return {
    season,
    fromSeasons: [...train],
    elo: { k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE, carryOver: STARTING_RATINGS.carryOver },
    startingRatings: startingRatingsOf(season),
    features: LEARNED_FEATURE_NAMES,
    featureParameters: { ...DEFAULT_LEARNED_FEATURE_PARAMETERS, priorGames: setting.priorGames, backToBackDays: setting.backToBackDays },
    coefficients: LEARNED_FEATURE_NAMES.map((_, column) => {
      const at = rung.columns.indexOf(column);
      return at < 0 ? 0 : fit.coefficients[at]!;
    }),
    cutPoints: fit.cutPoints,
    ...(fit.closeness && { closeness: fit.closeness }),
    tau,
  };
}

/** Season Simulation Back-Test jobs run on a pool of worker threads; every result is cached under its key. */
const pool = new SimulationPool(Number(values.workers), values.dir);
const simulationCache = new Map<string, SeasonSimulationScore[]>();
interface Simulation {
  key: string;
  spec: ModelSpec;
  season: number;
  runs: number;
}
const cacheKeyOf = ({ key, season, runs }: Simulation) => `${key}|${season}|${runs}`;
/** Runs the simulations not yet cached, in parallel, and caches their rows. */
async function prefetch(simulations: readonly Simulation[]): Promise<void> {
  const missing = [...new Map(simulations.filter((s) => !simulationCache.has(cacheKeyOf(s))).map((s) => [cacheKeyOf(s), s])).values()];
  let done = 0;
  const started = Date.now();
  await Promise.all(
    missing.map(async (simulation) => {
      simulationCache.set(cacheKeyOf(simulation), await pool.run(simulation));
      done++;
      if (done % 10 === 0 || done === missing.length) {
        console.error(`  ${done} of ${missing.length} simulations done (${((Date.now() - started) / 60000).toFixed(1)} min)`);
      }
    }),
  );
}
/** The rows of a simulation that has been prefetched. */
function rowsOfSimulation(simulation: Simulation): SeasonSimulationScore[] {
  const rows = simulationCache.get(cacheKeyOf(simulation));
  if (!rows) throw new Error(`Simulation ${cacheKeyOf(simulation)} was not prefetched`);
  return rows;
}
const learnedSimulation = (rung: Rung, setting: Setting, train: readonly number[], season: number, tau: number, runs: number): Simulation => ({
  key: ["learned", rung.name, settingLabel(setting, rung), train.join(), tau].join("|"),
  spec: { kind: "learned", weights: weightsOf(rung, setting, train, season, tau) },
  season,
  runs,
});
const eloSimulation = (season: number, runs: number): Simulation => ({ key: "elo", spec: eloSpec(season), season, runs });
const eloRows = (season: number, runs: number) => rowsOfSimulation(eloSimulation(season, runs));

interface TauTuning {
  tau: number;
  /** Pooled Rank RPS over the inner Seasons, by τ on the grid. */
  profile: Map<number, number>;
  innerSeasons: number[];
}

/** τ by the inner walk-forward over the training Seasons; undefined when there is no Season after the first to project. */
async function tuneTau(rung: Rung, setting: Setting, train: readonly number[]): Promise<TauTuning | undefined> {
  const innerSeasons = train.slice(1);
  if (innerSeasons.length === 0) return undefined;
  const simulationsAt = (index: number) =>
    innerSeasons.map((season) => learnedSimulation(rung, setting, train.filter((s) => s < season), season, tauAt(index), tuneRuns));
  const profile = new Map<number, number>();
  /** Scores the grid values up to `index` not yet scored, all their simulations at once. */
  const scoreUpTo = async (index: number) => {
    const indexes = Array.from({ length: index + 1 }, (_, i) => i).filter((i) => !profile.has(tauAt(i)));
    await prefetch(indexes.flatMap(simulationsAt));
    for (const i of indexes) {
      profile.set(tauAt(i), mean(simulationsAt(i).flatMap((simulation) => rowsOfSimulation(simulation)).map((row) => row.rankRps)));
    }
  };
  let triedUpTo = Math.round(TAU_GRID_END / TAU_STEP);
  await scoreUpTo(triedUpTo);
  const bestOf = () => {
    let best = 0;
    for (let index = 0; index <= triedUpTo; index++) if (profile.get(tauAt(index))! < profile.get(tauAt(best))!) best = index;
    return best;
  };
  let best = bestOf();
  // Extend while the optimum is on the edge of what has been tried.
  while (best === triedUpTo) {
    if (tauAt(triedUpTo) >= TAU_GRID_LIMIT) throw new Error(`Rank RPS is still falling at τ ${TAU_GRID_LIMIT}: the grid cannot be extended further`);
    triedUpTo++;
    await scoreUpTo(triedUpTo);
    best = bestOf();
  }
  return { tau: tauAt(best), profile, innerSeasons };
}

// ---------------------------------------------------------------------------------------------------------------------
// A variant: which Seasons each fold trains on. The main run and both sensitivity runs go through the same code.
// ---------------------------------------------------------------------------------------------------------------------

interface Variant {
  label: string;
  trainFor: (test: number) => number[];
}
const MAIN: Variant = { label: "Main run", trainFor: (test) => seasonsFrom(FIRST_TRAINING_SEASON, test - 1) };
const SENSITIVITY: Variant[] = [
  {
    label: "Sensitivity A: 2017/18–2019/20 added as training rows (2020/21 left out)",
    trainFor: (test) => [...seasonsFrom(WARM_UP_FIRST_SEASON, 2019), ...seasonsFrom(FIRST_TRAINING_SEASON, test - 1)],
  },
  { label: "Sensitivity B: 2021/22 rows dropped", trainFor: (test) => seasonsFrom(FIRST_TRAINING_SEASON + 1, test - 1) },
];

interface VariantFold {
  test: number;
  train: number[];
  setting: Setting;
  tau: number;
  /** Why τ is what it is when it was not tuned on this fold's own training Seasons. */
  tauNote?: string;
  tuning?: TauTuning;
  weights: LearnedWeights;
  /** The Learned Model's per-Game predictions on the test Season. */
  predicted: OutcomeVector[];
  rows: SeasonSimulationScore[];
}

const mainFolds = new Map<number, VariantFold>();
async function runVariant(variant: Variant): Promise<VariantFold[]> {
  return Promise.all(
    TEST_SEASONS.map(async (test) => {
      const train = variant.trainFor(test);
      // The sensitivity runs keep the main run's hyperparameters (they are not retuned on the changed training Seasons).
      const setting = foldRungs.get(`${test}|${learnedRung.name}`)!.tuned.setting;
      const tuning = await tuneTau(learnedRung, setting, train);
      const fallback = variant === MAIN ? undefined : mainFolds.get(test)!.tau;
      const tau = tuning?.tau ?? fallback ?? 0;
      const tauNote = tuning ? undefined : `no Season after the first to tune on; kept the main run's τ ${tau}, which was tuned with the dropped Season, so this fold only partly tests it`;
      const fit = fitFor(learnedRung, setting, train);
      const simulation = learnedSimulation(learnedRung, setting, train, test, tau, simulationRuns);
      await prefetch([simulation, eloSimulation(test, simulationRuns)]);
      const fold: VariantFold = {
        test,
        train,
        setting,
        tau,
        tauNote,
        tuning,
        weights: weightsOf(learnedRung, setting, train, test, tau),
        predicted: predictWith(learnedRung, setting, fit, test),
        rows: rowsOfSimulation(simulation),
      };
      if (variant === MAIN) mainFolds.set(test, fold);
      console.error(`${variant.label}, ${seasonLabel(test)}: τ ${tau}`);
      return fold;
    }),
  );
}

interface Verdict {
  brierPooled: number;
  brierSeasons: number[];
  rpsPooled: number;
  rpsSeasons: number[];
  earlyOuterTenths: number;
  brierPasses: boolean;
  rpsPasses: boolean;
  guardPasses: boolean;
  passes: boolean;
}

/** The Default rule's conditions against the Elo Model, for the folds of a variant. */
function defaultVerdict(folds: readonly VariantFold[]): Verdict {
  const brierDiffs = folds.map(({ test, predicted }) =>
    rowsBySeason.get(test)!.map((row, i) => brierOf(predicted[i]!, row.outcome) - brierOf(row.elo, row.outcome)),
  );
  const rpsDiffs = folds.map(({ test, rows }) => rows.map((row, i) => row.rankRps - eloRows(test, simulationRuns)[i]!.rankRps));
  const early = folds.flatMap(({ rows }) => rows.filter((row) => phaseOf(row.gamesPlayed) === 0));
  const brierSeasons = folds.filter((_, f) => mean(brierDiffs[f]!) < 0).map((fold) => fold.test);
  const rpsSeasons = folds.filter((_, f) => mean(rpsDiffs[f]!) < 0).map((fold) => fold.test);
  const brierPooled = mean(brierDiffs.flat());
  const rpsPooled = mean(rpsDiffs.flat());
  const earlyOuterTenths = mean(early.map((row) => Number(row.outerTenths)));
  const brierPasses = brierPooled < 0 && brierSeasons.length >= 2;
  const rpsPasses = rpsPooled < 0 && rpsSeasons.length >= 2;
  const guardPasses = earlyOuterTenths <= EARLY_OUTER_TENTHS_LIMIT;
  return {
    brierPooled,
    brierSeasons,
    rpsPooled,
    rpsSeasons,
    earlyOuterTenths,
    brierPasses,
    rpsPasses,
    guardPasses,
    passes: brierPasses && rpsPasses && guardPasses,
  };
}

const mainRun = await runVariant(MAIN);
const mainVerdict = defaultVerdict(mainRun);
const passFail = (ok: boolean) => (ok ? "PASS" : "FAIL");
const percentText = (x: number) => `${(100 * x).toFixed(1)}%`;

out();
out("=".repeat(110));
out(`Season Simulation half: the Learned Model is ${learnedRung.name}`);
out("=".repeat(110));
out(`Season Simulation Back-Test at ${simulationRuns} runs per forecast point (τ tuning: ${tuneRuns}), forecasting at every Projection History point of each test Season.`);
out(`Elo Model: production values with the chain's Starting Ratings and Rating Uncertainty σ = ${ELO_RATING_UNCERTAINTY}. Points MAE: the gap between a team's projected and actual final Points.`);
out(`The early Season is the first band of Games played (${PHASES[0]}). Rank metrics are bootstrapped over Season × team clusters.`);
out();

out("Strength Uncertainty τ tuned on each fold's training Seasons only (inner walk-forward, pooled Rank RPS)");
for (const fold of mainRun) {
  if (LEARNED_FEATURE_NAMES[0] !== "ratingDifference") throw new Error("σ = τ / β_R needs the Rating difference to be the first feature");
  const beta = fold.weights.coefficients[0]!;
  const trained = `${seasonLabel(FIRST_TRAINING_SEASON)}–${seasonLabel(fold.test - 1)}`;
  const inner = fold.tuning!.innerSeasons.map(seasonLabel).join(", ");
  const profile = fold.tuning!.profile;
  out(
    `  ${seasonLabel(fold.test)} (trained on ${trained}; inner Seasons ${inner}): τ ${fold.tau} = Elo-equivalent σ ${(fold.tau / beta).toFixed(1)} ` +
      `(β_R ${beta.toExponential(3)} per Rating point); pooled Rank RPS ${profile.get(fold.tau)!.toFixed(5)} at τ, ${profile.get(0)!.toFixed(5)} at τ 0` +
      `${fold.tau >= Math.max(...profile.keys()) ? "; optimum on the grid's edge" : ""}`,
  );
}
out();

const eloAll = mainRun.flatMap(({ test }) => eloRows(test, simulationRuns).map((row) => ({ ...row, season: test })));
const learnedAll = mainRun.flatMap(({ test, rows }) => rows.map((row) => ({ ...row, season: test })));
if (eloAll.length !== learnedAll.length || eloAll.some((row, i) => row.teamId !== learnedAll[i]!.teamId || row.matchDay !== learnedAll[i]!.matchDay)) {
  throw new Error("The Elo and Learned Season Simulation rows do not line up");
}

const SIMULATION_METRICS = [
  { name: "Rank RPS", value: (row: SeasonSimulationScore) => row.rankRps, show: (x: number) => x.toFixed(5) },
  { name: "Points MAE", value: (row: SeasonSimulationScore) => row.pointsError, show: (x: number) => x.toFixed(4) },
  { name: "Cut Line Brier", value: (row: SeasonSimulationScore) => row.cutLineBrier, show: (x: number) => x.toFixed(5) },
  { name: "Outer Tenths", value: (row: SeasonSimulationScore) => Number(row.outerTenths), show: percentText },
] as const;
type Tagged = SeasonSimulationScore & { season: number };
const inSeason = (rows: readonly Tagged[], season?: number) => rows.filter((row) => season === undefined || row.season === season);

out("Season Simulation scores against the Elo Model, per Season and pooled (lower is better; Outer Tenths about 20% when calibrated)");
out(`    ${"".padEnd(24)}${[...TEST_SEASONS.map(seasonLabel), "pooled"].map((h) => h.padStart(10)).join("")}`);
for (const metric of SIMULATION_METRICS) {
  for (const [name, rows] of [["Elo Model", eloAll], ["Learned Model", learnedAll]] as const) {
    const cells = [...TEST_SEASONS, undefined].map((s) => metric.show(mean(inSeason(rows, s).map(metric.value))).padStart(10));
    out(`    ${`${metric.name}, ${name}`.padEnd(24)}${cells.join("")}`);
  }
}
out(`    Forecasts: ${[...TEST_SEASONS.map((s) => inSeason(eloAll, s).length), eloAll.length].join(", ")}`);
out();

out("Learned Model − Elo Model, with the Season × team cluster bootstrap (negative favours the Learned Model)");
for (const metric of SIMULATION_METRICS) {
  for (const season of [undefined, ...TEST_SEASONS]) {
    const [elo, learned] = [inSeason(eloAll, season), inSeason(learnedAll, season)];
    const d = clusterBootstrap(
      learned.map((row, i) => metric.value(row) - metric.value(elo[i]!)),
      learned.map((row) => `${row.season}|${row.teamId}`),
      { resamples, seed },
    );
    const text = metric.name === "Outer Tenths" ? (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(2)} pts` : fmt;
    out(`    ${metric.name.padEnd(15)}${(season === undefined ? "pooled" : seasonLabel(season)).padEnd(9)}${text(d.mean)}  95% [${text(d.low)}, ${text(d.high)}]`);
  }
}
out();

out("Outer Tenths by Games-played band, pooled (share of team forecasts whose final rank fell in the outer tenths)");
out(`    ${"".padEnd(16)}${[...PHASES, "all"].map((h) => h.padStart(9)).join("")}`);
for (const [name, rows] of [["Elo Model", eloAll], ["Learned Model", learnedAll]] as const) {
  const cells = [...PHASES.map((_, band) => rows.filter((row) => phaseOf(row.gamesPlayed) === band)), rows].map((r) =>
    percentText(mean(r.map((row) => Number(row.outerTenths)))).padStart(9),
  );
  out(`    ${name.padEnd(16)}${cells.join("")}`);
}
out();

// Across the τ grid: each fold's weights at every τ, pooled over the test Seasons.
const gridEnd = Math.max(TAU_GRID_END, ...mainRun.map((fold) => fold.tau));
out("Across the τ grid (each fold's weights, pooled over the test Seasons; the Elo Model's scores for reference)");
out(`    ${["τ", "Rank RPS", "Points MAE", "Cut Brier", "Outer all", ...PHASES.map((p) => `Outer ${p}`)].map((h, i) => (i === 0 ? h.padEnd(8) : h.padStart(13))).join("")}`);
const gridLine = (label: string, rows: readonly SeasonSimulationScore[]) =>
  out(
    `    ${label.padEnd(8)}${[
      ...SIMULATION_METRICS.map((metric) => metric.show(mean(rows.map(metric.value)))),
      ...PHASES.map((_, band) => percentText(mean(rows.filter((row) => phaseOf(row.gamesPlayed) === band).map((row) => Number(row.outerTenths))))),
    ]
      .map((c) => c.padStart(13))
      .join("")}`,
  );
gridLine("Elo", eloAll);
const gridSimulations = (tau: number) => mainRun.map(({ test, train, setting }) => learnedSimulation(learnedRung, setting, train, test, tau, simulationRuns));
const gridTaus = Array.from({ length: Math.round(gridEnd / TAU_STEP) + 1 }, (_, index) => tauAt(index));
await prefetch(gridTaus.flatMap(gridSimulations));
for (const tau of gridTaus) gridLine(tau.toFixed(3), gridSimulations(tau).flatMap((simulation) => rowsOfSimulation(simulation)));
out(`    Tuned τ: ${mainRun.map((fold) => `${seasonLabel(fold.test)} ${fold.tau}`).join(", ")}`);
out();

// ---------------------------------------------------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------------------------------------------------

const seasonList = (seasons: readonly number[]) => (seasons.length ? ` (${seasons.map(seasonLabel).join(", ")})` : "");
function printDefaultVerdict(verdict: Verdict, indent = "  ") {
  const need = `${TEST_SEASONS.length} test Seasons`;
  out(`${indent}${passFail(verdict.brierPasses)}  pooled per-Game Brier better than Elo: ${fmt(verdict.brierPooled)} (needs < 0); better in ${verdict.brierSeasons.length} of ${need}${seasonList(verdict.brierSeasons)} (needs ≥ 2)`);
  out(`${indent}${passFail(verdict.rpsPasses)}  pooled Rank RPS better than Elo: ${fmt(verdict.rpsPooled)} (needs < 0); better in ${verdict.rpsSeasons.length} of ${need}${seasonList(verdict.rpsSeasons)} (needs ≥ 2)`);
  out(`${indent}${passFail(verdict.guardPasses)}  early-Season (${PHASES[0]} Games) Outer Tenths at the tuned τ: ${percentText(verdict.earlyOuterTenths)} (needs ≤ ${percentText(EARLY_OUTER_TENTHS_LIMIT)})`);
  out(`${indent}→ ${verdict.passes ? "Default rule PASSES" : "Default rule FAILS: no Default" + (verdict.guardPasses ? "" : " (a failed guard is never retuned)")}`);
}

out("=".repeat(110));
out(`Verdicts for ${learnedRung.name}`);
out("=".repeat(110));

// Picker verdict: the inference caps.
const liveSnapshot = JSON.parse(await readFile("data/games.json", "utf8")) as Snapshot;
const liveWeights: LearnedWeights = {
  ...mainRun[mainRun.length - 1]!.weights,
  season: STARTING_RATINGS.season,
  startingRatings: STARTING_RATINGS.ratings.map(({ teamId, rating }) => ({ teamId, rating })),
};
const liveModel = modelOf({ kind: "learned", weights: liveWeights });
/** Seconds one Projection History build takes, best of three. */
function buildSeconds(games: Snapshot["games"], model: Parameters<typeof projectionHistory>[1]): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now();
    projectionHistory(games, model);
    best = Math.min(best, (performance.now() - started) / 1000);
  }
  return best;
}
const BUILD_CAP_SECONDS = 3;
const WEIGHTS_CAP_BYTES = 50 * 1024;
const liveInput = projectionModelInput(liveSnapshot.games, new Date());
const predictedLive = liveModel.predictOutcomes(liveInput);
const learnedSeconds = buildSeconds(liveSnapshot.games, liveModel);
const eloSeconds = buildSeconds(liveSnapshot.games, eloModel);
const weightsBytes = Buffer.byteLength(JSON.stringify(liveWeights, null, 2));
const onePrediction = liveInput.remainingGames.length > 0 && predictedLive.size === liveInput.remainingGames.length;
const pickerPasses = learnedSeconds <= BUILD_CAP_SECONDS && weightsBytes <= WEIGHTS_CAP_BYTES && onePrediction;
out("Picker verdict (depends only on the inference caps, not on the score against Elo)");
out(`  ${passFail(learnedSeconds <= BUILD_CAP_SECONDS)}  Projection History build: ${learnedSeconds.toFixed(2)} s for the Learned Model on data/games.json (${liveSnapshot.games.filter((g) => g.result).length} Played Games; the Elo Model takes ${eloSeconds.toFixed(2)} s); cap ~${BUILD_CAP_SECONDS} s (read as the Learned Model's own build; read as extra time over the Elo Model it is ${(learnedSeconds - eloSeconds).toFixed(2)} s)`);
out(`  ${passFail(weightsBytes <= WEIGHTS_CAP_BYTES)}  weights file: ${(weightsBytes / 1024).toFixed(1)} KB as committed JSON; cap ~${WEIGHTS_CAP_BYTES / 1024} KB`);
out(`  ${passFail(onePrediction)}  one prediction per Remaining Game: ${predictedLive.size} predictions for ${liveInput.remainingGames.length} Remaining Games`);
out(`  → ${pickerPasses ? "the Learned Model joins the picker" : "the Learned Model does not join the picker"}`);
out();

out(`Default verdict (ADR 0004's rule against the Elo Model, at the τ tuned on training Seasons)`);
printDefaultVerdict(mainVerdict);
out();

// Sensitivity runs.
out("Sensitivity runs (report only; same rung and hyperparameters, weights refitted)");
let flips = false;
for (const variant of SENSITIVITY) {
  const folds = await runVariant(variant);
  const verdict = defaultVerdict(folds);
  const flipped = verdict.passes !== mainVerdict.passes;
  flips ||= flipped;
  out(`  ${variant.label}`);
  for (const fold of folds) {
    out(`    ${seasonLabel(fold.test)}: trained on ${fold.train.map(seasonLabel).join(", ")}; τ ${fold.tau}${fold.tauNote ? ` (${fold.tauNote})` : ""}`);
  }
  printDefaultVerdict(verdict, "    ");
  out(`    Flips the conclusion? ${flipped ? `YES: the main run's Default rule ${mainVerdict.passes ? "passes" : "fails"}, this one ${verdict.passes ? "passes" : "fails"}` : `no: the Default rule ${verdict.passes ? "passes" : "fails"} here too`}.`);
}
out();
out(
  flips
    ? "A sensitivity run flips the conclusion: the Default decision is handed to the human."
    : `Neither sensitivity run flips the conclusion: the Default rule ${mainVerdict.passes ? "passes" : "fails"} in all three.`,
);

await pool.close();
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nWrote ${values.out}`);

/**
 * Starting Rating study: does the Elo Model predict a Season better when each team starts from its Rating at the end of
 * the previous Season, pulled part of the way back toward the league average, than when every team starts level? Writes
 * a text report under data/local/ so study results never end up in the repo.
 *
 *   npm run study:starting-rating
 *   npm run study:starting-rating -- --dir d --seasons 2022,2023,2024,2025 --tests 2023,2024,2025 --runs 500 --tune-runs 200
 *
 * The default Seasons are those with all 14 of today's teams: 2021/22 had 13 (no Kloten), so it is left out.
 *
 * Ratings run continuously through every Season in --seasons, oldest first; at each Season boundary every team keeps the
 * carry-over share r of its distance from 1500 (startingRatingsFrom). The first Season starts level and is never scored.
 *
 * Walk-forward: each test Season is predicted with K, Home Advantage and r tuned on the Seasons before it only, by the mean
 * per-Game Brier over those of them that have a Season before them (so they are scored with a real carry-over). A test
 * Season right after the first has no such Season: it tunes K and Home Advantage on the first Season, which starts level,
 * and cannot tune r, so its carry-over is fixed at r = 1 (full carry-over), which leaks nothing. Three variants are tuned
 * per fold on the same grid:
 *   - Level: r = 0, every team starts at 1500 (today's Elo Model, but with K and Home Advantage re-tuned without leakage)
 *   - Carry-over: r tuned
 *
 * Calibration: the Season Simulation plays every run from the same Ratings, as if they were exact, which made the
 * carry-over's early Rank Distributions overconfident. Each variant is therefore also scored with Rating uncertainty σ:
 * every run moves each team's Rating by its own draw from N(0, σ). σ is tuned per fold and variant by pooled Rank RPS on
 * the same training Seasons, at the K, Home Advantage and r already chosen (Level + σ, Carry-over + σ).
 *
 * Each test Season is then scored with the per-Game Back-Test and the Season Simulation Back-Test, and the carry-over is
 * compared with the level start on team-seasons as the shrinkage study compares models (#41).
 *
 * Decision rule agreed before running, applied to the calibrated variants: ship Carry-over + σ if it beats Level + σ on
 * both pooled per-Game Brier and pooled Rank RPS, and on both in at least 2 of the 3 test Seasons. The bootstrap is
 * reported, not required.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { backTest, gameBriers } from "../src/domain/backTest.ts";
import { createEloModel, expectedHomeScore, INITIAL_RATING, startingRatingsFrom } from "../src/domain/eloModel.ts";
import type { PlayedGame } from "../src/domain/form.ts";
import { otsoRate, outcomesFromExpectedPoints, type OutcomeProbabilities } from "../src/domain/outcomes.ts";
import { pointsFor } from "../src/domain/form.ts";
import { projectionModelInput } from "../src/domain/project.ts";
import { seasonLabel } from "../src/domain/season.ts";
import { seasonSimulationBackTest, type OutcomesProjectionModel, type SeasonSimulationScore } from "../src/domain/seasonBackTest.ts";
import type { Game, Snapshot, TeamId } from "../src/domain/types.ts";
import { pairedUncertainty } from "./studyStats.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    seasons: { type: "string", default: "2022,2023,2024,2025" },
    tests: { type: "string", default: "2023,2024,2025" },
    runs: { type: "string", default: "2000" },
    "tune-runs": { type: "string", default: "1000" },
    resamples: { type: "string", default: "10000" },
    out: { type: "string", default: "data/local/starting-rating-study/starting-rating.txt" },
  },
});

const seasons = values.seasons.split(",").map(Number).sort((a, b) => a - b);
const tests = values.tests.split(",").map(Number).sort((a, b) => a - b);
const runs = Number(values.runs);
const tuneRuns = Number(values["tune-runs"]);
const resamples = Number(values.resamples);
for (const test of tests) {
  if (seasons.indexOf(test) < 1) throw new Error(`Test Season ${test} needs an earlier Season in --seasons to tune on`);
}

const snapshots = new Map<number, Snapshot>();
for (const season of seasons) {
  snapshots.set(season, JSON.parse(await readFile(join(values.dir, `season-${season}.json`), "utf8")) as Snapshot);
}

/** Down to 1: carry-over Ratings need a far smaller K than a level start, which chose the old grid's floor of 5. */
const GRID_K = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40];
const GRID_HOME_ADVANTAGE = Array.from({ length: 16 }, (_, i) => 10 * i);
const GRID_CARRY_OVER = Array.from({ length: 11 }, (_, i) => i / 10);
/** Rating uncertainty of the Season Simulation, in Rating points. */
const GRID_SIGMA = Array.from({ length: 11 }, (_, i) => 10 * i);
const PHASES = ["1–13", "14–26", "27–39", "40–52"];

interface Parameters {
  k: number;
  homeAdvantage: number;
  carryOver: number;
}
const parametersLabel = ({ k, homeAdvantage, carryOver }: Parameters) => `K ${k}, HA ${homeAdvantage}, r ${carryOver.toFixed(1)}`;

/** Each Season's Played Games in the order the Back-Test sees them: oldest first, as the snapshot lists them within a start time. */
const playedGamesOf = (snapshot: Snapshot): PlayedGame[] => projectionModelInput(snapshot.games, new Date(snapshot.snapshotAt)).playedGames;
const playedBySeason = new Map(seasons.map((season) => [season, playedGamesOf(snapshots.get(season)!)]));
const teamIdsOf = (season: number) => snapshots.get(season)!.teams.map((team) => team.id);

function brier(predicted: OutcomeProbabilities, game: PlayedGame): number {
  const homeWon = game.result.homeGoals > game.result.awayGoals;
  const regulation = game.result.decision === "regulation";
  return (
    (predicted.regulationWin - Number(homeWon && regulation)) ** 2 +
    (predicted.overtimeOrShootoutWin - Number(homeWon && !regulation)) ** 2 +
    (predicted.overtimeOrShootoutLoss - Number(!homeWon && !regulation)) ** 2 +
    (predicted.regulationLoss - Number(!homeWon && regulation)) ** 2
  );
}

/** One Season of the Elo chain: the Starting Ratings it began from, where it ended, and its mean per-Game Brier. */
interface ChainSeason {
  starting: Map<TeamId, number>;
  end: Map<TeamId, number>;
  brier: number;
}

/**
 * The Elo Model run through every Season with carry-over at each boundary, scoring each Played Game as the Back-Test
 * does: predicted from the Ratings and OT/SO Rate before its start time, Games starting together sharing them.
 */
function chain({ k, homeAdvantage, carryOver }: Parameters): Map<number, ChainSeason> {
  const result = new Map<number, ChainSeason>();
  let previous: Map<TeamId, number> | undefined;
  for (const season of seasons) {
    const starting = previous
      ? startingRatingsFrom(previous, teamIdsOf(season), carryOver)
      : new Map(teamIdsOf(season).map((teamId) => [teamId, INITIAL_RATING]));
    const ratings = new Map(starting);
    const played = playedBySeason.get(season)!;
    let brierSum = 0;
    for (let start = 0; start < played.length; ) {
      let end = start;
      while (end < played.length && played[end]!.startsAt === played[start]!.startsAt) end++;
      const group = played.slice(start, end);
      const rate = otsoRate(played.slice(0, start));
      for (const game of group) {
        const expected = expectedHomeScore(ratings.get(game.homeTeamId)!, ratings.get(game.awayTeamId)!, homeAdvantage);
        brierSum += brier(outcomesFromExpectedPoints(3 * expected, rate), game);
      }
      for (const game of group) {
        const home = ratings.get(game.homeTeamId)!;
        const away = ratings.get(game.awayTeamId)!;
        const change = k * (pointsFor(game, game.homeTeamId) / 3 - expectedHomeScore(home, away, homeAdvantage));
        ratings.set(game.homeTeamId, home + change);
        ratings.set(game.awayTeamId, away - change);
      }
      start = end;
    }
    result.set(season, { starting, end: ratings, brier: brierSum / played.length });
    previous = ratings;
  }
  return result;
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? NaN : xs.reduce((sum, x) => sum + x, 0) / xs.length);

const started = Date.now();

// The whole grid, once: a Season's Brier depends only on the Seasons up to it, so every fold reads its training and test
// scores from the same chains.
const grid: { parameters: Parameters; chain: Map<number, ChainSeason> }[] = [];
for (const k of GRID_K) {
  for (const homeAdvantage of GRID_HOME_ADVANTAGE) {
    for (const carryOver of GRID_CARRY_OVER) {
      const parameters = { k, homeAdvantage, carryOver };
      grid.push({ parameters, chain: chain(parameters) });
    }
  }
}
console.error(`Grid of ${grid.length} parameter sets scored in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const carriedOverBefore = (test: number) => seasons.filter((season) => season > seasons[0]! && season < test);

/** A test Season with no carried-over Season before it cannot tune r: its carry-over is fixed at full. */
const fixedCarryOver = (test: number) => carriedOverBefore(test).length === 0;

/**
 * The Seasons a fold tunes on: those before the test Season that started from a carry-over, or else the first Season,
 * which starts level whatever r is, so it tunes only K and Home Advantage.
 */
const trainingOf = (test: number) => (fixedCarryOver(test) ? [seasons[0]!] : carriedOverBefore(test));

const trainingBrier = (entry: (typeof grid)[number], test: number) => mean(trainingOf(test).map((season) => entry.chain.get(season)!.brier));

/** The grid entry with the lowest training Brier among those `filter` allows; the first in grid order on a tie. */
function tuned(test: number, filter: (parameters: Parameters) => boolean) {
  let best: (typeof grid)[number] | undefined;
  let bestScore = Infinity;
  for (const entry of grid) {
    if (!filter(entry.parameters)) continue;
    const score = trainingBrier(entry, test);
    if (score < bestScore) [best, bestScore] = [entry, score];
  }
  return best!;
}

const TUNED = [
  ["Level", (p: Parameters) => p.carryOver === 0],
  ["Carry-over", () => true],
] as const;
type TunedName = (typeof TUNED)[number][0];
const VARIANTS = ["Level", "Carry-over", "Level + σ", "Carry-over + σ"] as const;
type VariantName = (typeof VARIANTS)[number];
const calibrated = (name: TunedName): VariantName => `${name} + σ`;

/** A variant's chosen parameters and test scores in one fold. */
interface FoldScore {
  parameters: Parameters;
  trainingBrier: number;
  /** Rating uncertainty of the Season Simulation; 0 for the uncalibrated variants. */
  sigma: number;
  /** Pooled Rank RPS over the training Seasons at `sigma`; NaN for the uncalibrated variants. */
  trainingRps: number;
  starting: Map<TeamId, number>;
  brier: number;
  teamBrier: Map<TeamId, number>;
  rows: SeasonSimulationScore[];
}

/** Each team's mean Brier score over the Games it played: a Game counts for both its teams. */
function teamMeans(games: Game[], briers: ReadonlyMap<string, number>): Map<TeamId, number> {
  const byTeam = new Map<TeamId, number[]>();
  for (const game of games) {
    const value = briers.get(game.id);
    if (value === undefined) continue;
    for (const teamId of [game.homeTeamId, game.awayTeamId]) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), value]);
  }
  return new Map([...byTeam].map(([teamId, values]) => [teamId, mean(values)]));
}

// The fast chain must score a level start exactly as the Back-Test scores the Elo Model.
const levelEloModel = createEloModel({ k: 15, homeAdvantage: 70 });
for (const season of seasons) {
  const { games, snapshotAt } = snapshots.get(season)!;
  const expected = backTest(games, new Date(snapshotAt), [levelEloModel])[0]!.brierScore!;
  const levelChain = chain({ k: 15, homeAdvantage: 70, carryOver: 0 }).get(season)!.brier;
  if (Math.abs(expected - levelChain) > 1e-12) throw new Error(`Chain scores ${levelChain} in ${season}, the Back-Test ${expected}`);
}

/** Each Season's final ranks, which the Season Simulation Back-Test scores against. */
const finalRanksOf = (season: number) =>
  new Map(projectionModelInput(snapshots.get(season)!.games, new Date(8.64e15)).currentTable.map((row) => [row.teamId, row.rank]));

/** The Season Simulation Back-Test of the Elo Model as shipped (createEloModel), with Rating Uncertainty σ. */
function calibratedRows(season: number, parameters: Parameters, starting: ReadonlyMap<TeamId, number>, sigma: number, runs: number): SeasonSimulationScore[] {
  const model = createEloModel({ ...parameters, startingRatings: starting, ratingUncertainty: sigma }) as OutcomesProjectionModel;
  return seasonSimulationBackTest(snapshots.get(season)!.games, [model], runs)[0]!.rows;
}

/** Pooled Rank RPS of rows: every team forecast counts the same. */
const rpsOf = (rows: readonly SeasonSimulationScore[]) => mean(rows.map((row) => row.rankRps));

interface SigmaProfile {
  sigma: number;
  trainingRps: number;
  /** Hindsight, never used to choose. */
  test: SeasonSimulationScore[];
}

const folds = new Map<number, Map<VariantName, FoldScore>>();
/** Per fold and tuned variant, the training and (hindsight) test Rank RPS at every σ of the grid. */
const sigmaProfiles = new Map<number, Map<TunedName, SigmaProfile[]>>();
for (const test of tests) {
  const { games, snapshotAt } = snapshots.get(test)!;
  const chosen = TUNED.map(
    ([name, filter]) => [name, tuned(test, name === "Carry-over" && fixedCarryOver(test) ? (p) => p.carryOver === 1 : filter)] as const,
  );
  const models = chosen.map(([name, { parameters, chain }]) => ({
    ...(createEloModel({ ...parameters, startingRatings: chain.get(test)!.starting }) as OutcomesProjectionModel),
    name,
  }));
  const briers = gameBriers(games, new Date(snapshotAt), models);
  const simulations = seasonSimulationBackTest(games, models, runs);
  const fold = new Map<VariantName, FoldScore>();
  const profiles = new Map<TunedName, SigmaProfile[]>();
  chosen.forEach(([name, entry], i) => {
    const fastBrier = entry.chain.get(test)!.brier;
    const pipelineBrier = mean([...briers[i]!.values()]);
    if (Math.abs(fastBrier - pipelineBrier) > 1e-12) throw new Error(`${name} in ${test}: chain ${fastBrier}, Back-Test ${pipelineBrier}`);
    const starting = entry.chain.get(test)!.starting;
    const pipelineRows = simulations[i]!.rows;

    const profile = GRID_SIGMA.map((sigma): SigmaProfile => ({
      sigma,
      trainingRps: rpsOf(
        trainingOf(test).flatMap((season) => calibratedRows(season, entry.parameters, entry.chain.get(season)!.starting, sigma, tuneRuns)),
      ),
      test: calibratedRows(test, entry.parameters, starting, sigma, tuneRuns),
    }));
    profiles.set(name, profile);
    const best = profile.reduce((a, b) => (b.trainingRps < a.trainingRps ? b : a));

    const common = { parameters: entry.parameters, trainingBrier: trainingBrier(entry, test), starting, brier: pipelineBrier, teamBrier: teamMeans(games, briers[i]!) };
    fold.set(name, { ...common, sigma: 0, trainingRps: NaN, rows: pipelineRows });
    fold.set(calibrated(name), {
      ...common,
      sigma: best.sigma,
      trainingRps: best.trainingRps,
      rows: best.sigma === 0 ? pipelineRows : calibratedRows(test, entry.parameters, starting, best.sigma, runs),
    });
  });
  folds.set(test, fold);
  sigmaProfiles.set(test, profiles);
  console.error(`${seasonLabel(test)}: tuned, calibrated and simulated (${((Date.now() - started) / 1000).toFixed(0)}s)`);
}

const lines: string[] = [];
const print = (line = "") => lines.push(line);
const heading = (title: string) => {
  print("=".repeat(100));
  print(title);
  print("=".repeat(100));
};
const cell = (text: string | number, width: number) => String(text).padStart(width);
const fixed = (x: number, digits = 4) => (Number.isNaN(x) ? "—" : x.toFixed(digits));
const signed = (x: number, digits = 4) => (x >= 0 ? "+" : "") + fixed(x, digits);
const percent = (x: number) => (Number.isNaN(x) ? "—" : `${(100 * x).toFixed(1)}%`);

function table(rowHeader: string, headers: readonly string[], rows: readonly (readonly [string, ...string[]])[], minLabelWidth = 20, width = 10) {
  const labelWidth = Math.max(minLabelWidth, rowHeader.length + 2, ...rows.map(([label]) => label.length + 2));
  print(rowHeader.padEnd(labelWidth) + headers.map((h) => cell(h, width)).join(""));
  for (const [label, ...cells] of rows) print(label.padEnd(labelWidth) + cells.map((c) => cell(c, width)).join(""));
}

const testHeaders = tests.map(seasonLabel);
const phaseOf = (gamesPlayed: number) => Math.min(PHASES.length - 1, Math.max(0, Math.ceil(gamesPlayed / 13) - 1));

type Metric = "brier" | "rps" | "cut" | "outer";
const rowMetric = (row: SeasonSimulationScore, metric: Exclude<Metric, "brier">) =>
  metric === "rps" ? row.rankRps : metric === "cut" ? row.cutLineBrier : Number(row.outerTenths);
function rowsMetric(rows: readonly SeasonSimulationScore[], metric: Exclude<Metric, "brier">, phase?: number): number {
  return mean(rows.filter((row) => phase === undefined || phaseOf(row.gamesPlayed) === phase).map((row) => rowMetric(row, metric)));
}
function metricOf(score: FoldScore, metric: Metric, phase?: number): number {
  return metric === "brier" ? score.brier : rowsMetric(score.rows, metric, phase);
}
/** Every test Season weighs the same for per-Game Brier (each has as many Games); every team forecast the same otherwise. */
function pooledOf(name: VariantName, metric: Metric, phase?: number): number {
  if (metric === "brier") return mean(tests.map((test) => folds.get(test)!.get(name)!.brier));
  return rowsMetric(tests.flatMap((test) => folds.get(test)!.get(name)!.rows), metric, phase);
}

print(`Starting Rating study: the Elo Model with Starting Ratings carried over from the previous Season, against a level start,`);
print(`each with and without Rating uncertainty σ in the Season Simulation.`);
print(`Ratings chained through ${seasons.map(seasonLabel).join(", ")}; test Seasons ${testHeaders.join(", ")}, each tuned on the Seasons before it only.`);
print(`Grid: K ${GRID_K.join(", ")}; Home Advantage ${GRID_HOME_ADVANTAGE[0]}–${GRID_HOME_ADVANTAGE.at(-1)} by 10; r ${GRID_CARRY_OVER[0]}–${GRID_CARRY_OVER.at(-1)} by 0.1, tuned by mean per-Game Brier;`);
print(`then σ ${GRID_SIGMA[0]}–${GRID_SIGMA.at(-1)} by 10 Rating points, tuned by pooled Rank RPS at those K, Home Advantage and r (${tuneRuns} runs per forecast point).`);
print(`${runs} simulation runs per forecast point for the test scores; snapshots from ${values.dir}.`);
print(`Check: the chain's per-Game Brier equals the Back-Test's, for a level Elo Model (K 15, HA 70) in every Season and every chosen variant in its test Season.`);
print(`Season Simulations use the Elo Model as shipped, with its Rating Uncertainty (createEloModel's ratingUncertainty).`);
print();

heading("1. TUNING: parameters chosen on the Seasons before each test Season");
for (const test of tests) {
  print(
    `Test ${seasonLabel(test)}: tuned on ${trainingOf(test).map(seasonLabel).join(", ")}` +
      (fixedCarryOver(test)
        ? " (level start: r cannot be tuned, so Carry-over is fixed at r 1.0; both variants are the same model there, so they get the same σ)"
        : ""),
  );
  table(
    "",
    ["K", "HA", "r", "train Brier", "σ", "train RPS"],
    TUNED.map(([name]): [string, ...string[]] => {
      const { parameters, trainingBrier, sigma, trainingRps } = folds.get(test)!.get(calibrated(name))!;
      return [name, String(parameters.k), String(parameters.homeAdvantage), parameters.carryOver.toFixed(1), fixed(trainingBrier), String(sigma), fixed(trainingRps)];
    }),
    20,
    12,
  );
  print();
}

print("Carry-over profile: for each r, the best training Brier over K and Home Advantage, and (hindsight, never used to choose) the test Brier at those K and Home Advantage");
table(
  "r",
  tests.flatMap((test) => [`${seasonLabel(test)} train`, "test"]),
  GRID_CARRY_OVER.map((carryOver): [string, ...string[]] => [
    carryOver.toFixed(1),
    ...tests.flatMap((test) => {
      const entry = tuned(test, (p) => p.carryOver === carryOver);
      return [fixed(trainingBrier(entry, test)), fixed(entry.chain.get(test)!.brier)];
    }),
  ]),
  6,
  14,
);
print();

print(`σ profile: Rank RPS on the training Seasons (used to choose σ) and, in hindsight, on the test Season, with the test Season's outer tenths in its first 13 Games (${tuneRuns} runs)`);
for (const test of tests) {
  print(`Test ${seasonLabel(test)}`);
  const profiles = sigmaProfiles.get(test)!;
  table(
    "σ",
    TUNED.flatMap(([name]) => [`${name} train`, "test", "outer 1–13"]),
    GRID_SIGMA.map((sigma, s): [string, ...string[]] => [
      String(sigma),
      ...TUNED.flatMap(([name]) => {
        const { trainingRps, test: rows } = profiles.get(name)!.at(s)!;
        return [fixed(trainingRps), fixed(rpsOf(rows)), percent(rowsMetric(rows, "outer", 0))];
      }),
    ]),
    6,
    18,
  );
  print();
}

heading("2. TEST SEASONS: per-Game Back-Test and Season Simulation Back-Test");
print("σ changes only the Season Simulation, so a calibrated variant's per-Game Brier is its uncalibrated one's.");
print();
for (const [title, metric] of [
  ["per-Game Brier (lower is better)", "brier"],
  ["Rank RPS (lower is better)", "rps"],
  ["Cut Line Brier (lower is better)", "cut"],
  ["Outer tenths (about 20% when calibrated and spread over many ranks)", "outer"],
] as const) {
  const show = (x: number) => (metric === "outer" ? percent(x) : fixed(x));
  const shown = metric === "brier" ? TUNED.map(([name]) => name) : VARIANTS;
  print(`${title}: per test Season and pooled`);
  table(
    "",
    [...testHeaders, "pooled"],
    shown.map((name): [string, ...string[]] => [name, ...tests.map((test) => show(metricOf(folds.get(test)!.get(name)!, metric))), show(pooledOf(name, metric))]),
  );
  print();
  if (metric === "brier") continue;
  print(`${title}: pooled, by Games played at the forecast point`);
  table(
    "",
    [...PHASES, "all"],
    shown.map((name): [string, ...string[]] => [name, ...PHASES.map((_, phase) => show(pooledOf(name, metric, phase))), show(pooledOf(name, metric))]),
  );
  print();
}

heading("3. UNCERTAINTY: challenger minus baseline, negative means the challenger is better");
const signFlips = resamples * 10;
print(`Cluster bootstrap (${resamples} resamples) over the team-seasons of the test Seasons: 95% interval of the pooled difference.`);
print(`p: sign-flip test over the same team-seasons (${signFlips} random flips), two-sided. Season p: exact sign-flip test over the ${tests.length} test Seasons (smallest possible ${fixed(2 / 2 ** tests.length, 3)}).`);
print("A Game's Brier score counts for both its teams, so per-Game Brier intervals are somewhat too narrow. Neither the tuning nor simulation noise is resampled.");
print();

/** A team-season's mean score of a variant: per-Game Brier over its Games, otherwise over its forecast points. */
function teamSeasons(name: VariantName, metric: Exclude<Metric, "outer">): Map<string, { season: number; value: number }> {
  const units = new Map<string, { season: number; value: number }>();
  for (const test of tests) {
    const score = folds.get(test)!.get(name)!;
    if (metric === "brier") {
      for (const [teamId, value] of score.teamBrier) units.set(`${test}:${teamId}`, { season: test, value });
      continue;
    }
    const byTeam = new Map<TeamId, number[]>();
    for (const row of score.rows) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), metric === "rps" ? row.rankRps : row.cutLineBrier]);
    for (const [teamId, values] of byTeam) units.set(`${test}:${teamId}`, { season: test, value: mean(values) });
  }
  return units;
}

let seed = 1;
for (const [challenger, baselineName, metrics] of [
  ["Carry-over + σ", "Level + σ", ["brier", "rps", "cut"]],
  ["Carry-over + σ", "Level", ["brier", "rps", "cut"]],
  ["Carry-over + σ", "Carry-over", ["rps", "cut"]],
  ["Level + σ", "Level", ["rps", "cut"]],
] as const) {
  print(`${challenger}  −  ${baselineName}`);
  table(
    "",
    ["diff", "rel %", "95% CI low", "high", "p", "Seasons better", "Season p"],
    metrics.map((metric): [string, ...string[]] => {
      const label = { brier: "per-Game Brier", rps: "Rank RPS", cut: "Cut Line Brier" }[metric];
      const challengerUnits = teamSeasons(challenger, metric);
      const baselineUnits = teamSeasons(baselineName, metric);
      const diffs = [...challengerUnits].map(([key, { season, value }]) => ({ season, diff: value - baselineUnits.get(key)!.value }));
      const baseline = mean([...baselineUnits.values()].map(({ value }) => value));
      const u = pairedUncertainty(diffs, baseline, tests, { resamples, signFlips, seed: seed++ });
      return [label, signed(u.diff), ((100 * u.diff) / u.baseline).toFixed(1), signed(u.low), signed(u.high), fixed(u.p), `${u.seasonsBetter}/${tests.length}`, fixed(u.seasonP)];
    }),
    18,
    15,
  );
  print();
}

heading("4. DECISION RULE: Carry-over + σ against Level + σ");
const better = (metric: "brier" | "rps") => pooledOf("Carry-over + σ", metric) < pooledOf("Level + σ", metric);
const foldsBetterInBoth = tests.filter((test) => {
  const fold = folds.get(test)!;
  return (["brier", "rps"] as const).every((metric) => metricOf(fold.get("Carry-over + σ")!, metric) < metricOf(fold.get("Level + σ")!, metric));
});
print(`Pooled per-Game Brier better: ${better("brier") ? "yes" : "no"} (${fixed(pooledOf("Carry-over + σ", "brier"))} vs ${fixed(pooledOf("Level + σ", "brier"))})`);
print(`Pooled Rank RPS better:       ${better("rps") ? "yes" : "no"} (${fixed(pooledOf("Carry-over + σ", "rps"))} vs ${fixed(pooledOf("Level + σ", "rps"))})`);
print(`Test Seasons better in both:  ${foldsBetterInBoth.length}/${tests.length} (${foldsBetterInBoth.map(seasonLabel).join(", ") || "none"})`);
const ship = better("brier") && better("rps") && foldsBetterInBoth.length >= 2;
print(`Verdict: ${ship ? "SHIP the carry-over with σ" : "do NOT ship: keep the level start"}`);
print();

heading("5. STARTING RATINGS: per test Season as chosen, and a preview for the Season after the last");
for (const test of tests) {
  const { teams } = snapshots.get(test)!;
  const carryOver = folds.get(test)!.get("Carry-over + σ")!;
  print(`${seasonLabel(test)} (Carry-over: ${parametersLabel(carryOver.parameters)}, σ ${carryOver.sigma}): Starting Rating, then final rank`);
  const finalRank = finalRanksOf(test);
  table(
    "",
    ["Starting", "final"],
    [...teams]
      .sort((a, b) => carryOver.starting.get(b.id)! - carryOver.starting.get(a.id)!)
      .map((team): [string, ...string[]] => [team.acronym, carryOver.starting.get(team.id)!.toFixed(0), String(finalRank.get(team.id))]),
    8,
    12,
  );
  print();
}

// Preview: tuned on every Season after the first, as the shipped Starting Ratings and σ would be.
const last = seasons.at(-1)!;
const shippedSeasons = seasons.slice(1);
const allTrained = (() => {
  let best = grid[0]!;
  let bestScore = Infinity;
  for (const entry of grid) {
    const score = mean(shippedSeasons.map((season) => entry.chain.get(season)!.brier));
    if (score < bestScore) [best, bestScore] = [entry, score];
  }
  return { entry: best, score: bestScore };
})();
const shippedProfile = GRID_SIGMA.map((sigma) => ({
  sigma,
  rps: rpsOf(shippedSeasons.flatMap((season) => calibratedRows(season, allTrained.entry.parameters, allTrained.entry.chain.get(season)!.starting, sigma, tuneRuns))),
}));
const shippedSigma = shippedProfile.reduce((a, b) => (b.rps < a.rps ? b : a));
const lastTeams = snapshots.get(last)!.teams;
const preview = startingRatingsFrom(allTrained.entry.chain.get(last)!.end, lastTeams.map((team) => team.id), allTrained.entry.parameters.carryOver);
print(`Preview for ${seasonLabel(last + 1)}, assuming ${seasonLabel(last)}'s teams: tuned on ${shippedSeasons.map(seasonLabel).join(", ")} → ${parametersLabel(allTrained.entry.parameters)} (Brier ${fixed(allTrained.score)}), σ ${shippedSigma.sigma} (Rank RPS ${fixed(shippedSigma.rps)})`);
print(`σ profile on those Seasons: ${shippedProfile.map(({ sigma, rps }) => `${sigma}: ${fixed(rps)}`).join(", ")}`);
table(
  "",
  ["Starting"],
  [...lastTeams].sort((a, b) => preview.get(b.id)! - preview.get(a.id)!).map((team): [string, ...string[]] => [team.acronym, preview.get(team.id)!.toFixed(0)]),
  8,
  12,
);

await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.error(`\nWrote ${values.out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);

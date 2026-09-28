/**
 * Shrinkage study: scores a grid of Season Rate models, and the Elo Model for context, over several Seasons with
 * leave-one-season-out, then writes a text report under data/local/ so study results never end up in the repo.
 *
 *   npm run study                          2022/23–2025/26 from data/local/seasons/, grid at 2,000 simulation runs
 *   npm run study -- --rescore 0,10        also re-score m = 0 and m = 10 (and the Elo Model) at 10,000 runs
 *   npm run study -- --dir d --seasons 2024,2025 --runs 500 --out report.txt
 *
 * Per Season and model it runs the per-Game Back-Test and the Season Simulation Back-Test. Each held-out Season is
 * scored with the m that scored best on the other Seasons, twice: chosen by per-Game Brier and by Rank RPS.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { backTest } from "../src/domain/backTest.ts";
import { eloModel } from "../src/domain/eloModel.ts";
import { projectionModelInput } from "../src/domain/project.ts";
import { seasonLabel } from "../src/domain/season.ts";
import { createSeasonRate } from "../src/domain/seasonRate.ts";
import { seasonSimulationBackTest, type OutcomesProjectionModel, type SeasonSimulationScore } from "../src/domain/seasonBackTest.ts";
import type { Snapshot } from "../src/domain/types.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    seasons: { type: "string", default: "2022,2023,2024,2025" },
    runs: { type: "string", default: "2000" },
    rescore: { type: "string" },
    "rescore-runs": { type: "string", default: "10000" },
    out: { type: "string", default: "data/local/shrinkage-study/season-rate.txt" },
  },
});

/** m values of the grid: how many Games at the league-average 1.5 Points per Game each team is rated as if it had also played. */
const GRID = [0, 1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 30, 40];
const PHASES = ["1–13", "14–26", "27–39", "40–52"];

const seasons = values.seasons.split(",").map(Number);
const runs = Number(values.runs);
const rescore = values.rescore?.split(",").map(Number) ?? [];
const rescoreRuns = Number(values["rescore-runs"]);

const snapshots = new Map<number, Snapshot>();
for (const season of seasons) {
  snapshots.set(season, JSON.parse(await readFile(join(values.dir, `season-${season}.json`), "utf8")) as Snapshot);
}

// The Elo Model and Season Rate both give Outcome Probabilities; the constructors are typed as any Projection Model.
const elo = eloModel as OutcomesProjectionModel;
const eloName = elo.name;
const nameOf = (m: number) => `m=${m}`;
const seasonRateOf = (m: number): OutcomesProjectionModel => ({ ...(createSeasonRate({ priorGames: m }) as OutcomesProjectionModel), name: nameOf(m) });

/** What one model scored on one Season. */
interface SeasonScore {
  /** Mean per-Game Brier score. */
  brier: number;
  rows: SeasonSimulationScore[];
}

/** Every model's score on every Season, by Season then model name. */
async function scoreAll(models: readonly OutcomesProjectionModel[], simulationRuns: number, withBrier: boolean) {
  const all = [...models, elo];
  const scores = new Map<number, Map<string, SeasonScore>>();
  for (const season of seasons) {
    const { games, snapshotAt } = snapshots.get(season)!;
    const started = Date.now();
    const brier = withBrier ? backTest(games, new Date(snapshotAt), all) : [];
    const simulations = seasonSimulationBackTest(games, all, simulationRuns);
    scores.set(
      season,
      new Map(simulations.map(({ model, rows }, i) => [model, { brier: brier[i]?.brierScore ?? NaN, rows }])),
    );
    console.error(`${seasonLabel(season)}: ${all.length} models at ${simulationRuns} runs in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  return scores;
}

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

function phaseOf(gamesPlayed: number): number {
  return Math.min(PHASES.length - 1, Math.max(0, Math.ceil(gamesPlayed / 13) - 1));
}

interface Metrics {
  brier: number;
  rps: number;
  cut: number;
  /** Share of team forecasts whose actual rank fell in the outer tenths: 20% when calibrated. */
  outer: number;
}
type MetricName = keyof Metrics;

const metricsOf = (rows: readonly SeasonSimulationScore[], brier: number): Metrics => ({
  brier,
  rps: mean(rows.map((row) => row.rankRps)),
  cut: mean(rows.map((row) => row.cutLineBrier)),
  outer: mean(rows.map((row) => Number(row.outerTenths))),
});

/** A model per Season: fixed, or chosen per held-out Season. */
type Variant = Map<number, SeasonScore>;

/** The Season scores of one model, or of a different model per Season. */
const variantOf = (scores: Map<number, Map<string, SeasonScore>>, nameFor: (season: number) => string): Variant =>
  new Map(seasons.map((season) => [season, scores.get(season)!.get(nameFor(season))!]));

/** Every team forecast in every Season weighs the same (per-Game Brier: every Season, which has as many Games), as in #41. */
function pooled(variant: Variant, phase?: number, over: readonly number[] = seasons): Metrics {
  const rows = over.flatMap((season) => variant.get(season)!.rows).filter((row) => phase === undefined || phaseOf(row.gamesPlayed) === phase);
  return metricsOf(rows, mean(over.map((season) => variant.get(season)!.brier)));
}

/** For each held-out Season, the m that scores lowest on `metric` averaged over the other Seasons (the smaller m on a tie). */
function leaveOneSeasonOut(scores: Map<number, Map<string, SeasonScore>>, metric: MetricName): Map<number, number> {
  return new Map(
    seasons.map((heldOut) => {
      const others = seasons.filter((season) => season !== heldOut);
      let best = GRID[0]!;
      let bestScore = Infinity;
      for (const m of GRID) {
        const score = pooled(variantOf(scores, () => nameOf(m)), undefined, others)[metric];
        if (score < bestScore) [best, bestScore] = [m, score];
      }
      return [heldOut, best];
    }),
  );
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
const percent = (x: number) => `${(100 * x).toFixed(1)}%`;

/** A table with a row label and a column per header. */
function table(rowHeader: string, headers: readonly string[], rows: readonly (readonly [string, ...string[]])[], labelWidth = 34, width = 9) {
  print(rowHeader.padEnd(labelWidth) + headers.map((h) => cell(h, width)).join(""));
  for (const [label, ...cells] of rows) print(label.padEnd(labelWidth) + cells.map((c) => cell(c, width)).join(""));
}

const seasonHeaders = seasons.map(seasonLabel);

/** Per-Season and pooled scores of variants for one metric. */
function metricTable(metric: MetricName, variants: readonly [string, Variant][], digits = 4) {
  const show = (x: number) => (metric === "outer" ? percent(x) : fixed(x, digits));
  table(
    "",
    [...seasonHeaders, "pooled"],
    variants.map(([label, variant]) => [
      label,
      ...seasons.map((season) => show(metricsOf(variant.get(season)!.rows, variant.get(season)!.brier)[metric])),
      show(pooled(variant)[metric]),
    ]),
  );
}

/** Pooled scores of variants by Games played. */
function phaseTable(metric: MetricName, variants: readonly [string, Variant][]) {
  const show = (x: number) => (metric === "outer" ? percent(x) : fixed(x));
  table(
    "",
    [...PHASES, "all"],
    variants.map(([label, variant]) => [label, ...PHASES.map((_, phase) => show(pooled(variant, phase)[metric])), show(pooled(variant)[metric])]),
  );
}

function variantReport(variants: readonly [string, Variant][]) {
  for (const [title, metric] of [
    ["Rank RPS (lower is better)", "rps"],
    ["Cut Line Brier (lower is better)", "cut"],
    ["Share of team forecasts whose final rank fell in the outer tenths (about 20% when calibrated and spread over many ranks; lower late in the Season)", "outer"],
  ] as const) {
    print(`${title}: per Season and pooled`);
    metricTable(metric, variants);
    print();
    print(`${title}: pooled, by Games played`);
    phaseTable(metric, variants);
    print();
  }
}

/** Per team-season: final rank and each variant's mean Rank RPS and Cut Line Brier over the forecast points. */
function teamSeasonReport(variants: readonly [string, Variant][]) {
  for (const season of seasons) {
    const { games, teams } = snapshots.get(season)!;
    const finalRank = new Map(projectionModelInput(games, new Date(8.64e15)).currentTable.map((row) => [row.teamId, row.rank]));
    print(`Season ${seasonLabel(season)}: final rank, then mean Rank RPS and Cut Line Brier over the forecast points`);
    table(
      "",
      ["final", ...variants.flatMap(([label]) => [`${label} RPS`, `${label} Cut`])],
      [...teams]
        .sort((a, b) => finalRank.get(a.id)! - finalRank.get(b.id)!)
        .map((team): [string, ...string[]] => [
          team.acronym,
          String(finalRank.get(team.id)),
          ...variants.flatMap(([, variant]) => {
            const rows = variant.get(season)!.rows.filter((row) => row.teamId === team.id);
            return [fixed(mean(rows.map((row) => row.rankRps))), fixed(mean(rows.map((row) => row.cutLineBrier)))];
          }),
        ]),
      6,
      16,
    );
    print();
  }
}

const started = Date.now();
const scores = await scoreAll(GRID.map(seasonRateOf), runs, true);

print(`Shrinkage study: Season Rate over ${seasons.map(seasonLabel).join(", ")}; ${runs} simulation runs per forecast point.`);
print(`Snapshots from ${values.dir}. Pooled figures weigh every team forecast the same; the per-Game Brier mean weighs every Season the same.`);
print();

heading("1. PER-GAME BACK-TEST: Brier score by m (lower is better)");
table(
  "",
  [...seasonHeaders, "mean"],
  [
    ...[eloName, ...GRID.map(nameOf)].map((name): [string, ...string[]] => {
      const variant = variantOf(scores, () => name);
      return [name, ...seasons.map((season) => fixed(variant.get(season)!.brier)), fixed(pooled(variant).brier)];
    }),
  ],
);
print();

const chosenByBrier = leaveOneSeasonOut(scores, "brier");
const chosenByRps = leaveOneSeasonOut(scores, "rps");
const chosen = (by: Map<number, number>) => seasons.map((season) => `${seasonLabel(season)}: m=${by.get(season)}`).join(", ");
print(`Leave-one-season-out m, by per-Game Brier: ${chosen(chosenByBrier)}`);
print(`Leave-one-season-out m, by Rank RPS:       ${chosen(chosenByRps)}`);
print();

heading("2. SEASON SIMULATION BACK-TEST: pooled scores by m");
table(
  "m",
  ["Rank RPS", "Cut Brier", "outer 10ths"],
  [nameOf(0), ...GRID.slice(1).map(nameOf), eloName].map((name): [string, ...string[]] => {
    const { rps, cut, outer } = pooled(variantOf(scores, () => name));
    return [name, fixed(rps), fixed(cut), percent(outer)];
  }),
  12,
  12,
);
print();
print("Rank RPS by m and Games played:");
phaseTable(
  "rps",
  [...GRID.map(nameOf), eloName].map((name): [string, Variant] => [name, variantOf(scores, () => name)]),
);
print();

const heldOutByBrier = variantOf(scores, (season) => nameOf(chosenByBrier.get(season)!));
const heldOutByRps = variantOf(scores, (season) => nameOf(chosenByRps.get(season)!));
const compared: [string, Variant][] = [
  ["m=0", variantOf(scores, () => nameOf(0))],
  ["m=10", variantOf(scores, () => nameOf(10))],
  ["held-out m (by Brier)", heldOutByBrier],
  ["held-out m (by Rank RPS)", heldOutByRps],
  [eloName, variantOf(scores, () => eloName)],
];

heading("3. COMPARISON: per-Game Brier");
print("per-Game Brier score (lower is better): per Season and pooled");
metricTable("brier", compared);
print();

heading("4. COMPARISON: Season Simulation Back-Test");
variantReport(compared);

heading("5. PER TEAM-SEASON: mean over the forecast points");
teamSeasonReport(compared.filter(([label]) => label === "m=0" || label === "m=10" || label === eloName));

if (rescore.length > 0) {
  const rescored = await scoreAll(rescore.map(seasonRateOf), rescoreRuns, false);
  heading(`6. RE-SCORED AT ${rescoreRuns} SIMULATION RUNS: ${rescore.map(nameOf).join(", ")}`);
  variantReport([
    ...rescore.map((m): [string, Variant] => [nameOf(m), variantOf(rescored, () => nameOf(m))]),
    [eloName, variantOf(rescored, () => eloName)],
  ]);
}

await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.error(`\nWrote ${values.out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);

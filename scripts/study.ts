/**
 * Shrinkage study: scores a grid of Season Rate models, or of Matchup Model variants next to Season Rate, and the Elo
 * Model for context, over several Seasons with leave-one-season-out, then writes a text report under data/local/ so
 * study results never end up in the repo.
 *
 *   npm run study                          Season Rate, 2022/23–2025/26 from data/local/seasons/, grid at 2,000 simulation runs
 *   npm run study:matchup                  the Matchup Model's league, flat and team centres, Season Rate and the Elo Model
 *   npm run study -- --rescore 0,10        also re-score m = 0 and m = 10 (and the Elo Model) at 10,000 runs
 *   npm run study -- --dir d --seasons 2024,2025 --runs 500 --out report.txt
 *
 * Per Season and model it runs the per-Game Back-Test and the Season Simulation Back-Test. Each held-out Season is
 * scored with the m that scored best on the other Seasons, twice: chosen by per-Game Brier and by Rank RPS.
 *
 * The Matchup Model variants are the league centre (shrunk toward the league's home and away Points per Game), the flat
 * control (toward 1.5 at both venues) and the team centre (toward the team's Season Rate). Their home Points per Game,
 * where they use it, comes from the other Seasons' Played Games only, so a held-out Season never leaks into its own
 * prior. All variants share the id `matchup`, so they get the same Season Simulation seeds at each Match Day.
 *
 * Each comparison of two models gets its uncertainty as #41 did: a cluster bootstrap over team-seasons for the pooled
 * difference in per-Game Brier, Rank RPS and Cut Line Brier, a sign-flip test over the same team-seasons, and in how
 * many Seasons the challenger was better, with an exact sign-flip test across those Seasons.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { backTest, gameBriers } from "../src/domain/backTest.ts";
import { eloModel } from "../src/domain/eloModel.ts";
import { createMatchupModel, leagueHomePointsPerGame } from "../src/domain/matchupModel.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME } from "../src/domain/outcomes.ts";
import { projectionModelInput } from "../src/domain/project.ts";
import { seasonLabel } from "../src/domain/season.ts";
import { createSeasonRate } from "../src/domain/seasonRate.ts";
import { seasonSimulationBackTest, type OutcomesProjectionModel, type SeasonSimulationScore } from "../src/domain/seasonBackTest.ts";
import type { Snapshot, TeamId } from "../src/domain/types.ts";

const { values } = parseArgs({
  options: {
    study: { type: "string", default: "season-rate" },
    dir: { type: "string", default: "data/local/seasons" },
    seasons: { type: "string", default: "2022,2023,2024,2025" },
    runs: { type: "string", default: "2000" },
    rescore: { type: "string" },
    resamples: { type: "string", default: "10000" },
    "rescore-runs": { type: "string", default: "10000" },
    out: { type: "string" },
  },
});

const STUDIES = ["season-rate", "matchup"];
if (!STUDIES.includes(values.study)) throw new Error(`--study must be one of ${STUDIES.join(", ")}`);
const matchupStudy = values.study === "matchup";
const out = values.out ?? `data/local/shrinkage-study/${values.study}.txt`;

/** m values of the grid: how many Games at the league-average 1.5 Points per Game each team is rated as if it had also played. */
const GRID = [0, 1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 30, 40];
const PHASES = ["1–13", "14–26", "27–39", "40–52"];

const seasons = values.seasons.split(",").map(Number);
const runs = Number(values.runs);
const rescore = values.rescore?.split(",").map(Number) ?? [];
const rescoreRuns = Number(values["rescore-runs"]);
const resamples = Number(values.resamples);

const snapshots = new Map<number, Snapshot>();
for (const season of seasons) {
  snapshots.set(season, JSON.parse(await readFile(join(values.dir, `season-${season}.json`), "utf8")) as Snapshot);
}

// The Elo Model, Season Rate and the Matchup Model all give Outcome Probabilities; the constructors are typed as any Projection Model.
const elo = eloModel as OutcomesProjectionModel;
const eloName = elo.name;

/** A model to score on a Season: the Matchup Model's home Points per Game comes from the other Seasons, so it depends on the Season. */
type ModelFor = (season: number) => OutcomesProjectionModel;

/** A model with a prior strength m to choose, at every m of the grid. */
interface Family {
  label: string;
  nameOf: (m: number) => string;
  modelFor: (m: number) => ModelFor;
}

const seasonRateFamily: Family = {
  label: "Season Rate",
  nameOf: (m) => `${matchupStudy ? "Season Rate " : ""}m=${m}`,
  modelFor: (m) => () => ({ ...(createSeasonRate({ priorGames: m }) as OutcomesProjectionModel), name: seasonRateFamily.nameOf(m) }),
};

/** After every Game in any Season. */
const END_OF_SEASON = new Date(8.64e15);

const playedGamesOf = (season: number) => projectionModelInput(snapshots.get(season)!.games, END_OF_SEASON).playedGames;

/** League home Points per Game over the Played Games of every Season but `season`: 1.5 when there is none. */
const trainingHomePointsPerGame = (season: number) =>
  leagueHomePointsPerGame(seasons.filter((other) => other !== season).flatMap(playedGamesOf));

/** m = 0 is the unshrunk Matchup Model whatever the centre, so the variants share its row. */
function matchupFamily(label: string, centre: "league" | "flat" | "team"): Family {
  const nameOf = (m: number) => (m === 0 ? "Matchup m=0" : `${label} m=${m}`);
  return {
    label,
    nameOf,
    modelFor: (m) => (season) => ({
      ...(createMatchupModel({
        priorGames: m,
        homePointsPerGame: centre === "flat" ? LEAGUE_AVERAGE_POINTS_PER_GAME : trainingHomePointsPerGame(season),
        centre: centre === "team" ? "team" : "league",
      }) as OutcomesProjectionModel),
      name: nameOf(m),
    }),
  };
}

const matchupFamilies = [matchupFamily("League", "league"), matchupFamily("Flat", "flat"), matchupFamily("Team", "team")];
/** The unshrunk Matchup Model, the study's m = 0 row; the shipped Matchup Model is shrunk. */
const unshrunkMatchupModel = createMatchupModel({ priorGames: 0, homePointsPerGame: LEAGUE_AVERAGE_POINTS_PER_GAME, centre: "league" });
/** The unshrunk model: m = 0 of Season Rate, or of the Matchup Model. */
const unshrunkName = (matchupStudy ? matchupFamilies[0]! : seasonRateFamily).nameOf(0);
const families = matchupStudy ? [seasonRateFamily, ...matchupFamilies] : [seasonRateFamily];
const modelsOf = (ms: readonly number[]): ModelFor[] => [...families.flatMap((family) => ms.map(family.modelFor)), () => elo];
/** Every name of the grid's models, once (the Matchup Model's m = 0 is shared), without the Elo Model. */
const namesOf = (ms: readonly number[]) => [...new Set(families.flatMap((family) => ms.map(family.nameOf)))];

/** What one model scored on one Season. */
interface SeasonScore {
  /** Mean per-Game Brier score. */
  brier: number;
  /** Mean per-Game Brier score of each team's Played Games, by team. */
  teamBrier: Map<TeamId, number>;
  rows: SeasonSimulationScore[];
}

/** Every model's score on every Season, by Season then model name. */
async function scoreAll(modelsFor: readonly ModelFor[], simulationRuns: number, withBrier: boolean) {
  const scores = new Map<number, Map<string, SeasonScore>>();
  for (const season of seasons) {
    const { games, snapshotAt } = snapshots.get(season)!;
    const started = Date.now();
    const all = [...new Map(modelsFor.map((modelFor) => modelFor(season)).map((model) => [model.name, model])).values()];
    const briers = withBrier ? gameBriers(games, new Date(snapshotAt), all) : [];
    const simulations = seasonSimulationBackTest(games, all, simulationRuns);
    scores.set(
      season,
      new Map(
        simulations.map(({ model, rows }, i) => [
          model,
          { brier: mean([...(briers[i]?.values() ?? [])]), teamBrier: teamMeans(games, briers[i] ?? new Map()), rows },
        ]),
      ),
    );
    console.error(`${seasonLabel(season)}: ${all.length} models at ${simulationRuns} runs in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  return scores;
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? NaN : xs.reduce((sum, x) => sum + x, 0) / xs.length);

/** Each team's mean Brier score over the Games it played: a Game counts for both its teams. */
function teamMeans(games: Snapshot["games"], briers: ReadonlyMap<string, number>): Map<TeamId, number> {
  const byTeam = new Map<TeamId, number[]>();
  for (const game of games) {
    const brier = briers.get(game.id);
    if (brier === undefined) continue;
    for (const teamId of [game.homeTeamId, game.awayTeamId]) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), brier]);
  }
  return new Map([...byTeam].map(([teamId, values]) => [teamId, mean(values)]));
}

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
function leaveOneSeasonOut(scores: Map<number, Map<string, SeasonScore>>, metric: MetricName, { nameOf }: Family): Map<number, number> {
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

/** A seeded generator (mulberry32) so the report is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const UNCERTAINTY_METRICS = [
  ["brier", "per-Game Brier"],
  ["rps", "Rank RPS"],
  ["cut", "Cut Line Brier"],
] as const satisfies readonly [MetricName, string][];
/** Random sign-flips of the team-seasons' differences: more than the bootstrap needs, as their p-values can be small. */
const SIGN_FLIPS = resamples * 10;

/** A team-season's mean score of a variant on a metric: the independent unit of the uncertainty, as in #41. */
interface TeamSeason {
  season: number;
  value: number;
}

function teamSeasons(variant: Variant, metric: MetricName): Map<string, TeamSeason> {
  const units = new Map<string, TeamSeason>();
  for (const season of seasons) {
    const { teamBrier, rows } = variant.get(season)!;
    if (metric === "brier") {
      for (const [teamId, value] of teamBrier) units.set(`${season}:${teamId}`, { season, value });
      continue;
    }
    const byTeam = new Map<TeamId, number[]>();
    for (const row of rows) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), metric === "rps" ? row.rankRps : row.cutLineBrier]);
    for (const [teamId, values] of byTeam) units.set(`${season}:${teamId}`, { season, value: mean(values) });
  }
  return units;
}

interface Uncertainty {
  /** Challenger minus baseline, pooled over team-seasons; negative means the challenger is better. */
  diff: number;
  /** Baseline's pooled score, for the relative difference. */
  baseline: number;
  /** 95% percentile interval of the cluster bootstrap over team-seasons. */
  low: number;
  high: number;
  /** Two-sided sign-flip test over the team-seasons' differences. */
  p: number;
  /** Seasons where the challenger's pooled difference is negative. */
  seasonsBetter: number;
  /** Two-sided exact sign-flip test over the Seasons' differences: it cannot go below 2 / 2^(Seasons). */
  seasonP: number;
}

/** Differences of every team-season (challenger minus baseline), each with its Season. */
function uncertainty(challenger: Variant, baseline: Variant, metric: MetricName, seed: number): Uncertainty {
  const challengerUnits = teamSeasons(challenger, metric);
  const baselineUnits = teamSeasons(baseline, metric);
  const diffs = [...challengerUnits].map(([key, { season, value }]) => ({ season, diff: value - baselineUnits.get(key)!.value }));
  const values = diffs.map(({ diff }) => diff);
  const n = values.length;
  const observed = mean(values);
  const next = seededRandom(seed);

  // Cluster bootstrap: resample whole team-seasons, since one team's forecasts share a final rank and a schedule.
  const boot = Array.from({ length: resamples }, () => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(next() * n)]!;
    return sum / n;
  }).sort((a, b) => a - b);

  // Sign-flip: under "no difference" each team-season's difference is as likely to have the other sign.
  let extreme = 0;
  for (let i = 0; i < SIGN_FLIPS; i++) {
    let sum = 0;
    for (const value of values) sum += next() < 0.5 ? -value : value;
    if (Math.abs(sum / n) >= Math.abs(observed) - 1e-12) extreme++;
  }

  const seasonDiffs = seasons.map((season) => mean(diffs.filter((d) => d.season === season).map((d) => d.diff)));
  let seasonExtreme = 0;
  for (let flips = 0; flips < 2 ** seasons.length; flips++) {
    const sum = seasonDiffs.reduce((acc, diff, i) => acc + (flips & (1 << i) ? -diff : diff), 0);
    if (Math.abs(sum / seasons.length) >= Math.abs(mean(seasonDiffs)) - 1e-12) seasonExtreme++;
  }

  return {
    diff: observed,
    baseline: mean([...baselineUnits.values()].map(({ value }) => value)),
    low: boot[Math.floor(0.025 * resamples)]!,
    high: boot[Math.ceil(0.975 * resamples) - 1]!,
    p: (extreme + 1) / (SIGN_FLIPS + 1),
    seasonsBetter: seasonDiffs.filter((diff) => diff < 0).length,
    seasonP: seasonExtreme / 2 ** seasons.length,
  };
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
function table(rowHeader: string, headers: readonly string[], rows: readonly (readonly [string, ...string[]])[], minLabelWidth = 34, width = 9) {
  const labelWidth = Math.max(minLabelWidth, rowHeader.length + 2, ...rows.map(([label]) => label.length + 2));
  print(rowHeader.padEnd(labelWidth) + headers.map((h) => cell(h, width)).join(""));
  for (const [label, ...cells] of rows) print(label.padEnd(labelWidth) + cells.map((c) => cell(c, width)).join(""));
}

const signed = (x: number) => (x >= 0 ? "+" : "") + fixed(x);

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
const scores = await scoreAll(modelsOf(GRID), runs, true);

print(`Shrinkage study: ${matchupStudy ? "the Matchup Model's league, flat and team centres, with Season Rate," : "Season Rate"} over ${seasons.map(seasonLabel).join(", ")}; ${runs} simulation runs per forecast point.`);
print(`Snapshots from ${values.dir}. Pooled figures weigh every team forecast the same; the per-Game Brier mean weighs every Season the same.`);
print();

if (matchupStudy) {
  heading("0. LEAGUE HOME POINTS PER GAME AND THE UNSHRUNK MODEL");
  table(
    "",
    seasonHeaders,
    [
      ["Season's own", ...seasons.map((season) => fixed(leagueHomePointsPerGame(playedGamesOf(season)), 3))],
      ["Prior when held out (others)", ...seasons.map((season) => fixed(trainingHomePointsPerGame(season), 3))],
    ],
    30,
  );
  print("The league and team centres use the second row as homePointsPerGame for each held-out Season (away is 3 minus it); the flat control uses 1.5. Their m is chosen on the other Seasons, each scored with a prior from the Seasons but its own, which includes the held-out Season's Games.");
  print();
  // The priorGames 0 row is the unshrunk Matchup Model, so its per-Game Brier must be the existing Back-Test's.
  for (const season of seasons) {
    const { games, snapshotAt } = snapshots.get(season)!;
    const unshrunk = backTest(games, new Date(snapshotAt), [unshrunkMatchupModel])[0]!.brierScore!;
    const row = scores.get(season)!.get(unshrunkName)!.brier;
    if (Math.abs(unshrunk - row) > 1e-9) throw new Error(`${unshrunkName} scores ${row} in ${season}, the unshrunk Matchup Model ${unshrunk}`);
  }
  print(`Check: ${unshrunkName}'s per-Game Brier equals the unshrunk Matchup Model's in the Back-Test, in every Season.`);
  print();
}

heading("1. PER-GAME BACK-TEST: Brier score by m (lower is better)");
table(
  "",
  [...seasonHeaders, "mean"],
  [eloName, ...namesOf(GRID)].map((name): [string, ...string[]] => {
    const variant = variantOf(scores, () => name);
    return [name, ...seasons.map((season) => fixed(variant.get(season)!.brier)), fixed(pooled(variant).brier)];
  }),
);
print();

const chosenBy = new Map(
  families.map((family) => [family, { brier: leaveOneSeasonOut(scores, "brier", family), rps: leaveOneSeasonOut(scores, "rps", family) }]),
);
print("Leave-one-season-out m: the m that scored best on the other Seasons, for each held-out Season");
for (const [title, by] of [
  ["by per-Game Brier", "brier"],
  ["by Rank RPS", "rps"],
] as const) {
  table(
    title,
    seasonHeaders,
    families.map((family): [string, ...string[]] => [family.label, ...seasons.map((season) => `m=${chosenBy.get(family)![by].get(season)}`)]),
    20,
  );
}
print();

heading("2. SEASON SIMULATION BACK-TEST: pooled scores by m");
table(
  "m",
  ["Rank RPS", "Cut Brier", "outer 10ths"],
  [...namesOf(GRID), eloName].map((name): [string, ...string[]] => {
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
  [...namesOf(GRID), eloName].map((name): [string, Variant] => [name, variantOf(scores, () => name)]),
);
print();

const heldOutLabel = (family: Family, by: "Brier" | "Rank RPS") => `${matchupStudy ? `${family.label} ` : ""}held-out m (by ${by})`;
const heldOuts = families.flatMap((family): [string, Variant][] => [
  [heldOutLabel(family, "Brier"), variantOf(scores, (season) => family.nameOf(chosenBy.get(family)!.brier.get(season)!))],
  [heldOutLabel(family, "Rank RPS"), variantOf(scores, (season) => family.nameOf(chosenBy.get(family)!.rps.get(season)!))],
]);
const fixedM = (name: string): [string, Variant] => [name, variantOf(scores, () => name)];
const compared: [string, Variant][] = [
  fixedM(unshrunkName),
  ...(matchupStudy ? [] : [fixedM("m=10")]),
  ...heldOuts,
  fixedM(eloName),
];

heading("3. COMPARISON: per-Game Brier");
print("per-Game Brier score (lower is better): per Season and pooled");
metricTable("brier", compared);
print();

heading("4. COMPARISON: Season Simulation Back-Test");
variantReport(compared);

heading("5. UNCERTAINTY: challenger minus baseline, negative means the challenger is better");
print(`Cluster bootstrap (${resamples} resamples) over the ${seasons.length * snapshots.get(seasons[0]!)!.teams.length} team-seasons: 95% interval of the pooled difference.`);
print(`p: sign-flip test over the same team-seasons (${SIGN_FLIPS} random flips), two-sided; the test #41 reported.`);
print(`Seasons better: how many Seasons the challenger's pooled difference is negative in; Season p is the exact sign-flip test over the Seasons, whose smallest possible value is ${fixed(2 / 2 ** seasons.length, 3)}.`);
print("A Game's Brier score counts for both its teams, so per-Game Brier intervals are somewhat too narrow. Neither the choice of m nor simulation noise is resampled.");
print();
const byName = new Map(compared);
const comparisons: [challenger: string, baseline: string][] = matchupStudy
  ? matchupFamilies.flatMap((family) =>
      [unshrunkName, eloName].flatMap((baseline): [string, string][] => [
        [heldOutLabel(family, "Rank RPS"), baseline],
        [heldOutLabel(family, "Brier"), baseline],
      ]),
    )
  : [
      ["m=10", "m=0"],
      ["held-out m (by Rank RPS)", "m=0"],
      ["held-out m (by Brier)", "m=0"],
      ["m=10", eloName],
      ["held-out m (by Rank RPS)", eloName],
      ["held-out m (by Brier)", eloName],
    ];
let seed = 1;
for (const [challenger, baseline] of comparisons) {
  print(`${challenger}  −  ${baseline}`);
  table(
    "",
    ["diff", "rel %", "95% CI low", "high", "p", "Seasons better", "Season p"],
    UNCERTAINTY_METRICS.map(([metric, label]): [string, ...string[]] => {
      const u = uncertainty(byName.get(challenger)!, byName.get(baseline)!, metric, seed++);
      return [label, signed(u.diff), `${((100 * u.diff) / u.baseline).toFixed(1)}`, signed(u.low), signed(u.high), fixed(u.p), `${u.seasonsBetter}/${seasons.length}`, fixed(u.seasonP)];
    }),
    18,
    15,
  );
  print();
}

if (!matchupStudy) {
  heading("6. PER TEAM-SEASON: mean over the forecast points");
  teamSeasonReport(compared.filter(([label]) => label === "m=0" || label === "m=10" || label === eloName));
}

if (rescore.length > 0) {
  const rescored = await scoreAll(modelsOf(rescore), rescoreRuns, false);
  heading(`${matchupStudy ? 6 : 7}. RE-SCORED AT ${rescoreRuns} SIMULATION RUNS: ${namesOf(rescore).join(", ")}`);
  variantReport([...namesOf(rescore), eloName].map((name): [string, Variant] => [name, variantOf(rescored, () => name)]));
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.error(`\nWrote ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);

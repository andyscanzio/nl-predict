/**
 * PROTOTYPE — throwaway, never merged. Headroom check for the learned Projection Model (#141, map #137): does an ordered
 * logit over the agreed features (#140) beat the Elo Model per Game?
 *
 *   node scripts/headroomPrototype.ts [--prior-games 10] [--train-from 2021] [--resamples 10000]
 *
 * One Elo chain at the production values (K 10, carry-over 1), level from the first Season, gives each Played Game the
 * Ratings from just before it. The Elo Model scores each Game as the Back-Test does (Ratings + Home Advantage 60,
 * in-Season OT/SO Rate). The ordered logit RW > OTW > OTL > RL is trained on every Played Game of the Seasons before the
 * test Season (walk-forward) and predicts the test Season one step ahead from the same Ratings plus the other features.
 *
 * Caveat: K, Home Advantage and carry-over were tuned on 2023/24–2025/26 (ADR 0004), so the Ratings themselves leak the
 * test Seasons. That favours the Elo baseline and the logit's Rating feature alike; the check is about the gap.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { expectedHomeScore, INITIAL_RATING, startingRatingsFrom } from "../src/domain/eloModel.ts";
import { pointsFor, type PlayedGame } from "../src/domain/form.ts";
import { otsoRate, outcomesFromExpectedPoints } from "../src/domain/outcomes.ts";
import { projectionModelInput } from "../src/domain/project.ts";
import { swissCalendarDay } from "../src/domain/swissDay.ts";
import type { Snapshot, TeamId } from "../src/domain/types.ts";
import { seededRandom } from "./studyStats.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    "prior-games": { type: "string", default: "10" },
    "train-from": { type: "string", default: "2021" },
    resamples: { type: "string", default: "10000" },
  },
});
const SEASONS = [2021, 2022, 2023, 2024, 2025];
const TESTS = [2023, 2024, 2025];
const PRIOR_GAMES = Number(values["prior-games"]);
const TRAIN_FROM = Number(values["train-from"]);
const RESAMPLES = Number(values.resamples);
const K = 10;
const HOME_ADVANTAGE = 60;

const snapshots = new Map<number, Snapshot>();
for (const season of SEASONS) {
  snapshots.set(season, JSON.parse(await readFile(join(values.dir, `season-${season}.json`), "utf8")) as Snapshot);
}

/** 0 RL, 1 OTL, 2 OTW, 3 RW: the home side's outcome, ordered worst to best. */
const outcomeOf = (game: PlayedGame) =>
  game.result.homeGoals > game.result.awayGoals ? (game.result.decision === "regulation" ? 3 : 2) : game.result.decision === "regulation" ? 0 : 1;

interface Row {
  season: number;
  day: string;
  y: number;
  /** Elo Model's own Outcome Probabilities, [RL, OTL, OTW, RW]. */
  elo: number[];
  ratingDiff: number;
  gdDiff: number;
  b2bHome: number;
  b2bAway: number;
  progress: number;
}

// One step ahead through every Season, Games starting together sharing what was known before them.
const rows: Row[] = [];
let previousRatings: Map<TeamId, number> | undefined;
for (const season of SEASONS) {
  const snapshot = snapshots.get(season)!;
  const teamIds = snapshot.teams.map((team) => team.id);
  const ratings = previousRatings ? startingRatingsFrom(previousRatings, teamIds, 1) : new Map(teamIds.map((id) => [id, INITIAL_RATING]));
  const played = projectionModelInput(snapshot.games, new Date(snapshot.snapshotAt)).playedGames;
  const daysOf = new Map<TeamId, Set<string>>(teamIds.map((id) => [id, new Set()]));
  for (const game of snapshot.games) {
    const day = swissCalendarDay(Date.parse(game.startsAt));
    daysOf.get(game.homeTeamId)!.add(day);
    daysOf.get(game.awayTeamId)!.add(day);
  }
  const previousDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const goalDiff = new Map<TeamId, number>(teamIds.map((id) => [id, 0]));
  const gamesPlayed = new Map<TeamId, number>(teamIds.map((id) => [id, 0]));
  const shrunkGd = (id: TeamId) => goalDiff.get(id)! / (gamesPlayed.get(id)! + PRIOR_GAMES);

  for (let start = 0; start < played.length; ) {
    let end = start;
    while (end < played.length && played[end]!.startsAt === played[start]!.startsAt) end++;
    const group = played.slice(start, end);
    const rate = otsoRate(played.slice(0, start));
    for (const game of group) {
      const home = ratings.get(game.homeTeamId)!;
      const away = ratings.get(game.awayTeamId)!;
      const o = outcomesFromExpectedPoints(3 * expectedHomeScore(home, away, HOME_ADVANTAGE), rate);
      const day = swissCalendarDay(Date.parse(game.startsAt));
      rows.push({
        season,
        day,
        y: outcomeOf(game),
        elo: [o.regulationLoss, o.overtimeOrShootoutLoss, o.overtimeOrShootoutWin, o.regulationWin],
        ratingDiff: home - away,
        gdDiff: shrunkGd(game.homeTeamId) - shrunkGd(game.awayTeamId),
        b2bHome: Number(daysOf.get(game.homeTeamId)!.has(previousDay(day))),
        b2bAway: Number(daysOf.get(game.awayTeamId)!.has(previousDay(day))),
        progress: (gamesPlayed.get(game.homeTeamId)! + gamesPlayed.get(game.awayTeamId)!) / 104,
      });
    }
    for (const game of group) {
      const home = ratings.get(game.homeTeamId)!;
      const away = ratings.get(game.awayTeamId)!;
      const change = K * (pointsFor(game, game.homeTeamId) / 3 - expectedHomeScore(home, away, HOME_ADVANTAGE));
      ratings.set(game.homeTeamId, home + change);
      ratings.set(game.awayTeamId, away - change);
      for (const [id, gd] of [
        [game.homeTeamId, game.result.homeGoals - game.result.awayGoals],
        [game.awayTeamId, game.result.awayGoals - game.result.homeGoals],
      ] as const) {
        goalDiff.set(id, goalDiff.get(id)! + gd);
        gamesPlayed.set(id, gamesPlayed.get(id)! + 1);
      }
    }
    start = end;
  }
  previousRatings = ratings;
}

// --- Proportional-odds ordered logit: P(y ≤ k) = σ(θ_k − β·x), θ ordered via θ0, θ0+e^a1, θ0+e^a1+e^a2. ---

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const L2 = 1e-4;

function cutsOf(params: readonly number[]) {
  const t0 = params[0]!;
  const t1 = t0 + Math.exp(params[1]!);
  return [t0, t1, t1 + Math.exp(params[2]!)];
}

function probabilities(params: readonly number[], x: readonly number[]): number[] {
  const eta = x.reduce((sum, xi, i) => sum + xi * params[3 + i]!, 0);
  const [c0, c1, c2] = cutsOf(params).map((c) => sigmoid(c - eta)) as [number, number, number];
  return [c0, c1 - c0, c2 - c1, 1 - c2];
}

function negLogLik(params: readonly number[], xs: readonly number[][], ys: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum -= Math.log(Math.max(1e-15, probabilities(params, xs[i]!)[ys[i]!]!));
  for (let j = 3; j < params.length; j++) sum += L2 * xs.length * params[j]! ** 2;
  return sum;
}

/** Newton–Raphson on finite differences with backtracking: d ≤ 8, so brute force is fine for a prototype. */
function fit(xs: number[][], ys: number[], objective = negLogLik, offset = 3): number[] {
  const d = offset + xs[0]!.length;
  let params = offset === 3 ? [-1, 0, 0, ...Array<number>(d - 3).fill(0)] : Array<number>(d).fill(0);
  const f = (p: readonly number[]) => objective(p, xs, ys);
  const h = 1e-4;
  const gradient = (p: readonly number[]) =>
    p.map((_, j) => {
      const up = [...p];
      const down = [...p];
      up[j]! += h;
      down[j]! -= h;
      return (f(up) - f(down)) / (2 * h);
    });
  for (let iteration = 0; iteration < 50; iteration++) {
    const g = gradient(params);
    if (Math.hypot(...g) < 1e-4) break;
    const hessian = params.map((_, j) => {
      const up = [...params];
      const down = [...params];
      up[j]! += h;
      down[j]! -= h;
      const gu = gradient(up);
      const gd = gradient(down);
      return gu.map((v, k) => (v - gd[k]!) / (2 * h));
    });
    const step = solve(hessian, g);
    let scale = 1;
    const current = f(params);
    while (scale > 1e-6) {
      const candidate = params.map((p, j) => p - scale * step[j]!);
      if (f(candidate) < current) {
        params = candidate;
        break;
      }
      scale /= 2;
    }
    if (scale <= 1e-6) break;
  }
  return params;
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Binary logistic for a home win: params [intercept, β...]. */
const winProbability = (params: readonly number[], x: readonly number[]) => sigmoid(params[0]! + x.reduce((s, xi, i) => s + xi * params[1 + i]!, 0));
function winNegLogLik(params: readonly number[], xs: readonly number[][], ys: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    const p = winProbability(params, xs[i]!);
    sum -= Math.log(Math.max(1e-15, ys[i]! >= 2 ? p : 1 - p));
  }
  for (let j = 1; j < params.length; j++) sum += L2 * xs.length * params[j]! ** 2;
  return sum;
}

// --- Variants, nested ---

interface Variant {
  name: string;
  features: (row: Row) => number[];
}
const VARIANTS: Variant[] = [
  { name: "OL Rating diff", features: (r) => [r.ratingDiff] },
  { name: "OL + goal diff", features: (r) => [r.ratingDiff, r.gdDiff] },
  { name: "OL + back-to-back", features: (r) => [r.ratingDiff, r.gdDiff, r.b2bHome, r.b2bAway] },
  { name: "OL + progress×diff", features: (r) => [r.ratingDiff, r.gdDiff, r.b2bHome, r.b2bAway, r.progress * r.ratingDiff] },
];

const brier = (p: readonly number[], y: number) => p.reduce((sum, pi, k) => sum + (pi - Number(k === y)) ** 2, 0);
const logLoss = (p: readonly number[], y: number) => -Math.log(Math.max(1e-15, p[y]!));
/** Ranked probability score over the four ordered outcomes: mean over the 3 cumulative thresholds. */
const rps = (p: readonly number[], y: number) => {
  let cum = 0;
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    cum += p[k]!;
    sum += (cum - Number(y <= k)) ** 2;
  }
  return sum / 3;
};
const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Every test row's predictions per model name, in the same order. */
const testRows = rows.filter((r) => TESTS.includes(r.season));
const predictions = new Map<string, number[][]>([["Elo Model", testRows.map((r) => r.elo)]]);
const coefficients: string[] = [];
for (const variant of VARIANTS) predictions.set(variant.name, []);
const TWO_PART = "Win logit + OT/SO Rate";
predictions.set(TWO_PART, []);
for (const test of TESTS) {
  const train = rows.filter((r) => r.season < test && r.season >= TRAIN_FROM);
  const testing = rows.filter((r) => r.season === test);
  for (const variant of VARIANTS) {
    // Standardise on the training rows only.
    const raw = train.map(variant.features);
    const mu = raw[0]!.map((_, j) => mean(raw.map((x) => x[j]!)));
    const sd = raw[0]!.map((_, j) => Math.sqrt(mean(raw.map((x) => (x[j]! - mu[j]!) ** 2))) || 1);
    const standardise = (x: number[]) => x.map((v, j) => (v - mu[j]!) / sd[j]!);
    const params = fit(raw.map(standardise), train.map((r) => r.y));
    predictions.get(variant.name)!.push(...testing.map((r) => probabilities(params, standardise(variant.features(r)))));
    coefficients.push(
      `${test} ${variant.name.padEnd(20)} n=${train.length}  cuts ${cutsOf(params).map((c) => c.toFixed(3)).join(" ")}  β/sd ${params
        .slice(3)
        .map((b, j) => (b / sd[j]!).toExponential(2))
        .join(" ")}`,
    );
  }
  // Two-part: P(home win) from a binary logistic on the full feature set, split by the in-Season OT/SO Rate as the
  // Elo Model does (the Elo row's own OT/SO share is that rate).
  const full = VARIANTS[2]!.features;
  const raw = train.map(full);
  const mu = raw[0]!.map((_, j) => mean(raw.map((x) => x[j]!)));
  const sd = raw[0]!.map((_, j) => Math.sqrt(mean(raw.map((x) => (x[j]! - mu[j]!) ** 2))) || 1);
  const standardise = (x: number[]) => x.map((v, j) => (v - mu[j]!) / sd[j]!);
  const params = fit(raw.map(standardise), train.map((r) => r.y), winNegLogLik, 1);
  predictions.get(TWO_PART)!.push(
    ...testing.map((r) => {
      const p = winProbability(params, standardise(full(r)));
      const o = r.elo[1]! + r.elo[2]!;
      return [(1 - p) * (1 - o), (1 - p) * o, p * o, p * (1 - o)];
    }),
  );
}

// --- Report ---

const lines: string[] = [];
const say = (line = "") => lines.push(line);
say(`Headroom check (PROTOTYPE): ${testRows.length} test Games, ${TESTS.join(", ")}; training from ${TRAIN_FROM}; Prior Games ${PRIOR_GAMES}`);
say();
say("Pooled and per-Season mean per-Game scores (lower is better)");
say(`${"model".padEnd(22)}${"Brier".padStart(9)}${"LogLoss".padStart(9)}${"RPS".padStart(9)}   ${TESTS.map((t) => `Brier ${t}`.padStart(11)).join("")}`);
for (const [name, preds] of predictions) {
  const b = preds.map((p, i) => brier(p, testRows[i]!.y));
  const perSeason = TESTS.map((t) => mean(b.filter((_, i) => testRows[i]!.season === t)));
  say(
    `${name.padEnd(22)}${mean(b).toFixed(4).padStart(9)}${mean(preds.map((p, i) => logLoss(p, testRows[i]!.y))).toFixed(4).padStart(9)}${mean(
      preds.map((p, i) => rps(p, testRows[i]!.y)),
    )
      .toFixed(4)
      .padStart(9)}   ${perSeason.map((x) => x.toFixed(4).padStart(11)).join("")}`,
  );
}

// Paired cluster bootstrap over Swiss match days (Games on one day share the league's state), challenger − Elo.
say();
say("Brier difference vs the Elo Model (negative = better), 95% cluster bootstrap over match days, Seasons better");
const eloBrier = predictions.get("Elo Model")!.map((p, i) => brier(p, testRows[i]!.y));
const clusters = [...new Set(testRows.map((r) => `${r.season} ${r.day}`))];
const clusterOf = testRows.map((r) => clusters.indexOf(`${r.season} ${r.day}`));
for (const variant of [...VARIANTS, { name: TWO_PART }]) {
  const diffs = predictions.get(variant.name)!.map((p, i) => brier(p, testRows[i]!.y) - eloBrier[i]!);
  const sums = new Float64Array(clusters.length);
  const counts = new Float64Array(clusters.length);
  diffs.forEach((d, i) => {
    sums[clusterOf[i]!]! += d;
    counts[clusterOf[i]!]!++;
  });
  const random = seededRandom(141);
  const boot = Array.from({ length: RESAMPLES }, () => {
    let s = 0;
    let n = 0;
    for (let c = 0; c < clusters.length; c++) {
      const pick = Math.floor(random() * clusters.length);
      s += sums[pick]!;
      n += counts[pick]!;
    }
    return s / n;
  }).sort((a, b) => a - b);
  const better = TESTS.filter((t) => mean(diffs.filter((_, i) => testRows[i]!.season === t)) < 0).length;
  say(
    `${variant.name.padEnd(22)}${mean(diffs).toFixed(4).padStart(9)}  [${boot[Math.floor(0.025 * RESAMPLES)]!.toFixed(4)}, ${boot[
      Math.ceil(0.975 * RESAMPLES) - 1
    ]!.toFixed(4)}]  ${better}/${TESTS.length}  (${((100 * mean(diffs)) / mean(eloBrier)).toFixed(2)}%)`,
  );
}

// OT/SO calibration by closeness: does the share of Games reaching OT/SO follow how close the Game is?
say();
say("OT/SO share by closeness (tertiles of |P(home win) − ½| under each model): predicted vs actual");
for (const name of ["Elo Model", "OL + back-to-back", TWO_PART]) {
  const preds = predictions.get(name)!;
  const closeness = preds.map((p) => Math.abs(p[2]! + p[3]! - 0.5));
  const order = closeness.map((_, i) => i).sort((a, b) => closeness[a]! - closeness[b]!);
  const thirds = [0, 1, 2].map((t) => order.slice(Math.floor((t * order.length) / 3), Math.floor(((t + 1) * order.length) / 3)));
  say(
    `${name.padEnd(22)}${thirds
      .map((idx, t) => {
        const predicted = mean(idx.map((i) => preds[i]![1]! + preds[i]![2]!));
        const actual = mean(idx.map((i) => Number(testRows[i]!.y === 1 || testRows[i]!.y === 2)));
        return `${["close", "mid", "lopsided"][t]} ${predicted.toFixed(3)} vs ${actual.toFixed(3)}`;
      })
      .join("   ")}`,
  );
}

say();
say("Back-to-back base rates (all rows): home b2b " + mean(rows.map((r) => r.b2bHome)).toFixed(3) + ", away b2b " + mean(rows.map((r) => r.b2bAway)).toFixed(3));
say();
say("Fitted coefficients per fold (β per raw unit; cuts on the standardised scale)");
for (const line of coefficients) say(line);

console.log(lines.join("\n"));

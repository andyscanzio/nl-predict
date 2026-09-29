import { cutLineFor, type CutLine } from "./cutLines.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";
import type { Game, TeamId } from "./types.ts";

/** Seasons played out by a Season Simulation. */
export const SIMULATION_RUNS = 10_000;

/** A team's chances from a Season Simulation: of finishing in each Cut Line zone, and of finishing 1st. */
export interface CutLineProbabilities {
  playoffs: number;
  playIn: number;
  eliminated: number;
  first: number;
}

/** A team's Season Simulation result: its Cut Line chances, and the Rank Distribution they are summed from. */
export interface SimulationResult {
  probabilities: CutLineProbabilities;
  /** Probability of finishing at each rank of the final table; index 0 is 1st, one entry per team in the Season. */
  rankDistribution: number[];
}

/** 32-bit FNV-1a hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The seed `project()` gives a Season Simulation: the same Match Day (see Projection.matchDay) and model always give the same numbers. */
export function simulationSeed(matchDay: string, modelId: string): number {
  return hash(`${matchDay}|${modelId}`);
}

/** Mulberry32: a small, fast seeded generator of uniform numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixed into the seed for the second generator, the one `sampleOutcomes` draws from. */
const SAMPLE_SEED_MIX = 0x9e3779b9;

/**
 * One Season Simulation run's Outcome Probabilities for the Remaining Games, in their order, drawn with `random` (see
 * ProjectionModel.sampleOutcomes, ADR 0005).
 */
export type OutcomeSampler = (random: () => number) => readonly OutcomeProbabilities[];

/**
 * Season Simulation: plays out every Remaining Game `runs` times (SIMULATION_RUNS unless given) by sampling its Outcome Probabilities, adds the Points
 * to each team's current Points, and ranks each simulated Season with final ties broken at random.
 *
 * Each run draws one number per Game of `drawLayout` (the real Remaining Games; `remainingGames` unless given), in that order, then one per team
 * for the final ties. A Game of `remainingGames` takes the draw at its place in the layout; a layout Game not in `remainingGames` (it has a What-If
 * Result) has its draw skipped, so every other Game draws what it draws in the Real Projection.
 *
 * With `sampleOutcomes`, each run first takes its own Outcome Probabilities from it instead of `outcomes`. The sampler
 * draws from a second generator, seeded from `seed`, so the Games' and ties' draws stay exactly those without it, and a
 * What-If leaves the sampler's draws unchanged too.
 */
export function simulateSeason(
  currentPoints: ReadonlyMap<TeamId, number>,
  remainingGames: readonly Game[],
  outcomes: ReadonlyMap<string, OutcomeProbabilities>,
  seed: number,
  runs: number = SIMULATION_RUNS,
  drawLayout: readonly Game[] = remainingGames,
  sampleOutcomes?: OutcomeSampler,
): Map<TeamId, SimulationResult> {
  const teamIds = [...currentPoints.keys()];
  const indexOf = new Map(teamIds.map((teamId, index) => [teamId, index]));
  const teams = teamIds.length;
  const startingPoints = teamIds.map((teamId) => currentPoints.get(teamId)!);

  // Per Game: home index, away index, then the cumulative thresholds of regulation win, OT/SO win and OT/SO loss.
  const drawIndexOf = new Map(drawLayout.map((game, index) => [game.id, index]));
  const draws = new Float64Array(drawLayout.length);
  const drawAt = Int32Array.from(remainingGames, (game) => drawIndexOf.get(game.id)!);
  const homes = new Int32Array(remainingGames.length);
  const aways = new Int32Array(remainingGames.length);
  const thresholds = new Float64Array(remainingGames.length * 3);
  const setThresholds = (g: number, { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss }: OutcomeProbabilities) => {
    thresholds[3 * g] = regulationWin;
    thresholds[3 * g + 1] = regulationWin + overtimeOrShootoutWin;
    thresholds[3 * g + 2] = regulationWin + overtimeOrShootoutWin + overtimeOrShootoutLoss;
  };
  remainingGames.forEach((game, g) => {
    homes[g] = indexOf.get(game.homeTeamId)!;
    aways[g] = indexOf.get(game.awayTeamId)!;
    setThresholds(g, outcomes.get(game.id)!);
  });

  const random = seededRandom(seed);
  const sampleRandom = seededRandom(seed ^ SAMPLE_SEED_MIX);
  const points = new Float64Array(teams);
  const order = teamIds.map((_, index) => index);
  const rankCounts = teamIds.map(() => new Int32Array(teams));

  for (let run = 0; run < runs; run++) {
    if (sampleOutcomes) sampleOutcomes(sampleRandom).forEach((sampled, g) => setThresholds(g, sampled));
    for (let t = 0; t < teams; t++) points[t] = startingPoints[t]!;
    for (let d = 0; d < draws.length; d++) draws[d] = random();
    for (let g = 0; g < remainingGames.length; g++) {
      const u = draws[drawAt[g]!]!;
      const homePoints =
        u < thresholds[3 * g]! ? 3 : u < thresholds[3 * g + 1]! ? 2 : u < thresholds[3 * g + 2]! ? 1 : 0;
      points[homes[g]!] = points[homes[g]!]! + homePoints;
      points[aways[g]!] = points[aways[g]!]! + 3 - homePoints;
    }
    // Points are whole numbers, so a fraction in [0, 1) breaks ties at random without reordering anyone else.
    for (let t = 0; t < teams; t++) points[t] = points[t]! + random();
    order.sort((a, b) => points[b]! - points[a]!);

    order.forEach((team, index) => rankCounts[team]![index]!++);
  }

  return new Map(
    teamIds.map((teamId, index) => {
      const counts = rankCounts[index]!;
      const zones: Record<CutLine, number> = { playoffs: 0, "play-in": 0, eliminated: 0 };
      counts.forEach((count, rankIndex) => (zones[cutLineFor(rankIndex + 1)] += count));
      return [
        teamId,
        {
          probabilities: {
            playoffs: zones.playoffs / runs,
            playIn: zones["play-in"] / runs,
            eliminated: zones.eliminated / runs,
            first: counts[0]! / runs,
          },
          rankDistribution: Array.from(counts, (count) => count / runs),
        },
      ];
    }),
  );
}

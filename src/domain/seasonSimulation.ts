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
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Season Simulation: plays out every Remaining Game SIMULATION_RUNS times by sampling its Outcome Probabilities, adds the Points
 * to each team's current Points, and ranks each simulated Season with final ties broken at random.
 */
export function simulateSeason(
  currentPoints: ReadonlyMap<TeamId, number>,
  remainingGames: readonly Game[],
  outcomes: ReadonlyMap<string, OutcomeProbabilities>,
  seed: number,
): Map<TeamId, SimulationResult> {
  const teamIds = [...currentPoints.keys()];
  const indexOf = new Map(teamIds.map((teamId, index) => [teamId, index]));
  const teams = teamIds.length;
  const startingPoints = teamIds.map((teamId) => currentPoints.get(teamId)!);

  // Per Game: home index, away index, then the cumulative thresholds of regulation win, OT/SO win and OT/SO loss.
  const homes = new Int32Array(remainingGames.length);
  const aways = new Int32Array(remainingGames.length);
  const thresholds = new Float64Array(remainingGames.length * 3);
  remainingGames.forEach((game, g) => {
    const { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss } = outcomes.get(game.id)!;
    homes[g] = indexOf.get(game.homeTeamId)!;
    aways[g] = indexOf.get(game.awayTeamId)!;
    thresholds[3 * g] = regulationWin;
    thresholds[3 * g + 1] = regulationWin + overtimeOrShootoutWin;
    thresholds[3 * g + 2] = regulationWin + overtimeOrShootoutWin + overtimeOrShootoutLoss;
  });

  const random = seededRandom(seed);
  const points = new Float64Array(teams);
  const order = teamIds.map((_, index) => index);
  const rankCounts = teamIds.map(() => new Int32Array(teams));

  for (let run = 0; run < SIMULATION_RUNS; run++) {
    for (let t = 0; t < teams; t++) points[t] = startingPoints[t]!;
    for (let g = 0; g < remainingGames.length; g++) {
      const u = random();
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
            playoffs: zones.playoffs / SIMULATION_RUNS,
            playIn: zones["play-in"] / SIMULATION_RUNS,
            eliminated: zones.eliminated / SIMULATION_RUNS,
            first: counts[0]! / SIMULATION_RUNS,
          },
          rankDistribution: Array.from(counts, (count) => count / SIMULATION_RUNS),
        },
      ];
    }),
  );
}

import { cutLineFor, type CutLine } from "./cutLines.ts";
import { matchDayOf, predictGames, projectionModelInput, type ProjectionModel } from "./project.ts";
import { projectionHistoryAsOfDates } from "./projectionHistory.ts";
import { simulateSeason, simulationSeed } from "./seasonSimulation.ts";
import type { Game, TeamId } from "./types.ts";

/** A Projection Model with Outcome Probabilities: only these can drive a Season Simulation (ADR 0002). */
export type OutcomesProjectionModel = Extract<ProjectionModel, { kind: "outcomes" }>;

/** One team's Rank Distribution from one forecast point, scored against where the team actually finished. */
export interface SeasonSimulationScore {
  teamId: TeamId;
  /** The Match Day the forecast is as of (see Projection.matchDay), or SEASON_START before the first Game. */
  matchDay: string;
  /** The team's Played Games at the forecast point. */
  gamesPlayed: number;
  /** Mean over ranks 1 to K−1 of the squared difference between the forecast and actual cumulative rank probabilities (K teams); 0 is perfect, 1 the worst. */
  rankRps: number;
  /** Squared error summed over Playoffs, Play-in and Eliminated (0 is perfect, 2 the worst). */
  cutLineBrier: number;
  /** The actual final rank fell in the outer tenths of the Rank Distribution (see inOuterTenths); 20% of forecasts should. */
  outerTenths: boolean;
}

/** The Season Simulation Back-Test of one Projection Model: a row per team at every forecast point, oldest point first. */
export interface SeasonSimulationBackTest {
  model: string;
  rows: SeasonSimulationScore[];
}

const CUT_LINES: readonly CutLine[] = ["playoffs", "play-in", "eliminated"];

/** After every Game in any Season. */
const END_OF_SEASON = new Date(8.64e15);

/**
 * Season Simulation Back-Test: forecasts a complete Season at the Projection History points, without the last, where
 * nothing is left to forecast. At each point every model predicts the Remaining Games and runs the Season Simulation
 * `runs` times, seeded as `project()` seeds it, and each team's Rank Distribution is scored against its rank in the
 * final Current Table.
 */
export function seasonSimulationBackTest(
  games: Game[],
  models: readonly OutcomesProjectionModel[],
  runs: number,
): SeasonSimulationBackTest[] {
  const actualRanks = new Map(projectionModelInput(games, END_OF_SEASON).currentTable.map((row) => [row.teamId, row.rank]));
  const inputs = projectionHistoryAsOfDates(games)
    .slice(0, -1)
    .map((asOf) => {
      const input = projectionModelInput(games, asOf);
      return { input, matchDay: matchDayOf(input.playedGames) };
    });

  return models.map((model) => ({
    model: model.name,
    rows: inputs.flatMap(({ input, matchDay }) => {
      const predictions = predictGames(model, input);
      const simulation = simulateSeason(
        new Map(input.currentTable.map((row) => [row.teamId, row.points])),
        input.remainingGames,
        new Map(input.remainingGames.map((game) => [game.id, predictions.get(game.id)!.outcomes!])),
        simulationSeed(matchDay, model.id),
        runs,
      );
      return input.currentTable.map(({ teamId, gamesPlayed }): SeasonSimulationScore => {
        const { probabilities, rankDistribution } = simulation.get(teamId)!;
        const actualRank = actualRanks.get(teamId)!;
        const actualZone = cutLineFor(actualRank);
        const zoneChances = { playoffs: probabilities.playoffs, "play-in": probabilities.playIn, eliminated: probabilities.eliminated };
        return {
          teamId,
          matchDay,
          gamesPlayed,
          rankRps: rankProbabilityScore(rankDistribution, actualRank),
          cutLineBrier: CUT_LINES.reduce((sum, zone) => sum + (zoneChances[zone] - Number(zone === actualZone)) ** 2, 0),
          outerTenths: inOuterTenths(rankDistribution, actualRank),
        };
      });
    }),
  }));
}

/** Mean over ranks 1 to K−1 of the squared gap between the forecast chance of finishing at or above the rank and the actual 0 or 1. */
function rankProbabilityScore(distribution: readonly number[], actualRank: number): number {
  let cumulative = 0;
  let sum = 0;
  for (let rank = 1; rank < distribution.length; rank++) {
    cumulative += distribution[rank - 1]!;
    sum += (cumulative - Number(rank >= actualRank)) ** 2;
  }
  return sum / (distribution.length - 1);
}

/**
 * Whether the actual rank sits in the outer tenths of the forecast: its mid-point probability integral transform, the
 * forecast chance of finishing above it plus half the chance of finishing at it, is below 0.1 or above 0.9. Unlike the
 * middle 80% of a Rank Distribution, it does not favour a forecast spread over few ranks, so a calibrated forecast
 * spread over many ranks lands in the outer tenths about 20% of the time. A forecast concentrated on a few ranks, as late in
 * the Season, scores lower even when calibrated, because the transform of a discrete distribution is not uniform.
 */
export function inOuterTenths(distribution: readonly number[], actualRank: number): boolean {
  let above = 0;
  for (let rank = 1; rank < actualRank; rank++) above += distribution[rank - 1]!;
  const transform = above + distribution[actualRank - 1]! / 2;
  return transform < 0.1 || transform > 0.9;
}

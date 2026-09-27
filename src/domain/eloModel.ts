import { pointsFor, type PlayedGame } from "./form.ts";
import { outcomesFromExpectedPoints, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/** Every team's Rating at the start of a Season; nothing carries over from previous Seasons. */
export const INITIAL_RATING = 1500;

export interface EloParameters {
  /** How far one Game moves a Rating: K times actual minus expected score. */
  k: number;
  /** Home Advantage: the Rating bonus of the home team. */
  homeAdvantage: number;
}

/** The home team's expected score, its expected share of the Game's 3 Points, from the two Ratings and Home Advantage. */
function expectedHomeScore(homeRating: number, awayRating: number, homeAdvantage: number): number {
  return 1 / (1 + 10 ** ((awayRating - homeRating - homeAdvantage) / 400));
}

/**
 * Every team's Rating after the Played Games, oldest first: each Game moves both Ratings by K times the home team's
 * actual score, its Points ÷ 3, minus its expected score. No margin-of-victory term.
 */
export function eloRatings(
  playedGames: readonly PlayedGame[],
  teamIds: readonly TeamId[],
  { k, homeAdvantage }: EloParameters,
): Map<TeamId, number> {
  const ratings = new Map<TeamId, number>(teamIds.map((teamId) => [teamId, INITIAL_RATING]));
  for (const game of playedGames) {
    const home = ratings.get(game.homeTeamId)!;
    const away = ratings.get(game.awayTeamId)!;
    const change = k * (pointsFor(game, game.homeTeamId) / 3 - expectedHomeScore(home, away, homeAdvantage));
    ratings.set(game.homeTeamId, home + change);
    ratings.set(game.awayTeamId, away - change);
  }
  return ratings;
}

/**
 * Rates every team from the Played Games, then gives each Remaining Game's home team its expected score, from the two
 * Ratings plus Home Advantage, as its expected share of the Game's 3 Points, turned into Outcome Probabilities with the
 * OT/SO Rate (see outcomesFromExpectedPoints).
 */
export function createEloModel(parameters: EloParameters): ProjectionModel {
  return {
    id: "elo",
    name: "Elo Model",
    kind: "outcomes",
    predictOutcomes({ currentTable, playedGames, remainingGames, otsoRate }) {
      const ratings = eloRatings(
        playedGames,
        currentTable.map((row) => row.teamId),
        parameters,
      );
      return new Map<string, OutcomeProbabilities>(
        remainingGames.map((game) => {
          const expected = expectedHomeScore(
            ratings.get(game.homeTeamId)!,
            ratings.get(game.awayTeamId)!,
            parameters.homeAdvantage,
          );
          return [game.id, outcomesFromExpectedPoints(3 * expected, otsoRate)];
        }),
      );
    },
  };
}

/*
 * K and Home Advantage were tuned with the Back-Test: a grid search (K 5–40, Home Advantage 0–150) over the full 2024/25
 * and 2025/26 Regular Seasons (`npm run snapshot -- --season 2024`, `--season 2025`) gave the lowest mean Brier score,
 * 0.6569, at K 15 and Home Advantage 70.
 */

/** K: how far one Game moves a Rating. */
export const ELO_K = 15;

/** Home Advantage, in Rating points. */
export const ELO_HOME_ADVANTAGE = 70;

export const eloModel = createEloModel({ k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE });

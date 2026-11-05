import { ELO_CARRY_OVER, ELO_HOME_ADVANTAGE, ELO_K, eloRatings, expectedHomeScore, INITIAL_RATING, startingRatingsFrom } from "./eloModel.ts";
import { pointsFor, type PlayedGame } from "./form.ts";
import type { TeamId } from "./types.ts";

/** One Regular Season's teams and Played Games, for the warm-up chain. */
export interface WarmUpSeason {
  season: number;
  teamIds: readonly TeamId[];
  playedGames: readonly PlayedGame[];
}

/** The two teams' Ratings from before a Game, and the home team's lead. */
export interface GameRatings {
  homeRating: number;
  awayRating: number;
  /** homeRating − awayRating: the Rating-difference feature, before Home Advantage. */
  ratingDifference: number;
}

/**
 * Runs the Elo chain over the Seasons, oldest first, at the production K, Home Advantage and carry-over, from a level
 * start in the first Season, and returns each team's Rating before every Played Game of every Season, by Game id.
 * A promoted team with no relegated team to take over from starts at the league's lowest Rating, not INITIAL_RATING.
 * Production Starting Ratings (ADR 0004) are separate and unaffected.
 */
export function warmUpChain(seasons: readonly WarmUpSeason[]): Map<string, GameRatings> {
  const parameters = { k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE };
  const rows = new Map<string, GameRatings>();
  let previous: Map<number, number> | undefined;
  for (const { teamIds, playedGames } of [...seasons].sort((a, b) => a.season - b.season)) {
    const ratings =
      previous && startingRatingsFrom(previous, teamIds, ELO_CARRY_OVER, { expansionTeamsStartLowest: true });
    const startingRatings = ratings ?? new Map(teamIds.map((teamId) => [teamId, INITIAL_RATING]));
    const current = new Map(startingRatings);
    for (const game of [...playedGames].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
      const homeRating = current.get(game.homeTeamId)!;
      const awayRating = current.get(game.awayTeamId)!;
      rows.set(game.id, { homeRating, awayRating, ratingDifference: homeRating - awayRating });
      const change = parameters.k * (pointsFor(game, game.homeTeamId) / 3 - expectedHomeScore(homeRating, awayRating, parameters.homeAdvantage));
      current.set(game.homeTeamId, homeRating + change);
      current.set(game.awayTeamId, awayRating - change);
    }
    previous = current;
  }
  return rows;
}

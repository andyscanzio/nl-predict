import type { PlayedGame } from "./form.ts";
import { swissCalendarDay } from "./swissDay.ts";
import type { Game, TeamId } from "./types.ts";

/**
 * The Learned Model's feature hyperparameters. The study tunes them and the weights file records them, so training and
 * serving build the same vector.
 */
export interface LearnedFeatureParameters {
  /** Prior Games shrinking each team's goal difference per Game toward 0. */
  priorGames: number;
  /** A back-to-back flag is set when the team plays on any of this many Swiss days before the Game's: 1 is consecutive days. */
  backToBackDays: number;
  /** The value of both back-to-back flags for a Game with no usable date (a Remaining Game postponed without a new date). */
  undatedBackToBack: number;
}

export const DEFAULT_LEARNED_FEATURE_PARAMETERS: LearnedFeatureParameters = {
  priorGames: 10,
  backToBackDays: 1,
  undatedBackToBack: 0,
};

/**
 * The features, in vector order. The ordered logit's cut points carry the learned intercept (the home advantage), so it
 * is not a column.
 */
export const LEARNED_FEATURE_NAMES = ["ratingDifference", "goalDifference", "homeBackToBack", "awayBackToBack"] as const;

/** The two teams' Elo Ratings from just before the Game, the home side's Home Advantage not added. */
export interface FeatureRatings {
  homeRating: number;
  awayRating: number;
}

const DAY = 86_400_000;

/** The Swiss calendar day `days` before a Swiss calendar day (YYYY-MM-DD). */
function swissDayBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - days * DAY).toISOString().slice(0, 10);
}

/**
 * The Game's feature vector, as of just before it. Only Played Games starting before the Game count, so later Games and
 * Games starting at the same time never leak in; a Game with no usable date sees every Played Game given. A What-If
 * Result enters as a Played Game won by one goal, like any other.
 *
 *  1. Rating difference: home Rating − away Rating, with no Home Advantage added.
 *  2. Goal difference per Game, shrunk toward 0 by Prior Games: home side's − away side's.
 *  3. Home side's back-to-back flag, from the schedule.
 *  4. Away side's back-to-back flag, from the schedule.
 */
export function learnedFeatures(
  game: Game,
  ratings: FeatureRatings,
  playedGames: readonly PlayedGame[],
  schedule: readonly Game[],
  parameters: LearnedFeatureParameters = DEFAULT_LEARNED_FEATURE_PARAMETERS,
): number[] {
  const startsAt = Date.parse(game.startsAt);
  const dated = !Number.isNaN(startsAt);

  const shrunkGoalDifference = (teamId: TeamId) => {
    let total = 0;
    let games = 0;
    for (const played of playedGames) {
      if (dated && !(Date.parse(played.startsAt) < startsAt)) continue;
      const isHome = played.homeTeamId === teamId;
      if (!isHome && played.awayTeamId !== teamId) continue;
      const { homeGoals, awayGoals } = played.result;
      total += isHome ? homeGoals - awayGoals : awayGoals - homeGoals;
      games++;
    }
    return total / (games + parameters.priorGames);
  };

  const backToBack = (teamId: TeamId) => {
    if (!dated) return parameters.undatedBackToBack;
    const day = swissCalendarDay(startsAt);
    const recent = new Set(Array.from({ length: parameters.backToBackDays }, (_, i) => swissDayBefore(day, i + 1)));
    return schedule.some(
      (other) => (other.homeTeamId === teamId || other.awayTeamId === teamId) && recent.has(swissCalendarDay(Date.parse(other.startsAt))),
    )
      ? 1
      : 0;
  };

  return [
    ratings.homeRating - ratings.awayRating,
    shrunkGoalDifference(game.homeTeamId) - shrunkGoalDifference(game.awayTeamId),
    backToBack(game.homeTeamId),
    backToBack(game.awayTeamId),
  ];
}

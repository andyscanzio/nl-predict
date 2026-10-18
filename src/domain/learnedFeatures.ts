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

/**
 * The richer inputs the study screens (rung 4), appended after the base columns when box scores are given, in nested order:
 * regulation goal difference (swapped for goal difference), goal difference over periods 1–2, shot-share difference,
 * special-teams net difference.
 */
export const RICHER_FEATURE_NAMES = [
  "regulationGoalDifference",
  "firstTwoPeriodsGoalDifference",
  "shotShareDifference",
  "specialTeamsNetDifference",
] as const;

/** One side's box-score numbers from a Played Game. A number the source lacks is left out, never 0. */
export interface BoxScoreSide {
  /** Shots on goal. */
  sog?: number;
  /** Power-play goals. */
  ppGoals?: number;
}

/** A Played Game's box score. `scorePerPeriod` holds goals per period, OT/SO last when played, null where a period's score is missing. */
export interface GameBoxScore {
  home: BoxScoreSide;
  away: BoxScoreSide;
  scorePerPeriod: { home: readonly (number | null)[]; away: readonly (number | null)[] };
}

/** Box scores by Game id. A Game without an entry (a What-If Result, or one the source lacks) has no box score. */
export type BoxScores = ReadonlyMap<string, GameBoxScore>;

/** The two teams' Elo Ratings from just before the Game, the home side's Home Advantage not added. */
export interface FeatureRatings {
  homeRating: number;
  awayRating: number;
}

/*
 * The box-score inputs of one side of a Played Game, undefined where the box score lacks a number the input needs. These
 * define the missing-data rule, shared with the study's coverage report.
 */

/** Goals for − goals against over periods 1–2. */
export function firstTwoPeriodsMargin(box: GameBoxScore | undefined, isHome: boolean): number | undefined {
  if (!box) return undefined;
  const [own, other] = isHome ? [box.scorePerPeriod.home, box.scorePerPeriod.away] : [box.scorePerPeriod.away, box.scorePerPeriod.home];
  const [ownFirst, ownSecond, otherFirst, otherSecond] = [own[0], own[1], other[0], other[1]];
  if ([ownFirst, ownSecond, otherFirst, otherSecond].some((goals) => typeof goals !== "number")) return undefined;
  return ownFirst! + ownSecond! - otherFirst! - otherSecond!;
}

/** Shots on goal for / (for + against). */
export function shotShareOf(box: GameBoxScore | undefined, isHome: boolean): number | undefined {
  const [shotsFor, shotsAgainst] = isHome ? [box?.home.sog, box?.away.sog] : [box?.away.sog, box?.home.sog];
  if (shotsFor === undefined || shotsAgainst === undefined || shotsFor + shotsAgainst === 0) return undefined;
  return shotsFor / (shotsFor + shotsAgainst);
}

/** Power-play goals for − against. */
export function powerPlayNetOf(box: GameBoxScore | undefined, isHome: boolean): number | undefined {
  const [goalsFor, goalsAgainst] = isHome ? [box?.home.ppGoals, box?.away.ppGoals] : [box?.away.ppGoals, box?.home.ppGoals];
  if (goalsFor === undefined || goalsAgainst === undefined) return undefined;
  return goalsFor - goalsAgainst;
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
 *
 * With `boxScores`, four richer inputs follow (RICHER_FEATURE_NAMES), each a home − away difference shrunk by Prior Games
 * like goal difference: regulation goal difference (an OT/SO Game counts as 0), goal difference over periods 1–2, shot
 * share (SOG for / (for + against), shrunk toward ½) and special-teams net (power-play goals for − against per Game).
 * A Played Game missing the numbers an input needs is skipped by that input alone: it adds no value and no Game to the
 * team's count, so a gap never counts as 0 and never dilutes the rest. A Game with no box score (a What-If Result, which has
 * none) is skipped by the three box-score inputs and leaves them unmoved; regulation goal difference needs only the result.
 */
export function learnedFeatures(
  game: Game,
  ratings: FeatureRatings,
  playedGames: readonly PlayedGame[],
  schedule: readonly Game[],
  parameters: LearnedFeatureParameters = DEFAULT_LEARNED_FEATURE_PARAMETERS,
  boxScores?: BoxScores,
): number[] {
  const startsAt = Date.parse(game.startsAt);
  const dated = !Number.isNaN(startsAt);

  /**
   * A team's mean of `value` over its Played Games before the Game, shrunk toward `prior` by Prior Games. `value` is read
   * from the team's side and returns undefined where the Game lacks the numbers.
   */
  const shrunkMean = (teamId: TeamId, prior: number, value: (played: PlayedGame, isHome: boolean) => number | undefined) => {
    let total = 0;
    let games = 0;
    for (const played of playedGames) {
      if (dated && !(Date.parse(played.startsAt) < startsAt)) continue;
      const isHome = played.homeTeamId === teamId;
      if (!isHome && played.awayTeamId !== teamId) continue;
      const v = value(played, isHome);
      if (v === undefined) continue;
      total += v;
      games++;
    }
    return (total + parameters.priorGames * prior) / (games + parameters.priorGames);
  };
  const difference = (prior: number, value: (played: PlayedGame, isHome: boolean) => number | undefined) =>
    shrunkMean(game.homeTeamId, prior, value) - shrunkMean(game.awayTeamId, prior, value);

  const margin = ({ result: { homeGoals, awayGoals } }: PlayedGame, isHome: boolean) => (isHome ? homeGoals - awayGoals : awayGoals - homeGoals);

  const backToBack = (teamId: TeamId) => {
    if (!dated) return parameters.undatedBackToBack;
    const day = swissCalendarDay(startsAt);
    const recent = new Set(Array.from({ length: parameters.backToBackDays }, (_, i) => swissDayBefore(day, i + 1)));
    return schedule.some((other) => {
      const otherStart = Date.parse(other.startsAt);
      return (
        !Number.isNaN(otherStart) &&
        (other.homeTeamId === teamId || other.awayTeamId === teamId) &&
        recent.has(swissCalendarDay(otherStart))
      );
    })
      ? 1
      : 0;
  };

  const base = [
    ratings.homeRating - ratings.awayRating,
    difference(0, margin),
    backToBack(game.homeTeamId),
    backToBack(game.awayTeamId),
  ];
  if (!boxScores) return base;

  const boxOf = (played: PlayedGame) => boxScores.get(played.id);
  const regulationMargin = (played: PlayedGame, isHome: boolean) => (played.result.decision === "regulation" ? margin(played, isHome) : 0);
  return [
    ...base,
    difference(0, regulationMargin),
    difference(0, (played, isHome) => firstTwoPeriodsMargin(boxOf(played), isHome)),
    difference(0.5, (played, isHome) => shotShareOf(boxOf(played), isHome)),
    difference(0, (played, isHome) => powerPlayNetOf(boxOf(played), isHome)),
  ];
}

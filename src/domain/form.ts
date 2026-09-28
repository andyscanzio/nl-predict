import type { Decision, Game, GameResult, TeamId } from "./types.ts";

export type PlayedGame = Game & { result: GameResult };

export const FORM_WINDOW_SIZE = 5;

/** A team's most recent Played home and away Games, at most five each, newest first. */
export interface FormWindows {
  home: PlayedGame[];
  away: PlayedGame[];
}

/** Points a team earned from a Played Game. */
export function pointsFor(game: PlayedGame, teamId: TeamId): number {
  const { homeGoals, awayGoals, decision } = game.result;
  const won = (teamId === game.homeTeamId) === homeGoals > awayGoals;
  if (decision === "regulation") return won ? 3 : 0;
  return won ? 2 : 1;
}

/** Points per Game over a Form Window, or null when it is empty. */
export function formOf(window: PlayedGame[], teamId: TeamId): number | null {
  if (window.length === 0) return null;
  return window.reduce((sum, game) => sum + pointsFor(game, teamId), 0) / window.length;
}

/** The Form a team is expected to show at each venue. */
export interface VenueForms {
  home: number;
  away: number;
}

/** Home and Away Form as venue Forms, an empty Form Window (null) taking the other venue's Form, and `fallback` with neither. */
export function venueFormsFrom(homeForm: number | null, awayForm: number | null, fallback: number): VenueForms {
  return { home: homeForm ?? awayForm ?? fallback, away: awayForm ?? homeForm ?? fallback };
}

/** A team's Home and Away Form as venue Forms, with `fallback` for an empty Form Window and no Form at the other venue. */
export function venueFormsOf(windows: FormWindows, teamId: TeamId, fallback: number): VenueForms {
  return venueFormsFrom(formOf(windows.home, teamId), formOf(windows.away, teamId), fallback);
}

/** A Form Window Game seen from one team's side. */
export interface FormWindowGame {
  gameId: string;
  startsAt: string;
  opponentId: TeamId;
  goalsFor: number;
  goalsAgainst: number;
  decision: Decision;
  /** Points the team earned from the Game. */
  points: number;
  /** A What-If Result rather than a real one: its one-goal score is made up, but its Points count toward the Form. */
  whatIf: boolean;
}

export function formWindowGame(game: PlayedGame, teamId: TeamId, whatIf = false): FormWindowGame {
  const isHome = teamId === game.homeTeamId;
  const { homeGoals, awayGoals, decision } = game.result;
  return {
    gameId: game.id,
    startsAt: game.startsAt,
    opponentId: isHome ? game.awayTeamId : game.homeTeamId,
    goalsFor: isHome ? homeGoals : awayGoals,
    goalsAgainst: isHome ? awayGoals : homeGoals,
    decision,
    points: pointsFor(game, teamId),
    whatIf,
  };
}

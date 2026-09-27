import type { Game, GameResult, TeamId } from "./types.ts";

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

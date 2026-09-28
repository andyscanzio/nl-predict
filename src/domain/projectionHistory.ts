import { project, type ProjectionModel } from "./project.ts";
import type { ProjectionModelId } from "./projectionModels.ts";
import { swissCalendarDay, swissDayEnd } from "./swissDay.ts";
import type { Game, TeamId } from "./types.ts";

/** One team's standing in a Projection History point. */
export interface TeamHistoryPoint {
  projectedPoints: number;
  /** Played Games at that point; Low Sample is derived from it. */
  gamesPlayed: number;
  /** Playoff and 1st-place chances from the Season Simulation; null for Points-only models. */
  playoffs: number | null;
  first: number | null;
}

/** The Projection as it stood at the end of one Match Day, keeping only what the history chart needs. */
export interface HistoryPoint {
  /** The Swiss calendar day (YYYY-MM-DD), or SEASON_START for the point before the first Game. */
  matchDay: string;
  teams: Record<TeamId, TeamHistoryPoint>;
}

/** The As-Of Dates of a Season's Projection History points: the start of the Season, then Swiss midnight at the end of every Match Day with a Played Game. */
export function projectionHistoryAsOfDates(games: readonly Game[]): Date[] {
  // The epoch is before every Game, so nothing is Played and the Match Day is SEASON_START.
  return [new Date(0), ...matchDaysPlayed(games).map(swissDayEnd)];
}

/** The Projection History of one model: a point before the first Game, then one for each Match Day with a Played Game, oldest first. */
export type ProjectionHistory = HistoryPoint[];

/** The Projection History of every Projection Model, by model id. */
export type ProjectionHistories = Record<ProjectionModelId, ProjectionHistory>;

/** The Match Days on which at least one Played Game started, oldest first (YYYY-MM-DD). */
function matchDaysPlayed(games: readonly Game[]): string[] {
  const days = new Set<string>();
  for (const game of games) if (game.result) days.add(swissCalendarDay(Date.parse(game.startsAt)));
  return [...days].sort();
}

function pointAsOf(games: Game[], asOf: Date, model: ProjectionModel): HistoryPoint {
  const { matchDay, projectedTable, currentTable } = project(games, asOf, model);
  const gamesPlayed = new Map(currentTable.map((row) => [row.teamId, row.gamesPlayed]));
  const teams: Record<TeamId, TeamHistoryPoint> = {};
  for (const row of projectedTable) {
    teams[row.teamId] = {
      projectedPoints: row.projectedPoints,
      gamesPlayed: gamesPlayed.get(row.teamId)!,
      playoffs: row.probabilities?.playoffs ?? null,
      first: row.probabilities?.first ?? null,
    };
  }
  return { matchDay, teams };
}

/**
 * The Projection History under one model: `project()` as of the start of the Season, then as of Swiss midnight at the end of
 * every Match Day with a Played Game. Each point is labelled with the Match Day `project()` reports, which also seeds its
 * Season Simulation. Given `now` after every Played Game's start, the last point equals the live projection field for field.
 */
export function projectionHistory(games: Game[], model: ProjectionModel): ProjectionHistory {
  return projectionHistoryAsOfDates(games).map((asOf) => pointAsOf(games, asOf, model));
}

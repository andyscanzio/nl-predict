import { matchDayOf, simulationSeedAsOf } from "./matchDay.ts";
import { project, type ProjectionModel } from "./project.ts";
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

/** The Projection History of one model: a point before the first Game, then one for each Match Day with a Played Game, oldest first. */
export type ProjectionHistory = HistoryPoint[];

/** The Match Days on which at least one Played Game started, oldest first (YYYY-MM-DD). */
function matchDaysPlayed(games: readonly Game[]): string[] {
  const days = new Set<string>();
  for (const game of games) if (game.result) days.add(swissCalendarDay(Date.parse(game.startsAt)));
  return [...days].sort();
}

function pointAsOf(games: Game[], asOf: Date, model: ProjectionModel): HistoryPoint {
  const { projectedTable, currentTable } = project(games, asOf, model, simulationSeedAsOf(games, asOf, model.id));
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
  return { matchDay: matchDayOf(games, asOf), teams };
}

/**
 * The Projection History under one model: `project()` as of the start of the Season, then as of Swiss midnight at the end of
 * every Match Day with a Played Game, each seeded by its Match Day (see simulationSeedAsOf). Given `now` after every Played
 * Game's start, the last point equals the live projection field for field.
 */
export function projectionHistory(games: Game[], model: ProjectionModel): ProjectionHistory {
  // The epoch is before every Game, so nothing is Played and the Match Day is SEASON_START.
  const seasonStart = new Date(0);
  return [seasonStart, ...matchDaysPlayed(games).map(swissDayEnd)].map((asOf) => pointAsOf(games, asOf, model));
}

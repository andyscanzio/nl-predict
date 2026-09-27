import type { Game, Snapshot, Team, TeamId } from "../domain/types.ts";
import { readGames, readMatchDays, readRegularSeasonPhase, readSeason } from "./sihfResponse.ts";

/** Narrows a request for one Season: no phase gives the Season overview, a date (DD.MM.YYYY) gives one match day. */
export interface SihfQuery {
  phase?: string;
  date?: string;
}

/**
 * Fetches one SIHF `results` response, already bound to a Season: the Season overview, the
 * Regular Season's date list, or one match day, depending on the query. The snapshot's only I/O.
 */
export type FetchDay = (query: SihfQuery) => Promise<unknown>;

/**
 * Builds a snapshot of the Season's Regular Season Games.
 * For now it always fetches every match day; `previousSnapshot` is not yet used.
 */
export async function buildSnapshot(
  fetchDay: FetchDay,
  _previousSnapshot: Snapshot | null,
  now: Date,
): Promise<Snapshot> {
  const seasonResponse = await fetchDay({});
  const season = readSeason(seasonResponse);
  const phase = readRegularSeasonPhase(seasonResponse);
  const matchDays = readMatchDays(await fetchDay({ phase }));

  const games = new Map<string, Game>();
  const teams = new Map<TeamId, Team>();
  for (const date of matchDays) {
    const day = readGames(await fetchDay({ phase, date }));
    // Match days are fetched in date order, so a Game listed twice keeps its latest listing.
    for (const game of day.games) games.set(game.id, game);
    for (const team of day.teams) teams.set(team.id, team);
  }

  return {
    season,
    snapshotAt: now.toISOString(),
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    games: [...games.values()].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id),
    ),
  };
}

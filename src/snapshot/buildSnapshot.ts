import type { Game, Snapshot, Team, TeamId } from "../domain/types.ts";
import {
  matchDaySortKey,
  readGames,
  readMatchDays,
  readRegularSeasonPhase,
  readSeason,
} from "./sihfResponse.ts";

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

/** Match days this recent, counted back from the previous refresh or now, are re-fetched; older ones are settled. */
const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const swissDate = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Zurich",
});

/** The match day (DD.MM.YYYY) of an instant, in Swiss local time. */
function matchDayAt(time: number): string {
  return swissDate.format(new Date(time));
}

/**
 * Builds a snapshot of the Season's Regular Season Games, merged into the previous snapshot of the same Season.
 * It always re-reads the Season's date list, re-fetches the match days of the last seven days (counted from the
 * previous snapshot instead, if refreshes lapsed) and fetches any match day the previous snapshot has no Games on;
 * older match days are left alone. Games are keyed by id and a fetched listing replaces the previous one, so a Game
 * rescheduled onto a fetched match day appears once, on its new date. Any unexpected response rejects, producing no
 * snapshot.
 */
export async function buildSnapshot(
  fetchDay: FetchDay,
  previousSnapshot: Snapshot | null,
  now: Date,
): Promise<Snapshot> {
  const seasonResponse = await fetchDay({});
  const season = readSeason(seasonResponse);
  const phase = readRegularSeasonPhase(seasonResponse);
  const matchDays = readMatchDays(await fetchDay({ phase }));

  const previous = previousSnapshot?.season === season ? previousSnapshot : null;
  const games = new Map<string, Game>(previous?.games.map((game) => [game.id, game]));
  const teams = new Map<TeamId, Team>(previous?.teams.map((team) => [team.id, team]));

  const knownDays = new Set(previous?.games.map((game) => matchDayAt(Date.parse(game.startsAt))));
  const lastRefresh = Math.min(now.getTime(), Date.parse(previous?.snapshotAt ?? now.toISOString()));
  const recentFrom = matchDaySortKey(matchDayAt(lastRefresh - RECENT_DAYS * DAY_MS));
  const today = matchDaySortKey(matchDayAt(now.getTime()));
  const isRecent = (date: string) => matchDaySortKey(date) >= recentFrom && matchDaySortKey(date) <= today;

  for (const date of matchDays.filter((date) => !knownDays.has(date) || isRecent(date))) {
    const day = readGames(await fetchDay({ phase, date }));
    // Fetched listings replace previous ones, and match days come in date order, so the latest listing wins.
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

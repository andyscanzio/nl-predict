import type { Decision, Game, Team } from "../domain/types.ts";

/**
 * Readers for the unofficial SIHF data API (`results` alias). The API is undocumented,
 * so every reader validates the shape it relies on and throws on anything unexpected.
 */

export class SihfResponseError extends Error {
  override name = "SihfResponseError";
}

function fail(message: string): never {
  throw new SihfResponseError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FilterEntry {
  name: string;
  alias: string;
  entries?: FilterEntry[];
}

function readFilter(response: unknown, alias: string): { selected: unknown; entries: FilterEntry[] } {
  if (!isRecord(response) || !Array.isArray(response.filters)) fail("response has no filters");
  const filter = response.filters.find((f: unknown) => isRecord(f) && f.alias === alias);
  if (!isRecord(filter) || !Array.isArray(filter.entries)) fail(`response has no ${alias} filter`);
  return { selected: filter.selected, entries: filter.entries as FilterEntry[] };
}

/** The Season selected in a response, by its starting year (the API uses the ending year). */
export function readSeason(response: unknown): number {
  const { selected } = readFilter(response, "Season");
  const endingYear = Number(selected);
  if (!Number.isInteger(endingYear)) fail(`unexpected Season ${JSON.stringify(selected)}`);
  return endingYear - 1;
}

/** The Phase id of the Regular Season, which differs from Season to Season. */
export function readRegularSeasonPhase(response: unknown): string {
  const { entries } = readFilter(response, "Phase");
  const phase = entries.find((entry) => entry.name?.startsWith("Regular Season"));
  if (!phase) fail("Season has no Regular Season phase");
  return phase.alias;
}

/** A match day as DD.MM.YYYY, turned into a key that sorts in date order. */
export function matchDaySortKey(date: string): string {
  return date.split(".").reverse().join("");
}

/** Every match day in the response's Date filter tree (year → month → day), as DD.MM.YYYY, in date order. */
export function readMatchDays(response: unknown): string[] {
  const { entries: years } = readFilter(response, "Date");
  const dates: string[] = [];
  for (const year of years) {
    for (const month of year.entries ?? []) {
      for (const day of month.entries ?? []) {
        const [y, m, d] = [year.alias, month.alias, day.alias].map(Number) as [number, number, number];
        if (![y, m, d].every(Number.isInteger)) fail(`unexpected match day ${year.alias}-${month.alias}-${day.alias}`);
        dates.push(`${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`);
      }
    }
  }
  return dates.sort((a, b) => matchDaySortKey(a).localeCompare(matchDaySortKey(b)));
}

const COLUMNS = ["homeTeam", "awayTeam", "score", "decision", "status", "details"] as const;
type Column = (typeof COLUMNS)[number];

/** Status ids of finished Games: 12 is final, 9 is awaiting official confirmation. */
const FINISHED_STATUS_IDS = new Set([9, 12]);

const DECISIONS: Record<string, Decision> = { "": "regulation", OT: "OT", SO: "SO" };

function readTeam(value: unknown, gameId: string): Team {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.name !== "string" || typeof value.acronym !== "string") {
    fail(`game ${gameId}: unexpected team ${JSON.stringify(value)}`);
  }
  return { id: value.id, name: value.name, acronym: value.acronym };
}

function readGoals(value: unknown, gameId: string): number {
  const goals = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (Number.isNaN(goals)) fail(`game ${gameId}: finished without a score (${JSON.stringify(value)})`);
  return goals;
}

/** The Games (with their teams) of one match day response. Rows are positional; columns come from `header[].alias`. */
export function readGames(response: unknown): { games: Game[]; teams: Team[] } {
  if (!isRecord(response) || !Array.isArray(response.header) || !Array.isArray(response.data)) {
    fail("match day response has no header or data");
  }
  const aliases: unknown[] = response.header.map((column: unknown) => (isRecord(column) ? column.alias : undefined));
  const index = Object.fromEntries(
    COLUMNS.map((column) => {
      const i = aliases.indexOf(column);
      if (i === -1) fail(`match day response has no ${column} column`);
      return [column, i];
    }),
  ) as Record<Column, number>;

  const games: Game[] = [];
  const teams: Team[] = [];
  for (const row of response.data) {
    if (!Array.isArray(row)) fail("match day row is not an array");
    const cell = (column: Column): unknown => row[index[column]];

    const details = cell("details");
    const gameId = isRecord(details) && typeof details.gameId === "string" ? details.gameId : fail("row without gameId");
    const home = readTeam(cell("homeTeam"), gameId);
    const away = readTeam(cell("awayTeam"), gameId);
    teams.push(home, away);

    const status = cell("status");
    if (!isRecord(status) || typeof status.id !== "number" || typeof status.percent !== "number" || typeof status.startDateTime !== "string" || Number.isNaN(Date.parse(status.startDateTime))) {
      fail(`game ${gameId}: unexpected status ${JSON.stringify(status)}`);
    }
    const game: Game = { id: gameId, startsAt: status.startDateTime, homeTeamId: home.id, awayTeamId: away.id };

    const finished = status.percent === 100 && status.canceled !== true;
    if (finished) {
      if (!FINISHED_STATUS_IDS.has(status.id)) fail(`game ${gameId}: unknown finished status id ${status.id}`);
      const score = cell("score");
      if (!isRecord(score)) fail(`game ${gameId}: unexpected score ${JSON.stringify(score)}`);
      const rawDecision = cell("decision");
      const decision = typeof rawDecision === "string" ? DECISIONS[rawDecision] : undefined;
      if (!decision) fail(`game ${gameId}: unknown Decision ${JSON.stringify(rawDecision)}`);
      game.result = {
        homeGoals: readGoals(score.homeTeam, gameId),
        awayGoals: readGoals(score.awayTeam, gameId),
        decision,
      };
    }
    games.push(game);
  }
  return { games, teams };
}

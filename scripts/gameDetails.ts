/**
 * One-time local backfill of per-Game box scores, for screening the Learned Model's richer inputs (#149).
 *
 *   npm run game-details                       every Season in data/local/seasons/ (2017/18 on)
 *   npm run game-details -- --season 2025      one Season
 *
 * Reads the gameIds from the local Season snapshots and fetches SIHF `gameDetail` for each Played Game, then writes
 * data/local/game-details/season-<year>.json, keyed by gameId. A re-run fetches only the Games not yet in the file.
 * Missing or `-` values have no value (the key is left out, never 0). Nothing here touches data/games.json.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import type { Snapshot } from "../src/domain/types.ts";
import { seasonLabel } from "../src/domain/season.ts";

const API = "https://data.sihf.ch/Statistic/api/cms/gameoverview";
const USER_AGENT = "nl-predict/0.1 (+https://github.com/andyscanzio/nl-predict; National League standings projection)";
const DELAY_MS = 400;
const SAVE_EVERY = 50;
const FIRST_SEASON = 2017;

const TEAM_KEYS = ["sog", "ppGoals", "ppOpportunities", "pim", "saves", "shotsAgainst"] as const;
type TeamNumbers = Partial<Record<(typeof TEAM_KEYS)[number], number>>;
type GameDetail = {
  home: TeamNumbers;
  away: TeamNumbers;
  /** Goals per period, OT/SO last when played; null where the period's score is missing. */
  scorePerPeriod: { home: (number | null)[]; away: (number | null)[] };
};

type Table = { header?: { alias?: string }[]; data?: unknown[][] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** SIHF writes numbers as strings and a missing one as "-". */
function toNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (text === "" || text === "-") return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function setIfPresent(into: TeamNumbers, key: keyof TeamNumbers, value: number | undefined) {
  if (value !== undefined) into[key] = value;
}

/** Sum of a goalie column over the team's goalies; absent if any goalie's value is missing. */
function goalieTotal(table: Table | undefined, alias: string): number | undefined {
  const column = table?.header?.findIndex((h) => h.alias === alias) ?? -1;
  const rows = table?.data ?? [];
  if (column < 0 || rows.length === 0) return undefined;
  let total = 0;
  for (const row of rows) {
    const value = toNumber(row[column]);
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

export function readGameDetail(body: unknown): GameDetail {
  if (!isRecord(body)) throw new Error("gameDetail is not an object");
  const stats = Array.isArray(body.stats) ? (body.stats as (Table & { alias?: string })[]) : [];
  const table = (alias: string) => stats.find((t) => t.alias === alias);

  const home: TeamNumbers = {};
  const away: TeamNumbers = {};
  // gameTeamStats has one row per statistic and a home and an away column, named by the statistic in column 0.
  const teamRows = new Map((table("gameTeamStats")?.data ?? []).map((row) => [String(row[0]), row]));
  for (const [label, key] of [
    ["SOG Total", "sog"],
    ["PPG", "ppGoals"],
    ["PP OP", "ppOpportunities"],
    ["PIM Total", "pim"],
  ] as const) {
    const row = teamRows.get(label);
    setIfPresent(home, key, toNumber(row?.[1]));
    setIfPresent(away, key, toNumber(row?.[2]));
  }
  for (const [side, goalies] of [
    [home, table("gameGoalieStatsHome")],
    [away, table("gameGoalieStatsAway")],
  ] as const) {
    setIfPresent(side, "saves", goalieTotal(goalies, "saves"));
    setIfPresent(side, "shotsAgainst", goalieTotal(goalies, "shotsAgainst"));
  }

  const scores = isRecord(body.result) && Array.isArray(body.result.scores) ? (body.result.scores as Record<string, unknown>[]) : [];
  return {
    home,
    away,
    scorePerPeriod: {
      home: scores.map((s) => toNumber(s.homeTeam) ?? null),
      away: scores.map((s) => toNumber(s.awayTeam) ?? null),
    },
  };
}

async function fetchGameDetail(gameId: string): Promise<unknown> {
  const params = new URLSearchParams({
    alias: "gameDetail",
    searchQuery: gameId,
    language: "de",
    callback: "externalStatisticsCallback",
  });
  const response = await fetch(`${API}?${params}`, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  try {
    return JSON.parse(body.slice(body.indexOf("(") + 1, body.lastIndexOf(")")));
  } catch {
    throw new Error(`response is not JSONP: ${body.slice(0, 120)}`);
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function save(path: string, details: Record<string, GameDetail>) {
  const sorted = Object.fromEntries(Object.entries(details).sort(([a], [b]) => a.localeCompare(b)));
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(sorted, null, 1)}\n`);
  await rename(temporary, path);
}

const { values } = parseArgs({ options: { season: { type: "string" } } });
const seasons = values.season
  ? [Number(values.season)]
  : Array.from({ length: 2025 - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
if (!seasons.every(Number.isInteger)) throw new Error(`--season must be the Season's starting year, got ${values.season}`);

await mkdir("data/local/game-details", { recursive: true });
let requests = 0;
let failures = 0;
for (const season of seasons) {
  const snapshot = await readJson<Snapshot>(`data/local/seasons/season-${season}.json`);
  if (!snapshot) throw new Error(`no local snapshot for ${seasonLabel(season)}; run npm run snapshot -- --season ${season} --out data/local/seasons/season-${season}.json`);
  const path = `data/local/game-details/season-${season}.json`;
  const details = (await readJson<Record<string, GameDetail>>(path)) ?? {};
  const played = snapshot.games.filter((game) => game.result);
  const missing = played.filter((game) => !(game.id in details));
  console.log(`${seasonLabel(season)}: ${played.length} Played Games, ${played.length - missing.length} already fetched, ${missing.length} to fetch.`);

  let sinceSave = 0;
  for (const game of missing) {
    if (requests++ > 0) await sleep(DELAY_MS);
    try {
      details[game.id] = readGameDetail(await fetchGameDetail(game.id));
    } catch (error) {
      failures++;
      console.warn(`  ${game.id} (${game.startsAt.slice(0, 10)}): not stored, ${(error as Error).message}`);
      continue;
    }
    if (++sinceSave % SAVE_EVERY === 0) await save(path, details);
  }
  await save(path, details);

  const gaps = played.filter((game) => !(game.id in details)).length;
  const absent = Object.values(details).filter((d) => Object.keys(d.home).length < TEAM_KEYS.length || Object.keys(d.away).length < TEAM_KEYS.length).length;
  console.log(`  wrote ${path}: ${Object.keys(details).length} entries, ${gaps} Played Games without one, ${absent} entries with a missing number.`);
}
if (failures > 0) console.warn(`${failures} Games failed; re-run to retry them.`);

/**
 * Fetches the Season's Regular Season Games from the SIHF data API and writes the snapshot file.
 *
 *   npm run snapshot                          current Season → data/games.json
 *   npm run snapshot -- --season 2025         the 2025/26 Season
 *   npm run snapshot -- --out path/to.json    write somewhere else
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { buildSnapshot, type FetchDay } from "../src/snapshot/buildSnapshot.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { seasonFor, seasonLabel } from "../src/domain/season.ts";

const API = "https://data.sihf.ch/Statistic/api/cms/cache300";
const USER_AGENT = "nl-predict/0.1 (+https://github.com/andyscanzio/nl-predict; National League standings projection)";
const DELAY_MS = 400;

function sihfFetchDay(season: number): FetchDay {
  let requests = 0;
  return async ({ phase, date }) => {
    if (requests++ > 0) await sleep(DELAY_MS);
    // Filter order is Season, Region, Phase, Date; the API names a Season by its ending year.
    const filterQuery = [String(season + 1), ...(phase ? ["all", phase] : []), ...(date ? [date] : [])].join("/");
    const params = new URLSearchParams({
      alias: "results",
      searchQuery: "1//1",
      filterQuery,
      orderBy: "gameLocalTime",
      orderByDescending: "false",
      take: "200",
      filterBy: "Season,Region,Phase,Date",
      callback: "externalStatisticsCallback",
      skip: "-1",
      language: "de",
    });
    const response = await fetch(`${API}?${params}`, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`SIHF ${filterQuery}: HTTP ${response.status}`);
    const body = await response.text();
    // The API answers with JSONP: externalStatisticsCallback({...});
    const json = body.slice(body.indexOf("(") + 1, body.lastIndexOf(")"));
    try {
      return JSON.parse(json);
    } catch {
      throw new Error(`SIHF ${filterQuery}: response is not JSONP: ${body.slice(0, 200)}`);
    }
  };
}

async function readPreviousSnapshot(path: string): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const { values } = parseArgs({
  options: {
    season: { type: "string" },
    out: { type: "string", default: "data/games.json" },
  },
});
const now = new Date();
const season = values.season ? Number(values.season) : seasonFor(now);
if (!Number.isInteger(season)) throw new Error(`--season must be the Season's starting year, got ${values.season}`);

console.log(`Fetching Season ${seasonLabel(season)}…`);
const snapshot = await buildSnapshot(sihfFetchDay(season), await readPreviousSnapshot(values.out), now);
if (snapshot.season !== season) throw new Error(`asked SIHF for Season ${season} but got ${snapshot.season}`);

// Write to a temporary file first so a failed run never leaves a half-written snapshot.
const temporary = `${values.out}.tmp`;
await writeFile(temporary, `${JSON.stringify(snapshot, null, 1)}\n`);
await rename(temporary, values.out);

const played = snapshot.games.filter((game) => game.result).length;
console.log(`Wrote ${values.out}: ${snapshot.games.length} Games (${played} with a result), ${snapshot.teams.length} teams.`);

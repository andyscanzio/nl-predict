/**
 * Writes data/starting-ratings.json: the Elo Model's Starting Ratings for the Season in data/games.json, carried from the
 * Regular Seasons in data/local/seasons/ (ADR 0004). Run by hand once per Season, after snapshotting the Season just
 * ended into data/local/seasons/ and once data/games.json holds the new Season.
 *
 *   npm run starting-ratings                                 Ratings carried through 2022/23–2025/26
 *   npm run starting-ratings -- --seasons 2022,2023,2024,2025,2026
 *
 * Ratings run through every Season in --seasons, oldest first, from a level start: each Season starts from the previous
 * one's end (startingRatingsFrom, with ELO_CARRY_OVER) and moves with ELO_K and ELO_HOME_ADVANTAGE, as the Elo Model does.
 * The first Season should be one with all of today's teams; 2021/22 had 13.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  ELO_CARRY_OVER,
  ELO_HOME_ADVANTAGE,
  ELO_K,
  eloRatings,
  startingRatingsFrom,
  type StartingRatingsFile,
} from "../src/domain/eloModel.ts";
import { projectionModelInput } from "../src/domain/project.ts";
import { seasonLabel } from "../src/domain/season.ts";
import type { Snapshot, TeamId } from "../src/domain/types.ts";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "data/local/seasons" },
    seasons: { type: "string", default: "2022,2023,2024,2025" },
    games: { type: "string", default: "data/games.json" },
    out: { type: "string", default: "data/starting-ratings.json" },
  },
});

const readSnapshot = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Snapshot;
const seasons = values.seasons.split(",").map(Number).sort((a, b) => a - b);
const upcoming = await readSnapshot(values.games);
if (seasons.at(-1)! + 1 !== upcoming.season) {
  throw new Error(`${values.games} holds ${seasonLabel(upcoming.season)}, but the last Season carried is ${seasonLabel(seasons.at(-1)!)}`);
}

const parameters = { k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE };
let ratings: Map<TeamId, number> | undefined;
for (const season of seasons) {
  const snapshot = await readSnapshot(join(values.dir, `season-${season}.json`));
  const teamIds = snapshot.teams.map((team) => team.id);
  const { playedGames, remainingGames } = projectionModelInput(snapshot.games, new Date(8.64e15));
  if (remainingGames.length > 0) throw new Error(`${seasonLabel(season)} has ${remainingGames.length} Games without a result`);
  const startingRatings = ratings && startingRatingsFrom(ratings, teamIds, ELO_CARRY_OVER);
  ratings = eloRatings(playedGames, teamIds, { ...parameters, startingRatings });
}

const starting = startingRatingsFrom(ratings!, upcoming.teams.map((team) => team.id), ELO_CARRY_OVER);
const file: StartingRatingsFile = {
  season: upcoming.season,
  fromSeasons: seasons,
  k: ELO_K,
  homeAdvantage: ELO_HOME_ADVANTAGE,
  carryOver: ELO_CARRY_OVER,
  ratings: upcoming.teams
    .map((team) => ({ teamId: team.id, acronym: team.acronym, rating: Math.round(10 * starting.get(team.id)!) / 10 }))
    .sort((a, b) => b.rating - a.rating),
};
await writeFile(values.out, JSON.stringify(file, null, 2) + "\n");
console.log(`Starting Ratings for ${seasonLabel(upcoming.season)}, carried through ${seasons.map(seasonLabel).join(", ")}:`);
for (const { acronym, rating } of file.ratings) console.log(`  ${acronym.padEnd(6)}${rating.toFixed(1)}`);
console.log(`Wrote ${values.out}`);

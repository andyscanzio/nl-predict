import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlayedGame } from "../src/domain/form.ts";
import type { Snapshot } from "../src/domain/types.ts";
import { warmUpChain, type WarmUpSeason } from "../src/domain/warmUpChain.ts";

/** The first Season of the warm-up chain: the local snapshots start at 2017/18. */
export const WARM_UP_FIRST_SEASON = 2017;

/** Runs the warm-up chain over the local snapshots from 2017/18 through `lastSeason`; the Ratings of each Game by id. */
export async function warmUpRatings(lastSeason: number, dir = "data/local/seasons") {
  const seasons: WarmUpSeason[] = [];
  for (let season = WARM_UP_FIRST_SEASON; season <= lastSeason; season++) {
    const snapshot = JSON.parse(await readFile(join(dir, `season-${season}.json`), "utf8")) as Snapshot;
    seasons.push({
      season,
      teamIds: snapshot.teams.map((team) => team.id),
      playedGames: snapshot.games.filter((game): game is PlayedGame => game.result !== undefined),
    });
  }
  return warmUpChain(seasons);
}

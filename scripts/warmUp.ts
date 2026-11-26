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

/** A Season's Starting Ratings from the warm-up chain: each team's Rating before its first Game. */
export function chainStartingRatings(
  chain: ReadonlyMap<string, { homeRating: number; awayRating: number }>,
  playedGames: readonly PlayedGame[],
): { teamId: number; rating: number }[] {
  const first = new Map<number, number>();
  for (const game of [...playedGames].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const { homeRating, awayRating } = chain.get(game.id)!;
    if (!first.has(game.homeTeamId)) first.set(game.homeTeamId, homeRating);
    if (!first.has(game.awayTeamId)) first.set(game.awayTeamId, awayRating);
  }
  return [...first].map(([teamId, rating]) => ({ teamId, rating }));
}

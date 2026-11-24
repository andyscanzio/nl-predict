import type { Game } from "./types.ts";

/** One hand-listed Abandoned Game: its id and a note saying which Game it was and when it was replayed. */
export interface AbandonedGame {
  id: string;
  note: string;
}

/**
 * The Season's Games: the snapshot's Games without the Abandoned Games, in their order. A listed id that isn't among the Games is
 * ignored. A listed Game with a result is a wrong entry, which would silently delete a Played Game, so it throws.
 */
export function dropAbandonedGames(games: readonly Game[], abandoned: readonly AbandonedGame[]): Game[] {
  const ids = new Set(abandoned.map(({ id }) => id));
  const withResult = games.find((game) => ids.has(game.id) && game.result);
  if (withResult) throw new Error(`Game ${withResult.id} is listed as abandoned but has a result`);
  return games.filter((game) => !ids.has(game.id));
}

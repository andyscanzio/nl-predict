import { isPlayed } from "./project.ts";
import { swissCalendarDay } from "./swissDay.ts";
import type { Game } from "./types.ts";

/** The Match Day of a projection made before any Game has been played. */
export const SEASON_START = "season-start";

/**
 * The Match Day a projection is as of: the latest Swiss calendar day, as of the As-Of Date, on which a Played Game started
 * (YYYY-MM-DD), or SEASON_START before any Game. Remaining Games never count, however late their start.
 */
export function matchDayOf(games: readonly Game[], asOf: Date): string {
  let latest: number | undefined;
  for (const game of games) {
    if (!isPlayed(game, asOf)) continue;
    const startsAt = Date.parse(game.startsAt);
    if (latest === undefined || startsAt > latest) latest = startsAt;
  }
  return latest === undefined ? SEASON_START : swissCalendarDay(latest);
}

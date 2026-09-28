import { LEAGUE_AVERAGE_POINTS_PER_GAME, outcomesFromRates, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/*
 * m was chosen by leave-one-season-out on the 2022/23–2025/26 Regular Seasons: the per-Game Brier score is best at m
 * 4–8 and the Rank RPS at m 13–20, and m = 10 is within 0.0004 and 0.0002 of each best.
 */

/** m: how many Games at the league-average 1.5 Points per Game each team is rated as if it had also played. */
export const SEASON_RATE_PRIOR_GAMES = 10;

/**
 * Each team keeps earning its Points per Game over its Played Games, ignoring venue and opponent strength, shrunk toward
 * the league-average 1.5 as if it had also played SEASON_RATE_PRIOR_GAMES (m) Games at that rate:
 * (Points + 1.5 · m) / (Played Games + m). A team with no Played Games is rated 1.5 by the formula itself. A Game's 3
 * Points are split between the two rates (see outcomesFromRates) through the OT/SO Rate.
 */
export const seasonRate: ProjectionModel<"season-rate"> = {
  id: "season-rate",
  name: "Season Rate",
  kind: "outcomes",
  predictOutcomes({ currentTable, remainingGames, otsoRate }) {
    const rates = new Map<TeamId, number>(
      currentTable.map((row) => [
        row.teamId,
        (row.points + LEAGUE_AVERAGE_POINTS_PER_GAME * SEASON_RATE_PRIOR_GAMES) / (row.gamesPlayed + SEASON_RATE_PRIOR_GAMES),
      ]),
    );
    return new Map<string, OutcomeProbabilities>(
      remainingGames.map((game) => [
        game.id,
        outcomesFromRates(rates.get(game.homeTeamId)!, rates.get(game.awayTeamId)!, otsoRate),
      ]),
    );
  },
};

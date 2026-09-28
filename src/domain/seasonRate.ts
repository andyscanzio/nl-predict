import { LEAGUE_AVERAGE_POINTS_PER_GAME, outcomesFromRates, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/**
 * Each team keeps earning its Points per Game over all its Played Games, ignoring venue and opponent strength; a team
 * with no Played Games counts as the league-average 1.5. A Game's 3 Points are split between the two rates (see
 * outcomesFromRates) through the OT/SO Rate.
 */
export const seasonRate: ProjectionModel<"season-rate"> = {
  id: "season-rate",
  name: "Season Rate",
  kind: "outcomes",
  predictOutcomes({ currentTable, remainingGames, otsoRate }) {
    const rates = new Map<TeamId, number>(
      currentTable.map((row) => [
        row.teamId,
        row.gamesPlayed === 0 ? LEAGUE_AVERAGE_POINTS_PER_GAME : row.points / row.gamesPlayed,
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

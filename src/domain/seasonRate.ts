import { outcomesFromExpectedPoints, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/** Points per Game assumed for a team with no Played Games: half of every Game's 3 Points. */
const LEAGUE_AVERAGE_POINTS_PER_GAME = 1.5;

/**
 * Each team keeps earning its Points per Game over all its Played Games, ignoring venue and opponent strength.
 * A Game's 3 Points can only honour both teams' rates on average, so the home side expects the mean of its own rate and
 * what the away side's rate leaves it: (home rate + (3 − away rate)) / 2. That becomes Outcome Probabilities through the
 * OT/SO Rate (see outcomesFromExpectedPoints).
 */
export const seasonRate: ProjectionModel = {
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
      remainingGames.map((game) => {
        const expectedHomePoints = (rates.get(game.homeTeamId)! + 3 - rates.get(game.awayTeamId)!) / 2;
        return [game.id, outcomesFromExpectedPoints(expectedHomePoints, otsoRate)];
      }),
    );
  },
};

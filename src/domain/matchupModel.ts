import { venueFormsOf, type VenueForms } from "./form.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME, outcomesFromRates, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/**
 * Each Remaining Game weighs the home team's Home Form against the away team's Away Form, splitting the Game's 3 Points
 * between them (see outcomesFromRates) through the OT/SO Rate. An empty Form Window falls back to the team's
 * other-venue Form, as under Split Form Rate; with neither, the league-average 1.5.
 */
export const matchupModel: ProjectionModel = {
  name: "Matchup Model",
  kind: "outcomes",
  predictOutcomes({ formWindows, remainingGames, otsoRate }) {
    const forms = new Map<TeamId, VenueForms>(
      [...formWindows].map(([teamId, windows]) => [
        teamId,
        venueFormsOf(windows, teamId, LEAGUE_AVERAGE_POINTS_PER_GAME),
      ]),
    );
    return new Map<string, OutcomeProbabilities>(
      remainingGames.map((game) => [
        game.id,
        outcomesFromRates(forms.get(game.homeTeamId)!.home, forms.get(game.awayTeamId)!.away, otsoRate),
      ]),
    );
  },
};

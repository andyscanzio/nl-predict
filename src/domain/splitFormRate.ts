import { venueFormsOf, type VenueForms } from "./form.ts";
import type { ExpectedPoints } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/**
 * Each side of a Remaining Game earns its own Form for the venue, ignoring opponents: the home team its Home Form, the
 * away team its Away Form. When one Form Window is empty the other Form stands in for both; with neither, the team
 * earns nothing. The two sides are predicted independently, so a Game need not hand out 3 Points: Points-only.
 */
export const splitFormRate: ProjectionModel = {
  name: "Split Form Rate",
  kind: "points",
  predictPoints({ formWindows, remainingGames }) {
    const forms = new Map<TeamId, VenueForms>(
      [...formWindows].map(([teamId, windows]) => [teamId, venueFormsOf(windows, teamId, 0)]),
    );
    return new Map<string, ExpectedPoints>(
      remainingGames.map((game) => [
        game.id,
        { home: forms.get(game.homeTeamId)!.home, away: forms.get(game.awayTeamId)!.away },
      ]),
    );
  },
};

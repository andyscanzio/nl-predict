import { formOf, venueFormsFrom, type VenueForms } from "./form.ts";
import type { ExpectedPoints } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/**
 * The rate Split Form Rate projects a team's Remaining Games at, per venue: each venue its own Form; an empty Form Window
 * (null) borrows the other venue's Form, or earns 0 with neither.
 */
export function splitFormRatesOf(homeForm: number | null, awayForm: number | null): VenueForms {
  return venueFormsFrom(homeForm, awayForm, 0);
}

/**
 * Each side of a Remaining Game earns its own Form for the venue, ignoring opponents: the home team its Home Form, the
 * away team its Away Form. When one Form Window is empty the other Form stands in for both; with neither, the team
 * earns nothing. The two sides are predicted independently, so a Game need not hand out 3 Points: Points-only.
 */
export const splitFormRate: ProjectionModel<"split-form-rate"> = {
  id: "split-form-rate",
  name: "Split Form Rate",
  kind: "points",
  predictPoints({ formWindows, remainingGames }) {
    const forms = new Map<TeamId, VenueForms>(
      [...formWindows].map(([teamId, windows]) => [teamId, splitFormRatesOf(formOf(windows.home, teamId), formOf(windows.away, teamId))]),
    );
    return new Map<string, ExpectedPoints>(
      remainingGames.map((game) => [
        game.id,
        { home: forms.get(game.homeTeamId)!.home, away: forms.get(game.awayTeamId)!.away },
      ]),
    );
  },
};

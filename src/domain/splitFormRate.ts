import { formOf } from "./form.ts";
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
    const rates = new Map<TeamId, { home: number; away: number }>();
    for (const [teamId, windows] of formWindows) {
      const homeForm = formOf(windows.home, teamId);
      const awayForm = formOf(windows.away, teamId);
      rates.set(teamId, { home: homeForm ?? awayForm ?? 0, away: awayForm ?? homeForm ?? 0 });
    }
    return new Map<string, ExpectedPoints>(
      remainingGames.map((game) => [
        game.id,
        { home: rates.get(game.homeTeamId)!.home, away: rates.get(game.awayTeamId)!.away },
      ]),
    );
  },
};

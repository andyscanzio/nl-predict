import { formOf } from "./form.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/**
 * Current Points + Remaining home Games × Home Form + Remaining away Games × Away Form, ignoring opponents.
 * When one Form Window is empty the other Form stands in for both; with neither, projected Points are current Points.
 */
export const splitFormRate: ProjectionModel = {
  projectPoints({ currentTable, formWindows, remainingGames }) {
    const projected = new Map<TeamId, number>();
    for (const { teamId, points } of currentTable) {
      const windows = formWindows.get(teamId);
      const homeForm = windows ? formOf(windows.home, teamId) : null;
      const awayForm = windows ? formOf(windows.away, teamId) : null;
      const homeRate = homeForm ?? awayForm ?? 0;
      const awayRate = awayForm ?? homeForm ?? 0;
      const remainingHome = remainingGames.filter((game) => game.homeTeamId === teamId).length;
      const remainingAway = remainingGames.filter((game) => game.awayTeamId === teamId).length;
      projected.set(teamId, points + remainingHome * homeRate + remainingAway * awayRate);
    }
    return projected;
  },
};

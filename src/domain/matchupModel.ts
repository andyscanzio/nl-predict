import { pointsFor, venueFormsOf, type FormWindows, type PlayedGame, type VenueForms } from "./form.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME, outcomesFromRates, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/** m: Games at the prior each team is rated as if it had also played at each venue. 0 is the unshrunk model. */
export const MATCHUP_PRIOR_GAMES = 0;

export interface MatchupParameters {
  /** m: Games at the prior each team is rated as if it had also played at each venue; 0 is the unshrunk model. */
  priorGames: number;
  /** League home Points per Game; away is 3 minus it. 1.5 gives the flat control. */
  homePointsPerGame: number;
  /** "league": shrink toward the venue average. */
  centre: "league";
}

/** A team's Points per Game over a Form Window, shrunk toward `prior` as if it had also played `priorGames` Games there. */
function shrunkForm(window: PlayedGame[], teamId: TeamId, prior: number, priorGames: number): number {
  const points = window.reduce((sum, game) => sum + pointsFor(game, teamId), 0);
  return (points + prior * priorGames) / (window.length + priorGames);
}

/**
 * Each Remaining Game weighs the home team's Home Form against the away team's Away Form, splitting the Game's 3 Points
 * between them (see outcomesFromRates) through the OT/SO Rate.
 *
 * With priorGames (m) 0, the Forms are raw: an empty Form Window falls back to the team's other-venue Form, as under
 * Split Form Rate, and with neither to the league-average 1.5; homePointsPerGame and centre have no effect. With
 * priorGames above 0, each venue's rate is shrunk toward the league's Points per Game there, homePointsPerGame at home
 * and 3 minus it away, as if the team had also played m Games at that rate: (Points + prior · m) / (Games + m). An empty
 * Form Window is then exactly the prior, and the other-venue fallback is not used.
 */
export function createMatchupModel({ priorGames, homePointsPerGame }: MatchupParameters): ProjectionModel<"matchup"> {
  const awayPointsPerGame = 3 - homePointsPerGame;
  const venueForms = (windows: FormWindows, teamId: TeamId): VenueForms =>
    priorGames === 0
      ? venueFormsOf(windows, teamId, LEAGUE_AVERAGE_POINTS_PER_GAME)
      : {
          home: shrunkForm(windows.home, teamId, homePointsPerGame, priorGames),
          away: shrunkForm(windows.away, teamId, awayPointsPerGame, priorGames),
        };
  return {
    id: "matchup",
    name: "Matchup Model",
    kind: "outcomes",
    predictOutcomes({ formWindows, remainingGames, otsoRate }) {
      const forms = new Map<TeamId, VenueForms>(
        [...formWindows].map(([teamId, windows]) => [teamId, venueForms(windows, teamId)]),
      );
      return new Map<string, OutcomeProbabilities>(
        remainingGames.map((game) => [
          game.id,
          outcomesFromRates(forms.get(game.homeTeamId)!.home, forms.get(game.awayTeamId)!.away, otsoRate),
        ]),
      );
    },
  };
}

/** The shipped model: unshrunk, so the centre and home average are moot. */
export const matchupModel = createMatchupModel({
  priorGames: MATCHUP_PRIOR_GAMES,
  homePointsPerGame: LEAGUE_AVERAGE_POINTS_PER_GAME,
  centre: "league",
});

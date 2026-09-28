import { pointsFor, venueFormsOf, type FormWindows, type PlayedGame, type VenueForms } from "./form.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME, outcomesFromRates, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import { SEASON_RATE_PRIOR_GAMES, shrunkSeasonRate } from "./seasonRate.ts";
import type { TeamId } from "./types.ts";

/** m: Games at the prior each team is rated as if it had also played at each venue. 0 is the unshrunk model. */
export const MATCHUP_PRIOR_GAMES = 0;

export interface MatchupParameters {
  /** m: Games at the prior each team is rated as if it had also played at each venue; 0 is the unshrunk model. */
  priorGames: number;
  /** League home Points per Game; away is 3 minus it. 1.5 gives the flat control. */
  homePointsPerGame: number;
  /**
   * "league": shrink toward the venue average. "team": toward the team's Season Rate (shrunk with
   * SEASON_RATE_PRIOR_GAMES) plus (homePointsPerGame − 1.5) at home and minus it away.
   */
  centre: "league" | "team";
}

/** League home Points per Game over Played Games, for MatchupParameters.homePointsPerGame: the league-average 1.5 with none. */
export function leagueHomePointsPerGame(playedGames: readonly PlayedGame[]): number {
  if (playedGames.length === 0) return LEAGUE_AVERAGE_POINTS_PER_GAME;
  return playedGames.reduce((sum, game) => sum + pointsFor(game, game.homeTeamId), 0) / playedGames.length;
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
 * priorGames above 0, each venue's rate is shrunk toward a prior as if the team had also played m Games at it:
 * (Points + prior · m) / (Games + m). An empty Form Window is then exactly the prior, and the other-venue fallback is
 * not used. With the league centre the prior is the league's Points per Game there, homePointsPerGame at home and 3
 * minus it away. With the team centre it is the team's own shrunk Season Rate, offset by homePointsPerGame − 1.5 at home
 * and minus that away, so the home average still tilts it.
 */
export function createMatchupModel({ priorGames, homePointsPerGame, centre }: MatchupParameters): ProjectionModel<"matchup"> {
  const homeOffset = homePointsPerGame - LEAGUE_AVERAGE_POINTS_PER_GAME;
  const venueForms = (windows: FormWindows, teamId: TeamId, seasonRate: number): VenueForms => {
    if (priorGames === 0) return venueFormsOf(windows, teamId, LEAGUE_AVERAGE_POINTS_PER_GAME);
    const [homePrior, awayPrior] =
      centre === "team"
        ? [seasonRate + homeOffset, seasonRate - homeOffset]
        : [homePointsPerGame, 3 - homePointsPerGame];
    return {
      home: shrunkForm(windows.home, teamId, homePrior, priorGames),
      away: shrunkForm(windows.away, teamId, awayPrior, priorGames),
    };
  };
  return {
    id: "matchup",
    name: "Matchup Model",
    kind: "outcomes",
    predictOutcomes({ formWindows, currentTable, remainingGames, otsoRate }) {
      const seasonRates = new Map<TeamId, number>(
        currentTable.map((row) => [row.teamId, shrunkSeasonRate(row.points, row.gamesPlayed, SEASON_RATE_PRIOR_GAMES)]),
      );
      const forms = new Map<TeamId, VenueForms>(
        [...formWindows].map(([teamId, windows]) => [teamId, venueForms(windows, teamId, seasonRates.get(teamId)!)]),
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

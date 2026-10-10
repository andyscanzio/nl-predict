import type { OutcomeProbabilities } from "./outcomes.ts";
import type { Game, TeamId } from "./types.ts";

/**
 * The Outcome Probabilities of every ordered pair of teams, by home team then away team, so the Post-Season can decide
 * pairings that never meet in a Remaining Game.
 */
export type PairingOutcomes = ReadonlyMap<TeamId, ReadonlyMap<TeamId, OutcomeProbabilities>>;

/** The id of the synthetic Game in which `homeTeamId` hosts `awayTeamId`; never a real Game's id. */
export function pairingGameId(homeTeamId: TeamId, awayTeamId: TeamId): string {
  return `pairing:${homeTeamId}-${awayTeamId}`;
}

/**
 * One synthetic Game per ordered pair of `teamIds`, for a Projection Model to predict along with the Remaining Games.
 * They are never scheduled (an empty start) and never Remaining Games: they only carry a pairing to the model.
 */
export function pairingGames(teamIds: readonly TeamId[]): Game[] {
  return teamIds.flatMap((homeTeamId) =>
    teamIds
      .filter((awayTeamId) => awayTeamId !== homeTeamId)
      .map((awayTeamId) => ({ id: pairingGameId(homeTeamId, awayTeamId), startsAt: "", homeTeamId, awayTeamId })),
  );
}

/** Every pairing's Outcome Probabilities, picked out of a model's predictions that include `pairingGames(teamIds)`. */
export function pairingOutcomesOf(
  teamIds: readonly TeamId[],
  outcomeOf: (gameId: string) => OutcomeProbabilities,
): PairingOutcomes {
  return new Map(
    teamIds.map((home) => [
      home,
      new Map(teamIds.filter((away) => away !== home).map((away) => [away, outcomeOf(pairingGameId(home, away))])),
    ]),
  );
}

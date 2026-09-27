import type { PlayedGame } from "./form.ts";

/** Used as the OT/SO Rate until enough Games are Played to measure it: roughly the National League's long-run share. */
export const FALLBACK_OTSO_RATE = 0.23;

/** Played Games needed before the OT/SO Rate is measured rather than assumed. */
export const OTSO_RATE_MIN_GAMES = 20;

/** The OT/SO Rate: the share of Played Games decided in overtime or a shootout, or the fallback while too few are Played. */
export function otsoRate(playedGames: readonly PlayedGame[]): number {
  if (playedGames.length < OTSO_RATE_MIN_GAMES) return FALLBACK_OTSO_RATE;
  const decidedLate = playedGames.filter((game) => game.result.decision !== "regulation").length;
  return decidedLate / playedGames.length;
}

/** Points per Game assumed for a team with nothing to measure it from: half of every Game's 3 Points. */
export const LEAGUE_AVERAGE_POINTS_PER_GAME = 1.5;

/** Outcome Probabilities for one Game, from the home team's side; they sum to 1. */
export interface OutcomeProbabilities {
  regulationWin: number;
  overtimeOrShootoutWin: number;
  overtimeOrShootoutLoss: number;
  regulationLoss: number;
}

/** The Points each side of one Game is expected to earn. */
export interface ExpectedPoints {
  home: number;
  away: number;
}

/** Expected Points of each side under Outcome Probabilities; they always sum to 3. */
export function expectedPointsOf(outcomes: OutcomeProbabilities): ExpectedPoints {
  const { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss, regulationLoss } = outcomes;
  return {
    home: 3 * regulationWin + 2 * overtimeOrShootoutWin + overtimeOrShootoutLoss,
    away: 3 * regulationLoss + 2 * overtimeOrShootoutLoss + overtimeOrShootoutWin,
  };
}

/**
 * The Outcome Probabilities that give the home side `expectedHomePoints`, with Games reaching OT/SO at the OT/SO Rate `o`.
 * A home win probability p yields o + p·(3 − 2o) expected home Points; p is solved from that and clamped to [0, 1],
 * so the home side can expect no less than o and no more than 3 − o.
 */
export function outcomesFromExpectedPoints(expectedHomePoints: number, o: number): OutcomeProbabilities {
  const p = Math.min(1, Math.max(0, (expectedHomePoints - o) / (3 - 2 * o)));
  return {
    regulationWin: p * (1 - o),
    overtimeOrShootoutWin: p * o,
    overtimeOrShootoutLoss: (1 - p) * o,
    regulationLoss: (1 - p) * (1 - o),
  };
}

/**
 * The Outcome Probabilities of a Game between a home side expected to earn `homeRate` Points and an away side expected to
 * earn `awayRate`. A Game's 3 Points can only honour both rates on average, so the home side expects the mean of its own
 * rate and what the away side's rate leaves it: (home rate + (3 − away rate)) / 2.
 */
export function outcomesFromRates(homeRate: number, awayRate: number, o: number): OutcomeProbabilities {
  return outcomesFromExpectedPoints((homeRate + 3 - awayRate) / 2, o);
}

import type { OutcomeProbabilities } from "./outcomes.ts";
import type { TeamId } from "./types.ts";

/**
 * The Post-Season's format rules (CONTEXT.md, Post-Season; ADR 0006): the Play-In and the Playoffs, from a final Regular
 * Season ranking and the chance that one team, at home, beats another. It knows nothing of Projection Models or Games.
 */

/** The chance that the first team, at home, beats the second in a Post-Season Game. */
export type HomeWinChance = (home: TeamId, away: TeamId) => number;

/** A Post-Season Game's home win chance: overtime is sudden death with no shootout, so every OT/SO win is a win. */
export function postSeasonGameWinChance(outcomes: OutcomeProbabilities): number {
  return outcomes.regulationWin + outcomes.overtimeOrShootoutWin;
}

/** A team's chance of winning a Play-In tie, played as one Game on neutral ice: the mean of its home and away chances. */
export function playInTieChance(team: TeamId, opponent: TeamId, homeWin: HomeWinChance): number {
  return (homeWin(team, opponent) + 1 - homeWin(opponent, team)) / 2;
}

/**
 * The better-ranked team's chance of winning a best-of-seven series, hosting Games 1, 3, 5 and 7: it wins each home
 * Game with `homeChance` and each away Game with `awayChance`. Playing all seven Games gives the same winner, so it is
 * the chance of winning at least four of them.
 */
export function bestOfSevenChance(homeChance: number, awayChance: number): number {
  // wins[w]: the chance of w wins so far.
  let wins = [1];
  for (let game = 0; game < 7; game++) {
    const p = game % 2 === 0 ? homeChance : awayChance;
    wins = [...wins, 0].map((_, w) => (wins[w] ?? 0) * (1 - p) + (wins[w - 1] ?? 0) * p);
  }
  return wins.slice(4).reduce((sum, chance) => sum + chance, 0);
}

/** One Post-Season tie: the better-ranked team, the other, and who goes through. */
export interface Tie {
  higher: TeamId;
  lower: TeamId;
  winner: TeamId;
}

/** A Projected Bracket tie also carries its favourite's chance of winning it; the favourite is the winner. */
export interface ProjectedTie extends Tie {
  favouriteChance: number;
}

/** Every tie of one Post-Season, in the order they are played, and its Champion. */
export interface Bracket<T extends Tie = Tie> {
  playIn: { sevenEight: T; nineTen: T; decider: T };
  /** Seed 1 v 8, 2 v 7, 3 v 6, 4 v 5. */
  quarterfinals: T[];
  /** Best remaining v worst, then the other two. */
  semifinals: T[];
  final: T;
  champion: TeamId;
}

/** The Play-In and the Playoffs as they would go if the Regular Season finished exactly as the Projected Table. */
export type ProjectedBracket = Bracket<ProjectedTie>;

/** How a tie between `higher` (better-ranked) and `lower` is decided; a series is best-of-seven, else a Play-In tie. */
export type DecideTie<T extends Tie> = (higher: TeamId, lower: TeamId, series: boolean) => T;

/**
 * Plays the Post-Season from a final Regular Season ranking (best first; only ranks 1–10 count), deciding each tie with
 * `decide`. The two Play-In qualifiers become seeds 7 and 8 in Regular Season order, and the Playoffs are re-paired by
 * Regular Season rank before every round, best remaining against worst remaining.
 */
export function playPostSeason<T extends Tie>(ranking: readonly TeamId[], decide: DecideTie<T>): Bracket<T> {
  if (ranking.length < 10) throw new Error(`The Post-Season needs ranks 1–10, got ${ranking.length} teams`);
  const rank = new Map(ranking.map((teamId, index) => [teamId, index + 1]));
  const byRank = (teams: TeamId[]) => teams.toSorted((a, b) => rank.get(a)! - rank.get(b)!);
  const loser = (tie: Tie) => (tie.winner === tie.higher ? tie.lower : tie.higher);
  const at = (r: number) => ranking[r - 1]!;

  const sevenEight = decide(at(7), at(8), false);
  const nineTen = decide(at(9), at(10), false);
  const decider = decide(loser(sevenEight), nineTen.winner, false);

  const round = (teams: TeamId[]) => {
    const seeded = byRank(teams);
    return seeded.slice(0, seeded.length / 2).map((higher, i) => decide(higher, seeded[seeded.length - 1 - i]!, true));
  };
  const quarterfinals = round([...ranking.slice(0, 6), sevenEight.winner, decider.winner]);
  const semifinals = round(quarterfinals.map((tie) => tie.winner));
  const [final] = round(semifinals.map((tie) => tie.winner)) as [T];
  return { playIn: { sevenEight, nineTen, decider }, quarterfinals, semifinals, final, champion: final.winner };
}

/** The better-ranked team's exact chance of winning a tie: a best-of-seven series, or a Play-In tie on neutral ice. */
function higherTieChance(higher: TeamId, lower: TeamId, series: boolean, homeWin: HomeWinChance): number {
  return series ? bestOfSevenChance(homeWin(higher, lower), 1 - homeWin(lower, higher)) : playInTieChance(higher, lower, homeWin);
}

/**
 * The Projected Bracket from a final ranking: each tie's chance is exact, and its favourite (the better-ranked team on
 * an even tie) advances.
 */
export function projectedBracket(ranking: readonly TeamId[], homeWin: HomeWinChance): ProjectedBracket {
  return playPostSeason(ranking, (higher, lower, series) => {
    const higherChance = higherTieChance(higher, lower, series, homeWin);
    return higherChance >= 0.5
      ? { higher, lower, winner: higher, favouriteChance: higherChance }
      : { higher, lower, winner: lower, favouriteChance: 1 - higherChance };
  });
}

/** The Playoff rounds a team can reach, in order: the Quarterfinal, Semifinal and Final, then the title. */
export const PLAYOFF_ROUNDS = ["quarterfinal", "semifinal", "final", "champion"] as const;

/** The furthest a team got in one Post-Season: no Playoff place, or one of PLAYOFF_ROUNDS. */
export type PostSeasonRound = "none" | (typeof PLAYOFF_ROUNDS)[number];

/**
 * A team's Round Chances from a Playoff Simulation: of reaching the Quarterfinal (by Cut Line or through the Play-In),
 * the Semifinal and the Final, and of becoming Champion.
 */
export type RoundChances = Record<(typeof PLAYOFF_ROUNDS)[number], number>;

/**
 * Plays one Post-Season from a final ranking, drawing each tie's winner with its exact chance (one draw of `random` per
 * tie, ten in all), and gives the furthest round every team of `ranking` reached.
 */
export function simulatePostSeason(
  ranking: readonly TeamId[],
  homeWin: HomeWinChance,
  random: () => number,
): Map<TeamId, PostSeasonRound> {
  const bracket = playPostSeason(ranking, (higher, lower, series) => ({
    higher,
    lower,
    winner: random() < higherTieChance(higher, lower, series, homeWin) ? higher : lower,
  }));
  const rounds = new Map<TeamId, PostSeasonRound>(ranking.map((teamId) => [teamId, "none"]));
  const reach = (ties: Tie[], round: PostSeasonRound) => ties.forEach((tie) => rounds.set(tie.higher, round).set(tie.lower, round));
  reach(bracket.quarterfinals, "quarterfinal");
  reach(bracket.semifinals, "semifinal");
  reach([bracket.final], "final");
  rounds.set(bracket.champion, "champion");
  return rounds;
}

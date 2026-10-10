import startingRatingsFile from "../../data/starting-ratings.json" with { type: "json" };
import { pointsFor, type PlayedGame } from "./form.ts";
import { outcomesFromExpectedPoints, type OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/** The league-average Rating: a team's Starting Rating when it has no other. */
export const INITIAL_RATING = 1500;

export interface EloParameters {
  /** How far one Game moves a Rating: K times actual minus expected score. */
  k: number;
  /** Home Advantage: the Rating bonus of the home team. */
  homeAdvantage: number;
  /** Each team's Starting Rating; a team without one starts at INITIAL_RATING. Level when omitted. */
  startingRatings?: ReadonlyMap<TeamId, number>;
  /**
   * Rating Uncertainty σ, in Rating points: each Season Simulation run moves every team's Rating by its own draw from
   * N(0, σ) before playing out the Remaining Games (ADR 0005). None when omitted or 0.
   */
  ratingUncertainty?: number;
  /**
   * The Played Games at which a team's σ has fallen to σ₀/√2: its σ is σ₀·√(n₀/(n₀+n)) after n Played Games, with no
   * floor. Constant σ when omitted or ∞.
   */
  ratingUncertaintyHalfLife?: number;
}

/** A standard normal draw (Box–Muller) from two uniform draws. */
function standardNormal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/**
 * The Season's Starting Ratings from each team's Rating at the end of the previous Season: the carry-over share of its
 * distance from INITIAL_RATING (0 starts everyone level, 1 keeps the Ratings as they were). A promoted team takes the
 * Starting Rating of a relegated team, lowest Rating first; a team added by an expansion starts at INITIAL_RATING.
 */
export function startingRatingsFrom(
  previousRatings: ReadonlyMap<TeamId, number>,
  teamIds: readonly TeamId[],
  carryOver: number,
): Map<TeamId, number> {
  const carried = (rating: number) => INITIAL_RATING + carryOver * (rating - INITIAL_RATING);
  const relegated = [...previousRatings]
    .filter(([teamId]) => !teamIds.includes(teamId))
    .map(([, rating]) => carried(rating))
    .sort((a, b) => a - b);
  return new Map(
    teamIds.map((teamId) => {
      const previous = previousRatings.get(teamId);
      return [teamId, previous === undefined ? (relegated.shift() ?? INITIAL_RATING) : carried(previous)];
    }),
  );
}

/** The home team's expected score, its expected share of the Game's 3 Points, from the two Ratings and Home Advantage. */
export function expectedHomeScore(homeRating: number, awayRating: number, homeAdvantage: number): number {
  return 1 / (1 + 10 ** ((awayRating - homeRating - homeAdvantage) / 400));
}

/**
 * Every team's Rating after the Played Games, oldest first, from its Starting Rating: each Game moves both Ratings by K times the home team's
 * actual score, its Points ÷ 3, minus its expected score. No margin-of-victory term.
 */
export function eloRatings(
  playedGames: readonly PlayedGame[],
  teamIds: readonly TeamId[],
  { k, homeAdvantage, startingRatings }: EloParameters,
): Map<TeamId, number> {
  const ratings = new Map<TeamId, number>(teamIds.map((teamId) => [teamId, startingRatings?.get(teamId) ?? INITIAL_RATING]));
  for (const game of playedGames) {
    const home = ratings.get(game.homeTeamId)!;
    const away = ratings.get(game.awayTeamId)!;
    const change = k * (pointsFor(game, game.homeTeamId) / 3 - expectedHomeScore(home, away, homeAdvantage));
    ratings.set(game.homeTeamId, home + change);
    ratings.set(game.awayTeamId, away - change);
  }
  return ratings;
}

/**
 * Rates every team from the Played Games, then gives each Remaining Game's home team its expected score, from the two
 * Ratings plus Home Advantage, as its expected share of the Game's 3 Points, turned into Outcome Probabilities with the
 * OT/SO Rate (see outcomesFromExpectedPoints). With Rating Uncertainty, each Season Simulation run does the same from
 * Ratings moved by its own draws.
 */
export function createEloModel(parameters: EloParameters): ProjectionModel<"elo"> {
  const { homeAdvantage, ratingUncertainty = 0, ratingUncertaintyHalfLife = Infinity } = parameters;
  return {
    id: "elo",
    name: "Elo Model",
    kind: "outcomes",
    predictOutcomes({ currentTable, playedGames, remainingGames, otsoRate }) {
      const ratings = eloRatings(
        playedGames,
        currentTable.map((row) => row.teamId),
        parameters,
      );
      return new Map<string, OutcomeProbabilities>(
        remainingGames.map((game) => {
          const expected = expectedHomeScore(ratings.get(game.homeTeamId)!, ratings.get(game.awayTeamId)!, homeAdvantage);
          return [game.id, outcomesFromExpectedPoints(3 * expected, otsoRate)];
        }),
      );
    },
    ...(ratingUncertainty > 0 && {
      sampleOutcomes({ currentTable, playedGames, remainingGames, otsoRate }) {
        const teamIds = currentTable.map((row) => row.teamId);
        const ratings = eloRatings(playedGames, teamIds, parameters);
        const indexOf = new Map(teamIds.map((teamId, index) => [teamId, index]));
        const homes = remainingGames.map((game) => indexOf.get(game.homeTeamId)!);
        const aways = remainingGames.map((game) => indexOf.get(game.awayTeamId)!);
        const playedCounts = new Map<TeamId, number>();
        for (const game of playedGames) {
          playedCounts.set(game.homeTeamId, (playedCounts.get(game.homeTeamId) ?? 0) + 1);
          playedCounts.set(game.awayTeamId, (playedCounts.get(game.awayTeamId) ?? 0) + 1);
        }
        // Each team's σ(n) = σ₀·√(n₀/(n₀+n)); exactly σ₀ at n₀ = ∞.
        const sigmas = teamIds.map((teamId) => {
          const n = playedCounts.get(teamId) ?? 0;
          return Number.isFinite(ratingUncertaintyHalfLife)
            ? ratingUncertainty * Math.sqrt(ratingUncertaintyHalfLife / (ratingUncertaintyHalfLife + n))
            : ratingUncertainty;
        });
        const runRatings = new Float64Array(teamIds.length);
        return (random) => {
          // One draw per team, in Current Table order.
          teamIds.forEach((teamId, t) => (runRatings[t] = ratings.get(teamId)! + sigmas[t]! * standardNormal(random)));
          return remainingGames.map((_, g) =>
            outcomesFromExpectedPoints(3 * expectedHomeScore(runRatings[homes[g]!]!, runRatings[aways[g]!]!, homeAdvantage), otsoRate),
          );
        };
      },
    }),
  };
}

/*
 * Tuned by the Starting Rating study (`npm run study:starting-rating`, ADR 0004) with Ratings carried through the 2022/23
 * to 2025/26 Regular Seasons: K, Home Advantage and carry-over by the lowest mean per-Game Brier score over 2023/24 to
 * 2025/26 (0.6502, grid K 1–40, Home Advantage 0–150, carry-over 0–1), then Rating Uncertainty by the lowest pooled Rank
 * RPS over the same Seasons at those values (0.0822, grid 0–100).
 */

/** K: how far one Game moves a Rating. */
export const ELO_K = 10;

/** Home Advantage, in Rating points. */
export const ELO_HOME_ADVANTAGE = 60;

/** The share of its distance from INITIAL_RATING a team keeps from the end of one Season to the start of the next. */
export const ELO_CARRY_OVER = 1;

/** Rating Uncertainty σ of the Season Simulation, in Rating points. */
export const ELO_RATING_UNCERTAINTY = 50;

/** The committed Starting Ratings (`npm run starting-ratings`), regenerated by hand once per Season. */
export interface StartingRatingsFile {
  /** The Season they start, by the year it starts. */
  season: number;
  /** The Seasons the Ratings were carried through, oldest first. */
  fromSeasons: number[];
  k: number;
  homeAdvantage: number;
  carryOver: number;
  ratings: { teamId: TeamId; acronym: string; rating: number }[];
}

export const STARTING_RATINGS: StartingRatingsFile = startingRatingsFile;

export const eloModel = createEloModel({
  k: ELO_K,
  homeAdvantage: ELO_HOME_ADVANTAGE,
  startingRatings: new Map(STARTING_RATINGS.ratings.map(({ teamId, rating }) => [teamId, rating])),
  ratingUncertainty: ELO_RATING_UNCERTAINTY,
});

const levelEloModel = createEloModel({ k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE, ratingUncertainty: ELO_RATING_UNCERTAINTY });

/**
 * The Elo Model's Level Start: every team starts at INITIAL_RATING, with the same K, Home Advantage and Rating Uncertainty.
 * A variant a visitor can switch the Elo Model to, never the Default Model; its own id keeps it apart wherever models are
 * keyed by id (Season Simulation draws, Projection History, the URL).
 */
export const eloLevelStartModel: ProjectionModel<"elo-level"> = { ...levelEloModel, id: "elo-level", name: "Elo Model (Level Start)" };

/**
 * The Elo Model to Back-Test a Season with: the Starting Ratings belong to STARTING_RATINGS.season only, so any other
 * Season starts level, with the same K, Home Advantage and Rating Uncertainty.
 */
export function eloModelFor(season: number): ProjectionModel<"elo"> {
  return season === STARTING_RATINGS.season ? eloModel : levelEloModel;
}

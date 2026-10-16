import learnedWeightsFile from "../../data/learned-weights.json" with { type: "json" };
import { eloRatings } from "./eloModel.ts";
import {
  LEARNED_FEATURE_NAMES,
  learnedFeatures,
  type LearnedFeatureParameters,
} from "./learnedFeatures.ts";
import { linearPredictor, outcomeProbabilitiesOf } from "./orderedLogit.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel } from "./project.ts";
import type { TeamId } from "./types.ts";

/** The committed Learned Model weights (`npm run learned-weights`), refitted by hand once per Season. */
export interface LearnedWeights {
  /** The Season they predict, by the year it starts. */
  season: number;
  /** The Seasons whose Played Games the weights were fitted on, oldest first. */
  fromSeasons: number[];
  /** The Elo parameters and Starting Ratings the Rating-difference feature was fitted against. */
  elo: { k: number; homeAdvantage: number; carryOver: number };
  startingRatings: { teamId: TeamId; rating: number }[];
  /** The feature vector's columns, in order. */
  features: readonly string[];
  featureParameters: LearnedFeatureParameters;
  coefficients: number[];
  cutPoints: [number, number, number];
  /** Strength Uncertainty on the logit scale; 0 for none. */
  tau: number;
}

/**
 * Predicts each Remaining Game's four Outcome Probabilities with an ordered logit on features as of the As-Of Date:
 * the live Elo Model's Ratings (from the weights' Starting Ratings), shrunk goal difference and back-to-back flags.
 * The weights stay frozen within the Season while the features move with every Played Game.
 */
export function createLearnedModel(weights: LearnedWeights): ProjectionModel<"learned"> {
  if (weights.features.join() !== LEARNED_FEATURE_NAMES.join()) {
    throw new Error(`Learned weights are for features ${weights.features.join(", ")}, not ${LEARNED_FEATURE_NAMES.join(", ")}`);
  }
  const startingRatings = new Map(weights.startingRatings.map(({ teamId, rating }) => [teamId, rating]));
  return {
    id: "learned",
    name: "Learned Model",
    kind: "outcomes",
    predictOutcomes({ currentTable, playedGames, remainingGames }) {
      const ratings = eloRatings(
        playedGames,
        currentTable.map((row) => row.teamId),
        { k: weights.elo.k, homeAdvantage: weights.elo.homeAdvantage, startingRatings },
      );
      const schedule = [...playedGames, ...remainingGames];
      return new Map<string, OutcomeProbabilities>(
        remainingGames.map((game) => {
          const features = learnedFeatures(
            game,
            { homeRating: ratings.get(game.homeTeamId)!, awayRating: ratings.get(game.awayTeamId)! },
            playedGames,
            schedule,
            weights.featureParameters,
          );
          return [game.id, outcomeProbabilitiesOf(linearPredictor(weights.coefficients, features), weights.cutPoints)];
        }),
      );
    },
  };
}

export const LEARNED_WEIGHTS: LearnedWeights = learnedWeightsFile as unknown as LearnedWeights;

/** The Learned Model with the committed weights. Not yet in the picker. */
export const learnedModel = createLearnedModel(LEARNED_WEIGHTS);

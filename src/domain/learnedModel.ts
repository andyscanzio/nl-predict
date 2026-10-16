import learnedWeightsFile from "../../data/learned-weights.json" with { type: "json" };
import { eloRatings, standardNormal } from "./eloModel.ts";
import {
  LEARNED_FEATURE_NAMES,
  learnedFeatures,
  type LearnedFeatureParameters,
} from "./learnedFeatures.ts";
import { linearPredictor, outcomeProbabilitiesOf } from "./orderedLogit.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";
import type { ProjectionModel, ProjectionModelInput } from "./project.ts";
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
  /** Strength Uncertainty τ on the logit scale, tuned by `npm run learned-weights`; 0 for none. */
  tau: number;
}

/**
 * Predicts each Remaining Game's four Outcome Probabilities with an ordered logit on features as of the As-Of Date:
 * the live Elo Model's Ratings (from the weights' Starting Ratings), shrunk goal difference and back-to-back flags.
 * The weights stay frozen within the Season while the features move with every Played Game.
 */
export function createLearnedModel(weights: LearnedWeights): Extract<ProjectionModel<"learned">, { kind: "outcomes" }> {
  if (weights.features.join() !== LEARNED_FEATURE_NAMES.join()) {
    throw new Error(`Learned weights are for features ${weights.features.join(", ")}, not ${LEARNED_FEATURE_NAMES.join(", ")}`);
  }
  const startingRatings = new Map(weights.startingRatings.map(({ teamId, rating }) => [teamId, rating]));
  /**
   * Each Remaining Game's linear predictor η, from features as of the As-Of Date. A projection asks for the model's
   * predictions and then its sampler on the same input, so η is kept per input rather than computed twice.
   */
  const etasByInput = new WeakMap<ProjectionModelInput, number[]>();
  const linearPredictors = (input: ProjectionModelInput) => {
    let etas = etasByInput.get(input);
    if (!etas) etasByInput.set(input, (etas = computeLinearPredictors(input)));
    return etas;
  };
  const computeLinearPredictors = ({ currentTable, playedGames, remainingGames }: ProjectionModelInput) => {
    const ratings = eloRatings(
      playedGames,
      currentTable.map((row) => row.teamId),
      { k: weights.elo.k, homeAdvantage: weights.elo.homeAdvantage, startingRatings },
    );
    const schedule = [...playedGames, ...remainingGames];
    return remainingGames.map((game) => {
      const features = learnedFeatures(
        game,
        { homeRating: ratings.get(game.homeTeamId)!, awayRating: ratings.get(game.awayTeamId)! },
        playedGames,
        schedule,
        weights.featureParameters,
      );
      return linearPredictor(weights.coefficients, features);
    });
  };
  return {
    id: "learned",
    name: "Learned Model",
    kind: "outcomes",
    predictOutcomes(input) {
      const etas = linearPredictors(input);
      return new Map<string, OutcomeProbabilities>(
        input.remainingGames.map((game, g) => [game.id, outcomeProbabilitiesOf(etas[g]!, weights.cutPoints)]),
      );
    },
    ...(weights.tau > 0 && {
      sampleOutcomes(input) {
        const { currentTable, remainingGames } = input;
        const etas = linearPredictors(input);
        const indexOf = new Map(currentTable.map((row, index) => [row.teamId, index]));
        const homes = remainingGames.map((game) => indexOf.get(game.homeTeamId)!);
        const aways = remainingGames.map((game) => indexOf.get(game.awayTeamId)!);
        // σ(cut − η) = 1 / (1 + e^η · e^−cut), and e^(η + u_home − u_away) = e^η · e^u_home / e^u_away: per run only the
        // teams need an exp, so a Game costs a few multiplications and divisions, not three logistic evaluations.
        const oddsAtLevel = etas.map(Math.exp);
        const [odds0, odds1, odds2] = weights.cutPoints.map((cut) => Math.exp(-cut)) as [number, number, number];
        const strengthOdds = new Float64Array(currentTable.length);
        return (random) => {
          // One draw per team, in Current Table order.
          for (let t = 0; t < strengthOdds.length; t++) strengthOdds[t] = Math.exp(weights.tau * standardNormal(random));
          return remainingGames.map((_, g) => {
            const odds = (oddsAtLevel[g]! * strengthOdds[homes[g]!]!) / strengthOdds[aways[g]!]!;
            const c0 = 1 / (1 + odds * odds0);
            const c1 = 1 / (1 + odds * odds1);
            const c2 = 1 / (1 + odds * odds2);
            return { regulationLoss: c0, overtimeOrShootoutLoss: c1 - c0, overtimeOrShootoutWin: c2 - c1, regulationWin: 1 - c2 };
          });
        };
      },
    }),
  };
}

export const LEARNED_WEIGHTS: LearnedWeights = learnedWeightsFile as unknown as LearnedWeights;

/** The Learned Model with the committed weights. Not yet in the picker. */
export const learnedModel = createLearnedModel(LEARNED_WEIGHTS);

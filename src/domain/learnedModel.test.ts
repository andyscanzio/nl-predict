import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import currentSnapshot from "../../data/games.json";
import { standardNormal, ELO_CARRY_OVER, ELO_HOME_ADVANTAGE, ELO_K, STARTING_RATINGS } from "./eloModel.ts";
import type { PlayedGame } from "./form.ts";
import { DEFAULT_LEARNED_FEATURE_PARAMETERS, LEARNED_FEATURE_NAMES } from "./learnedFeatures.ts";
import { createLearnedModel, LEARNED_WEIGHTS, type LearnedWeights } from "./learnedModel.ts";
import { outcomeProbabilitiesOf } from "./orderedLogit.ts";
import { expectedPointsOf } from "./outcomes.ts";
import { predictGames, projectionModelInput } from "./project.ts";
import { seededRandom } from "./seasonSimulation.ts";
import type { Game } from "./types.ts";

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

const fixture: LearnedWeights = {
  season: 2026,
  fromSeasons: [2025],
  elo: { k: 10, homeAdvantage: 60, carryOver: 1 },
  startingRatings: [
    { teamId: 1, rating: 1600 },
    { teamId: 2, rating: 1500 },
    { teamId: 3, rating: 1400 },
  ],
  features: LEARNED_FEATURE_NAMES,
  featureParameters: DEFAULT_LEARNED_FEATURE_PARAMETERS,
  coefficients: [0.01, 0.5, -0.2, 0.3],
  cutPoints: [-1, -0.25, 0.5],
  tau: 0,
};

const asOf = new Date("2026-10-01T12:00:00+02:00");
const game = (id: string, homeTeamId: number, awayTeamId: number, startsAt: string): Game => ({ id, homeTeamId, awayTeamId, startsAt });
const played = (id: string, homeTeamId: number, awayTeamId: number, startsAt: string): PlayedGame => ({
  ...game(id, homeTeamId, awayTeamId, startsAt),
  result: { homeGoals: 1, awayGoals: 0, decision: "regulation" },
});

function predict(weights: LearnedWeights, games: Game[]) {
  return predictGames(createLearnedModel(weights), projectionModelInput(games, asOf));
}

describe("createLearnedModel", () => {
  it("is an outcomes model named Learned Model", () => {
    const model = createLearnedModel(fixture);
    expect(model).toMatchObject({ id: "learned", name: "Learned Model", kind: "outcomes" });
  });

  it("gives a fixture weights file known probabilities", () => {
    // No Played Games: Ratings are the Starting Ratings, goal differences 0, and no Game on the day before.
    const predictions = predict(fixture, [game("a", 1, 2, "2026-10-10T19:45:00+02:00"), game("b", 2, 3, "2026-10-11T19:45:00+02:00")]);
    const eta = 0.01 * 100;
    const c = fixture.cutPoints.map((cut) => sigmoid(cut - eta));
    expect(predictions.get("a")!.outcomes).toEqual({
      regulationLoss: expect.closeTo(c[0]!, 10),
      overtimeOrShootoutLoss: expect.closeTo(c[1]! - c[0]!, 10),
      overtimeOrShootoutWin: expect.closeTo(c[2]! - c[1]!, 10),
      regulationWin: expect.closeTo(1 - c[2]!, 10),
    });
    // Team 2, at home in "b", also plays on the 10th: its back-to-back flag is set.
    const eta2 = 0.01 * 100 + -0.2 * 1;
    expect(predictions.get("b")!.outcomes!.regulationWin).toBeCloseTo(1 - sigmoid(fixture.cutPoints[2] - eta2), 10);
  });

  it("sums the four probabilities to 1", () => {
    const games = [game("a", 1, 2, "2026-10-10T19:45:00+02:00"), game("b", 3, 1, "2026-10-11T19:45:00+02:00")];
    for (const { outcomes } of predict(fixture, games).values()) {
      const { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss, regulationLoss } = outcomes!;
      expect(regulationWin + overtimeOrShootoutWin + overtimeOrShootoutLoss + regulationLoss).toBeCloseTo(1, 12);
    }
  });

  it("raises the home win chance with a larger home Rating difference", () => {
    const games = [game("a", 1, 2, "2026-10-10T19:45:00+02:00"), game("b", 3, 2, "2026-10-12T19:45:00+02:00")];
    const predictions = predict(fixture, games);
    // Home Rating minus away: +100 for a, −100 for b
    expect(predictions.get("a")!.outcomes!.regulationWin).toBeGreaterThan(predictions.get("b")!.outcomes!.regulationWin);
  });

  it("moves Ratings with Played Games", () => {
    const remaining = game("r", 2, 3, "2026-10-10T19:45:00+02:00");
    const before = predict(fixture, [remaining]).get("r")!.outcomes!.regulationWin;
    const after = predict(fixture, [played("p", 2, 1, "2026-09-20T19:45:00+02:00"), remaining]).get("r")!.outcomes!.regulationWin;
    expect(after).toBeGreaterThan(before);
  });
});

describe("createLearnedModel: Strength Uncertainty", () => {
  const games = [played("p", 2, 1, "2026-09-20T19:45:00+02:00"), game("a", 1, 2, "2026-10-10T19:45:00+02:00"), game("b", 3, 1, "2026-10-11T19:45:00+02:00")];
  const input = projectionModelInput(games, asOf);
  const samplerOf = (tau: number) => {
    const model = createLearnedModel({ ...fixture, tau });
    if (model.kind !== "outcomes") throw new Error("the Learned Model gives Outcome Probabilities");
    return model.sampleOutcomes?.(input);
  };
  const sampledHomePoints = (tau: number, seed = 5) => {
    const sample = samplerOf(tau)!;
    const random = seededRandom(seed);
    return Array.from({ length: 3000 }, () => sample(random).map((o) => expectedPointsOf(o).home));
  };
  const spread = (values: number[]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  };

  it("has no sampler at τ = 0", () => {
    expect(samplerOf(0)).toBeUndefined();
  });

  it("gives the same draws for the same seed", () => {
    expect(sampledHomePoints(0.3, 9)).toEqual(sampledHomePoints(0.3, 9));
    expect(sampledHomePoints(0.3, 9)).not.toEqual(sampledHomePoints(0.3, 10));
  });

  it("gives one set of Outcome Probabilities per Remaining Game, in order, summing to 1", () => {
    const sets = samplerOf(0.3)!(seededRandom(1));
    expect(sets).toHaveLength(input.remainingGames.length);
    for (const { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss, regulationLoss } of sets) {
      expect(regulationWin + overtimeOrShootoutWin + overtimeOrShootoutLoss + regulationLoss).toBeCloseTo(1, 12);
    }
  });

  it("plays from the model's own Outcome Probabilities at a vanishing τ", () => {
    const predicted = predictGames(createLearnedModel(fixture), input);
    const sets = samplerOf(1e-9)!(seededRandom(7));
    input.remainingGames.forEach((remaining, g) => {
      const expected = predicted.get(remaining.id)!.outcomes!;
      for (const key of ["regulationWin", "overtimeOrShootoutWin", "overtimeOrShootoutLoss", "regulationLoss"] as const) {
        expect(sets[g]![key]).toBeCloseTo(expected[key], 6);
      }
    });
  });

  it("widens the spread of sampled expected home Points with a larger τ", () => {
    const narrow = sampledHomePoints(0.1).map((run) => run[0]!);
    const wide = sampledHomePoints(0.5).map((run) => run[0]!);
    expect(spread(wide)).toBeGreaterThan(2 * spread(narrow));
  });

  it("draws one number per team, so Games sharing a team move together", () => {
    // Games a (1 v 2) and b (3 v 1) share team 1: its draw lifts one and lowers the other.
    const runs = sampledHomePoints(0.5);
    const a = runs.map((run) => run[0]!);
    const b = runs.map((run) => run[1]!);
    const meanA = a.reduce((x, y) => x + y) / a.length;
    const meanB = b.reduce((x, y) => x + y) / b.length;
    const covariance = a.reduce((sum, x, i) => sum + (x - meanA) * (b[i]! - meanB), 0) / a.length;
    expect(covariance).toBeLessThan(0);
  });
});

describe("createLearnedModel: non-proportional OT/SO", () => {
  const closeness: [number, number] = [0.3, -0.2];
  const withCloseness: LearnedWeights = { ...fixture, closeness };
  const games = [played("p", 2, 1, "2026-09-20T19:45:00+02:00"), game("a", 1, 2, "2026-10-10T19:45:00+02:00"), game("b", 3, 1, "2026-10-11T19:45:00+02:00")];
  const input = projectionModelInput(games, asOf);
  const modelOf = (weights: LearnedWeights) => {
    const model = createLearnedModel(weights);
    if (model.kind !== "outcomes") throw new Error("the Learned Model gives Outcome Probabilities");
    return model;
  };

  it("moves the OT/SO cut points with |η|", () => {
    const plain = predictGames(createLearnedModel(fixture), input).get("a")!.outcomes!;
    const moved = predictGames(createLearnedModel(withCloseness), input).get("a")!.outcomes!;
    expect(moved.regulationLoss).toBeCloseTo(plain.regulationLoss, 12);
    expect(moved.overtimeOrShootoutLoss).not.toBeCloseTo(plain.overtimeOrShootoutLoss, 3);
    const { regulationWin, overtimeOrShootoutWin, overtimeOrShootoutLoss, regulationLoss } = moved;
    expect(regulationWin + overtimeOrShootoutWin + overtimeOrShootoutLoss + regulationLoss).toBeCloseTo(1, 12);
  });

  it("recomputes closeness from the shifted η in each Season Simulation run", () => {
    const tau = 0.5;
    const model = modelOf({ ...withCloseness, tau });
    // Replay the draws: one standard normal per team in Current Table order, from the same random stream.
    const sets = model.sampleOutcomes!(input)(seededRandom(3));
    const draws = (() => {
      const random = seededRandom(3);
      return input.currentTable.map(() => standardNormal(random));
    })();
    const indexOf = new Map(input.currentTable.map((row, index) => [row.teamId, index]));
    const base = modelOf({ ...withCloseness, tau: 0 });
    input.remainingGames.forEach((remaining, g) => {
      // η of the Game without shifts, recovered from the first cut point, which closeness leaves alone: P(regulation loss) = σ(c0 − η).
      const p0 = base.predictOutcomes(input).get(remaining.id)!.regulationLoss;
      const eta = fixture.cutPoints[0] - Math.log(p0 / (1 - p0));
      const shifted = eta + tau * (draws[indexOf.get(remaining.homeTeamId)!]! - draws[indexOf.get(remaining.awayTeamId)!]!);
      const expected = outcomeProbabilitiesOf(shifted, fixture.cutPoints, closeness);
      for (const key of ["regulationWin", "overtimeOrShootoutWin", "overtimeOrShootoutLoss", "regulationLoss"] as const) {
        expect(sets[g]![key]).toBeCloseTo(expected[key], 10);
      }
    });
  });

  it("still plays from the model's own Outcome Probabilities at a vanishing τ", () => {
    const predicted = predictGames(createLearnedModel(withCloseness), input);
    const sets = modelOf({ ...withCloseness, tau: 1e-9 }).sampleOutcomes!(input)(seededRandom(7));
    input.remainingGames.forEach((remaining, g) => {
      expect(sets[g]!.overtimeOrShootoutWin).toBeCloseTo(predicted.get(remaining.id)!.outcomes!.overtimeOrShootoutWin, 6);
    });
  });
});

describe("the committed weights file", () => {
  it("is for the Season in data/games.json", () => {
    expect(LEARNED_WEIGHTS.season).toBe(currentSnapshot.season);
  });

  it("records the live Elo parameters and Starting Ratings", () => {
    expect(LEARNED_WEIGHTS.elo).toEqual({ k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE, carryOver: ELO_CARRY_OVER });
    expect(LEARNED_WEIGHTS.startingRatings).toEqual(STARTING_RATINGS.ratings.map(({ teamId, rating }) => ({ teamId, rating })));
  });

  it("has the features the model computes", () => {
    expect(LEARNED_WEIGHTS.features).toEqual(LEARNED_FEATURE_NAMES);
    expect(LEARNED_WEIGHTS.coefficients).toHaveLength(LEARNED_FEATURE_NAMES.length);
  });

  it("is at most about 50 KB", () => {
    expect(statSync(new URL("../../data/learned-weights.json", import.meta.url)).size).toBeLessThanOrEqual(50 * 1024);
  });
});

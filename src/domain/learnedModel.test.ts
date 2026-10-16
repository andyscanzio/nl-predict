import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import currentSnapshot from "../../data/games.json";
import { ELO_CARRY_OVER, ELO_HOME_ADVANTAGE, ELO_K, STARTING_RATINGS } from "./eloModel.ts";
import type { PlayedGame } from "./form.ts";
import { DEFAULT_LEARNED_FEATURE_PARAMETERS, LEARNED_FEATURE_NAMES } from "./learnedFeatures.ts";
import { createLearnedModel, LEARNED_WEIGHTS, type LearnedWeights } from "./learnedModel.ts";
import { predictGames, projectionModelInput } from "./project.ts";
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

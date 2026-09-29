import { describe, expect, it } from "vitest";
import {
  createEloModel,
  ELO_CARRY_OVER,
  ELO_HOME_ADVANTAGE,
  ELO_K,
  eloModel,
  eloModelFor,
  eloRatings,
  INITIAL_RATING,
  STARTING_RATINGS,
  startingRatingsFrom,
} from "./eloModel.ts";
import { expectedPointsOf } from "./outcomes.ts";
import { seededRandom } from "./seasonSimulation.ts";
import currentSnapshot from "../../data/games.json";
import type { PlayedGame } from "./form.ts";
import { predictGames, project, projectionModelInput } from "./project.ts";
import type { Decision, Game } from "./types.ts";

const asOf = new Date("2026-10-01T12:00:00+02:00");

let nextId = 1;
function played(homeTeamId: number, awayTeamId: number, homeGoals: number, awayGoals: number, decision: Decision = "regulation"): PlayedGame {
  return {
    id: String(nextId++),
    startsAt: "2026-09-20T19:45:00+02:00",
    homeTeamId,
    awayTeamId,
    result: { homeGoals, awayGoals, decision },
  };
}

function scheduled(homeTeamId: number, awayTeamId: number): Game {
  return { id: String(nextId++), startsAt: "2026-10-10T19:45:00+02:00", homeTeamId, awayTeamId };
}

function projectedPoints(games: Game[], k: number, homeAdvantage: number) {
  return Object.fromEntries(
    project(games, asOf, createEloModel({ k, homeAdvantage })).projectedTable.map((row) => [row.teamId, row.projectedPoints]),
  );
}

describe("eloRatings", () => {
  it("starts every team level and moves Ratings by K times actual minus expected score", () => {
    // Level Ratings, no Home Advantage: expected 0.5; a regulation win scores 1
    const ratings = eloRatings([played(1, 2, 3, 0)], [1, 2, 3], { k: 30, homeAdvantage: 0 });
    expect(ratings.get(1)).toBeCloseTo(INITIAL_RATING + 15);
    expect(ratings.get(2)).toBeCloseTo(INITIAL_RATING - 15);
    expect(ratings.get(3)).toBe(INITIAL_RATING);
  });

  it("scores an OT/SO loss as a third of a win and expects more of the home team by its Home Advantage", () => {
    // 100 Home Advantage: home expected 1 / (1 + 10^(−100/400)) = 0.640065; an OT loss (1 Point) scores 1/3
    // 30 · (0.333333 − 0.640065) = −9.20196
    const ratings = eloRatings([played(1, 2, 1, 2, "OT")], [1, 2], { k: 30, homeAdvantage: 100 });
    expect(ratings.get(1)).toBeCloseTo(INITIAL_RATING - 9.20196, 4);
    expect(ratings.get(2)).toBeCloseTo(INITIAL_RATING + 9.20196, 4);
  });

  it("updates in order, each Game expected from the Ratings the previous Games left", () => {
    // Game 1: 1 beats 2 → 1515 / 1485. Game 2: 2 beats 1 at home, expected 1 / (1 + 10^(30/400)) = 0.456934
    // 30 · (1 − 0.456934) = 16.29199
    const ratings = eloRatings([played(1, 2, 3, 0), played(2, 1, 4, 1)], [1, 2], { k: 30, homeAdvantage: 0 });
    expect(ratings.get(2)).toBeCloseTo(1485 + 16.29199, 4);
    expect(ratings.get(1)).toBeCloseTo(1515 - 16.29199, 4);
  });

  it("starts each team at its Starting Rating, and a team without one level", () => {
    // 1 at 1600 hosts 2 at 1400, no Home Advantage: expected 1 / (1 + 10^(−200/400)) = 0.759747; a win scores 1
    // 30 · (1 − 0.759747) = 7.20759
    const startingRatings = new Map([
      [1, 1600],
      [2, 1400],
    ]);
    const ratings = eloRatings([played(1, 2, 3, 0)], [1, 2, 3], { k: 30, homeAdvantage: 0, startingRatings });
    expect(ratings.get(1)).toBeCloseTo(1600 + 7.20759, 4);
    expect(ratings.get(2)).toBeCloseTo(1400 - 7.20759, 4);
    expect(ratings.get(3)).toBe(INITIAL_RATING);
  });
});

describe("startingRatingsFrom", () => {
  const previous = new Map([
    [1, 1600],
    [2, 1450],
    [3, 1400],
  ]);

  it("keeps the carry-over share of each team's distance from the league average", () => {
    const starting = startingRatingsFrom(previous, [1, 2, 3], 0.5);
    expect(starting).toEqual(
      new Map([
        [1, 1550],
        [2, 1475],
        [3, 1450],
      ]),
    );
  });

  it("starts every team level at carry-over 0 and keeps the Ratings as they were at 1", () => {
    expect([...startingRatingsFrom(previous, [1, 2, 3], 0).values()]).toEqual([1500, 1500, 1500]);
    expect(startingRatingsFrom(previous, [1, 2, 3], 1)).toEqual(previous);
  });

  it("gives a promoted team the Starting Rating of the team it replaces", () => {
    // 3 is relegated and 4 promoted: 4 takes 3's 1500 + 0.5 · (1400 − 1500)
    const starting = startingRatingsFrom(previous, [1, 2, 4], 0.5);
    expect(starting.get(4)).toBe(1450);
    expect(starting.has(3)).toBe(false);
  });

  it("pairs several promoted teams with the relegated teams from the lowest Rating up", () => {
    const starting = startingRatingsFrom(previous, [1, 5, 4], 1);
    expect(starting.get(5)).toBe(1400);
    expect(starting.get(4)).toBe(1450);
  });

  it("starts a team added by an expansion at the league average", () => {
    const starting = startingRatingsFrom(previous, [1, 2, 3, 4], 0.5);
    expect(starting.get(4)).toBe(INITIAL_RATING);
  });
});

describe("project: Elo Model", () => {
  it("gives the home team its expected score of the Game's 3 Points, Home Advantage included", () => {
    // Level Ratings: 3 · 0.640065 = 1.920195 home Points
    const points = projectedPoints([scheduled(1, 2)], 30, 100);
    expect(points[1]).toBeCloseTo(1.920195, 5);
    expect(points[2]).toBeCloseTo(3 - 1.920195, 5);
  });

  it("predicts from the Ratings the Played Games left", () => {
    // 1 beats 2 → 1515 / 1485; with 2 at home and no Home Advantage, 2 expects 1 / (1 + 10^(30/400)) = 0.456934 of 3
    const points = projectedPoints([played(1, 2, 3, 0), scheduled(2, 1)], 30, 0);
    expect(points[2]).toBeCloseTo(3 * 0.456934, 5);
    expect(points[1]).toBeCloseTo(3 + 3 * (1 - 0.456934), 5);
  });

  it("splits the home team's expected Points into the four Outcome Probabilities with the OT/SO Rate", () => {
    // Level Ratings, 100 Home Advantage: 1.920195 home Points at the fallback OT/SO Rate 0.23 needs a
    // home win probability of (1.920195 − 0.23) / (3 − 0.46) = 0.665431
    const game = scheduled(1, 2);
    const model = createEloModel({ k: 30, homeAdvantage: 100 });
    const { outcomes } = predictGames(model, projectionModelInput([game], asOf)).get(game.id)!;
    expect(outcomes!.regulationWin).toBeCloseTo(0.512382, 5);
    expect(outcomes!.overtimeOrShootoutWin).toBeCloseTo(0.153049, 5);
    expect(outcomes!.overtimeOrShootoutLoss).toBeCloseTo(0.076951, 5);
    expect(outcomes!.regulationLoss).toBeCloseTo(0.257618, 5);
  });

  it("predicts before the first Game from the Starting Ratings", () => {
    // 1 at 1600 hosts 2 at 1400, no Home Advantage: 3 · 0.759747 = 2.279241 home Points
    const game = scheduled(1, 2);
    const model = createEloModel({ k: 30, homeAdvantage: 0, startingRatings: new Map([[1, 1600], [2, 1400]]) });
    const { points } = predictGames(model, projectionModelInput([game], asOf)).get(game.id)!;
    expect(points.home).toBeCloseTo(2.279241, 5);
  });
});

describe("Elo Model: Rating Uncertainty", () => {
  const games = [played(1, 2, 3, 0), scheduled(1, 2), scheduled(2, 3)];
  const input = projectionModelInput(games, asOf);

  it("has no sampler without Rating Uncertainty", () => {
    expect("sampleOutcomes" in createEloModel({ k: 30, homeAdvantage: 0 })).toBe(false);
    expect("sampleOutcomes" in createEloModel({ k: 30, homeAdvantage: 0, ratingUncertainty: 0 })).toBe(false);
  });

  it("draws each run's Outcome Probabilities around the model's own, one set per Remaining Game in order", () => {
    const model = createEloModel({ k: 30, homeAdvantage: 20, ratingUncertainty: 50 });
    if (model.kind !== "outcomes") throw new Error("the Elo Model gives Outcome Probabilities");
    const predicted = model.predictOutcomes(input);
    const sample = model.sampleOutcomes!(input);
    const random = seededRandom(7);
    const runs = Array.from({ length: 4000 }, () => sample(random));
    expect(runs[0]).toHaveLength(input.remainingGames.length);
    expect(runs[0]).not.toEqual(runs[1]);
    input.remainingGames.forEach((game, g) => {
      const meanHomePoints = runs.reduce((sum, run) => sum + expectedPointsOf(run[g]!).home, 0) / runs.length;
      // Symmetric noise on the Rating gap, and the logistic is nearly linear here: the mean stays close to the prediction.
      expect(meanHomePoints).toBeCloseTo(expectedPointsOf(predicted.get(game.id)!).home, 1);
    });
  });

  it("plays from the model's own Outcome Probabilities at a vanishing Rating Uncertainty", () => {
    const model = createEloModel({ k: 30, homeAdvantage: 20, ratingUncertainty: 1e-9 });
    if (model.kind !== "outcomes") throw new Error("the Elo Model gives Outcome Probabilities");
    const predicted = model.predictOutcomes(input);
    const [first] = model.sampleOutcomes!(input)(seededRandom(7));
    expect(first!.regulationWin).toBeCloseTo(predicted.get(input.remainingGames[0]!.id)!.regulationWin, 9);
  });
});

describe("Elo Model: committed Starting Ratings", () => {
  it("were carried with the shipped K, Home Advantage and carry-over", () => {
    expect([STARTING_RATINGS.k, STARTING_RATINGS.homeAdvantage, STARTING_RATINGS.carryOver]).toEqual([ELO_K, ELO_HOME_ADVANTAGE, ELO_CARRY_OVER]);
  });

  it("are for the Season in data/games.json and rate each of its teams (else run npm run starting-ratings)", () => {
    expect(STARTING_RATINGS.season).toBe(currentSnapshot.season);
    expect(STARTING_RATINGS.ratings.map(({ teamId }) => teamId).sort()).toEqual(currentSnapshot.teams.map(({ id }) => id).sort());
  });

  it("apply to their own Season only: a Back-Test of any other starts level", () => {
    expect(eloModelFor(STARTING_RATINGS.season)).toBe(eloModel);
    const game = scheduled(STARTING_RATINGS.ratings[0]!.teamId, STARTING_RATINGS.ratings.at(-1)!.teamId);
    const { points } = predictGames(eloModelFor(STARTING_RATINGS.season - 1), projectionModelInput([game], asOf)).get(game.id)!;
    const level = createEloModel({ k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE });
    expect(points).toEqual(predictGames(level, projectionModelInput([game], asOf)).get(game.id)!.points);
  });
});

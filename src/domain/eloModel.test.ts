import { describe, expect, it } from "vitest";
import { createEloModel, eloRatings, INITIAL_RATING } from "./eloModel.ts";
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
});

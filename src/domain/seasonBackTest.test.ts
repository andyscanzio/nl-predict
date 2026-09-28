import { describe, expect, it } from "vitest";
import type { OutcomeProbabilities } from "./outcomes.ts";
import { SEASON_START, type ProjectionModel } from "./project.ts";
import { inOuterTenths, seasonSimulationBackTest } from "./seasonBackTest.ts";
import type { Game, TeamId } from "./types.ts";

type OutcomesModel = Extract<ProjectionModel, { kind: "outcomes" }>;

const sure = (regulationWin: number, regulationLoss: number): OutcomeProbabilities => ({
  regulationWin,
  overtimeOrShootoutWin: 0,
  overtimeOrShootoutLoss: 0,
  regulationLoss,
});

/** Predicts every Remaining Game with `outcomesOf`, whatever has been played so far. */
function modelOf(id: string, outcomesOf: (game: Game) => OutcomeProbabilities): OutcomesModel {
  return {
    id,
    name: id,
    kind: "outcomes",
    predictOutcomes: ({ remainingGames }) => new Map(remainingGames.map((game) => [game.id, outcomesOf(game)])),
  };
}

/** Knows how the Season ends: forecasts every Game as it was actually played, in regulation. */
function oracle(season: Game[]): OutcomesModel {
  const results = new Map(season.map((game) => [game.id, game.result!]));
  return modelOf("oracle", (game) => {
    const { homeGoals, awayGoals } = results.get(game.id)!;
    return homeGoals > awayGoals ? sure(1, 0) : sure(0, 1);
  });
}

/** A regulation win by the winner, wherever it plays. */
function game(id: string, day: string, home: TeamId, away: TeamId, winner: TeamId): Game {
  return {
    id,
    startsAt: `2026-09-${day}T19:45:00+02:00`,
    homeTeamId: home,
    awayTeamId: away,
    result: winner === home ? { homeGoals: 1, awayGoals: 0, decision: "regulation" } : { homeGoals: 0, awayGoals: 1, decision: "regulation" },
  };
}

/** Team 1 beats teams 2 and 3, team 2 beats team 3: final order 1, 2, 3. One Game on each of three Match Days. */
const threeTeamSeason = [game("a", "20", 1, 2, 1), game("b", "21", 3, 1, 1), game("c", "22", 2, 3, 2)];

/** Team 1 hosts team 2 in the Season's only Game, and wins. */
const twoTeamSeason = [game("only", "20", 1, 2, 1)];
const coinFlip = modelOf("coin-flip", () => sure(0.5, 0.5));

const rowsOf = (result: ReturnType<typeof seasonSimulationBackTest>[number], teamId: TeamId) =>
  result.rows.filter((row) => row.teamId === teamId);

describe("seasonSimulationBackTest", () => {
  it("scores a model that forecasts the final order with certainty as perfect", () => {
    const [result] = seasonSimulationBackTest(threeTeamSeason, [oracle(threeTeamSeason)], 200);
    expect(result!.model).toBe("oracle");
    expect(result!.rows).toHaveLength(9);
    for (const row of result!.rows) {
      expect(row.rankRps).toBe(0);
      expect(row.cutLineBrier).toBe(0);
      expect(row.outerTenths).toBe(false);
    }
  });

  it("forecasts at the Projection History points, without the last", () => {
    const [result] = seasonSimulationBackTest(threeTeamSeason, [oracle(threeTeamSeason)], 10);
    // Before the first Game and at the end of Match Days 1 and 2; nothing is left to forecast after Match Day 3.
    expect(rowsOf(result!, 1).map(({ matchDay, gamesPlayed }) => ({ matchDay, gamesPlayed }))).toEqual([
      { matchDay: SEASON_START, gamesPlayed: 0 },
      { matchDay: "2026-09-20", gamesPlayed: 1 },
      { matchDay: "2026-09-21", gamesPlayed: 2 },
    ]);
    expect(rowsOf(result!, 3).map((row) => row.gamesPlayed)).toEqual([0, 0, 1]);
  });

  it("gives a forecast that splits a two-team Season evenly a Rank RPS of 0.25 for each team", () => {
    // Team 1's chance of finishing 1st is 0.5 against an actual 1st: (0.5 − 1)² = 0.25; team 2 mirrors it.
    // With two teams both make the playoffs whatever happens, so the Cut Line Brier is 0.
    const [result] = seasonSimulationBackTest(twoTeamSeason, [coinFlip], 10_000);
    expect(result!.rows.map((row) => row.teamId)).toEqual([1, 2]);
    for (const row of result!.rows) {
      expect(row.rankRps).toBeCloseTo(0.25, 1);
      expect(row.cutLineBrier).toBe(0);
      expect(row.outerTenths).toBe(false);
    }
  });

  it("scores a forecast that has the final order exactly reversed", () => {
    // Seven teams, one Match Day; team i beats every team above it, wherever it plays. The model has the higher-numbered
    // team win every Game, so it is certain team k finishes (8 − k)th where team k in fact finishes kth.
    const season: Game[] = [];
    for (let i = 1; i <= 7; i++) {
      for (let j = i + 1; j <= 7; j++) {
        const [home, away] = (i + j) % 2 === 0 ? [i, j] : [j, i];
        season.push(game(`${i}-${j}`, "20", home, away, i));
      }
    }
    const reversed = modelOf("reversed", (g) => (g.homeTeamId > g.awayTeamId ? sure(1, 0) : sure(0, 1)));

    const [result] = seasonSimulationBackTest(season, [reversed], 50);
    expect(result!.rows).toHaveLength(7);
    for (const row of result!.rows) {
      const team = row.teamId;
      // The forecast and actual cumulative chances differ at |8 − 2k| of the six ranks 1 to 6.
      expect(row.rankRps).toBeCloseTo(Math.abs(8 - 2 * team) / 6, 12);
      // Only teams 1 (forecast 7th, in fact 1st) and 7 (forecast 1st, in fact 7th) are on the wrong side of a Cut Line.
      expect(row.cutLineBrier).toBe(team === 1 || team === 7 ? 2 : 0);
      // Team 4 is the one team forecast where it finished.
      expect(row.outerTenths).toBe(team !== 4);
    }
  });

  it("plays out the run count it is given", () => {
    // One simulated Season puts team 1 either 1st or 2nd for certain, so its Rank RPS can only be 0 or 1.
    const [one] = seasonSimulationBackTest(twoTeamSeason, [coinFlip], 1);
    expect([0, 1]).toContain(rowsOf(one!, 1)[0]!.rankRps);
    const [many] = seasonSimulationBackTest(twoTeamSeason, [coinFlip], 10_000);
    expect(rowsOf(many!, 1)[0]!.rankRps).toBeGreaterThan(0.1);
    expect(rowsOf(many!, 1)[0]!.rankRps).toBeLessThan(0.4);
  });

  it("gives the same scores for the same inputs, one result per model", () => {
    const models = [coinFlip, oracle(twoTeamSeason)];
    const scores = seasonSimulationBackTest(twoTeamSeason, models, 500);
    expect(scores.map((result) => result.model)).toEqual(["coin-flip", "oracle"]);
    expect(seasonSimulationBackTest(twoTeamSeason, models, 500)).toEqual(scores);
  });
});

describe("inOuterTenths", () => {
  const uniform = Array<number>(10).fill(0.1);

  it("counts a rank whose mid-point transform is below 0.1 or above 0.9", () => {
    // Rank 1 of a uniform forecast: 0 + 0.1 / 2 = 0.05. Rank 10: 0.9 + 0.05 = 0.95.
    expect(inOuterTenths(uniform, 1)).toBe(true);
    expect(inOuterTenths(uniform, 10)).toBe(true);
    // Rank 2: 0.1 + 0.05 = 0.15. Rank 9: 0.8 + 0.05 = 0.85.
    expect(inOuterTenths(uniform, 2)).toBe(false);
    expect(inOuterTenths(uniform, 9)).toBe(false);
  });

  it("weighs the actual rank at half", () => {
    // Rank 2 of [0.05, 0.1, ...]: 0.05 + 0.05 = 0.10, which is not below 0.1; with the rest of the mass on rank 3 it stays in.
    expect(inOuterTenths([0.05, 0.1, 0.85], 2)).toBe(false);
    // 0.04 + 0.05 = 0.09 is below 0.1.
    expect(inOuterTenths([0.04, 0.1, 0.86], 2)).toBe(true);
    // Rank 2 of [0.85, 0.1, 0.05]: 0.85 + 0.05 = 0.90, which is not above 0.9; 0.86 + 0.05 = 0.91 is.
    expect(inOuterTenths([0.85, 0.1, 0.05], 2)).toBe(false);
    expect(inOuterTenths([0.86, 0.1, 0.04], 2)).toBe(true);
  });
});

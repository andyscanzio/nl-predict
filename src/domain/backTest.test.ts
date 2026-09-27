import { describe, expect, it } from "vitest";
import { backTest } from "./backTest.ts";
import type { ProjectionModel } from "./project.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Game } from "./types.ts";

/** Always a coin flip decided in regulation. */
const coinFlip: ProjectionModel = {
  name: "Coin Flip",
  kind: "outcomes",
  predictOutcomes: ({ remainingGames }) =>
    new Map(
      remainingGames.map((game) => [
        game.id,
        { regulationWin: 0.5, overtimeOrShootoutWin: 0, overtimeOrShootoutLoss: 0, regulationLoss: 0.5 },
      ]),
    ),
};

const asOf = new Date("2026-10-01T12:00:00+02:00");

const games: Game[] = [
  // home regulation win: 3 – 0 Points
  { id: "g1", startsAt: "2026-09-20T19:45:00+02:00", homeTeamId: 1, awayTeamId: 2, result: { homeGoals: 3, awayGoals: 0, decision: "regulation" } },
  // home OT loss: 1 – 2 Points
  { id: "g2", startsAt: "2026-09-22T19:45:00+02:00", homeTeamId: 1, awayTeamId: 2, result: { homeGoals: 1, awayGoals: 2, decision: "OT" } },
  // Remaining: not scored
  { id: "g3", startsAt: "2026-10-05T19:45:00+02:00", homeTeamId: 2, awayTeamId: 1 },
  // has a result but falls after the As-Of Date: not scored
  { id: "g4", startsAt: "2026-10-02T19:45:00+02:00", homeTeamId: 2, awayTeamId: 1, result: { homeGoals: 9, awayGoals: 0, decision: "regulation" } },
];

describe("backTest", () => {
  it("scores Outcome Probabilities by Brier score and expected Points by MAE per team-side", () => {
    // g1: Brier 0.25 + 0.25 = 0.5, Points errors 1.5 + 1.5
    // g2: Brier 0.25 + 1 + 0.25 = 1.5, Points errors 0.5 + 0.5
    expect(backTest(games, asOf, [coinFlip])).toEqual([
      { model: "Coin Flip", games: 2, brierScore: 1, pointsMae: 1 },
    ]);
  });

  it("predicts each Played Game from only the Games played before it, and gives Points-only models no Brier score", () => {
    // g1: no Form yet, so 0 – 0 predicted against 3 – 0: errors 3 + 0
    // g2: team 1 Home Form 3, team 2 Away Form 0, predicted 3 – 0 against 1 – 2: errors 2 + 2
    expect(backTest(games, asOf, [splitFormRate])).toEqual([
      { model: "Split Form Rate", games: 2, brierScore: null, pointsMae: 7 / 4 },
    ]);
  });
});

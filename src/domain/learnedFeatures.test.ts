import { describe, expect, it } from "vitest";
import { DEFAULT_LEARNED_FEATURE_PARAMETERS, learnedFeatures, type LearnedFeatureParameters } from "./learnedFeatures.ts";
import type { PlayedGame } from "./form.ts";
import type { Game } from "./types.ts";

const ratings = { homeRating: 1530, awayRating: 1510 };
const parameters: LearnedFeatureParameters = { priorGames: 2, backToBackDays: 1, undatedBackToBack: 0.25 };

let nextId = 1;
function game(startsAt: string, homeTeamId: number, awayTeamId: number): Game {
  return { id: String(nextId++), startsAt, homeTeamId, awayTeamId };
}
function played(startsAt: string, homeTeamId: number, awayTeamId: number, homeGoals: number, awayGoals: number): PlayedGame {
  return { ...game(startsAt, homeTeamId, awayTeamId), result: { homeGoals, awayGoals, decision: "regulation" } };
}

const target = game("2026-10-10T19:45:00+02:00", 1, 2);
const features = (playedGames: PlayedGame[], schedule: Game[] = [], g: Game = target) =>
  learnedFeatures(g, ratings, playedGames, schedule, parameters);

describe("learnedFeatures", () => {
  it("takes the Rating difference without Home Advantage", () => {
    expect(features([])[0]).toBe(20);
  });

  it("shrinks goal difference per Game toward 0 by Prior Games, home minus away", () => {
    // Team 1: +3 over one Game; team 2: −1 over one Game. (3 / (1 + 2)) − (−1 / (1 + 2))
    const before = [played("2026-10-01T19:45:00+02:00", 1, 3, 3, 0), played("2026-10-02T19:45:00+02:00", 4, 2, 2, 1)];
    expect(features(before)[1]).toBeCloseTo(4 / 3);
  });

  it("is not changed by Games after it or starting at the same time", () => {
    const before = [played("2026-10-01T19:45:00+02:00", 1, 3, 3, 0)];
    const alone = features(before);
    const withLater = [
      ...before,
      played("2026-10-10T19:45:00+02:00", 1, 4, 5, 0),
      played("2026-10-10T19:45:00+02:00", 5, 2, 0, 6),
      played("2026-10-11T19:45:00+02:00", 2, 6, 7, 0),
    ];
    expect(features(withLater)).toEqual(alone);
  });

  it("flags a back-to-back for a side that plays on the previous Swiss day", () => {
    const schedule = [game("2026-10-09T19:45:00+02:00", 1, 3), game("2026-10-08T19:45:00+02:00", 2, 4)];
    expect(features([], schedule).slice(2)).toEqual([1, 0]);
  });

  it("follows Swiss days, not 24-hour gaps", () => {
    // 22:30 UTC on 9 Oct is 00:30 Swiss on 10 Oct: the same Swiss day as the Game, so no back-to-back for team 1.
    // 21:30 UTC on 8 Oct is 23:30 Swiss on 8 Oct, the day before, so 2 is not either; 01:00 UTC on 9 Oct is 03:00 Swiss on 9 Oct, so it is.
    const schedule = [game("2026-10-09T22:30:00Z", 1, 3), game("2026-10-09T01:00:00Z", 2, 4)];
    expect(features([], schedule).slice(2)).toEqual([0, 1]);
  });

  it("honours a wider back-to-back rule", () => {
    const schedule = [game("2026-10-08T19:45:00+02:00", 1, 3)];
    expect(features([], schedule).slice(2)).toEqual([0, 0]);
    expect(learnedFeatures(target, ratings, [], schedule, { ...parameters, backToBackDays: 2 }).slice(2)).toEqual([1, 0]);
  });

  it("gives a Game with no date the neutral default and every Played Game", () => {
    const undated = game("", 1, 2);
    const before = [played("2026-10-01T19:45:00+02:00", 1, 3, 3, 0)];
    const result = features(before, [], undated);
    expect(result.slice(2)).toEqual([0.25, 0.25]);
    expect(result[1]).toBeCloseTo(1);
  });

  it("moves goal difference with a What-If Result like a Played Game won by one goal", () => {
    const whatIf: PlayedGame = { ...game("2026-10-05T19:45:00+02:00", 1, 3), result: { homeGoals: 1, awayGoals: 0, decision: "OT" } };
    const oneGoalWin = played("2026-10-05T19:45:00+02:00", 1, 3, 1, 0);
    expect(features([whatIf])).toEqual(features([oneGoalWin]));
    expect(features([whatIf])[1]).toBeCloseTo(1 / 3);
  });

  it("has a default parameter set", () => {
    expect(learnedFeatures(target, ratings, [], [])).toEqual([20, 0, 0, 0]);
    expect(DEFAULT_LEARNED_FEATURE_PARAMETERS.priorGames).toBeGreaterThan(0);
  });
});

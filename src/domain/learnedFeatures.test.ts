import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEARNED_FEATURE_PARAMETERS,
  learnedFeatures,
  RICHER_FEATURE_NAMES,
  type GameBoxScore,
  type LearnedFeatureParameters,
} from "./learnedFeatures.ts";
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

  it("ignores undated Games in the schedule", () => {
    const schedule = [game("", 1, 3), game("2026-10-09T19:45:00+02:00", 2, 4)];
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

describe("learnedFeatures with box scores", () => {
  const [REGULATION, FIRST_TWO, SHOTS, SPECIAL] = [4, 5, 6, 7];
  const boxScore = (overrides: Partial<GameBoxScore> = {}): GameBoxScore => ({
    home: { sog: 30, ppGoals: 1 },
    away: { sog: 10, ppGoals: 0 },
    scorePerPeriod: { home: [1, 1, 1], away: [0, 0, 0] },
    ...overrides,
  });
  const withBoxScores = (playedGames: PlayedGame[], entries: [PlayedGame, GameBoxScore][], g: Game = target) =>
    learnedFeatures(g, ratings, playedGames, [], parameters, new Map(entries.map(([played, box]) => [played.id, box])));
  const earlier = played("2026-10-01T19:45:00+02:00", 1, 3, 3, 0);

  it("appends the richer inputs only when box scores are given", () => {
    expect(learnedFeatures(target, ratings, [], [], parameters)).toHaveLength(4);
    expect(withBoxScores([], [])).toHaveLength(4 + RICHER_FEATURE_NAMES.length);
  });

  it("counts an OT/SO Game as 0 in regulation goal difference, shrunk by Prior Games, home minus away", () => {
    const regulation = played("2026-10-01T19:45:00+02:00", 1, 3, 3, 0);
    const overtime: PlayedGame = { ...played("2026-10-02T19:45:00+02:00", 4, 2, 2, 1), result: { homeGoals: 2, awayGoals: 1, decision: "SO" } };
    // Team 1: +3 / (1 + 2); team 2: the shootout loss counts 0, so 0 / (1 + 2).
    expect(withBoxScores([regulation, overtime], [])[REGULATION]).toBeCloseTo(1);
    // Goal difference itself still sees the shootout's one goal.
    expect(withBoxScores([regulation, overtime], [])[1]).toBeCloseTo(4 / 3);
  });

  it("computes goal difference over periods 1–2 from the box score, home minus away", () => {
    const box = boxScore({ scorePerPeriod: { home: [2, 1, 0], away: [0, 0, 4] } });
    // Team 1 was +3 after two periods (it lost the third, which does not count): 3 / (1 + 2).
    expect(withBoxScores([earlier], [[earlier, box]])[FIRST_TWO]).toBeCloseTo(1);
  });

  it("computes shot share, shrunk toward ½, as the home side's minus the away side's", () => {
    const other = played("2026-10-02T19:45:00+02:00", 4, 2, 1, 0);
    const box = boxScore({ home: { sog: 30 }, away: { sog: 10 } });
    // Team 1: (0.75 + 2 × ½) / 3; team 2 (away at the other Game, 20 for 30 against): (0.4 + 1) / 3.
    const otherBox = boxScore({ home: { sog: 30 }, away: { sog: 20 } });
    expect(withBoxScores([earlier, other], [[earlier, box], [other, otherBox]])[SHOTS]).toBeCloseTo((0.75 + 1) / 3 - (0.4 + 1) / 3);
  });

  it("computes special-teams net difference as power-play goals for minus against per Game", () => {
    const box = boxScore({ home: { ppGoals: 2 }, away: { ppGoals: 0 } });
    // Team 1: +2 / (1 + 2); team 2 has no Game.
    expect(withBoxScores([earlier], [[earlier, box]])[SPECIAL]).toBeCloseTo(2 / 3);
  });

  it("skips a Played Game with missing box-score data for that input only, so it neither counts nor dilutes", () => {
    const noShots = boxScore({ home: { ppGoals: 2 }, away: { ppGoals: 0 } });
    const result = withBoxScores([earlier], [[earlier, noShots]]);
    expect(result[SHOTS]).toBe(0);
    expect(result[SPECIAL]).toBeCloseTo(2 / 3);
    const noPeriods = boxScore({ scorePerPeriod: { home: [null, 1, 1], away: [0, 0, 0] } });
    expect(withBoxScores([earlier], [[earlier, noPeriods]])[FIRST_TWO]).toBe(0);
    // A Game with no box score at all is skipped by every box-score input but still counts for regulation goal difference.
    const none = withBoxScores([earlier], []);
    expect([none[FIRST_TWO], none[SHOTS], none[SPECIAL]]).toEqual([0, 0, 0]);
    expect(none[REGULATION]).toBeCloseTo(1);
  });

  it("never lets a Game that starts at or after the target into the box-score inputs", () => {
    const same = played("2026-10-10T19:45:00+02:00", 1, 3, 5, 0);
    const later = played("2026-10-11T19:45:00+02:00", 1, 3, 5, 0);
    const alone = withBoxScores([earlier], [[earlier, boxScore()]]);
    expect(withBoxScores([earlier, same, later], [[earlier, boxScore()], [same, boxScore()], [later, boxScore()]])).toEqual(alone);
  });

  it("leaves box-score inputs unmoved by a What-If Result, which has no box score", () => {
    const before = withBoxScores([earlier], [[earlier, boxScore()]]);
    const whatIf = played("2026-10-05T19:45:00+02:00", 1, 3, 2, 0);
    const after = withBoxScores([earlier, whatIf], [[earlier, boxScore()]]);
    expect(after.slice(FIRST_TWO)).toEqual(before.slice(FIRST_TWO));
    // A regulation win does move regulation goal difference, like any Played Game.
    expect(after[REGULATION]).toBeGreaterThan(before[REGULATION]!);
  });
});

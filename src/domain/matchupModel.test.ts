import { describe, expect, it } from "vitest";
import { matchupModel } from "./matchupModel.ts";
import { project } from "./project.ts";
import type { Decision, Game } from "./types.ts";

const asOf = new Date("2026-10-01T12:00:00+02:00");
const later = "2026-10-10T19:45:00+02:00";

let nextId = 1;
function played(homeTeamId: number, awayTeamId: number, homeGoals: number, awayGoals: number, decision: Decision = "regulation"): Game {
  return {
    id: String(nextId++),
    startsAt: "2026-09-20T19:45:00+02:00",
    homeTeamId,
    awayTeamId,
    result: { homeGoals, awayGoals, decision },
  };
}

function scheduled(homeTeamId: number, awayTeamId: number): Game {
  return { id: String(nextId++), startsAt: later, homeTeamId, awayTeamId };
}

function projectedPoints(games: Game[]) {
  return Object.fromEntries(
    project(games, asOf, matchupModel).projectedTable.map((row) => [row.teamId, row.projectedPoints]),
  );
}

describe("project: Matchup Model", () => {
  it("splits a Game's 3 Points by the home team's Home Form against the away team's Away Form", () => {
    const games = [
      played(1, 3, 2, 3, "OT"), // 1 at home: 1
      played(1, 4, 3, 0), // 1 at home: 3 → Home Form 2
      played(3, 1, 5, 0), // 1 away: 0, not counted at home
      played(3, 2, 1, 2, "SO"), // 2 away: 2
      played(4, 2, 3, 0), // 2 away: 0 → Away Form 1
      played(2, 4, 4, 0), // 2 at home: 3, not counted away
      scheduled(1, 2),
    ];
    // home expects (2 + (3 − 1)) / 2 = 2 of the 3 Points
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(4 + 2);
    expect(points[2]).toBeCloseTo(5 + 1);
  });

  it("falls back to a team's other-venue Form when a Form Window is empty, and to 1.5 with neither", () => {
    const games = [played(3, 1, 0, 3), scheduled(1, 2)];
    // 1 has only an Away Form (3) to use at home; 2 has no Games and counts as 1.5: (3 + (3 − 1.5)) / 2 = 2.25
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(3 + 2.25);
    expect(points[2]).toBeCloseTo(0.75);
  });

  it("falls back to an away team's Home Form when its away Form Window is empty", () => {
    const games = [played(1, 3, 0, 3), played(2, 4, 3, 0), scheduled(1, 2)];
    // 1 has Home Form 0; 2 has only a Home Form (3) to use away: (0 + (3 − 3)) / 2 = 0,
    // so the home side loses for sure, still taking the OT/SO share of the loser's point
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(0.23);
    expect(points[2]).toBeCloseTo(3 + 3 - 0.23);
  });

  it("caps a Game's win probability at 1: a sure winner still concedes the OT/SO share of the loser's point", () => {
    const games = [played(1, 3, 3, 0), played(4, 2, 3, 0), scheduled(1, 2)];
    // Home Form 3 against Away Form 0: the home side wins for sure, in OT/SO at the fallback OT/SO Rate 0.23
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(3 + 3 - 0.23);
    expect(points[2]).toBeCloseTo(0.23);
  });

  it("flags Low Sample by Played Games, as under every Projection Model", () => {
    const nine = Array.from({ length: 9 }, () => played(1, 2, 3, 1));
    const row = (games: Game[]) => project(games, asOf, matchupModel).projectedTable.find((r) => r.teamId === 1)!;
    expect(row(nine).lowSample).toBe(true);
    expect(row([...nine, played(3, 1, 1, 3)]).lowSample).toBe(false);
  });

  it("hands out exactly 3 Points per Remaining Game", () => {
    const games = [
      played(1, 2, 3, 0),
      played(2, 3, 2, 1, "OT"),
      played(3, 1, 4, 2),
      played(4, 1, 1, 2, "SO"),
      scheduled(1, 2),
      scheduled(2, 4),
      scheduled(3, 4),
      scheduled(4, 1),
      scheduled(1, 3),
    ];
    const { projectedTable } = project(games, asOf, matchupModel);
    const gained = projectedTable.reduce((sum, row) => sum + row.projectedPoints - row.currentPoints, 0);
    expect(gained).toBeCloseTo(5 * 3);
  });
});

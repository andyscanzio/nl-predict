import { describe, expect, it } from "vitest";
import { project } from "./project.ts";
import { seasonRate } from "./seasonRate.ts";
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
    project(games, asOf, seasonRate).projectedTable.map((row) => [row.teamId, row.projectedPoints]),
  );
}

describe("project: Season Rate", () => {
  it("splits a Game's 3 Points by the two teams' season Points per Game, ignoring venue", () => {
    const games = [
      played(1, 3, 3, 1), // 1: 3
      played(3, 1, 2, 3, "OT"), // 1: 2 → 2.5 per Game
      played(2, 4, 1, 3), // 2: 0
      played(4, 2, 2, 3, "SO"), // 2: 2 → 1 per Game
      scheduled(1, 2),
    ];
    // home expects (2.5 + (3 − 1)) / 2 = 2.25 of the 3 Points
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(7.25);
    expect(points[2]).toBeCloseTo(2.75);
  });

  it("gives a team with no Played Games the league-average 1.5 Points per Game", () => {
    const games = [played(1, 3, 3, 0), played(3, 1, 0, 3), scheduled(1, 2), scheduled(2, 1)];
    // 1 (3 per Game) vs 2 (1.5): 2.25 at home, 2.25 away
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(6 + 4.5);
    expect(points[2]).toBeCloseTo(1.5);
  });

  it("caps a Game's win probability at 1: a sure winner still concedes the OT/SO share of the loser's point", () => {
    const games = [played(1, 2, 3, 0), scheduled(1, 2)];
    // 1 (3 per Game) vs 2 (0): the home side wins for sure, in OT/SO at the fallback OT/SO Rate 0.23
    expect(projectedPoints(games)[1]).toBeCloseTo(3 + 3 - 0.23);
    expect(projectedPoints(games)[2]).toBeCloseTo(0.23);
  });

  it("flags Low Sample by Played Games, as under every Projection Model", () => {
    const nine = Array.from({ length: 9 }, () => played(1, 2, 3, 1));
    const row = (games: Game[]) => project(games, asOf, seasonRate).projectedTable.find((r) => r.teamId === 1)!;
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
    const { projectedTable } = project(games, asOf, seasonRate);
    const gained = projectedTable.reduce((sum, row) => sum + row.projectedPoints - row.currentPoints, 0);
    expect(gained).toBeCloseTo(5 * 3);
  });
});

import { describe, expect, it } from "vitest";
import { project } from "./project.ts";
import { createSeasonRate, seasonRate } from "./seasonRate.ts";
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
  it("splits a Game's 3 Points by the two teams' shrunk season Points per Game, ignoring venue", () => {
    const games = [
      played(1, 3, 3, 1), // 1: 3
      played(3, 1, 2, 3, "OT"), // 1: 2 → 5 Points in 2 Games, rated (5 + 15) / 12 = 5/3
      played(2, 4, 1, 3), // 2: 0
      played(4, 2, 2, 3, "SO"), // 2: 2 → 2 Points in 2 Games, rated (2 + 15) / 12 = 17/12
      scheduled(1, 2),
    ];
    // home expects (5/3 + (3 − 17/12)) / 2 = 1.625 of the 3 Points
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(5 + 1.625);
    expect(points[2]).toBeCloseTo(2 + 1.375);
  });

  it("gives a team with no Played Games the league-average 1.5 Points per Game", () => {
    const games = [played(1, 3, 3, 0), played(3, 1, 0, 3), scheduled(1, 2), scheduled(2, 1)];
    // 1: 6 Points in 2 Games, rated (6 + 15) / 12 = 1.75, against 2 at 1.5: 1.625 at home, 1.625 away
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(6 + 3.25);
    expect(points[2]).toBeCloseTo(2.75);
  });

  it("rates a hot start well below its raw Points per Game", () => {
    const games = [played(1, 3, 3, 0), played(1, 4, 3, 0), played(1, 5, 3, 0), scheduled(1, 2)];
    // 9 Points in 3 Games, rated (9 + 15) / 13 ≈ 1.85 rather than 3.0, against 2 at 1.5
    expect(projectedPoints(games)[1]).toBeCloseTo(9 + (24 / 13 + 3 - 1.5) / 2);
  });

  it("rates a hot start at its raw Points per Game with no prior Games", () => {
    const games = [played(1, 3, 3, 0), played(1, 4, 3, 0), played(1, 5, 3, 0), scheduled(1, 2)];
    const model = createSeasonRate({ priorGames: 0 });
    const points = Object.fromEntries(
      project(games, asOf, model).projectedTable.map((row) => [row.teamId, row.projectedPoints]),
    );
    // 9 Points in 3 Games, rated 3.0, against 2 at 1.5
    expect(points[1]).toBeCloseTo(9 + (3 + 3 - 1.5) / 2);
  });

  it("is named Season Rate whatever its prior Games", () => {
    expect(createSeasonRate({ priorGames: 4 })).toMatchObject({ id: "season-rate", name: "Season Rate" });
  });

  it("follows a team's raw Points per Game closely late in the Season", () => {
    const wins = Array.from({ length: 20 }, () => played(1, 3, 3, 0));
    const losses = Array.from({ length: 20 }, () => played(3, 1, 3, 2, "OT"));
    // 80 Points in 40 Games, rated (80 + 15) / 50 = 1.9 against a raw 2.0, against 2 at 1.5
    expect(projectedPoints([...wins, ...losses, scheduled(1, 2)])[1]).toBeCloseTo(80 + (1.9 + 3 - 1.5) / 2);
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

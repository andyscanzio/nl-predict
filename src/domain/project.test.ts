import { describe, expect, it } from "vitest";
import { project } from "./project.ts";
import type { Decision, Game } from "./types.ts";

const asOf = new Date("2026-10-01T12:00:00+02:00");

let nextId = 1;
function played(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  decision: Decision = "regulation",
  startsAt = "2026-09-20T19:45:00+02:00",
): Game {
  return {
    id: String(nextId++),
    startsAt,
    homeTeamId,
    awayTeamId,
    result: { homeGoals, awayGoals, decision },
  };
}

function scheduled(homeTeamId: number, awayTeamId: number, startsAt: string): Game {
  return { id: String(nextId++), startsAt, homeTeamId, awayTeamId };
}

function pointsByTeam(games: Game[]) {
  return Object.fromEntries(
    project(games, asOf).currentTable.map((row) => [row.teamId, row.points]),
  );
}

describe("project: Current Table", () => {
  it("awards 3 Points for a regulation win and 0 for a regulation loss", () => {
    expect(pointsByTeam([played(1, 2, 4, 2)])).toEqual({ 1: 3, 2: 0 });
  });

  it("awards 2 Points for an OT win and 1 for an OT loss", () => {
    expect(pointsByTeam([played(1, 2, 2, 3, "OT")])).toEqual({ 1: 1, 2: 2 });
  });

  it("awards 2 Points for an SO win and 1 for an SO loss", () => {
    expect(pointsByTeam([played(1, 2, 3, 2, "SO")])).toEqual({ 1: 2, 2: 1 });
  });

  it("sums Points over all Played Games, home and away", () => {
    const games = [
      played(1, 2, 4, 2), // 1: +3
      played(2, 1, 3, 2, "OT"), // 1: +1, 2: +2
      played(3, 1, 0, 1), // 1: +3
    ];
    expect(pointsByTeam(games)).toEqual({ 1: 7, 2: 2, 3: 0 });
  });

  it("orders the Current Table by Points and assigns ranks", () => {
    const games = [played(1, 2, 1, 3), played(3, 1, 2, 1, "SO"), played(2, 3, 5, 0)];
    const table = project(games, asOf).currentTable;
    expect(table.map((row) => [row.rank, row.teamId, row.points])).toEqual([
      [1, 2, 6],
      [2, 3, 2],
      [3, 1, 1],
    ]);
  });

  it("counts Games with a result as Played only if they started before the As-Of Date", () => {
    const games = [
      played(1, 2, 4, 2, "regulation", "2026-09-30T19:45:00+02:00"),
      played(2, 1, 4, 2, "regulation", "2026-10-02T19:45:00+02:00"),
    ];
    const table = project(games, asOf).currentTable;
    expect(table.find((row) => row.teamId === 1)).toMatchObject({ gamesPlayed: 1, points: 3 });
  });

  it("lists every team in the schedule, including teams with no Played Games", () => {
    const games = [played(1, 2, 4, 2), scheduled(3, 1, "2026-10-03T19:45:00+02:00")];
    expect(pointsByTeam(games)).toEqual({ 1: 3, 2: 0, 3: 0 });
  });

  it("does not count past Games without a result, such as postponed ones", () => {
    const games = [played(1, 2, 4, 2), scheduled(2, 1, "2026-09-25T19:45:00+02:00")];
    const table = project(games, asOf).currentTable;
    expect(table.map((row) => row.gamesPlayed)).toEqual([1, 1]);
  });

  it("tallies the win/loss record and goals for each team", () => {
    const games = [
      played(1, 2, 4, 2),
      played(2, 1, 3, 2, "OT"),
      played(1, 2, 1, 2, "SO"),
      played(2, 1, 5, 1),
    ];
    const row = project(games, asOf).currentTable.find((r) => r.teamId === 1);
    expect(row).toEqual({
      rank: 2,
      teamId: 1,
      gamesPlayed: 4,
      regulationWins: 1,
      overtimeOrShootoutWins: 0,
      overtimeOrShootoutLosses: 2,
      regulationLosses: 1,
      goalsFor: 8,
      goalsAgainst: 12,
      points: 5,
    });
  });
});

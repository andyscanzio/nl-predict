import { describe, expect, it } from "vitest";
import { eloModel, STARTING_RATINGS } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import { project, SEASON_START, type ProjectionModel } from "./project.ts";
import { projectionHistory } from "./projectionHistory.ts";
import { seasonRate } from "./seasonRate.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Game, Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;
const MODELS: ProjectionModel[] = [splitFormRate, seasonRate, matchupModel, eloModel];
const RECORDED_DAYS = ["2026-09-15", "2026-09-18", "2026-09-19", "2026-09-22", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

/** After every Played Game's start, which is what makes the last point equal the live projection (Played Games always started before the snapshot). */
const now = new Date("2026-09-28T00:00:00Z");

const histories = new Map(MODELS.map((model) => [model.id, projectionHistory(snapshot.games, model)]));
const historyOf = (model: ProjectionModel) => histories.get(model.id)!;

describe("projectionHistory", () => {
  it("starts before the first Game with nothing played, every team level but under the Elo Model's Starting Ratings", () => {
    const [start] = historyOf(eloModel);
    expect(start!.matchDay).toBe(SEASON_START);
    const teams = Object.values(start!.teams);
    expect(teams).toHaveLength(snapshot.teams.length);
    expect(teams.every((team) => team.gamesPlayed === 0)).toBe(true);
    for (const model of MODELS.filter((model) => model !== eloModel)) {
      const [first] = historyOf(model);
      const points = Object.values(first!.teams).map((team) => team.projectedPoints);
      expect(points.every((p) => Math.abs(p - points[0]!) < 1e-9)).toBe(true);
    }
    const byStartingRating = [...STARTING_RATINGS.ratings].sort((a, b) => b.rating - a.rating).map(({ teamId }) => teamId);
    const byProjectedPoints = Object.entries(start!.teams)
      .sort(([, a], [, b]) => b.projectedPoints - a.projectedPoints)
      .map(([teamId]) => Number(teamId));
    expect(byProjectedPoints[0]).toBe(byStartingRating[0]);
    expect(byProjectedPoints.at(-1)).toBe(byStartingRating.at(-1));
  });

  it("has one point per Match Day with a Played Game, oldest first", () => {
    expect(historyOf(eloModel).map((point) => point.matchDay)).toEqual([SEASON_START, ...RECORDED_DAYS]);
  });

  it("puts a Game late in the evening on its Swiss day, and adds no point for a day whose only Game was postponed", () => {
    const game = (id: string, startsAt: string, result = true): Game => ({
      id,
      startsAt,
      homeTeamId: 1,
      awayTeamId: 2,
      ...(result && { result: { homeGoals: 2, awayGoals: 1, decision: "regulation" as const } }),
    });
    const games = [
      game("a", "2026-09-30T23:30:00Z"), // 01:30 on 1 October in Switzerland
      game("b", "2026-10-03T19:45:00+02:00", false), // postponed
      game("c", "2026-10-05T19:45:00+02:00"),
      game("d", "2026-10-20T19:45:00+02:00", false),
    ];
    expect(projectionHistory(games, splitFormRate).map((point) => point.matchDay)).toEqual([SEASON_START, "2026-10-01", "2026-10-05"]);
  });

  it("carries, at every point, the Played Games each team has in the Current Table as of that point", () => {
    const history = historyOf(splitFormRate);
    history.slice(1).forEach((point, index) => {
      const endOfDay = new Date(`${RECORDED_DAYS[index]}T23:59:59+02:00`);
      const { currentTable } = project(snapshot.games, endOfDay, splitFormRate);
      for (const row of currentTable) expect(point.teams[row.teamId]!.gamesPlayed).toBe(row.gamesPlayed);
    });
  });

  for (const model of MODELS) {
    it(`ends, under ${model.name}, on exactly what the live projection gives once "now" is after the last Played Game`, () => {
      const live = project(snapshot.games, now, model);
      const last = historyOf(model).at(-1)!;
      expect(last.matchDay).toBe("2026-09-27");
      for (const row of live.projectedTable) {
        expect(last.teams[row.teamId]).toEqual({
          projectedPoints: row.projectedPoints,
          gamesPlayed: live.currentTable.find((t) => t.teamId === row.teamId)!.gamesPlayed,
          playoffs: row.probabilities?.playoffs ?? null,
          first: row.probabilities?.first ?? null,
        });
      }
    });
  }

  it("gives Split Form Rate real projected Points and no chances", () => {
    for (const point of historyOf(splitFormRate)) {
      for (const team of Object.values(point.teams)) {
        expect(team.playoffs).toBeNull();
        expect(team.first).toBeNull();
        expect(Number.isFinite(team.projectedPoints)).toBe(true);
      }
    }
    expect(Object.values(historyOf(splitFormRate).at(-1)!.teams).some((team) => team.projectedPoints > 0)).toBe(true);
  });

  it("gives outcome models chances from every point on", () => {
    for (const point of historyOf(eloModel)) {
      for (const team of Object.values(point.teams)) {
        expect(team.playoffs).toBeGreaterThanOrEqual(0);
        expect(team.first).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic", () => {
    expect(projectionHistory(snapshot.games, eloModel)).toEqual(historyOf(eloModel));
  });

  it("does not depend on when the snapshot was taken", () => {
    const later = { ...snapshot, snapshotAt: "2026-10-30T12:00:00Z" };
    expect(projectionHistory(later.games, eloModel)).toEqual(historyOf(eloModel));
  });

  it("has only the Season-start point before any Game has been played", () => {
    const unplayed = snapshot.games.map(({ result: _result, ...game }) => game);
    expect(projectionHistory(unplayed, eloModel)).toHaveLength(1);
  });
});

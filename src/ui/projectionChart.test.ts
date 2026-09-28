import { describe, expect, it } from "vitest";
import { SEASON_START } from "../domain/matchDay.ts";
import type { HistoryPoint, ProjectionHistory } from "../domain/projectionHistory.ts";
import { projectionChart } from "./projectionChart.ts";

function point(matchDay: string, playoffs: Record<number, number | null>): HistoryPoint {
  return {
    matchDay,
    teams: Object.fromEntries(
      Object.entries(playoffs).map(([teamId, chance]) => [teamId, { projectedPoints: 60, gamesPlayed: 0, playoffs: chance, first: chance === null ? null : 0.1 }]),
    ),
  };
}

const history: ProjectionHistory = [
  point(SEASON_START, { 1: 0.5, 2: 0.5, 3: 0.5 }),
  point("2026-09-15", { 1: 0.6, 2: 0.4, 3: 0.5 }),
  point("2026-09-18", { 1: 0.8, 2: 0.3, 3: 0.4 }),
];

describe("projectionChart", () => {
  it("is hidden while the history has only its Season-start point", () => {
    expect(projectionChart([point(SEASON_START, { 1: 0.5, 2: 0.5 })], 1)).toBeNull();
    expect(projectionChart([], 1)).toBeNull();
  });

  it("is hidden for a Points-only model, which has no playoff chances", () => {
    const pointsOnly = [point(SEASON_START, { 1: null, 2: null }), point("2026-09-15", { 1: null, 2: null })];
    expect(projectionChart(pointsOnly, 1)).toBeNull();
  });

  it("plots playoff chance on a fixed 0–100% scale, whatever the values", () => {
    const chart = projectionChart(history, 1)!;
    const chosen = chart.lines.find((line) => line.chosen)!;
    // y is measured from the top: 100% is 0, 0% is 1.
    expect(chosen.points.map((p) => p.y)).toEqual([0.5, 0.4, 0.2].map((y) => expect.closeTo(y, 12)));
    const narrow = projectionChart([point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: 0.51 })], 1)!;
    expect(narrow.lines[0]!.points.map((p) => p.y)).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.49, 12)]);
  });

  it("draws a 50% guide at the middle", () => {
    expect(projectionChart(history, 1)!.guideY).toBe(0.5);
  });

  it("has a line for every team and flags only the chosen one", () => {
    const chart = projectionChart(history, 2)!;
    expect(chart.lines.map((line) => line.teamId).sort()).toEqual([1, 2, 3]);
    expect(chart.lines.filter((line) => line.chosen).map((line) => line.teamId)).toEqual([2]);
  });

  it("draws the chosen team last, so it sits on top", () => {
    expect(projectionChart(history, 1)!.lines.at(-1)!.teamId).toBe(1);
  });

  it("spaces the points evenly, one per Match Day, from the left edge to the right", () => {
    const chosen = projectionChart(history, 1)!.lines.at(-1)!;
    expect(chosen.points.map((p) => p.x)).toEqual([0, 0.5, 1]);
  });

  it("labels the x-axis sparsely with Swiss dates", () => {
    expect(projectionChart(history, 1)!.xLabels).toEqual([
      { x: 0, text: "Start" },
      { x: 0.5, text: "15 Sep" },
      { x: 1, text: "18 Sep" },
    ]);
    const long = [point(SEASON_START, { 1: 0.5 }), ...Array.from({ length: 30 }, (_, day) => point(`2026-10-${String(day + 1).padStart(2, "0")}`, { 1: 0.5 }))];
    expect(projectionChart(long, 1)!.xLabels.map((label) => label.text)).toEqual(["Start", "15 Oct", "30 Oct"]);
  });

  it("summarises the chosen team's playoff chance for screen readers", () => {
    expect(projectionChart(history, 1)!.summary).toBe("Playoff chance 80% now, 50% at the start of the Season, up 20 pts since the previous Match Day.");
    expect(projectionChart(history, 2)!.summary).toBe("Playoff chance 30% now, 50% at the start of the Season, down 10 pts since the previous Match Day.");
    expect(projectionChart(history, 3)!.summary).toBe("Playoff chance 40% now, 50% at the start of the Season, down 10 pts since the previous Match Day.");
  });

  it("says a chance is unchanged when it did not move", () => {
    const flat = [point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: 0.5 })];
    expect(projectionChart(flat, 1)!.summary).toBe("Playoff chance 50% now, 50% at the start of the Season, unchanged since the previous Match Day.");
  });
});

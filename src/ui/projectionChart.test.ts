import { describe, expect, it } from "vitest";
import { SEASON_START } from "../domain/matchDay.ts";
import type { HistoryPoint, ProjectionHistory } from "../domain/projectionHistory.ts";
import { chartMetrics, projectionChart, shownMetric } from "./projectionChart.ts";

function point(matchDay: string, playoffs: Record<number, number | null>, projectedPoints: Record<number, number> = {}): HistoryPoint {
  return {
    matchDay,
    teams: Object.fromEntries(
      Object.entries(playoffs).map(([teamId, chance]) => [
        teamId,
        { projectedPoints: projectedPoints[Number(teamId)] ?? 60, gamesPlayed: 0, playoffs: chance, first: chance === null ? null : 0.1 },
      ]),
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
    expect(projectionChart([point(SEASON_START, { 1: 0.5, 2: 0.5 })], 1, "playoffs")).toBeNull();
    expect(projectionChart([], 1, "playoffs")).toBeNull();
  });

  it("has no playoff-chance view for a Points-only model, which has no playoff chances", () => {
    const pointsOnly = [point(SEASON_START, { 1: null, 2: null }), point("2026-09-15", { 1: null, 2: null })];
    expect(projectionChart(pointsOnly, 1, "playoffs")).toBeNull();
  });

  it("plots playoff chance on a fixed 0–100% scale, whatever the values", () => {
    const chart = projectionChart(history, 1, "playoffs")!;
    const chosen = chart.lines.find((line) => line.chosen)!;
    // y is measured from the top: 100% is 0, 0% is 1.
    expect(chosen.points.map((p) => p.y)).toEqual([0.5, 0.4, 0.2].map((y) => expect.closeTo(y, 12)));
    const narrow = projectionChart([point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: 0.51 })], 1, "playoffs")!;
    expect(narrow.lines[0]!.points.map((p) => p.y)).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.49, 12)]);
  });

  it("draws a 50% guide at the middle", () => {
    expect(projectionChart(history, 1, "playoffs")!.guideY).toBe(0.5);
  });

  it("has a line for every team and flags only the chosen one", () => {
    const chart = projectionChart(history, 2, "playoffs")!;
    expect(chart.lines.map((line) => line.teamId).sort()).toEqual([1, 2, 3]);
    expect(chart.lines.filter((line) => line.chosen).map((line) => line.teamId)).toEqual([2]);
  });

  it("draws the chosen team last, so it sits on top", () => {
    expect(projectionChart(history, 1, "playoffs")!.lines.at(-1)!.teamId).toBe(1);
  });

  it("spaces the points evenly, one per Match Day, from the left edge to the right", () => {
    const chosen = projectionChart(history, 1, "playoffs")!.lines.at(-1)!;
    expect(chosen.points.map((p) => p.x)).toEqual([0, 0.5, 1]);
  });

  it("labels the x-axis sparsely with Swiss dates", () => {
    expect(projectionChart(history, 1, "playoffs")!.xLabels).toEqual([
      { x: 0, text: "Start" },
      { x: 0.5, text: "15 Sep" },
      { x: 1, text: "18 Sep" },
    ]);
    const long = [point(SEASON_START, { 1: 0.5 }), ...Array.from({ length: 30 }, (_, day) => point(`2026-10-${String(day + 1).padStart(2, "0")}`, { 1: 0.5 }))];
    expect(projectionChart(long, 1, "playoffs")!.xLabels.map((label) => label.text)).toEqual(["Start", "15 Oct", "30 Oct"]);
  });

  it("summarises the chosen team's playoff chance for screen readers", () => {
    expect(projectionChart(history, 1, "playoffs")!.summary).toBe("Playoff chance 80% now, 50% at the start of the Season, up 20 pts since the previous Match Day.");
    expect(projectionChart(history, 2, "playoffs")!.summary).toBe("Playoff chance 30% now, 50% at the start of the Season, down 10 pts since the previous Match Day.");
    expect(projectionChart(history, 3, "playoffs")!.summary).toBe("Playoff chance 40% now, 50% at the start of the Season, down 10 pts since the previous Match Day.");
  });

  it("says a chance is unchanged when it did not move", () => {
    const flat = [point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: 0.5 })];
    expect(projectionChart(flat, 1, "playoffs")!.summary).toBe("Playoff chance 50% now, 50% at the start of the Season, unchanged since the previous Match Day.");
  });

  it("labels the playoff scale 100%, 50% and 0%", () => {
    expect(projectionChart(history, 1, "playoffs")!.yTicks.map((tick) => tick.text)).toEqual(["100%", "50%", "0%"]);
  });
});

describe("projectionChart, projected Points", () => {
  const points: ProjectionHistory = [
    point(SEASON_START, { 1: 0.5, 2: 0.5, 3: 0.5 }, { 1: 60, 2: 60, 3: 60 }),
    point("2026-09-15", { 1: 0.6, 2: 0.4, 3: 0.5 }, { 1: 64, 2: 58, 3: 61 }),
    point("2026-09-18", { 1: 0.8, 2: 0.3, 3: 0.4 }, { 1: 62, 2: 52, 3: 70 }),
  ];

  it("spans the whole field's lowest to highest projected Points, not just the chosen team's", () => {
    const chart = projectionChart(points, 1, "points")!;
    const [top, , bottom] = chart.yTicks;
    // The field ranges from 52 (team 2, last point) to 70 (team 3, last point); team 1 alone only spans 60 to 64.
    expect(top).toEqual({ y: 0, text: "70.0" });
    expect(bottom).toEqual({ y: 1, text: "52.0" });
    const y = (teamId: number) => chart.lines.find((line) => line.teamId === teamId)!.points.map((p) => p.y);
    expect(y(3)[2]).toBe(0);
    expect(y(2)[2]).toBe(1);
    expect(y(1)).toEqual([expect.closeTo(10 / 18, 12), expect.closeTo(6 / 18, 12), expect.closeTo(8 / 18, 12)]);
  });

  it("uses the same range whichever team is chosen", () => {
    expect(projectionChart(points, 2, "points")!.yTicks).toEqual(projectionChart(points, 1, "points")!.yTicks);
  });

  it("keeps every line inside the plot", () => {
    const ys = projectionChart(points, 1, "points")!.lines.flatMap((line) => line.points.map((p) => p.y));
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(1);
  });

  it("has no 50% guide, and labels the top, middle and bottom of the range", () => {
    const chart = projectionChart(points, 1, "points")!;
    expect(chart.guideY).toBeNull();
    expect(chart.yTicks).toEqual([
      { y: 0, text: "70.0" },
      { y: 0.5, text: "61.0" },
      { y: 1, text: "52.0" },
    ]);
  });

  it("draws a flat field in the middle", () => {
    const flat = [point(SEASON_START, { 1: 0.5 }, { 1: 60 }), point("2026-09-15", { 1: 0.5 }, { 1: 60 })];
    expect(projectionChart(flat, 1, "points")!.lines[0]!.points.map((p) => p.y)).toEqual([0.5, 0.5]);
  });

  it("still flags the chosen team, draws it last and spaces the points by Match Day", () => {
    const chart = projectionChart(points, 2, "points")!;
    expect(chart.lines.at(-1)).toMatchObject({ teamId: 2, chosen: true });
    expect(chart.lines.filter((line) => line.chosen)).toHaveLength(1);
    expect(chart.lines.at(-1)!.points.map((p) => p.x)).toEqual([0, 0.5, 1]);
  });

  it("is hidden while the history has only its Season-start point", () => {
    expect(projectionChart([point(SEASON_START, { 1: 0.5 }, { 1: 60 })], 1, "points")).toBeNull();
  });

  it("shows a Points-only model, which has no playoff chances", () => {
    const pointsOnly = [point(SEASON_START, { 1: null, 2: null }, { 1: 60, 2: 60 }), point("2026-09-15", { 1: null, 2: null }, { 1: 63, 2: 57 })];
    const chart = projectionChart(pointsOnly, 1, "points")!;
    expect(chart.lines.at(-1)!.points.map((p) => p.y)).toEqual([0.5, 0]);
  });

  it("summarises the chosen team's projected Points for screen readers", () => {
    expect(projectionChart(points, 1, "points")!.summary).toBe("Projected Points 62.0 now, 60.0 at the start of the Season, down 2.0 since the previous Match Day.");
    expect(projectionChart(points, 3, "points")!.summary).toBe("Projected Points 70.0 now, 60.0 at the start of the Season, up 9.0 since the previous Match Day.");
    const flat = [point(SEASON_START, { 1: 0.5 }, { 1: 60 }), point("2026-09-15", { 1: 0.5 }, { 1: 60 })];
    expect(projectionChart(flat, 1, "points")!.summary).toBe("Projected Points 60.0 now, 60.0 at the start of the Season, unchanged since the previous Match Day.");
  });
});

describe("chartMetrics", () => {
  it("offers playoff % and projected Points for a model with Outcome Probabilities", () => {
    expect(chartMetrics(history)).toEqual(["playoffs", "points"]);
  });

  it("offers only projected Points for a Points-only model", () => {
    const pointsOnly = [point(SEASON_START, { 1: null }), point("2026-09-15", { 1: null })];
    expect(chartMetrics(pointsOnly)).toEqual(["points"]);
  });

  it("offers playoff % only when every point of every team has a chance", () => {
    const partial = [point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: null })];
    expect(chartMetrics(partial)).toEqual(["points"]);
  });

  it("offers nothing while the history has only its Season-start point", () => {
    expect(chartMetrics([point(SEASON_START, { 1: 0.5 })])).toEqual([]);
    expect(chartMetrics([])).toEqual([]);
  });
});

describe("shownMetric", () => {
  it("keeps the chosen metric when the model supports it", () => {
    expect(shownMetric("points", ["playoffs", "points"])).toBe("points");
    expect(shownMetric("playoffs", ["playoffs", "points"])).toBe("playoffs");
  });

  it("falls back to what the model supports, without forgetting the choice", () => {
    expect(shownMetric("playoffs", ["points"])).toBe("points");
  });

  it("has nothing to show when there is nothing to offer", () => {
    expect(shownMetric("playoffs", [])).toBeNull();
  });
});

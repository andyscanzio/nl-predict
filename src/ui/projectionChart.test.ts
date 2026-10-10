import { describe, expect, it } from "vitest";
import { SEASON_START } from "../domain/project.ts";
import type { HistoryPoint, ProjectionHistory } from "../domain/projectionHistory.ts";
import { LOW_SAMPLE_GAMES } from "../domain/project.ts";
import { chartMetrics, nearestMatchDay, projectionChart, shownMetric, tooltipAt } from "./projectionChart.ts";

function point(
  matchDay: string,
  playoffs: Record<number, number | null>,
  projectedPoints: Record<number, number> = {},
  gamesPlayed: Record<number, number> = {},
  ranks: Record<number, number> = {},
): HistoryPoint {
  return {
    matchDay,
    teams: Object.fromEntries(
      Object.entries(playoffs).map(([teamId, chance], index) => [
        teamId,
        { projectedPoints: projectedPoints[Number(teamId)] ?? 60, rank: ranks[Number(teamId)] ?? index + 1, gamesPlayed: gamesPlayed[Number(teamId)] ?? 0, playoffs: chance, first: chance === null ? null : 0.1 },
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
    expect(projectionChart(history, 1, "playoffs")!.guides).toEqual([0.5]);
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
    expect(projectionChart(history, 1, "playoffs")!.summary).toBe("Playoff chance 80% now, 50% at the start of the season, up 20 pts since the previous match day.");
    expect(projectionChart(history, 2, "playoffs")!.summary).toBe("Playoff chance 30% now, 50% at the start of the season, down 10 pts since the previous match day.");
    expect(projectionChart(history, 3, "playoffs")!.summary).toBe("Playoff chance 40% now, 50% at the start of the season, down 10 pts since the previous match day.");
  });

  it("says a chance is unchanged when it did not move", () => {
    const flat = [point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: 0.5 })];
    expect(projectionChart(flat, 1, "playoffs")!.summary).toBe("Playoff chance 50% now, 50% at the start of the season, unchanged since the previous match day.");
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
    expect(chart.guides).toEqual([]);
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
    expect(projectionChart(points, 1, "points")!.summary).toBe("Projected points 62.0 now, 60.0 at the start of the season, down 2.0 since the previous match day.");
    expect(projectionChart(points, 3, "points")!.summary).toBe("Projected points 70.0 now, 60.0 at the start of the season, up 9.0 since the previous match day.");
    const flat = [point(SEASON_START, { 1: 0.5 }, { 1: 60 }), point("2026-09-15", { 1: 0.5 }, { 1: 60 })];
    expect(projectionChart(flat, 1, "points")!.summary).toBe("Projected points 60.0 now, 60.0 at the start of the season, unchanged since the previous match day.");
  });
});

describe("projectionChart tooltips", () => {
  const tipped: ProjectionHistory = [
    point(SEASON_START, { 1: 0.5, 2: 0.5 }, { 1: 60, 2: 60 }),
    point("2026-09-15", { 1: 0.54, 2: 0.4 }, { 1: 61.2, 2: 58 }),
    point("2026-09-18", { 1: 0.53, 2: 0.3 }, { 1: 60, 2: 52 }),
  ];

  it("has one tooltip per Match Day, on the chosen team's line only", () => {
    const chart = projectionChart(tipped, 1, "playoffs")!;
    const chosen = chart.lines.find((line) => line.chosen)!;
    expect(chart.tooltips.map(({ x, y }) => ({ x, y }))).toEqual(chosen.points);
  });

  it("shows the date, the playoff chance, the 1st-place chance and the signed change", () => {
    const chart = projectionChart(tipped, 1, "playoffs")!;
    expect(chart.tooltips[1]!.lines).toEqual(["15 Sep", "Playoffs 54%", "1st place 10%", "+4 pts"]);
    expect(chart.tooltips[2]!.lines).toEqual(["18 Sep", "Playoffs 53%", "1st place 10%", "−1 pts"]);
  });

  it("shows the projected Points in the Points view, with the change in Points", () => {
    const chart = projectionChart(tipped, 1, "points")!;
    expect(chart.tooltips[1]!.lines).toEqual(["15 Sep", "Points 61.2", "1st place 10%", "+1.2 points"]);
    expect(chart.tooltips[2]!.lines.at(-1)).toBe("−1.2 points");
  });

  it("gives the first point no change, and names it the Season start", () => {
    expect(projectionChart(tipped, 1, "playoffs")!.tooltips[0]!.lines).toEqual(["Season start", "Playoffs 50%", "1st place 10%"]);
  });

  it("leaves out the 1st-place chance for a Points-only model", () => {
    const pointsOnly = [point(SEASON_START, { 1: null }, { 1: 60 }), point("2026-09-15", { 1: null }, { 1: 63 })];
    expect(projectionChart(pointsOnly, 1, "points")!.tooltips.map((tip) => tip.lines)).toEqual([
      ["Season start", "Points 60.0"],
      ["15 Sep", "Points 63.0", "+3.0 points"],
    ]);
  });

  it("shows a change that rounds to nothing as 0", () => {
    const flat = [point(SEASON_START, { 1: 0.5 }, { 1: 60 }), point("2026-09-15", { 1: 0.502 }, { 1: 60.01 })];
    expect(projectionChart(flat, 1, "playoffs")!.tooltips[1]!.lines.at(-1)).toBe("0 pts");
    expect(projectionChart(flat, 1, "points")!.tooltips[1]!.lines.at(-1)).toBe("0.0 points");
  });
});

describe("nearestMatchDay", () => {
  it("picks the Match Day nearest a share of the plot's width", () => {
    expect(nearestMatchDay(0, 5)).toBe(0);
    expect(nearestMatchDay(0.13, 5)).toBe(1);
    expect(nearestMatchDay(0.62, 5)).toBe(2);
    expect(nearestMatchDay(0.63, 5)).toBe(3);
    expect(nearestMatchDay(1, 5)).toBe(4);
  });

  it("clamps a share outside the plot", () => {
    expect(nearestMatchDay(-0.2, 5)).toBe(0);
    expect(nearestMatchDay(1.4, 5)).toBe(4);
  });
});

describe("projectionChart Low Sample shading", () => {
  const played = (games: number[]) =>
    games.map((gamesPlayed, index) => point(index === 0 ? SEASON_START : `2026-10-${String(index).padStart(2, "0")}`, { 1: 0.5, 2: 0.5 }, {}, { 1: gamesPlayed, 2: 40 }));

  it("runs from the left edge to the chosen team's last point with fewer than 10 Played Games", () => {
    const chart = projectionChart(played([0, 4, 9, LOW_SAMPLE_GAMES, 12]), 1, "playoffs")!;
    expect(chart.lowSample).toEqual({ from: 0, to: 0.5 });
  });

  it("follows the chosen team, not the field", () => {
    expect(projectionChart(played([0, 4, 9, 10, 12]), 2, "playoffs")!.lowSample).toBeNull();
  });

  it("covers the whole chart while the team is still Low Sample", () => {
    expect(projectionChart(played([0, 3, 6]), 1, "points")!.lowSample).toEqual({ from: 0, to: 1 });
  });

  it("is absent when no point is Low Sample", () => {
    const chart = projectionChart(played([10, 11, 12]), 1, "playoffs")!;
    expect(chart.lowSample).toBeNull();
  });
});

describe("chartMetrics", () => {
  it("offers playoff %, projected Points and Projected Rank for a model with Outcome Probabilities", () => {
    expect(chartMetrics(history)).toEqual(["playoffs", "points", "rank"]);
  });

  it("offers projected Points and Projected Rank for a Points-only model", () => {
    const pointsOnly = [point(SEASON_START, { 1: null }), point("2026-09-15", { 1: null }), point("2026-09-18", { 1: null })];
    expect(chartMetrics(pointsOnly)).toEqual(["points", "rank"]);
  });

  it("offers playoff % only when every point of every team has a chance", () => {
    const partial = [point(SEASON_START, { 1: 0.5 }), point("2026-09-15", { 1: null })];
    expect(chartMetrics(partial)).not.toContain("playoffs");
  });

  it("offers Projected Rank only once it has two points to draw", () => {
    // Every team level at the start: the Rank view leaves that point out, so one Match Day is not enough.
    const level = [point(SEASON_START, { 1: 0.5, 2: 0.5 }, { 1: 60, 2: 60 }), point("2026-09-15", { 1: 0.6, 2: 0.4 }, { 1: 63, 2: 57 })];
    expect(chartMetrics(level)).toEqual(["playoffs", "points"]);
    expect(chartMetrics([...level, point("2026-09-18", { 1: 0.6, 2: 0.4 }, { 1: 64, 2: 56 })])).toEqual(["playoffs", "points", "rank"]);
    // Not level (the Elo Model's Starting Ratings): the start point counts.
    const rated = [point(SEASON_START, { 1: 0.5, 2: 0.5 }, { 1: 61, 2: 59 }), point("2026-09-15", { 1: 0.6, 2: 0.4 }, { 1: 63, 2: 57 })];
    expect(chartMetrics(rated)).toEqual(["playoffs", "points", "rank"]);
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
    expect(shownMetric("rank", ["playoffs", "points"])).toBe("playoffs");
  });

  it("has nothing to show when there is nothing to offer", () => {
    expect(shownMetric("playoffs", [])).toBeNull();
  });
});

describe("projectionChart, Projected Rank", () => {
  /** Four teams; under the Elo Model they start apart, so the Season-start point is drawn. */
  const rated: ProjectionHistory = [
    point(SEASON_START, { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 }, { 1: 62, 2: 61, 3: 60, 4: 59 }, {}, { 1: 1, 2: 2, 3: 3, 4: 4 }),
    point("2026-09-15", { 1: 0.4, 2: 0.6, 3: 0.5, 4: 0.5 }, { 1: 60, 2: 63, 3: 61, 4: 59 }, {}, { 1: 3, 2: 1, 3: 2, 4: 4 }),
    point("2026-09-18", { 1: 0.7, 2: 0.6, 3: 0.5, 4: 0.2 }, { 1: 64, 2: 63, 3: 61, 4: 58 }, {}, { 1: 1, 2: 2, 3: 3, 4: 4 }),
  ];
  /** Every team level at the start, as under Split Form Rate, Season Rate and the Matchup Model. */
  const level: ProjectionHistory = [
    point(SEASON_START, { 1: null, 2: null, 3: null }, { 1: 60, 2: 60, 3: 60 }, {}, { 1: 1, 2: 2, 3: 3 }),
    point("2026-09-15", { 1: null, 2: null, 3: null }, { 1: 61, 2: 63, 3: 58 }, {}, { 1: 2, 2: 1, 3: 3 }),
    point("2026-09-18", { 1: null, 2: null, 3: null }, { 1: 64, 2: 62, 3: 58 }, {}, { 1: 1, 2: 2, 3: 3 }),
    point("2026-09-20", { 1: null, 2: null, 3: null }, { 1: 64, 2: 62, 3: 65 }, {}, { 1: 2, 2: 3, 3: 1 }),
  ];
  const fourteen: ProjectionHistory = [SEASON_START, "2026-09-15"].map((day, index) => {
    const teams = Array.from({ length: 14 }, (_, team) => team + 1);
    const map = (value: (team: number) => number) => Object.fromEntries(teams.map((team) => [team, value(team)]));
    return point(day, map(() => 0.5), map((team) => 80 - team + index), {}, map((team) => team));
  });

  it("puts 1st at the top and last at the bottom, by the history's own rank", () => {
    const chart = projectionChart(rated, 1, "rank")!;
    const y = (teamId: number) => chart.lines.find((line) => line.teamId === teamId)!.points.map((p) => p.y);
    expect(y(1)).toEqual([0, expect.closeTo(2 / 3, 12), 0]);
    expect(y(4)).toEqual([1, 1, 1]);
  });

  it("labels ranks 1, 6, 10 and 14 and draws faint Cut Line guides at 6.5 and 10.5", () => {
    const chart = projectionChart(fourteen, 1, "rank")!;
    expect(chart.yTicks).toEqual([
      { y: 0, text: "1" },
      { y: 5 / 13, text: "6" },
      { y: 9 / 13, text: "10" },
      { y: 1, text: "14" },
    ]);
    expect(chart.guides).toEqual([5.5 / 13, 9.5 / 13]);
  });

  it("keeps the Season-start point when the teams start apart", () => {
    const chart = projectionChart(rated, 1, "rank")!;
    expect(chart.lines.at(-1)!.points.map((p) => p.x)).toEqual([0, 0.5, 1]);
    expect(chart.tooltips).toHaveLength(3);
  });

  it("leaves out the Season-start point when every team is level, on the same x scale and with the Start label", () => {
    const chart = projectionChart(level, 1, "rank")!;
    for (const line of chart.lines) expect(line.points.map((p) => p.x)).toEqual([1 / 3, 2 / 3, 1]);
    expect(chart.xLabels).toEqual(projectionChart(level, 1, "points")!.xLabels);
    expect(chart.xLabels[0]).toEqual({ x: 0, text: "Start" });
    expect(chart.tooltips.map(({ x, y }) => ({ x, y }))).toEqual(chart.lines.at(-1)!.points);
    expect(chart.steps).toBe(4);
  });

  it("shows the date, the Projected Rank, the 1st-place chance and the places gained, + for a climb", () => {
    const chart = projectionChart(rated, 1, "rank")!;
    expect(chart.tooltips.map((tip) => tip.lines)).toEqual([
      ["Season start", "Projected 1st", "1st place 10%"],
      ["15 Sep", "Projected 3rd", "1st place 10%", "−2 places"],
      ["18 Sep", "Projected 1st", "1st place 10%", "+2 places"],
    ]);
    expect(projectionChart(rated, 4, "rank")!.tooltips[1]!.lines.at(-1)).toBe("0 places");
  });

  it("gives the first drawn point no change, and leaves out the 1st-place chance for a Points-only model", () => {
    expect(projectionChart(level, 1, "rank")!.tooltips.map((tip) => tip.lines)).toEqual([
      ["15 Sep", "Projected 2nd"],
      ["18 Sep", "Projected 1st", "+1 place"],
      ["20 Sep", "Projected 2nd", "−1 place"],
    ]);
  });

  it("summarises the chosen team's Projected Rank for screen readers", () => {
    expect(projectionChart(rated, 1, "rank")!.summary).toBe("Projected 1st now, 1st at the start of the season, up 2 places since the previous match day.");
    expect(projectionChart(rated, 4, "rank")!.summary).toBe("Projected 4th now, 4th at the start of the season, unchanged since the previous match day.");
    expect(projectionChart(level, 2, "rank")!.summary).toBe("Projected 3rd now, 1st after the first match day, down 1 place since the previous match day.");
  });

  it("keeps the Low Sample band and the x scale of the other views", () => {
    const chart = projectionChart(level, 1, "rank")!;
    expect(chart.lowSample).toEqual(projectionChart(level, 1, "points")!.lowSample);
  });

  it("is hidden until it has two points to draw", () => {
    expect(projectionChart(level.slice(0, 2), 1, "rank")).toBeNull();
  });
});

describe("tooltipAt", () => {
  it("maps a Match Day on the x scale to its tooltip, the first drawn one before the line starts", () => {
    const level = [SEASON_START, "2026-09-15", "2026-09-18"].map((day, index) => point(day, { 1: null, 2: null }, { 1: 60 + index, 2: 60 - index }));
    const chart = projectionChart(level, 1, "rank")!;
    expect([0, 1, 2].map((matchDay) => tooltipAt(chart, matchDay))).toEqual([0, 0, 1]);
    const points = projectionChart(level, 1, "points")!;
    expect([0, 1, 2].map((matchDay) => tooltipAt(points, matchDay))).toEqual([0, 1, 2]);
  });
});

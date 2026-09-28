import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { TeamDetail } from "./TeamDetail.tsx";
import type { Teams } from "./TeamName.tsx";
import type { ProjectedTableRow } from "../domain/project.ts";
import type { FormWindowGame } from "../domain/form.ts";
import type { HistoryPoint, ProjectionHistory } from "../domain/projectionHistory.ts";
import { formatGameDate } from "./format.ts";
import type { ChartMetric } from "./projectionChart.ts";

const teams: Teams = new Map([
  [1, { id: 1, name: "HC Davos", acronym: "HCD" }],
  [2, { id: 2, name: "SC Bern", acronym: "SCB" }],
  [3, { id: 3, name: "ZSC Lions", acronym: "ZSC" }],
]);

function game(overrides: Partial<FormWindowGame> = {}): FormWindowGame {
  return { gameId: "g1", startsAt: "2026-09-26T17:45:00Z", opponentId: 2, goalsFor: 3, goalsAgainst: 1, decision: "regulation", points: 3, ...overrides };
}

function row(overrides: Partial<ProjectedTableRow> = {}): ProjectedTableRow {
  return {
    rank: 2,
    teamId: 1,
    currentRank: 3,
    movement: 1,
    cutLine: "playoffs",
    currentPoints: 19,
    homeForm: 1.5,
    awayForm: 2,
    homeFormWindow: [game()],
    awayFormWindow: [game({ gameId: "g2" })],
    remainingHomeGames: 4,
    remainingAwayGames: 3,
    projectedPoints: 30.4,
    lowSample: false,
    probabilities: { playoffs: 0.8, playIn: 0.15, eliminated: 0.05, first: 0.1 },
    rankDistribution: [0.1, 0.4, 0.3, 0.2],
    ...overrides,
  };
}

/** A Projection History of two Match Days over teams 1 and 2, with playoff chances unless `playoffs` is null (a Points-only model). */
function history(playoffs: number | null = 0.5): ProjectionHistory {
  const point = (matchDay: string, projectedPoints: number): HistoryPoint => ({
    matchDay,
    teams: {
      1: { projectedPoints, gamesPlayed: 10, playoffs, first: playoffs && 0.1 },
      2: { projectedPoints: projectedPoints + 2, gamesPlayed: 10, playoffs, first: playoffs && 0.1 },
    },
  });
  return [point("season-start", 20), point("2026-09-26", 24)];
}

function panel(
  overrides: {
    row?: ProjectedTableRow;
    history?: ProjectionHistory;
    showProbabilities?: boolean;
    chartMetric?: ChartMetric;
    whatIfActive?: boolean;
  } = {},
) {
  const { showProbabilities = true, chartMetric = "playoffs", whatIfActive = false } = overrides;
  return render(
    <TeamDetail
      row={overrides.row ?? row()}
      history={overrides.history ?? history()}
      teams={teams}
      showProbabilities={showProbabilities}
      chartMetric={chartMetric}
      onChartMetricChange={() => {}}
      whatIfActive={whatIfActive}
    />,
  );
}

/** The text a visitor reads, without markup. */
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** The Form Window headings, home first. */
function formWindowHeadings(html: string) {
  return [...html.matchAll(/<section class="form-window"><h3>(.*?)<\/h3>/g)].map((match) => match[1]!);
}

/** The Form Window sections, home first. */
function formWindows(html: string) {
  return [...html.matchAll(/<section class="form-window">(.*?)<\/section>/g)].map((match) => match[1]!);
}

describe("TeamDetail", () => {
  describe("Projection History note", () => {
    const note = "Projection History ignores the What-If.";

    it("says the chart ignores the What-If while one is active, and leaves the chart as it is", () => {
      const html = panel({ whatIfActive: true });
      expect(text(html)).toContain(note);
      expect(html.replace(/<p class="meta history-note">.*?<\/p>/, "")).toBe(panel());
    });

    it("is absent without a What-If", () => {
      expect(text(panel())).not.toContain("What-If");
    });

    it("is absent when the chart itself is not drawn", () => {
      expect(text(panel({ history: [], whatIfActive: true }))).not.toContain(note);
    });
  });

  describe("Form Window headings under Split Form Rate", () => {
    it("show each side's rate per Game × Remaining Games", () => {
      const html = panel({ showProbabilities: false, row: row({ homeForm: 1.5, awayForm: 2, remainingHomeGames: 4, remainingAwayGames: 3 }) });
      expect(formWindowHeadings(html)).toEqual(["Home Form: 1.50 per Game × 4 Remaining", "Away Form: 2.00 per Game × 3 Remaining"]);
    });

    it("borrow the other venue's Form for an empty Form Window and name it", () => {
      const html = panel({ showProbabilities: false, row: row({ homeForm: null, homeFormWindow: [], awayForm: 2 }) });
      expect(formWindowHeadings(html)[0]).toBe("Home Form: 2.00 per Game (Away Form) × 4 Remaining");
      const away = panel({ showProbabilities: false, row: row({ awayForm: null, awayFormWindow: [], homeForm: 1.5 }) });
      expect(formWindowHeadings(away)[1]).toBe("Away Form: 1.50 per Game (Home Form) × 3 Remaining");
    });

    it("show a rate of 0 for a team with no Played Games at either venue", () => {
      const html = panel({
        showProbabilities: false,
        row: row({ homeForm: null, awayForm: null, homeFormWindow: [], awayFormWindow: [] }),
      });
      expect(formWindowHeadings(html)).toEqual(["Home Form: 0 per Game × 4 Remaining", "Away Form: 0 per Game × 3 Remaining"]);
    });
  });

  it("shows the Form and Remaining Games without a rate under models with Outcome Probabilities", () => {
    const html = panel({ showProbabilities: true, row: row({ homeForm: 1.5, awayForm: null, awayFormWindow: [] }) });
    expect(formWindowHeadings(html)).toEqual(["Home Form: 1.50 · 4 Remaining", "Away Form: – · 3 Remaining"]);
    expect(html).not.toContain("per Game");
  });

  describe("Rank Distribution", () => {
    it("appears when the row has one", () => {
      const html = panel();
      expect(html).toContain('<section class="rank-histogram">');
      expect(text(html)).toContain("Rank Distribution");
    });

    it("is left out when the row has none", () => {
      const html = panel({ showProbabilities: false, row: row({ rankDistribution: null, probabilities: null }), history: history(null) });
      expect(html).not.toContain("rank-histogram");
      expect(text(html)).not.toContain("Rank Distribution");
    });
  });

  describe("Form Window tables", () => {
    it("list each Game with date, opponent, score, Decision and Points", () => {
      const html = panel({
        row: row({
          homeFormWindow: [
            game({ gameId: "a", startsAt: "2026-09-26T17:45:00Z", opponentId: 2, goalsFor: 3, goalsAgainst: 1, decision: "regulation", points: 3 }),
            game({ gameId: "b", startsAt: "2026-09-20T17:45:00Z", opponentId: 3, goalsFor: 2, goalsAgainst: 3, decision: "OT", points: 1 }),
          ],
        }),
      });
      const [home] = formWindows(html);
      const body = home!.slice(home!.indexOf("<tbody>"), home!.indexOf("</tbody>"));
      const rows = [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) =>
        [...match[1]!.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((cell) => text(cell[1]!)),
      );
      expect(rows).toEqual([
        [formatGameDate(new Date("2026-09-26T17:45:00Z")), "vs SC Bern", "3:1", "", "3"],
        [formatGameDate(new Date("2026-09-20T17:45:00Z")), "vs ZSC Lions", "2:3", "OT", "1"],
      ]);
    });

    it("prefix away Games with @ and label the columns", () => {
      const html = panel({ row: row({ awayFormWindow: [game({ decision: "SO", opponentId: 3, goalsFor: 2, goalsAgainst: 1, points: 2 })] }) });
      const [, away] = formWindows(html);
      expect(text(away!)).toContain("@ ZSC Lions 2:1 SO 2");
      const headers = [...away!.matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => text(match[1]!));
      expect(headers).toEqual(["Date", "Opponent", "Score", "Decision", "Pts"]);
    });

    it("mark each date for machines", () => {
      expect(panel()).toContain(`<time datetime="2026-09-26T17:45:00Z">${formatGameDate(new Date("2026-09-26T17:45:00Z"))}</time>`);
    });

    it("say so when a Form Window is empty, instead of showing a table", () => {
      const html = panel({ row: row({ homeForm: null, homeFormWindow: [] }) });
      const [home, away] = formWindows(html);
      expect(text(home!)).toContain("No Played home Games yet.");
      expect(home).not.toContain("<table");
      expect(away).toContain("<table");
    });

    it("say so for an empty away window too", () => {
      const html = panel({ row: row({ awayForm: null, awayFormWindow: [] }) });
      const [home, away] = formWindows(html);
      expect(home).toContain("<table");
      expect(text(away!)).toContain("No Played away Games yet.");
    });
  });

  describe("Projection History chart", () => {
    it("shows the chosen metric under a heading, with a toggle when the model can chart more than one", () => {
      const html = panel({ chartMetric: "points" });
      expect(html).toContain("<h3>Projected Points over the Season</h3>");
      expect(html).toContain('class="history-toggle"');
      expect(html).toMatch(/aria-pressed="true"[^>]*>Points<\/button>/);
      expect(html).toMatch(/aria-pressed="false"[^>]*>Playoff %<\/button>/);
    });

    it("charts the playoff chance when that is the chosen metric", () => {
      expect(panel({ chartMetric: "playoffs" })).toContain("<h3>Playoff chance over the Season</h3>");
    });

    it("leaves out the metric toggle when the model can chart only Points, and shows Points whatever was chosen", () => {
      const html = panel({ showProbabilities: false, row: row({ rankDistribution: null, probabilities: null }), history: history(null), chartMetric: "playoffs" });
      expect(html).not.toContain("history-toggle");
      expect(html).toContain("<h3>Projected Points over the Season</h3>");
    });

    it("describes the team's chart for screen readers", () => {
      expect(panel()).toMatch(/<svg[^>]*role="img"[^>]*aria-label="HC Davos: /);
    });

    it("draws no chart before the first Match Day", () => {
      const html = panel({ history: [history()[0]!] });
      expect(html).not.toContain("history-chart");
    });
  });
});

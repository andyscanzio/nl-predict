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
  return { gameId: "g1", startsAt: "2026-09-26T17:45:00Z", opponentId: 2, goalsFor: 3, goalsAgainst: 1, decision: "regulation", points: 3, whatIf: false, ...overrides };
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

/**
 * A Projection History of two Match Days over teams 1 and 2, with playoff chances unless `playoffs` is null (a Points-only model).
 * The teams start apart unless `levelStart`, which leaves the Rank view only one point to draw.
 */
function history(playoffs: number | null = 0.5, levelStart = false): ProjectionHistory {
  const point = (matchDay: string, projectedPoints: number, gap: number): HistoryPoint => ({
    matchDay,
    teams: {
      1: { projectedPoints, rank: gap > 0 ? 2 : 1, gamesPlayed: 10, playoffs, first: playoffs && 0.1 },
      2: { projectedPoints: projectedPoints + gap, rank: gap > 0 ? 1 : 2, gamesPlayed: 10, playoffs, first: playoffs && 0.1 },
    },
  });
  return [point("season-start", 20, levelStart ? 0 : 2), point("2026-09-26", 24, 2)];
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
  return [...html.matchAll(/<section class="form-window[^"]*"><h3>(.*?)<\/h3>/g)].map((match) => text(match[1]!));
}

/** The Form Window sections, home first. */
function formWindows(html: string) {
  return [...html.matchAll(/<section class="form-window[^"]*">(.*?)<\/section>/g)].map((match) => match[1]!);
}

describe("TeamDetail", () => {
  describe("Projection History note", () => {
    const note = "Projection history ignores the what-if.";

    it("says the chart ignores the What-If while one is active, and leaves the chart as it is", () => {
      const html = panel({ whatIfActive: true });
      expect(text(html)).toContain(note);
      expect(html.replace(/<p class="meta history-note">.*?<\/p>/, "")).toBe(panel());
    });

    it("is absent without a What-If", () => {
      expect(text(panel())).not.toContain("what-if");
    });

    it("is absent when the chart itself is not drawn", () => {
      expect(text(panel({ history: [], whatIfActive: true }))).not.toContain(note);
    });
  });

  describe("Form Window headings under Split Form Rate", () => {
    it("show each side's rate per game × remaining games", () => {
      const html = panel({ showProbabilities: false, row: row({ homeForm: 1.5, awayForm: 2, remainingHomeGames: 4, remainingAwayGames: 3 }) });
      expect(formWindowHeadings(html)).toEqual(["Home form: 1.50 per game × 4 remaining", "Away form: 2.00 per game × 3 remaining"]);
    });

    it("borrow the other venue's Form for an empty Form Window, name it, and say no games are played", () => {
      const html = panel({ showProbabilities: false, row: row({ homeForm: null, homeFormWindow: [], awayForm: 2 }) });
      expect(formWindowHeadings(html)[0]).toBe("Home form: 2.00 per game (away) × 4 remaining · no home games played yet");
      const away = panel({ showProbabilities: false, row: row({ awayForm: null, awayFormWindow: [], homeForm: 1.5 }) });
      expect(formWindowHeadings(away)[1]).toBe("Away form: 1.50 per game (home) × 3 remaining · no away games played yet");
    });

    it("show a rate of 0 for a team with no Played Games at either venue", () => {
      const html = panel({
        showProbabilities: false,
        row: row({ homeForm: null, awayForm: null, homeFormWindow: [], awayFormWindow: [] }),
      });
      expect(formWindowHeadings(html)).toEqual([
        "Home form: 0 per game × 4 remaining · no home games played yet",
        "Away form: 0 per game × 3 remaining · no away games played yet",
      ]);
    });
  });

  it("shows the Form and Remaining Games without a rate under models with Outcome Probabilities", () => {
    const html = panel({ showProbabilities: true, row: row({ homeForm: 1.5, awayForm: 1, awayFormWindow: [game()] }) });
    expect(formWindowHeadings(html)).toEqual(["Home form: 1.50 · 4 remaining", "Away form: 1.00 · 3 remaining"]);
    expect(html).not.toContain("per game");
  });

  describe("Rank Distribution", () => {
    it("appears when the row has one", () => {
      const html = panel();
      expect(html).toContain('<section class="rank-histogram">');
      expect(text(html)).toContain("Rank distribution");
    });

    describe("during a What-If", () => {
      const note = "Marks show the real projection.";
      const withReal = (rankDistribution: number[] | null) =>
        panel({
          whatIfActive: true,
          row: row({
            rankDistribution: [0.1, 0.5, 0.3, 0.1],
            realProjection: { rank: 3, projectedPoints: 28, probabilities: null, rankDistribution },
          }),
        });

      it("draws a cap per real chance, the real chance in each label, and the note", () => {
        const html = withReal([0.2, 0.4, 0.4, 0]);
        expect(html.match(/class="rank-bar-cap"/g)).toHaveLength(3);
        expect(html).toContain('title="2nd: 50% (real 40%)"');
        expect(html).toContain("<li>2nd: 50% (real 40%)</li>");
        expect(html).toContain("<li>4th: 10% (real 0%)</li>");
        expect(html).toContain(`<p class="meta history-note">${note}</p>`);
      });

      it("keeps the summary line to the What-If", () => {
        const plain = panel({ row: row({ rankDistribution: [0.1, 0.5, 0.3, 0.1] }) });
        const summary = (html: string) => html.match(/<p class="rank-summary">.*?<\/p>/)![0];
        expect(summary(withReal([0.2, 0.4, 0.4, 0]))).toBe(summary(plain));
      });

      it("shows no caps, note or real chances when the distributions are equal", () => {
        const html = withReal([0.1, 0.5, 0.3, 0.1]);
        expect(html).not.toContain("rank-bar-cap");
        expect(html).not.toContain(note);
        expect(html).not.toContain("real ");
      });

      it("shows none for a Points-only model", () => {
        expect(text(withReal(null))).not.toContain(note);
      });
    });

    it("is left out when the row has none", () => {
      const html = panel({ showProbabilities: false, row: row({ rankDistribution: null, probabilities: null }), history: history(null) });
      expect(html).not.toContain("rank-histogram");
      expect(text(html)).not.toContain("Rank distribution");
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

    it("mark a What-If Result in italic, with 'What-if' and how it was won in place of the made-up score, keeping its Points", () => {
      const html = panel({
        row: row({
          homeFormWindow: [
            game({ gameId: "a", goalsFor: 1, goalsAgainst: 0, decision: "OT", points: 2, whatIf: true }),
            game({ gameId: "b", goalsFor: 0, goalsAgainst: 1, decision: "regulation", points: 0, whatIf: true }),
            game({ gameId: "c" }),
          ],
        }),
      });
      const [home] = formWindows(html);
      const rows = [...home!.matchAll(/<tr( class="what-if")?>(.*?)<\/tr>/g)].slice(1).map((match) => ({
        whatIf: match[1] !== undefined,
        cells: [...match[2]!.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((cell) => text(cell[1]!)).slice(2),
      }));
      expect(rows).toEqual([
        { whatIf: true, cells: ["What-if · OT/SO", "", "2"] },
        { whatIf: true, cells: ["What-if", "", "0"] },
        { whatIf: false, cells: ["3:1", "", "3"] },
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

    it("collapse an empty Form Window to its heading and let the other one take the full width", () => {
      const html = panel({ row: row({ homeForm: null, homeFormWindow: [] }) });
      expect(html).toContain('<section class="form-window empty"><h3>Home form: – · 4 remaining · no home games played yet</h3></section>');
      expect(html).toContain('<div class="form-windows single">');
      const [, away] = formWindows(html);
      expect(away).toContain("<table");
    });

    it("collapse an empty away window too", () => {
      const html = panel({ row: row({ awayForm: null, awayFormWindow: [] }) });
      const [home, away] = formWindows(html);
      expect(home).toContain("<table");
      expect(text(away!)).toBe("Away form: – · 3 remaining · no away games played yet");
    });

    it("sit side by side when both have Games", () => {
      expect(panel()).toContain('<div class="form-windows">');
    });
  });

  describe("Projection History chart", () => {
    it("shows the chosen metric under a heading, with a toggle when the model can chart more than one", () => {
      const html = panel({ chartMetric: "points" });
      expect(html).toContain("<h3>Projected points over the season</h3>");
      expect(html).toContain('class="history-toggle"');
      expect(html).toMatch(/aria-pressed="true"[^>]*>Points<\/button>/);
      expect(html).toMatch(/aria-pressed="false"[^>]*>Playoff %<\/button>/);
      expect(html).toMatch(/aria-pressed="false"[^>]*>Rank<\/button>/);
    });

    it("charts the Projected Rank when that is the chosen metric", () => {
      const html = panel({ chartMetric: "rank" });
      expect(html).toContain("<h3>Projected rank over the season</h3>");
      expect(html).toMatch(/aria-pressed="true"[^>]*>Rank<\/button>/);
    });

    it("gives a Points-only model a Points and Rank toggle", () => {
      const html = panel({ showProbabilities: false, row: row({ rankDistribution: null, probabilities: null }), history: history(null), chartMetric: "rank" });
      expect(html).toContain("<h3>Projected rank over the season</h3>");
      expect(html).toMatch(/aria-pressed="false"[^>]*>Points<\/button>/);
      expect(html).not.toContain("Playoff %");
    });

    it("hides the Rank option until it has two points, falling back to the next view", () => {
      const html = panel({ history: history(0.5, true), chartMetric: "rank" });
      expect(html).not.toMatch(/>Rank<\/button>/);
      expect(html).toContain("<h3>Playoff chance over the season</h3>");
    });

    it("charts the playoff chance when that is the chosen metric", () => {
      expect(panel({ chartMetric: "playoffs" })).toContain("<h3>Playoff chance over the season</h3>");
    });

    it("leaves out the metric toggle when the model can chart only Points, and shows Points whatever was chosen", () => {
      const html = panel({ showProbabilities: false, row: row({ rankDistribution: null, probabilities: null }), history: history(null, true), chartMetric: "playoffs" });
      expect(html).not.toContain("history-toggle");
      expect(html).toContain("<h3>Projected points over the season</h3>");
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

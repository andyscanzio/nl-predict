import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ProjectedTable } from "./ProjectedTable.tsx";
import type { Teams } from "./TeamName.tsx";
import type { ProjectedTableRow, ProjectionModel } from "../domain/project.ts";
import { PROJECTION_MODELS, type ProjectionModelId } from "../domain/projectionModels.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";

const teams: Teams = new Map([
  [1, { id: 1, name: "HC Davos", acronym: "HCD" }],
  [2, { id: 2, name: "SC Bern", acronym: "SCB" }],
  [3, { id: 3, name: "ZSC Lions", acronym: "ZSC" }],
  [4, { id: 4, name: "EV Zug", acronym: "EVZ" }],
]);

const outcomesModel = PROJECTION_MODELS.find((model) => model.kind === "outcomes")!;
const pointsModel = PROJECTION_MODELS.find((model) => model.kind !== "outcomes")!;

function row(overrides: Partial<ProjectedTableRow> = {}): ProjectedTableRow {
  return {
    rank: 1,
    teamId: 1,
    currentRank: 1,
    movement: 0,
    cutLine: "playoffs",
    currentPoints: 20,
    homeForm: 1.5,
    awayForm: 2,
    homeFormWindow: [],
    awayFormWindow: [],
    remainingHomeGames: 4,
    remainingAwayGames: 3,
    projectedPoints: 30,
    lowSample: false,
    probabilities: { playoffs: 0.8, playIn: 0.15, eliminated: 0.05, first: 0.1 },
    rankDistribution: [0.1, 0.4, 0.3, 0.2],
    ...overrides,
  };
}

const history: ProjectionHistory = [];

function panel(rows: ProjectedTableRow[], model: ProjectionModel<ProjectionModelId> = outcomesModel) {
  return render(<ProjectedTable rows={rows} model={model} history={history} whatIfActive={false} teams={teams} onModelChange={() => {}} />);
}

/** The text a visitor reads, without markup. */
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

/** Each team's row of the table, in order, as its opening `<tr>` tag and its markup. */
function teamRows(html: string) {
  return [...html.matchAll(/<tbody class="cut-[\w-]+">(<tr[^>]*>)(.*?)<\/tr>/g)].map((match) => ({ open: match[1]!, html: match[2]! }));
}

/** The gain bar's solid and striped widths in a team's row. */
function gainWidths(rowHtml: string) {
  const now = /gain-bar-now" style="width:([\d.]+)%/.exec(rowHtml)?.[1];
  const gain = /gain-bar-gain" style="left:[\d.]+%;width:([\d.]+)%/.exec(rowHtml)?.[1];
  return { now: Number(now), gain: Number(gain) };
}

describe("ProjectedTable", () => {
  describe("Cut Line breaks", () => {
    const rows = [
      row({ rank: 1, teamId: 1, cutLine: "playoffs" }),
      row({ rank: 2, teamId: 2, cutLine: "playoffs" }),
      row({ rank: 3, teamId: 3, cutLine: "play-in" }),
      row({ rank: 4, teamId: 4, cutLine: "eliminated" }),
    ];

    it("marks the first row of each new Cut Line, and never the first row of the table", () => {
      const marked = teamRows(panel(rows)).map((teamRow) => teamRow.open.includes('class="cut-line"'));
      expect(marked).toEqual([false, false, true, true]);
    });

    it("has no break where the Cut Line stays the same", () => {
      const same = rows.map((r) => ({ ...r, cutLine: "playoffs" as const }));
      expect(teamRows(panel(same)).some((teamRow) => teamRow.open.includes("cut-line"))).toBe(false);
    });
  });

  describe("gain bars", () => {
    it("share one scale set by the highest projected Points", () => {
      const rows = [
        row({ teamId: 1, currentPoints: 20, projectedPoints: 40 }),
        row({ teamId: 2, currentPoints: 10, projectedPoints: 30 }),
      ];
      const [first, second] = teamRows(panel(rows));
      expect(gainWidths(first!.html)).toEqual({ now: 50, gain: 50 });
      expect(gainWidths(second!.html)).toEqual({ now: 25, gain: 50 });
    });

    it("shows no striped gain for a team projected to gain nothing", () => {
      const rows = [
        row({ teamId: 1, currentPoints: 20, projectedPoints: 40 }),
        row({ teamId: 2, currentPoints: 30, projectedPoints: 28 }),
      ];
      const [, behind] = teamRows(panel(rows));
      expect(gainWidths(behind!.html).gain).toBe(0);
    });
  });

  describe("percentage columns", () => {
    it("show Playoffs, Play-in, Eliminated and 1st for a model with Outcome Probabilities", () => {
      const html = panel([row()]);
      for (const label of ["Playoffs %", "Play-in %", "Eliminated %", "1st %"]) expect(text(html)).toContain(label);
      expect(text(html)).toContain("% of");
      expect(text(html)).not.toContain("No % columns");
    });

    it('print remote chances as "<1" and ">99"', () => {
      const html = panel([row({ probabilities: { playoffs: 0.999, playIn: 0.004, eliminated: 0.001, first: 0.5 } })]);
      const cells = [...teamRows(html)[0]!.html.matchAll(/<td class="num pct[^"]*">(.*?)<\/td>/g)].map((match) => text(match[1]!));
      expect(cells).toEqual([">99", "<1", "<1", "50"]);
    });

    it("are absent for Split Form Rate, with a legend line saying why", () => {
      const html = panel([row({ probabilities: undefined, rankDistribution: undefined })], pointsModel);
      expect(html).not.toContain("pct");
      expect(text(html)).toContain(`No % columns: ${pointsModel.name} gives no Outcome Probabilities`);
    });
  });

  describe("expand button", () => {
    it("is collapsed by default and points at its detail row", () => {
      const html = panel([row({ teamId: 2 })]);
      const button = /<button[^>]*class="expand"[^>]*>/.exec(html)![0];
      expect(button).toContain('aria-expanded="false"');
      expect(button).toContain('aria-controls="form-windows-2"');
      expect(html).not.toContain('id="form-windows-2"');
    });
  });

  describe("Low Sample marker", () => {
    it("appears only on Low Sample teams", () => {
      const rows = [row({ teamId: 1, lowSample: true }), row({ teamId: 2, lowSample: false })];
      const [low, ok] = teamRows(panel(rows));
      expect(low!.html).toContain('class="low-sample"');
      expect(ok!.html).not.toContain("low-sample");
    });
  });

  it("lists the Projection Models in the picker, with the picked one checked", () => {
    const html = panel([row()], pointsModel);
    const inputs = [...html.matchAll(/<input[^>]*name="model"[^>]*>/g)].map((match) => match[0]);
    expect(inputs).toHaveLength(PROJECTION_MODELS.length);
    expect(inputs.filter((input) => input.includes("checked"))).toHaveLength(1);
    expect(inputs.find((input) => input.includes("checked"))).toContain(`value="${pointsModel.id}"`);
  });

  describe("What-If Change", () => {
    const changed = (overrides: Partial<ProjectedTableRow>, realRank: number, realPoints: number) =>
      row({ realProjection: { rank: realRank, projectedPoints: realPoints }, ...overrides });
    const projCell = (html: string) => /<td class="num projected-points">(.*?)<\/td>/.exec(teamRows(html)[0]!.html)![1]!;

    it("shows a signed Proj change with a real minus sign, green up and red down", () => {
      const up = projCell(panel([changed({ projectedPoints: 45.2 }, 1, 43.1)]));
      expect(up).toContain('what-if-change up');
      expect(text(up)).toContain("+2");
      const down = projCell(panel([changed({ projectedPoints: 41.2 }, 1, 43.1)]));
      expect(down).toContain('what-if-change down');
      expect(text(down)).toContain("−2");
    });

    it("shows no change when the rounded values match, never +0", () => {
      const cell = projCell(panel([changed({ projectedPoints: 43.4 }, 1, 42.6)]));
      expect(cell).not.toContain("what-if-change");
      expect(text(cell)).toBe("43");
    });

    it("gives screen readers one phrase and hides the stacked number", () => {
      const cell = projCell(panel([changed({ projectedPoints: 43 }, 1, 45)]));
      expect(cell).toContain("43, down 2 from the Real Projection");
      expect(cell).toMatch(/<small[^>]*aria-hidden="true"/);
    });

    it("measures Movement against the real projected rank with the new tooltips", () => {
      const html = panel([
        changed({ rank: 1, teamId: 1, movement: 0 }, 3, 30),
        changed({ rank: 2, teamId: 2, movement: 0 }, 1, 30),
        changed({ rank: 3, teamId: 3, movement: 0 }, 3, 30),
      ]);
      expect(html).toContain("Up 2 from the real projected rank");
      expect(html).toContain("Down 1 from the real projected rank");
      expect(html).toContain("Same as the real projected rank");
      expect(html).toContain("Movement against the real projected rank");
    });

    it("keeps today's Movement text when rows carry no Real Projection", () => {
      const html = panel([row({ movement: 2 })]);
      expect(html).toContain("Up 2 from current rank");
      expect(html).toContain("Movement against current rank");
      expect(html).not.toContain("what-if-change");
    });

    it("shows Movement and the Proj change only for Split Form Rate", () => {
      const html = panel([changed({ projectedPoints: 45, probabilities: null, rankDistribution: null }, 2, 43)], pointsModel);
      expect(html).toContain("Up 1 from the real projected rank");
      expect(text(projCell(html))).toContain("+2");
    });
  });
});

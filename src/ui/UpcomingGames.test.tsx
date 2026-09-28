import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { UpcomingGames } from "./UpcomingGames.tsx";
import type { Teams } from "./TeamName.tsx";
import type { NextRoundDay, UpcomingGame } from "../domain/project.ts";
import type { OutcomeProbabilities } from "../domain/outcomes.ts";

const teams: Teams = new Map([
  [1, { id: 1, name: "HC Davos", acronym: "HCD" }],
  [2, { id: 2, name: "SC Bern", acronym: "SCB" }],
  [3, { id: 3, name: "ZSC Lions", acronym: "ZSC" }],
  [4, { id: 4, name: "EV Zug", acronym: "EVZ" }],
]);

const evenOutcomes: OutcomeProbabilities = {
  regulationWin: 0.3,
  overtimeOrShootoutWin: 0.2,
  overtimeOrShootoutLoss: 0.2,
  regulationLoss: 0.3,
};

/** An Upcoming Game with Outcome Probabilities unless `outcomes` is overridden (null for a Points-only model). */
function upcomingGame(overrides: { id?: string; startsAt?: string; home?: number; away?: number; outcomes?: OutcomeProbabilities | null; points?: { home: number; away: number } } = {}): UpcomingGame {
  const { id = "g1", startsAt = "2026-10-06T17:45:00Z", home = 1, away = 2, outcomes = evenOutcomes, points = { home: 1.5, away: 1.5 } } = overrides;
  return { game: { id, startsAt, homeTeamId: home, awayTeamId: away }, prediction: { points, outcomes } };
}

function day(date: string, ...games: UpcomingGame[]): NextRoundDay {
  return { date, games };
}

function panel(nextRound: NextRoundDay[], lowSample = false) {
  return render(<UpcomingGames nextRound={nextRound} lowSample={lowSample} teams={teams} onWhatIfPick={() => {}} />);
}

/** The text a visitor reads, without markup. */
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

describe("UpcomingGames", () => {
  it("renders nothing when the Next Round is empty", () => {
    expect(panel([])).toBe("");
  });

  it("groups Games under one heading per Match Day, in order", () => {
    const html = panel([
      day("2026-10-06", upcomingGame({ id: "a" }), upcomingGame({ id: "b", home: 3, away: 4 })),
      day("2026-10-08", upcomingGame({ id: "c" })),
    ]);
    const headings = [...html.matchAll(/<h3 class="upcoming-day-heading">([^<]*)<\/h3>/g)].map((match) => match[1]);
    expect(headings).toEqual(["Tue 6 Oct", "Thu 8 Oct"]);
    const games = html.split('<div class="upcoming-day"').slice(1).map((section) => section.match(/class="upcoming-game"/g)?.length);
    expect(games).toEqual([2, 1]);
  });

  it("shows each Game's Swiss start time and both teams", () => {
    const html = panel([day("2026-10-06", upcomingGame())]);
    expect(html).toContain('<time class="upcoming-time" datetime="2026-10-06T17:45:00Z">19:45</time>');
    expect(html).toContain('<span class="team-name">HC Davos</span>');
    expect(html).toContain('<span class="team-acronym">SCB</span>');
  });

  describe("with Outcome Probabilities", () => {
    const html = panel([day("2026-10-06", upcomingGame())]);

    it("shows a win-split bar with each side's win percentage", () => {
      expect(html).toContain('<div class="win-split">');
      expect(html).toContain('<span class="win-split-pct">50</span>');
      expect(html).not.toContain("upcoming-points");
    });

    it("sizes each side by its win chance and its OT/SO slice by its share of those wins", () => {
      // Home wins 75% (half of them in OT/SO), away 25% (a quarter of them in OT/SO).
      const lopsided = panel([day("2026-10-06", upcomingGame({ outcomes: { regulationWin: 0.375, overtimeOrShootoutWin: 0.375, overtimeOrShootoutLoss: 0.0625, regulationLoss: 0.1875 } }))]);
      expect(lopsided).toContain('<span class="win-split-side home" style="flex-grow:0.75;"><span class="win-split-otso" style="width:50%;"></span></span>');
      expect(lopsided).toContain('<span class="win-split-side away" style="flex-grow:0.25;"><span class="win-split-otso" style="width:25%;"></span></span>');
      expect(lopsided).toContain('<span class="win-split-pct">75</span>');
      expect(lopsided).toContain('<span class="win-split-pct">25</span>');
    });

    it("names all four Outcome Probabilities in the hover text", () => {
      expect(html).toContain(
        'title="HC Davos win in regulation 30.0% · HC Davos win in OT/SO 20.0% · SC Bern win in OT/SO 20.0% · SC Bern win in regulation 30.0%"',
      );
    });

    it("shows the win-split legend", () => {
      const legend = text(html.slice(html.indexOf('<ul class="legend">')));
      expect(legend).toBe(
        "Home win Home win in OT/SO Away win in OT/SO Away win Percentages are the chance of winning, in regulation or OT/SO",
      );
    });
  });

  describe("with Points only", () => {
    const html = panel([day("2026-10-06", upcomingGame({ outcomes: null, points: { home: 1.46, away: 1.54 } }))]);

    it("shows each side's expected Points instead of a win-split bar", () => {
      expect(html).toContain('<p class="upcoming-points">1.5 Pts – 1.5 Pts</p>');
      expect(html).not.toContain("win-split");
    });

    it("has no hover text", () => {
      expect(html).not.toContain("title=");
    });

    it("shows the expected-Points legend", () => {
      expect(text(html.slice(html.indexOf('<ul class="legend">')))).toBe("Pts – Pts: expected Points for the home – away team");
    });
  });

  it("shows the Low Sample note only when a team is Low Sample", () => {
    const nextRound = [day("2026-10-06", upcomingGame())];
    expect(text(panel(nextRound, true))).toContain("Some teams are Low Sample, with fewer than 10 Played Games");
    expect(panel(nextRound, false)).not.toContain("Low Sample");
  });

  it("shows a What-If Result's outcome in place of the win-split bar", () => {
    const setGame: UpcomingGame = {
      game: { id: "g1", startsAt: "2026-10-06T17:45:00Z", homeTeamId: 1, awayTeamId: 2 },
      whatIf: "overtimeOrShootoutWin",
    };
    const html = panel([day("2026-10-06", setGame, upcomingGame({ id: "g2", home: 3, away: 4 }))]);
    expect(text(html)).toContain("HC Davos win in OT/SO");
    expect(html.match(/class="win-split"/g)).toHaveLength(1);
  });

  it("drops the legend when every Game has a What-If Result", () => {
    const setGame: UpcomingGame = {
      game: { id: "g1", startsAt: "2026-10-06T17:45:00Z", homeTeamId: 1, awayTeamId: 2 },
      whatIf: "regulationLoss",
    };
    const html = panel([day("2026-10-06", setGame)]);
    expect(html).not.toContain('class="legend"');
    expect(text(html)).toContain("SC Bern win in regulation");
  });

  describe("picker", () => {
    const setGame = (whatIf: UpcomingGame["whatIf"], id = "g1"): UpcomingGame => ({
      game: { id, startsAt: "2026-10-06T17:45:00Z", homeTeamId: 1, awayTeamId: 2 },
      whatIf: whatIf!,
    });

    /** The picker's option values in order, with the checked one. */
    function options(html: string) {
      const inputs = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((match) => match[0]);
      return {
        values: inputs.map((input) => input.match(/value="([^"]*)"/)![1]),
        checked: inputs.filter((input) => /\bchecked\b/.test(input)).map((input) => input.match(/value="([^"]*)"/)![1]),
      };
    }

    it("offers five options on every Game, Model checked by default", () => {
      const html = panel([day("2026-10-06", upcomingGame({ id: "a" }), upcomingGame({ id: "b", outcomes: null }))]);
      expect(html.match(/<fieldset/g)).toHaveLength(2);
      expect(text(html)).toContain("Home Home OT Model Away OT Away");
      const { values, checked } = options(html);
      expect(values).toEqual(Array(2).fill(["regulationWin", "overtimeOrShootoutWin", "model", "overtimeOrShootoutLoss", "regulationLoss"]).flat());
      expect(checked).toEqual(["model", "model"]);
    });

    it("names both teams in a visually hidden legend", () => {
      const html = panel([day("2026-10-06", upcomingGame())]);
      expect(html).toContain('<legend class="visually-hidden">Set the result of HC Davos vs SC Bern</legend>');
    });

    it("gives each Game its own radio group", () => {
      const html = panel([day("2026-10-06", upcomingGame({ id: "a" }), upcomingGame({ id: "b" }))]);
      const names = [...html.matchAll(/<input[^>]*name="([^"]*)"/g)].map((match) => match[1]);
      expect(new Set(names)).toEqual(new Set(["whatif-a", "whatif-b"]));
    });

    it("checks the option of a What-If Result", () => {
      for (const outcome of ["regulationWin", "overtimeOrShootoutWin", "overtimeOrShootoutLoss", "regulationLoss"] as const) {
        expect(options(panel([day("2026-10-06", setGame(outcome))])).checked).toEqual([outcome]);
      }
    });

    it("keeps the picker on a Points-only Game with a What-If Result", () => {
      const html = panel([day("2026-10-06", setGame("regulationWin"))]);
      expect(text(html)).toContain("HC Davos win in regulation");
      expect(html).not.toContain("Pts");
    });
  });
});

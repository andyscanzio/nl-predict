import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { UpcomingGames } from "./UpcomingGames.tsx";
import type { Teams } from "./TeamName.tsx";
import type { LowSampleShare } from "./lowSample.ts";
import type { NextRoundDay, UpcomingGame, WhatIfOutcome } from "../domain/project.ts";
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

function panel(nextRound: NextRoundDay[], lowSample: LowSampleShare = "none") {
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
      expect(text(html.slice(html.indexOf('<ul class="legend">')))).toBe("Pts – Pts: expected points for the home – away team");
    });
  });

  it("shows the Low Sample note only when a team is Low Sample, saying whether it is some or all", () => {
    const nextRound = [day("2026-10-06", upcomingGame())];
    expect(text(panel(nextRound, "some"))).toContain("Some teams are low sample, with fewer than 10 played games");
    expect(text(panel(nextRound, "all"))).toContain("All teams are low sample, with fewer than 10 played games");
    expect(panel(nextRound, "none")).not.toContain("low sample");
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

  describe("result toggles", () => {
    const setGame = (whatIf: WhatIfOutcome): UpcomingGame => ({
      game: { id: "g1", startsAt: "2026-10-06T17:45:00Z", homeTeamId: 1, awayTeamId: 2 },
      whatIf,
    });

    /** Each Game's toggle buttons, as their text and whether they are pressed. */
    function toggles(html: string) {
      return [...html.matchAll(/<div class="what-if-toggles"[^>]*>(.*?)<\/div>/g)].map((group) =>
        [...group[1]!.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((button) => ({
          label: button[2],
          pressed: button[1] === "true",
        })),
      );
    }

    it("offers four toggle buttons on every Game, none pressed by default, and no Model option", () => {
      const html = panel([day("2026-10-06", upcomingGame({ id: "a" }), upcomingGame({ id: "b", outcomes: null }))]);
      const groups = toggles(html);
      expect(groups).toHaveLength(2);
      for (const group of groups) {
        expect(group).toEqual(["Home", "Home OT", "Away OT", "Away"].map((label) => ({ label, pressed: false })));
      }
      expect(html).not.toContain('type="radio"');
      expect(text(html)).not.toContain("Model");
    });

    it("names both teams for screen readers", () => {
      const html = panel([day("2026-10-06", upcomingGame())]);
      expect(html).toMatch(/<div class="what-if-toggles" role="group" aria-label="Set the result of HC Davos vs SC Bern">/);
    });

    it("presses the button of a What-If Result", () => {
      const labels = { regulationWin: "Home", overtimeOrShootoutWin: "Home OT", overtimeOrShootoutLoss: "Away OT", regulationLoss: "Away" };
      for (const [outcome, label] of Object.entries(labels) as [WhatIfOutcome, string][]) {
        const pressed = toggles(panel([day("2026-10-06", setGame(outcome))]))[0]!.filter((button) => button.pressed);
        expect(pressed.map((button) => button.label)).toEqual([label]);
      }
    });
  });
});

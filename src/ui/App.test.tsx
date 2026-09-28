import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { App } from "./App.tsx";
import { DEFAULT_MODEL } from "../domain/projectionModels.ts";
import { project, type WhatIf } from "../domain/project.ts";
import type { Game, Snapshot } from "../domain/types.ts";
import recordedSnapshot from "../domain/__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;

function page(now: Date, whatIf: WhatIf = new Map()) {
  return render(
    <App
      snapshot={snapshot}
      now={now}
      model={DEFAULT_MODEL}
      history={[]}
      whatIf={whatIf}
      onModelChange={() => {}}
      onWhatIfChange={() => {}}
    />,
  );
}

/** The panel headings in page order. */
function headings(html: string) {
  return [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => match[1]!.replace(/<[^>]*>/g, ""));
}

describe("App", () => {
  it("renders the projected table, upcoming games, current table and model explanation in order", () => {
    const html = page(new Date(snapshot.snapshotAt));
    expect(headings(html)).toEqual([
      "Projected table",
      "Upcoming games",
      "Current table",
      `How the projection works: ${DEFAULT_MODEL.name}`,
    ]);
    expect(html.indexOf('<section class="headline"')).toBeLessThan(html.indexOf("<h2>Projected table</h2>"));
    expect(html).not.toContain("No games played yet");
  });

  it("shows the empty state instead of the tables before any Game is played", () => {
    const firstStart = Math.min(...snapshot.games.map((game) => Date.parse(game.startsAt)));
    const html = page(new Date(firstStart - 24 * 60 * 60 * 1000));
    expect(headings(html)).toEqual(["No games played yet"]);
    expect(html).not.toContain("<table");
  });

  it("shows the Headline once, as static text with no pause button", () => {
    const html = page(new Date(snapshot.snapshotAt));
    const headline = /<section class="headline"[^>]*>(.*?)<\/section>/.exec(html)![1]!;
    expect(headline.match(/<p[ >]/g)).toHaveLength(1);
    expect(headline).toContain(`${DEFAULT_MODEL.name} projection:`);
    expect(headline).not.toContain("<button");
    expect(html).not.toContain("ticker");
  });

  describe("with a What-If", () => {
    const asOf = new Date(snapshot.snapshotAt);
    const nextRoundIds = project(snapshot.games, asOf, DEFAULT_MODEL).nextRound.flatMap((day) => day.games.map((g) => g.game.id));
    const banner = (html: string) => html.match(/<div class="warning what-if-banner".*?<\/div>/s)?.[0];
    const text = (html: string | undefined) => html?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    const acronyms = new Map(snapshot.teams.map((team) => [team.id, team.acronym]));
    const names = new Map(snapshot.teams.map((team) => [team.id, team.name]));
    const nextRoundGames = project(snapshot.games, asOf, DEFAULT_MODEL).nextRound.flatMap((day) => day.games.map((g) => g.game));

    it("lists one chip per What-If Result in Next Round order, then Reset, above the Projected Table", () => {
      const [first, second] = nextRoundGames as [Game, Game];
      // Given in reverse, shown in Next Round order.
      const html = page(asOf, new Map([[second.id, "regulationLoss"], [first.id, "overtimeOrShootoutWin"]]));
      const chips = [...banner(html)!.matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((match) => text(match[1]));
      expect(chips).toEqual([
        `${acronyms.get(first.homeTeamId)}–${acronyms.get(first.awayTeamId)}: ${names.get(first.homeTeamId)} win in OT/SO ✕`,
        `${acronyms.get(second.homeTeamId)}–${acronyms.get(second.awayTeamId)}: ${names.get(second.awayTeamId)} win in regulation ✕`,
      ]);
      expect(banner(html)).toMatch(/<button[^>]*>\s*Reset\s*<\/button>\s*<\/div>$/);
      expect(html.indexOf("what-if-banner")).toBeLessThan(html.indexOf("<h2>Projected table</h2>"));
    });

    it("names the Game each ✕ removes", () => {
      const [first] = nextRoundGames as [Game];
      const html = page(asOf, new Map([[first.id, "regulationWin"]]));
      expect(banner(html)).toContain(
        `aria-label="Remove the what-if result of ${names.get(first.homeTeamId)} vs ${names.get(first.awayTeamId)}"`,
      );
    });

    it("explains the What-If in one line", () => {
      const html = page(asOf, new Map([[nextRoundIds[0]!, "regulationWin"]]));
      expect(text(banner(html)!.match(/<p[^>]*>.*?<\/p>/s)![0])).toBe(
        "What-if: the projected table, chances and headline assume these results; small numbers and ▲▼ compare with the real projection.",
      );
    });

    it("presses the picked button of the Game and none of the others", () => {
      const html = page(asOf, new Map([[nextRoundIds[0]!, "overtimeOrShootoutLoss"]]));
      const pressed = [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((match) => match[1]);
      expect(pressed).toEqual(["Away OT"]);
    });

    it("tags the Headline 'What-if' and marks the Current Table as real results", () => {
      const html = page(asOf, new Map([[nextRoundIds[0]!, "regulationWin"]]));
      expect(html).toMatch(/<span class="headline-tag"[^>]*>\s*What-if\s*<\/span>/);
      expect(html).not.toMatch(/<span class="headline-tag"[^>]*>\s*Projection\s*<\/span>/);
      expect(headings(html)).toContain("Current table (real results)");
    });

    it("keeps the Headline tag and Current Table heading as they are without a What-If", () => {
      const html = page(asOf);
      expect(html).toMatch(/<span class="headline-tag"[^>]*>\s*Projection\s*<\/span>/);
      expect(headings(html)).toContain("Current table");
    });

    it("shows neither banner nor Reset without a What-If", () => {
      const html = page(asOf);
      expect(html).not.toContain("What-if");
      expect(html).not.toContain("What-If Change");
      expect(html).not.toContain("Reset");
    });

    it("shows neither banner nor Reset when every entry is stale", () => {
      const played = snapshot.games.find((game) => game.result)!;
      const html = page(asOf, new Map([[played.id, "regulationWin"], ["no-such-game", "regulationLoss"]]));
      expect(html).not.toContain("What-if");
      expect(html).not.toContain("real results");
      expect(html).not.toContain("Reset");
      expect(html).toBe(page(asOf));
    });
  });
});

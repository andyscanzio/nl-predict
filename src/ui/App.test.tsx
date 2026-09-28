import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { App } from "./App.tsx";
import { DEFAULT_MODEL } from "../domain/projectionModels.ts";
import { project, type WhatIf } from "../domain/project.ts";
import type { Snapshot } from "../domain/types.ts";
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
  it("renders Projected Table, Upcoming Games, model explanation and Current Table in order", () => {
    const html = page(new Date(snapshot.snapshotAt));
    expect(headings(html)).toEqual([
      "Projected Table",
      "Upcoming Games",
      `How the projection works: ${DEFAULT_MODEL.name}`,
      "Current Table",
    ]);
    expect(html).not.toContain("No Games played yet");
  });

  it("shows the empty state instead of the tables before any Game is played", () => {
    const firstStart = Math.min(...snapshot.games.map((game) => Date.parse(game.startsAt)));
    const html = page(new Date(firstStart - 24 * 60 * 60 * 1000));
    expect(headings(html)).toEqual(["No Games played yet"]);
    expect(html).not.toContain("<table");
  });

  describe("with a What-If", () => {
    const asOf = new Date(snapshot.snapshotAt);
    const nextRoundIds = project(snapshot.games, asOf, DEFAULT_MODEL).nextRound.flatMap((day) => day.games.map((g) => g.game.id));
    const banner = (html: string) => html.match(/<div class="warning what-if-banner".*?<\/div>/s)?.[0];
    const text = (html: string | undefined) => html?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    it("shows the banner with the count and a Reset button, above the Projected Table", () => {
      const html = page(asOf, new Map([[nextRoundIds[0]!, "regulationWin"], [nextRoundIds[1]!, "regulationLoss"]]));
      expect(text(banner(html))).toContain(
        "What-if: 2 results set. The Projected Table, chances and headline assume them. Reset",
      );
      expect(banner(html)).toMatch(/<button[^>]*>\s*Reset\s*<\/button>/);
      expect(html.indexOf("What-if:")).toBeLessThan(html.indexOf("<h2>Projected Table</h2>"));
    });

    it("says 'result' for a single What-If Result", () => {
      expect(text(banner(page(asOf, new Map([[nextRoundIds[0]!, "overtimeOrShootoutWin"]]))))).toContain(
        "What-if: 1 result set.",
      );
    });

    it("checks the picked option of the Game and leaves the others on Model", () => {
      const html = page(asOf, new Map([[nextRoundIds[0]!, "overtimeOrShootoutLoss"]]));
      const checked = [...html.matchAll(/<input[^>]*type="radio"[^>]*name="whatif-[^>]*>/g)]
        .map((match) => match[0])
        .filter((input) => /\bchecked\b/.test(input))
        .map((input) => input.match(/value="([^"]*)"/)![1]);
      expect(checked.filter((value) => value === "overtimeOrShootoutLoss")).toHaveLength(1);
      expect(checked.filter((value) => value === "model")).toHaveLength(nextRoundIds.length - 1);
    });

    it("shows neither banner nor Reset without a What-If", () => {
      const html = page(asOf);
      expect(html).not.toContain("What-if");
      expect(html).not.toContain("Reset");
    });

    it("shows neither banner nor Reset when every entry is stale", () => {
      const played = snapshot.games.find((game) => game.result)!;
      const html = page(asOf, new Map([[played.id, "regulationWin"], ["no-such-game", "regulationLoss"]]));
      expect(html).not.toContain("What-if");
      expect(html).not.toContain("Reset");
      expect(html).toBe(page(asOf));
    });
  });
});

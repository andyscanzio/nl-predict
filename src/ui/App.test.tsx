import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { App } from "./App.tsx";
import { DEFAULT_MODEL } from "../domain/projectionModels.ts";
import type { Snapshot } from "../domain/types.ts";
import recordedSnapshot from "../domain/__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;

function page(now: Date) {
  return render(<App snapshot={snapshot} now={now} model={DEFAULT_MODEL} history={[]} onModelChange={() => {}} />);
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
});

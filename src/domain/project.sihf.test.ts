import { describe, expect, it } from "vitest";
import { project } from "./project.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";
import officialStandings from "./__fixtures__/standings-2026-09-27.json";

// Both recorded from the live SIHF API on 27.09.2026, with no Game in progress in between.
const snapshot = recordedSnapshot as Snapshot;

/** The official ranks as "rank ACRONYM", read from the positional rows of the SIHF `standing` response. */
function officialRanks(): string[] {
  const column = (alias: string) => officialStandings.header.findIndex((h) => h.alias === alias);
  const [rank, team] = [column("rank"), column("team")];
  return officialStandings.data.map((row) => `${row[rank]} ${(row[team] as { acronym: string }).acronym}`);
}

describe("project: Current Table against the official SIHF standings", () => {
  it("ranks every team as the recorded official standings do", () => {
    const acronyms = new Map(snapshot.teams.map((team) => [team.id, team.acronym]));
    const { currentTable } = project(snapshot.games, new Date(snapshot.snapshotAt), splitFormRate);
    const computed = currentTable.map((row) => `${row.rank} ${acronyms.get(row.teamId)}`);

    // On failure the diff lists each rank where our tie-break approximation disagrees with SIHF.
    expect(computed).toEqual(officialRanks());
  });
});

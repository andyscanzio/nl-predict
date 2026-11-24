import { describe, expect, it } from "vitest";
import { dropAbandonedGames } from "./abandonedGames.ts";
import { project } from "./project.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Game } from "./types.ts";
import snapshot from "../../data/games.json";
import abandonedGames from "../../data/abandoned-games.json";

const scheduled = (id: string, home = 1, away = 2, startsAt = "2026-10-10T19:45:00+02:00"): Game => ({
  id,
  startsAt,
  homeTeamId: home,
  awayTeamId: away,
});
const played = (id: string): Game => ({ ...scheduled(id), result: { homeGoals: 3, awayGoals: 1, decision: "regulation" } });
const entry = (id: string) => ({ id, note: "test" });

describe("dropAbandonedGames", () => {
  const games = [scheduled("a"), played("b"), scheduled("c"), scheduled("d")];

  it("drops a listed Game and passes every other Game through unchanged and in order", () => {
    expect(dropAbandonedGames(games, [entry("c")])).toEqual([games[0], games[1], games[3]]);
  });

  it("ignores a listed id that is not among the Games", () => {
    expect(dropAbandonedGames(games, [entry("zzz")])).toEqual(games);
  });

  it("returns the Games unchanged for an empty list", () => {
    expect(dropAbandonedGames(games, [])).toEqual(games);
  });

  it("throws, naming the Game id, when a listed Game has a result", () => {
    expect(() => dropAbandonedGames(games, [entry("b")])).toThrow(/\bb\b/);
  });
});

describe("an Abandoned Game and its replay", () => {
  const asOf = new Date("2026-10-01T12:00:00+02:00");
  const later = "2026-10-20T19:45:00+02:00";
  const abandoned = scheduled("old", 1, 2, "2026-09-25T19:45:00+02:00");
  const replay = scheduled("replay", 1, 2, later);
  // With the replay, 52 Games between the same two teams remain once the Abandoned Game is dropped.
  const rest = Array.from({ length: 51 }, (_, index) => scheduled(`g${index}`, index % 2 ? 1 : 2, index % 2 ? 2 : 1, later));
  const schedule = [abandoned, replay, ...rest];

  it("shows an integrity issue before the Abandoned Game is dropped, and none after", () => {
    expect(project(schedule, asOf, splitFormRate).integrityIssues).not.toEqual([]);
    const season = dropAbandonedGames(schedule, [entry("old")]);
    expect(project(season, asOf, splitFormRate).integrityIssues).toEqual([]);
  });

  it("keeps the Abandoned Game out of the Remaining Games and the Next Round", () => {
    const season = dropAbandonedGames(schedule, [entry("old")]);
    const projection = project(season, asOf, splitFormRate);
    const nextRoundIds = projection.nextRound.flatMap((day) => day.games.map((upcoming) => ("game" in upcoming ? upcoming.game.id : "")));
    expect(nextRoundIds).not.toContain("old");
    expect(nextRoundIds).toContain("replay");
    expect(projection.projectedTable.flatMap((row) => row.remainingHomeGames + row.remainingAwayGames)).toEqual([52, 52]);
  });
});

describe("the committed Abandoned Game list", () => {
  it("lists no Game that has a result in the snapshot", () => {
    const withResult = new Set(snapshot.games.filter((game) => "result" in game).map((game) => game.id));
    expect(abandonedGames.filter(({ id }) => withResult.has(id))).toEqual([]);
  });
});

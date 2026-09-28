import { describe, expect, it } from "vitest";
import { matchDayOf, SEASON_START } from "./matchDay.ts";
import type { Game } from "./types.ts";

let nextId = 1;
function played(startsAt: string): Game {
  return { id: String(nextId++), startsAt, homeTeamId: 1, awayTeamId: 2, result: { homeGoals: 3, awayGoals: 2, decision: "regulation" } };
}

function remaining(startsAt: string): Game {
  return { id: String(nextId++), startsAt, homeTeamId: 1, awayTeamId: 2 };
}

const asOf = new Date("2026-10-01T12:00:00+02:00");

describe("matchDayOf", () => {
  it("gives the Season-start token before any Game has been played", () => {
    expect(matchDayOf([], asOf)).toBe(SEASON_START);
    expect(matchDayOf([remaining("2026-10-10T19:45:00+02:00")], asOf)).toBe(SEASON_START);
    expect(matchDayOf([played("2026-10-01T19:45:00+02:00")], asOf)).toBe(SEASON_START);
  });

  it("gives the latest Swiss calendar day a Played Game started on", () => {
    const games = [played("2026-09-25T19:45:00+02:00"), played("2026-09-30T19:45:00+02:00"), played("2026-09-27T15:00:00+02:00")];
    expect(matchDayOf(games, asOf)).toBe("2026-09-30");
  });

  it("counts a late-evening Game on its Swiss day, not its UTC day", () => {
    // 23:30 UTC on the 30th is 01:30 on 1 October in Swiss summer time.
    expect(matchDayOf([played("2026-09-30T23:30:00Z")], new Date("2026-10-01T12:00:00Z"))).toBe("2026-10-01");
    // 21:59 UTC on the 30th is still the 30th in Switzerland.
    expect(matchDayOf([played("2026-09-30T21:59:00Z")], asOf)).toBe("2026-09-30");
  });

  it("ignores a Remaining Game that has started or was postponed", () => {
    const games = [
      played("2026-09-28T19:45:00+02:00"),
      remaining("2026-09-30T19:45:00+02:00"), // started, awaiting a result
      remaining("2026-09-29T19:45:00+02:00"), // postponed without a new date
    ];
    expect(matchDayOf(games, asOf)).toBe("2026-09-28");
  });

  it("ignores a Game with a result that starts after the As-Of Date", () => {
    expect(matchDayOf([played("2026-09-28T19:45:00+02:00"), played("2026-10-05T19:45:00+02:00")], asOf)).toBe("2026-09-28");
  });

  it("does not depend on Game order", () => {
    const games = [played("2026-09-25T19:45:00+02:00"), played("2026-09-30T19:45:00+02:00")];
    expect(matchDayOf([...games].reverse(), asOf)).toBe(matchDayOf(games, asOf));
  });
});

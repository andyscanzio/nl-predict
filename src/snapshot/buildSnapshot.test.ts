import { describe, expect, it } from "vitest";
import { buildSnapshot, snapshotChanged, type SihfQuery } from "./buildSnapshot.ts";
import type { Game, Snapshot, Team } from "../domain/types.ts";
import seasonResponse from "./__fixtures__/season-2027.json";
import regularSeasonResponse from "./__fixtures__/regular-season-2027.json";
import day20260915 from "./__fixtures__/day-2026-09-15.json";
import day20260926 from "./__fixtures__/day-2026-09-26.json";
import day20261003 from "./__fixtures__/day-2026-10-03.json";

const now = new Date("2026-09-27T09:00:00+02:00");
const REGULAR_SEASON_PHASE = "657";

const recordedDays: Record<string, unknown> = {
  "15.09.2026": day20260915,
  "26.09.2026": day20260926,
  "03.10.2026": day20261003,
};

/** The recorded Regular Season response, with its Date filter narrowed to the given match days. */
function regularSeasonWithDates(dates: string[]) {
  const copy = structuredClone(regularSeasonResponse);
  const dateFilter = copy.filters.find((f) => f.alias === "Date")!;
  const byYear = new Map<string, Map<string, string[]>>();
  for (const date of dates) {
    const [day, month, year] = date.split(".").map((part) => String(Number(part))) as [string, string, string];
    const months = byYear.get(year) ?? new Map<string, string[]>();
    months.set(month, [...(months.get(month) ?? []), day]);
    byYear.set(year, months);
  }
  dateFilter.entries = [...byYear].map(([year, months]) => ({
    name: year,
    alias: year,
    entries: [...months].map(([month, days]) => ({
      name: month,
      alias: month,
      entries: days.map((day) => ({ name: day, alias: day })),
    })),
  }));
  return copy;
}

/** A fake fetchDay answering from recorded SIHF responses, logging every query it receives. */
function fakeFetchDay(days: Record<string, unknown>, regularSeason: unknown = regularSeasonWithDates(Object.keys(days))) {
  const queries: SihfQuery[] = [];
  const fetchDay = async (query: SihfQuery) => {
    queries.push(query);
    if (query.phase === undefined) return seasonResponse;
    expect(query.phase).toBe(REGULAR_SEASON_PHASE);
    if (query.date === undefined) return regularSeason;
    const response = days[query.date];
    if (!response) throw new Error(`no recorded response for ${query.date}`);
    return response;
  };
  return { fetchDay, queries };
}

describe("buildSnapshot", () => {
  it("fetches every match day listed in the Regular Season's Date filter", async () => {
    const emptyDay = { ...day20260915, data: [] };
    const allDays = new Proxy({} as Record<string, unknown>, { get: () => emptyDay });
    const { fetchDay, queries } = fakeFetchDay(allDays, regularSeasonResponse);

    await buildSnapshot(fetchDay, null, now);

    const dates = queries.flatMap((q) => (q.date ? [q.date] : []));
    expect(dates).toHaveLength(93);
    expect(dates[0]).toBe("15.09.2026");
    expect(dates).toContain("03.10.2026");
    expect(dates.at(-1)).toBe("01.03.2027");
  });

  it("records the Season by its starting year and the snapshot time", async () => {
    const { fetchDay } = fakeFetchDay(recordedDays);
    const snapshot = await buildSnapshot(fetchDay, null, now);
    expect(snapshot.season).toBe(2026);
    expect(snapshot.snapshotAt).toBe("2026-09-27T07:00:00.000Z");
  });

  it("parses regulation, OT and SO results", async () => {
    const { fetchDay } = fakeFetchDay(recordedDays);
    const { games } = await buildSnapshot(fetchDay, null, now);
    const byId = new Map(games.map((game) => [game.id, game]));

    // HC Lugano 6–3 Genève-Servette
    expect(byId.get("20271105000006")).toEqual({
      id: "20271105000006",
      startsAt: "2026-09-15T19:45:00+02:00",
      homeTeamId: 101150,
      awayTeamId: 103140,
      result: { homeGoals: 6, awayGoals: 3, decision: "regulation" },
    });
    // Rapperswil-Jona 3–4 Kloten in overtime
    expect(byId.get("20271105000004")?.result).toEqual({ homeGoals: 3, awayGoals: 4, decision: "OT" });
    // Ajoie 2–3 Ambri-Piotta in a shootout
    expect(byId.get("20271105000001")?.result).toEqual({ homeGoals: 2, awayGoals: 3, decision: "SO" });
  });

  it("counts a result awaiting official confirmation as a result", async () => {
    const { fetchDay } = fakeFetchDay(recordedDays);
    const { games } = await buildSnapshot(fetchDay, null, now);
    // HC Lugano 3–5 Ambri-Piotta on 26.09.2026, status "Ende*"
    expect(games.find((game) => game.id === "20271105000040")?.result).toEqual({
      homeGoals: 3,
      awayGoals: 5,
      decision: "regulation",
    });
  });

  it("keeps scheduled Games without a result", async () => {
    const { fetchDay } = fakeFetchDay(recordedDays);
    const { games } = await buildSnapshot(fetchDay, null, now);
    // SCL Tigers vs Kloten on 03.10.2026
    expect(games.find((game) => game.id === "20271105000062")).toEqual({
      id: "20271105000062",
      startsAt: "2026-10-03T19:45:00+02:00",
      homeTeamId: 102127,
      awayTeamId: 101149,
    });
  });

  it("collects each team once, with name and acronym", async () => {
    const { fetchDay } = fakeFetchDay(recordedDays);
    const { teams, games } = await buildSnapshot(fetchDay, null, now);
    expect(games).toHaveLength(7 + 5 + 5);
    expect(teams).toHaveLength(14);
    expect(teams).toContainEqual({ id: 101139, name: "ZSC Lions", acronym: "ZSC" });
  });

  it("orders Games by scheduled start", async () => {
    const { fetchDay } = fakeFetchDay(recordedDays);
    const { games } = await buildSnapshot(fetchDay, null, now);
    const starts = games.map((game) => Date.parse(game.startsAt));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("de-duplicates Games listed on more than one match day by game id", async () => {
    const { fetchDay } = fakeFetchDay({ "26.09.2026": day20260926, "27.09.2026": day20260926 });
    const { games } = await buildSnapshot(fetchDay, null, now);
    expect(games).toHaveLength(5);
  });

  it("refuses a Season without a Regular Season phase", async () => {
    const seasonWithoutPhase = structuredClone(seasonResponse);
    const phaseFilter = seasonWithoutPhase.filters.find((f) => f.alias === "Phase")!;
    phaseFilter.entries = phaseFilter.entries.filter((entry) => entry.alias === "all");
    const fetchDay = async (query: SihfQuery) => (query.phase === undefined ? seasonWithoutPhase : {});
    await expect(buildSnapshot(fetchDay, null, now)).rejects.toThrow(/Regular Season/);
  });

  it("refuses a match day whose rows lack an expected column", async () => {
    const broken = structuredClone(day20260915);
    broken.header = broken.header.filter((column) => column.alias !== "decision");
    const { fetchDay } = fakeFetchDay({ "15.09.2026": broken });
    await expect(buildSnapshot(fetchDay, null, now)).rejects.toThrow(/decision/);
  });

  it("refuses a finished Game with an unknown Decision", async () => {
    const broken = structuredClone(day20260915);
    const decisionColumn = broken.header.findIndex((column) => column.alias === "decision");
    (broken.data[0] as unknown[])[decisionColumn] = "Penalty";
    const { fetchDay } = fakeFetchDay({ "15.09.2026": broken });
    await expect(buildSnapshot(fetchDay, null, now)).rejects.toThrow(/Decision/);
  });
});

describe("buildSnapshot: incremental refresh", () => {
  const emptyDay = { ...day20260915, data: [] };

  function fetchedDates(queries: SihfQuery[]) {
    return queries.flatMap((q) => (q.date ? [q.date] : []));
  }

  /** A previous snapshot of the 2026/27 Season holding the given Games. */
  function previousWith(
    games: Game[],
    { season = 2026, teams = [] as Team[], snapshotAt = "2026-09-27T05:00:00.000Z" } = {},
  ): Snapshot {
    return { season, snapshotAt, teams, games };
  }

  function scheduledOn(id: string, startsAt: string): Game {
    return { id, startsAt, homeTeamId: 101150, awayTeamId: 103140 };
  }

  it("re-reads the Season date list, re-fetches the last 7 days and fetches dates not yet in the snapshot", async () => {
    const days = {
      "15.09.2026": emptyDay,
      "19.09.2026": emptyDay,
      "20.09.2026": emptyDay,
      "27.09.2026": emptyDay,
      "03.10.2026": emptyDay,
      "04.10.2026": emptyDay,
    };
    const previous = previousWith([
      scheduledOn("a", "2026-09-15T19:45:00+02:00"),
      scheduledOn("b", "2026-09-19T19:45:00+02:00"),
      scheduledOn("c", "2026-09-20T19:45:00+02:00"),
      scheduledOn("d", "2026-09-27T15:45:00+02:00"),
      scheduledOn("e", "2026-10-04T15:45:00+02:00"),
    ]);
    const { fetchDay, queries } = fakeFetchDay(days);

    await buildSnapshot(fetchDay, previous, now);

    expect(queries.filter((q) => q.date === undefined)).toHaveLength(2);
    // 15.09 and 19.09 are settled; 20.09–27.09 fall in the last 7 days; 03.10 is new; 04.10 is known.
    expect(fetchedDates(queries)).toEqual(["20.09.2026", "27.09.2026", "03.10.2026"]);
  });

  it("re-fetches from 7 days before the previous snapshot when refreshes have lapsed", async () => {
    const days = { "10.09.2026": emptyDay, "12.09.2026": emptyDay, "20.09.2026": emptyDay };
    const previous = previousWith(
      [
        scheduledOn("a", "2026-09-10T19:45:00+02:00"),
        scheduledOn("b", "2026-09-12T19:45:00+02:00"),
        scheduledOn("c", "2026-09-20T19:45:00+02:00"),
      ],
      { snapshotAt: "2026-09-18T21:00:00.000Z" },
    );
    const { fetchDay, queries } = fakeFetchDay(days);

    await buildSnapshot(fetchDay, previous, now);

    // The last refresh was on 18.09, so 11.09 onwards may hold results it never saw.
    expect(fetchedDates(queries)).toEqual(["12.09.2026", "20.09.2026"]);
  });

  it("keeps settled Games, updates re-fetched ones and adds new ones", async () => {
    const { fetchDay: fetchAll } = fakeFetchDay(recordedDays);
    const full = await buildSnapshot(fetchAll, null, now);
    // The previous snapshot knew 15.09 (with a doctored score, to show it is left alone) and 26.09 without results.
    const doctored = { homeGoals: 9, awayGoals: 0, decision: "regulation" } as const;
    const previous = previousWith(
      full.games
        .filter((game) => !game.startsAt.startsWith("2026-10-03"))
        .map((game) =>
          game.startsAt.startsWith("2026-09-15")
            ? { ...game, result: doctored }
            : (({ result: _, ...scheduled }) => scheduled)(game),
        ),
      { teams: full.teams },
    );
    const { fetchDay, queries } = fakeFetchDay(recordedDays);

    const snapshot = await buildSnapshot(fetchDay, previous, now);

    expect(fetchedDates(queries)).toEqual(["26.09.2026", "03.10.2026"]);
    expect(snapshot.snapshotAt).toBe(now.toISOString());
    expect(snapshot.teams).toEqual(full.teams);
    const byId = new Map(snapshot.games.map((game) => [game.id, game]));
    expect(snapshot.games).toHaveLength(full.games.length);
    expect(byId.get("20271105000006")?.result).toEqual(doctored);
    expect(byId.get("20271105000040")?.result).toEqual({ homeGoals: 3, awayGoals: 5, decision: "regulation" });
    expect(byId.get("20271105000062")).toBeDefined();
  });

  it("lists a rescheduled Game once, on its new date", async () => {
    // SCL Tigers vs Kloten was scheduled for 12.09 in the previous snapshot and now sits on 03.10.
    const previous = previousWith([
      { id: "20271105000062", startsAt: "2026-09-12T19:45:00+02:00", homeTeamId: 102127, awayTeamId: 101149 },
    ]);
    const { fetchDay } = fakeFetchDay({ "03.10.2026": day20261003 });

    const { games } = await buildSnapshot(fetchDay, previous, now);

    const moved = games.filter((game) => game.id === "20271105000062");
    expect(moved).toEqual([expect.objectContaining({ startsAt: "2026-10-03T19:45:00+02:00" })]);
  });

  it("ignores a previous snapshot of another Season", async () => {
    const previous = previousWith([scheduledOn("old", "2026-09-15T19:45:00+02:00")], { season: 2025 });
    const { fetchDay, queries } = fakeFetchDay(recordedDays);

    const { games } = await buildSnapshot(fetchDay, previous, now);

    expect(fetchedDates(queries)).toEqual(["15.09.2026", "26.09.2026", "03.10.2026"]);
    expect(games.map((game) => game.id)).not.toContain("old");
  });

  it("refuses to produce a snapshot when a re-fetched match day is malformed", async () => {
    const previous = previousWith([scheduledOn("a", "2026-09-26T19:45:00+02:00")]);
    const { fetchDay } = fakeFetchDay({ "26.09.2026": { header: [], data: [] } });
    await expect(buildSnapshot(fetchDay, previous, now)).rejects.toThrow(/column/);
  });
});

describe("snapshotChanged", () => {
  const game: Game = { id: "a", startsAt: "2026-09-26T19:45:00+02:00", homeTeamId: 101150, awayTeamId: 103140 };
  const previous: Snapshot = { season: 2026, snapshotAt: "2026-09-26T21:00:00.000Z", teams: [], games: [game] };

  it("is false when only the snapshot time differs", () => {
    expect(snapshotChanged(previous, { ...previous, snapshotAt: "2026-09-27T05:00:00.000Z" })).toBe(false);
  });

  it("is true when a Game gains a result", () => {
    const played = { ...game, result: { homeGoals: 2, awayGoals: 1, decision: "OT" } as const };
    expect(snapshotChanged(previous, { ...previous, games: [played] })).toBe(true);
  });

  it("is true when there is no previous snapshot", () => {
    expect(snapshotChanged(null, previous)).toBe(true);
  });
});

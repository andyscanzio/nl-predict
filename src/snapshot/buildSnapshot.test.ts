import { describe, expect, it } from "vitest";
import { buildSnapshot, type SihfQuery } from "./buildSnapshot.ts";
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

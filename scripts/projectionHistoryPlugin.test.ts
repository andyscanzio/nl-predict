import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECTION_MODELS } from "../src/domain/projectionModels.ts";
import type { Game, Snapshot } from "../src/domain/types.ts";

// The plugin reads the real Abandoned Game list and cache file by fixed path; stand both in memory so the test touches neither.
const fake = vi.hoisted(() => ({ abandoned: "[]", cache: new Map<string, string>() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: string, ...rest: unknown[]) => {
    if (path.endsWith("abandoned-games.json")) return fake.abandoned;
    if (path.endsWith("projection-history.json")) {
      const cached = fake.cache.get(path);
      if (cached === undefined) throw new Error("ENOENT");
      return cached;
    }
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.readFileSync;
  const writeFileSync = ((path: string, data: string, ...rest: unknown[]) => {
    if (path.endsWith("projection-history.json")) return void fake.cache.set(path, data);
    return (fs.writeFileSync as (...args: unknown[]) => unknown)(path, data, ...rest);
  }) as typeof fs.writeFileSync;
  return { ...fs, default: { ...fs, readFileSync, writeFileSync }, readFileSync, writeFileSync, mkdirSync: () => undefined };
});

const { projectionHistoryPlugin } = await import("./projectionHistoryPlugin.ts");

const played = (id: string, startsAt: string, home: number, away: number): Game => ({ id, startsAt, homeTeamId: home, awayTeamId: away, result: { homeGoals: 3, awayGoals: 1, decision: "regulation" } });
const snapshot: Snapshot = {
  season: 2026,
  snapshotAt: "2026-11-23T00:00:00Z",
  teams: [1, 2, 3, 4].map((id) => ({ id, name: `Team ${id}`, acronym: `T${id}` })),
  games: [
    played("g1", "2026-10-01T19:45:00+02:00", 1, 2),
    { id: "abandoned", startsAt: "2026-11-11T19:45:00+01:00", homeTeamId: 3, awayTeamId: 4 },
    { id: "g3", startsAt: "2026-12-01T19:45:00+01:00", homeTeamId: 3, awayTeamId: 4 },
  ],
};

const model = PROJECTION_MODELS.find((candidate) => candidate.id !== "elo") ?? PROJECTION_MODELS[0]!;
let dir: string;
let gamesPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "history-plugin-"));
  gamesPath = join(dir, "games.json");
  writeFileSync(gamesPath, JSON.stringify(snapshot));
  fake.abandoned = "[]";
  fake.cache.clear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function load(): string {
  const plugin = projectionHistoryPlugin(gamesPath, [model]) as Plugin & { load: (this: unknown, id: string) => string };
  return plugin.load.call({ addWatchFile: () => undefined }, "\0virtual:projection-history");
}

describe("projectionHistoryPlugin", () => {
  it("builds the history as if an Abandoned Game was never scheduled", () => {
    const withoutGame = { ...snapshot, games: snapshot.games.filter((game) => game.id !== "abandoned") };
    writeFileSync(gamesPath, JSON.stringify(withoutGame));
    const expected = load();
    fake.cache.clear();
    writeFileSync(gamesPath, JSON.stringify(snapshot));
    expect(load()).not.toBe(expected);
    fake.cache.clear();
    fake.abandoned = JSON.stringify([{ id: "abandoned", note: "stopped, replayed as g3" }]);
    expect(load()).toBe(expected);
  });

  it("rebuilds the cached history when the Abandoned Game list changes", () => {
    const first = load();
    expect(load()).toBe(first);
    expect(fake.cache.size).toBe(1);
    fake.abandoned = JSON.stringify([{ id: "abandoned", note: "stopped, replayed as g3" }]);
    load();
    const [cached] = [...fake.cache.values()];
    expect(JSON.parse(cached!).code).not.toBe(first);
  });
});

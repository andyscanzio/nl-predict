import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { cachedOrComputed, domainSourceHash, hashOf } from "./historyCache.ts";
import type { ProjectionModel } from "../src/domain/project.ts";
import { projectionHistory } from "../src/domain/projectionHistory.ts";
import type { Snapshot } from "../src/domain/types.ts";

const VIRTUAL_ID = "virtual:projection-history";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const DOMAIN_DIR = new URL("../src/domain", import.meta.url).pathname;
/** Gitignored; a cold checkout (CI) simply computes. */
const CACHE_FILE = new URL("../.cache/projection-history.json", import.meta.url).pathname;

/** Decimals kept in the shipped history: finer than the chart and its tooltips can show. */
const DECIMALS = 4;

/** Rounds every number in the history, so the page ships only the precision it can display. */
function rounded(_key: string, value: unknown): unknown {
  return typeof value === "number" ? Number(value.toFixed(DECIMALS)) : value;
}

/**
 * Provides `virtual:projection-history`: the Projection History of every model, keyed by model id, computed from the Games
 * snapshot at `gamesPath` (ADR 0003). A thin wrapper: all projection logic is in the domain. A computing error fails the build.
 *
 * The module is cached on disk, keyed by the snapshot, the domain source and the models, so restarting `vite dev` skips the
 * replay. A missing or corrupt cache just computes.
 */
export function projectionHistoryPlugin(gamesPath: string, models: readonly ProjectionModel[]): Plugin {
  return {
    name: "projection-history",
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      this.addWatchFile(gamesPath);
      const snapshot = readFileSync(gamesPath, "utf8");
      // This file is in the key too: it decides the rounding and the shape of the module.
      const pluginSource = readFileSync(import.meta.filename, "utf8");
      const key = hashOf(snapshot, domainSourceHash(DOMAIN_DIR), pluginSource, ...models.map((model) => model.id));
      return cachedOrComputed(CACHE_FILE, key, () => {
        const { games } = JSON.parse(snapshot) as Snapshot;
        const histories = Object.fromEntries(models.map((model) => [model.id, projectionHistory(games, model)]));
        return `export default ${JSON.stringify(histories, rounded)};`;
      });
    },
  };
}

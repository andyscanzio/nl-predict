import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import type { ProjectionModel } from "../src/domain/project.ts";
import { projectionHistory } from "../src/domain/projectionHistory.ts";
import type { Snapshot } from "../src/domain/types.ts";

const VIRTUAL_ID = "virtual:projection-history";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Decimals kept in the shipped history: finer than the chart and its tooltips can show. */
const DECIMALS = 4;

/** Rounds every number in the history, so the page ships only the precision it can display. */
function rounded(_key: string, value: unknown): unknown {
  return typeof value === "number" ? Number(value.toFixed(DECIMALS)) : value;
}

/**
 * Provides `virtual:projection-history`: the Projection History of every model, keyed by model id, computed from the Games
 * snapshot at `gamesPath` (ADR 0003). A thin wrapper: all projection logic is in the domain. Any error fails the build.
 */
export function projectionHistoryPlugin(gamesPath: string, models: readonly ProjectionModel[]): Plugin {
  return {
    name: "projection-history",
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      this.addWatchFile(gamesPath);
      const { games } = JSON.parse(readFileSync(gamesPath, "utf8")) as Snapshot;
      const histories = Object.fromEntries(models.map((model) => [model.id, projectionHistory(games, model)]));
      return `export default ${JSON.stringify(histories, rounded)};`;
    },
  };
}

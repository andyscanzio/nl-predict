/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { projectionHistoryPlugin } from "./scripts/projectionHistoryPlugin.ts";
import { ALL_MODELS } from "./src/domain/projectionModels.ts";

export default defineConfig({
  plugins: [preact(), projectionHistoryPlugin(new URL("./data/games.json", import.meta.url).pathname, ALL_MODELS)],
  base: "./",
  test: {
    // The Monte Carlo projections run ~1.5s locally but 2-3x slower on the shared CI runner, where the 5s default
    // started timing out once the Post-Season tests added load.
    testTimeout: 30_000,
  },
});

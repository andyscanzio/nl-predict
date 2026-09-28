import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { projectionHistoryPlugin } from "./scripts/projectionHistoryPlugin.ts";
import { PROJECTION_MODELS } from "./src/domain/projectionModels.ts";

export default defineConfig({
  plugins: [preact(), projectionHistoryPlugin(new URL("./data/games.json", import.meta.url).pathname, PROJECTION_MODELS)],
  base: "./",
});

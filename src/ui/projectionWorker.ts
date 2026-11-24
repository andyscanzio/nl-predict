// Runs the Season Simulation off the page's main thread, so the page paints and answers taps while it plays out.
import snapshot from "../../data/games.json";
import abandonedGames from "../../data/abandoned-games.json";
import { dropAbandonedGames } from "../domain/abandonedGames.ts";
import type { Snapshot } from "../domain/types.ts";
import { projectionAnswerer, type ProjectionRequest } from "./projectionRequests.ts";

const answer = projectionAnswerer(dropAbandonedGames((snapshot as Snapshot).games, abandonedGames));

// The DOM typings describe `self` as a window; in a dedicated worker, postMessage takes the message alone.
const scope = self as unknown as { postMessage(message: unknown): void };

addEventListener("message", (event: MessageEvent<ProjectionRequest>) => scope.postMessage(answer(event.data)));

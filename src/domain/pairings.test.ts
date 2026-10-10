import { describe, expect, it } from "vitest";
import { pairingGameId, pairingGames } from "./pairings.ts";
import { projectionModelInput } from "./project.ts";
import { ALL_MODELS } from "./projectionModels.ts";
import { seededRandom } from "./seasonSimulation.ts";
import type { Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;
const input = projectionModelInput(snapshot.games, new Date(snapshot.snapshotAt));
const teamIds = input.currentTable.map((row) => row.teamId);
const withPairings = { ...input, remainingGames: [...input.remainingGames, ...pairingGames(teamIds)] };

describe("pairingGames", () => {
  it("has one Game per ordered pair of teams, never a team against itself", () => {
    const games = pairingGames(teamIds);
    expect(games).toHaveLength(14 * 13);
    expect(games.every((game) => game.homeTeamId !== game.awayTeamId)).toBe(true);
    expect(new Set(games.map((game) => game.id)).size).toBe(games.length);
    expect(games.map((game) => game.id)).toContain(pairingGameId(teamIds[0]!, teamIds[1]!));
    expect(games.map((game) => game.id)).toContain(pairingGameId(teamIds[1]!, teamIds[0]!));
  });

  it("never shares an id with a real Game", () => {
    const realIds = new Set(snapshot.games.map((game) => game.id));
    expect(pairingGames(teamIds).some((game) => realIds.has(game.id))).toBe(false);
  });

  it("has no result", () => {
    expect(pairingGames(teamIds).every((game) => game.result === undefined)).toBe(true);
  });
});

for (const model of ALL_MODELS) {
  if (model.kind !== "outcomes") continue;

  describe(`${model.name} with the pairings appended to the Remaining Games`, () => {
    it("predicts every real Remaining Game identically", () => {
      const without = model.predictOutcomes(input);
      const withThem = model.predictOutcomes(withPairings);
      for (const game of input.remainingGames) expect(withThem.get(game.id)).toEqual(without.get(game.id));
    });

    it("predicts every pairing", () => {
      const predictions = model.predictOutcomes(withPairings);
      for (const game of pairingGames(teamIds)) expect(predictions.has(game.id)).toBe(true);
    });

    if (model.sampleOutcomes) {
      it("samples every real Remaining Game identically, run after run, and every pairing after them", () => {
        const without = model.sampleOutcomes!(input);
        const withThem = model.sampleOutcomes!(withPairings);
        const [randomWithout, randomWith] = [seededRandom(42), seededRandom(42)];
        for (let run = 0; run < 3; run++) {
          const sampledWithout = without(randomWithout);
          const sampledWith = withThem(randomWith);
          expect(sampledWith).toHaveLength(input.remainingGames.length + 14 * 13);
          expect(sampledWith.slice(0, input.remainingGames.length)).toEqual(sampledWithout);
        }
      });
    }
  });
}

import { describe, expect, it } from "vitest";
import { project, type Projection } from "./project.ts";
import { ALL_MODELS } from "./projectionModels.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;
const asOf = new Date(snapshot.snapshotAt);

/** A Projection as it is without the Post-Season option: its pairings dropped. */
const withoutPairings = ({ pairingOutcomes: _, ...projection }: Projection) => projection;

describe("project with the Post-Season option", () => {
  for (const model of ALL_MODELS) {
    if (model.kind !== "outcomes") continue;

    describe(model.name, () => {
      const off = project(snapshot.games, asOf, model);
      const on = project(snapshot.games, asOf, model, undefined, undefined, { postSeason: true });

      it("has Outcome Probabilities for every ordered pair of teams, at both venues", () => {
        const teamIds = off.currentTable.map((row) => row.teamId);
        const pairings = on.pairingOutcomes!;
        expect([...pairings.keys()].sort()).toEqual([...teamIds].sort());
        for (const home of teamIds) {
          const opponents = pairings.get(home)!;
          expect([...opponents.keys()].sort()).toEqual(teamIds.filter((teamId) => teamId !== home).sort());
          for (const outcomes of opponents.values()) {
            const total = outcomes.regulationWin + outcomes.overtimeOrShootoutWin + outcomes.overtimeOrShootoutLoss + outcomes.regulationLoss;
            expect(total).toBeCloseTo(1, 12);
          }
        }
      });

      it("gives a pairing the Outcome Probabilities of a Remaining Game between the same home and away teams", () => {
        const { game, prediction } = off.nextRound[0]!.games[0]!;
        expect(on.pairingOutcomes!.get(game.homeTeamId)!.get(game.awayTeamId)).toEqual(prediction!.outcomes);
      });

      it("changes nothing else, down to every Rank Distribution and Cut Line chance", () => {
        expect(withoutPairings(on)).toEqual(off);
      });

      it("changes nothing else with a What-If either", () => {
        const { game } = off.nextRound[0]!.games[0]!;
        const whatIf = new Map([[game.id, "regulationLoss" as const]]);
        const whatIfOn = project(snapshot.games, asOf, model, whatIf, undefined, { postSeason: true });
        expect(withoutPairings(whatIfOn)).toEqual(project(snapshot.games, asOf, model, whatIf));
      });
    });
  }

  describe(splitFormRate.name, () => {
    it("has no pairings and changes nothing else", () => {
      const on = project(snapshot.games, asOf, splitFormRate, undefined, undefined, { postSeason: true });
      expect(on.pairingOutcomes).toBeNull();
      expect(withoutPairings(on)).toEqual(project(snapshot.games, asOf, splitFormRate));
    });
  });

  it("is off by default: a projection has no pairings", () => {
    for (const model of ALL_MODELS) expect("pairingOutcomes" in project(snapshot.games, asOf, model)).toBe(false);
  });
});

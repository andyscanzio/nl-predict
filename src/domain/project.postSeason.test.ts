import { describe, expect, it } from "vitest";
import { project, type Projection } from "./project.ts";
import { postSeasonGameWinChance, projectedBracket } from "./postSeason.ts";
import { eloModel, eloLevelStartModel } from "./eloModel.ts";
import { ALL_MODELS } from "./projectionModels.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;
const asOf = new Date(snapshot.snapshotAt);

/** A Projection as it is without the Post-Season option: its pairings and Projected Bracket dropped. */
const withoutPostSeason = ({ pairingOutcomes: _, projectedBracket: __, ...projection }: Projection) => projection;

/** The Projected Bracket a projection should carry: from its Projected Table's ranks and its pairings. */
const expectedBracket = ({ projectedTable, pairingOutcomes }: Projection) =>
  projectedBracket(
    projectedTable.map((row) => row.teamId),
    (home, away) => postSeasonGameWinChance(pairingOutcomes!.get(home)!.get(away)!),
  );

/** Every tie of a Projected Bracket, in the order they are played. */
const tiesOf = ({ playIn, quarterfinals, semifinals, final }: NonNullable<Projection["projectedBracket"]>) => [
  playIn.sevenEight,
  playIn.nineTen,
  playIn.decider,
  ...quarterfinals,
  ...semifinals,
  final,
];

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

      it("has the Projected Bracket of its Projected Table and pairings", () => {
        const ranking = on.projectedTable.map((row) => row.teamId);
        expect(on.projectedBracket).toEqual(expectedBracket(on));
        expect([on.projectedBracket!.playIn.sevenEight.higher, on.projectedBracket!.playIn.nineTen.lower]).toEqual([
          ranking[6],
          ranking[9],
        ]);
        expect(on.projectedBracket!.quarterfinals.map((tie) => tie.higher)).toEqual(ranking.slice(0, 4));
      });

      it("follows a What-If in its Projected Bracket", () => {
        const { game } = off.nextRound[0]!.games[0]!;
        const whatIfOn = project(snapshot.games, asOf, model, new Map([[game.id, "regulationLoss" as const]]), undefined, {
          postSeason: true,
        });
        expect(whatIfOn.projectedBracket).toEqual(expectedBracket(whatIfOn));
        expect(tiesOf(whatIfOn.projectedBracket!)).not.toEqual(tiesOf(on.projectedBracket!));
      });

      it("changes nothing else, down to every Rank Distribution and Cut Line chance", () => {
        expect(withoutPostSeason(on)).toEqual(off);
      });

      it("changes nothing else with a What-If either", () => {
        const { game } = off.nextRound[0]!.games[0]!;
        const whatIf = new Map([[game.id, "regulationLoss" as const]]);
        const whatIfOn = project(snapshot.games, asOf, model, whatIf, undefined, { postSeason: true });
        expect(withoutPostSeason(whatIfOn)).toEqual(project(snapshot.games, asOf, model, whatIf));
      });
    });
  }

  it("follows the Elo Model's start in its Projected Bracket", () => {
    const carriedOver = project(snapshot.games, asOf, eloModel, undefined, undefined, { postSeason: true });
    const levelStart = project(snapshot.games, asOf, eloLevelStartModel, undefined, undefined, { postSeason: true });
    expect(tiesOf(levelStart.projectedBracket!)).not.toEqual(tiesOf(carriedOver.projectedBracket!));
  });

  describe(splitFormRate.name, () => {
    it("has no pairings, no Projected Bracket and changes nothing else", () => {
      const on = project(snapshot.games, asOf, splitFormRate, undefined, undefined, { postSeason: true });
      expect(on.pairingOutcomes).toBeNull();
      expect(on.projectedBracket).toBeNull();
      expect(withoutPostSeason(on)).toEqual(project(snapshot.games, asOf, splitFormRate));
    });
  });

  it("is off by default: a projection has no pairings and no Projected Bracket", () => {
    for (const model of ALL_MODELS) {
      const projection = project(snapshot.games, asOf, model);
      expect("pairingOutcomes" in projection).toBe(false);
      expect("projectedBracket" in projection).toBe(false);
    }
  });
});

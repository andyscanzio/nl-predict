import { describe, expect, it } from "vitest";
import { project, type Projection, type ProjectionModel, type WhatIfOutcome } from "./project.ts";
import { PROJECTION_MODELS } from "./projectionModels.ts";
import type { Decision, Game, Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;
const asOf = new Date(snapshot.snapshotAt);
const real = (model: ProjectionModel) => project(snapshot.games, asOf, model);

const firstGame = (model: ProjectionModel) => real(model).nextRound[0]!.games[0]!.game;
const secondGame = (model: ProjectionModel) => real(model).nextRound[0]!.games[1]!.game;

const RESULTS: Record<WhatIfOutcome, { homeGoals: number; awayGoals: number; decision: Decision }> = {
  regulationWin: { homeGoals: 1, awayGoals: 0, decision: "regulation" },
  overtimeOrShootoutWin: { homeGoals: 1, awayGoals: 0, decision: "OT" },
  overtimeOrShootoutLoss: { homeGoals: 0, awayGoals: 1, decision: "OT" },
  regulationLoss: { homeGoals: 0, awayGoals: 1, decision: "regulation" },
};

/** What the page will show once `gameId` really is Played with `outcome`: a copy of the Games and an As-Of Date just past its start. */
function projectedOnceReallyPlayed(model: ProjectionModel, gameId: string, outcome: WhatIfOutcome): Projection {
  const games: Game[] = snapshot.games.map((game) => (game.id === gameId ? { ...game, result: RESULTS[outcome] } : game));
  const game = snapshot.games.find((g) => g.id === gameId)!;
  return project(games, new Date(Date.parse(game.startsAt) + 1), model);
}

/**
 * Movement is measured against the real Current Table, so it may differ from the copy's. The Season Simulation's numbers differ too: the What-If
 * projection reuses the Real Projection's random draws, where the copy draws afresh.
 */
const withoutMovement = (projection: Projection) =>
  projection.projectedTable.map(
    ({ currentRank: _currentRank, movement: _movement, probabilities: _p, rankDistribution: _r, ...row }) => row,
  );

describe("project with a What-If", () => {
  for (const model of PROJECTION_MODELS) {
    describe(model.name, () => {
      for (const outcome of Object.keys(RESULTS) as WhatIfOutcome[]) {
        it(`treats a ${outcome} What-If Result as a Played Game`, () => {
          const game = firstGame(model);
          const projection = project(snapshot.games, asOf, model, new Map([[game.id, outcome]]));
          const expected = projectedOnceReallyPlayed(model, game.id, outcome);

          expect(withoutMovement(projection)).toEqual(withoutMovement(expected));
          expect(projection.matchDay).toBe(real(model).matchDay);
          if (model.kind === "points") {
            expect(projection.projectedTable.every((row) => row.probabilities === null)).toBe(true);
          }
        });
      }

      it("gives identical numbers on a second call, and the original numbers back when a result is toggled off and on", () => {
        const [a, b] = [firstGame(model).id, secondGame(model).id];
        const both = new Map<string, WhatIfOutcome>([
          [a, "regulationWin"],
          [b, "overtimeOrShootoutLoss"],
        ]);
        const first = project(snapshot.games, asOf, model, both);
        expect(project(snapshot.games, asOf, model, both)).toEqual(first);

        const onlyA = project(snapshot.games, asOf, model, new Map([[a, "regulationWin"]]));
        const again = project(snapshot.games, asOf, model, both);
        expect(again).toEqual(first);
        expect(onlyA).not.toEqual(first);
      });

      it("keeps the Match Day of the real Played Games", () => {
        const game = firstGame(model);
        const projection = project(snapshot.games, asOf, model, new Map([[game.id, "regulationWin"]]));
        expect(projection.matchDay).toBe(real(model).matchDay);
      });

      it("keeps the chances of teams the What-If Game does not reach", () => {
        if (model.kind !== "outcomes") return;
        const game = firstGame(model);
        const projection = project(snapshot.games, asOf, model, new Map([[game.id, "regulationWin"]]));
        const unchanged = real(model);
        // The rows differ for at least the two teams playing the What-If Game, and the rest of the table moves only through them.
        const changed = projection.projectedTable.filter(
          (row) => JSON.stringify(row.rankDistribution) !== JSON.stringify(unchanged.projectedTable.find((r) => r.teamId === row.teamId)!.rankDistribution),
        );
        expect(changed.map((row) => row.teamId)).toEqual(expect.arrayContaining([game.homeTeamId, game.awayTeamId]));
      });

      it("keeps the Current Table, integrity issues and Next Round Games real", () => {
        const game = firstGame(model);
        const projection = project(snapshot.games, asOf, model, new Map([[game.id, "regulationWin"]]));
        const unchanged = real(model);
        expect(projection.currentTable).toEqual(unchanged.currentTable);
        expect(projection.integrityIssues).toEqual(unchanged.integrityIssues);
        expect(projection.anyGamesPlayed).toBe(unchanged.anyGamesPlayed);
        expect(projection.nextRound.map((day) => [day.date, day.games.map((g) => g.game.id)])).toEqual(
          unchanged.nextRound.map((day) => [day.date, day.games.map((g) => g.game.id)]),
        );
      });

      it("measures movement against the real Current Table rank", () => {
        const game = firstGame(model);
        const projection = project(snapshot.games, asOf, model, new Map([[game.id, "regulationWin"]]));
        const realRanks = new Map(real(model).currentTable.map((row) => [row.teamId, row.rank]));
        for (const row of projection.projectedTable) {
          expect(row.currentRank).toBe(realRanks.get(row.teamId));
          expect(row.movement).toBe(row.currentRank - row.rank);
        }
      });

      it("marks the picked Game with its outcome and no prediction, and predicts the others", () => {
        const game = firstGame(model);
        const { nextRound, whatIf } = project(snapshot.games, asOf, model, new Map([[game.id, "overtimeOrShootoutWin"]]));
        const games = nextRound.flatMap((day) => day.games);
        const picked = games.find((g) => g.game.id === game.id)!;
        expect(picked.whatIf).toBe("overtimeOrShootoutWin");
        expect(picked.prediction).toBeUndefined();
        for (const other of games.filter((g) => g !== picked)) {
          expect(other.whatIf).toBeUndefined();
          expect(other.prediction).toBeDefined();
        }
        expect([...whatIf]).toEqual([[game.id, "overtimeOrShootoutWin"]]);
      });

      it("drops entries for Played Games, Games outside the Next Round and unknown ids", () => {
        const nextRoundIds = new Set(real(model).nextRound.flatMap((day) => day.games.map((g) => g.game.id)));
        const played = snapshot.games.find((g) => g.result && Date.parse(g.startsAt) < asOf.getTime())!;
        const later = snapshot.games.find((g) => !g.result && !nextRoundIds.has(g.id) && Date.parse(g.startsAt) > asOf.getTime())!;
        const stale = new Map<string, WhatIfOutcome>([
          [played.id, "regulationWin"],
          [later.id, "regulationLoss"],
          ["no-such-game", "overtimeOrShootoutWin"],
        ]);

        const projection = project(snapshot.games, asOf, model, stale);
        expect(projection).toEqual({ ...real(model), whatIf: new Map() });

        const valid = firstGame(model).id;
        const mixed = project(snapshot.games, asOf, model, new Map([...stale, [valid, "regulationWin"]]));
        expect([...mixed.whatIf]).toEqual([[valid, "regulationWin"]]);
      });

      it("gives exactly the real projection with no What-If or an empty one", () => {
        const unchanged = real(model);
        expect(unchanged.whatIf).toEqual(new Map());
        expect(project(snapshot.games, asOf, model, new Map())).toEqual(unchanged);
      });
    });
  }
});

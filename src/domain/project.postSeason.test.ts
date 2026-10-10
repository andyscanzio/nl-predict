import { describe, expect, it } from "vitest";
import { project, type Projection, type ProjectionModel } from "./project.ts";
import { postSeasonGameWinChance, projectedBracket } from "./postSeason.ts";
import { createEloModel, eloModel, eloLevelStartModel } from "./eloModel.ts";
import { ALL_MODELS } from "./projectionModels.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Game, Snapshot, TeamId } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const snapshot = recordedSnapshot as Snapshot;
const asOf = new Date(snapshot.snapshotAt);

/** A Projection as it is without the Post-Season option: its pairings, Projected Bracket and Round Chances dropped. */
const withoutPostSeason = ({ pairingOutcomes: _, projectedBracket: __, ...projection }: Projection) => ({
  ...projection,
  projectedTable: projection.projectedTable.map(({ roundChances: _, ...row }) => ({
    ...row,
    ...(row.realProjection && { realProjection: (({ roundChances: _, ...real }) => real)(row.realProjection) }),
  })),
});

/** Each team's Round Chances, by team id. */
const roundChancesOf = (projection: Projection) => new Map(projection.projectedTable.map((row) => [row.teamId, row.roundChances]));

/**
 * A small Season of 14 teams whose final ranking is certain: a double round robin is played, the better team (lower id)
 * winning every Game, so 6 Points separate each team from the next, and each team has one Remaining Game left.
 */
const certainRanking = (() => {
  const teamIds: TeamId[] = Array.from({ length: 14 }, (_, i) => i + 1);
  const played: Game[] = teamIds.flatMap((home) =>
    teamIds
      .filter((away) => away !== home)
      .map((away, i) => ({
        id: `played-${home}-${away}`,
        startsAt: new Date(Date.UTC(2026, 8, 1 + i, 18, home)).toISOString(),
        homeTeamId: home,
        awayTeamId: away,
        result: home < away ? { homeGoals: 3, awayGoals: 1, decision: "regulation" as const } : { homeGoals: 1, awayGoals: 3, decision: "regulation" as const },
      })),
  );
  const remaining: Game[] = teamIds
    .filter((teamId) => teamId % 2 === 1)
    .map((home) => ({ id: `remaining-${home}`, startsAt: "2026-12-01T19:45:00+01:00", homeTeamId: home, awayTeamId: home + 1 }));
  return { games: [...played, ...remaining], asOf: new Date("2026-11-01T00:00:00Z"), teamIds };
})();

/** A model in which every Game, wherever and whoever, is a coin flip decided in regulation. */
const coinFlip: ProjectionModel = {
  id: "coin-flip",
  name: "Coin Flip",
  kind: "outcomes",
  predictOutcomes: ({ remainingGames }) =>
    new Map(remainingGames.map((game) => [game.id, { regulationWin: 0.5, overtimeOrShootoutWin: 0, overtimeOrShootoutLoss: 0, regulationLoss: 0.5 }])),
};

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

      it("gives Round Chances that sum across teams to 8 Quarterfinalists, 4 Semifinalists, 2 Finalists and 1 Champion", () => {
        const rows = on.projectedTable.map((row) => row.roundChances!);
        const sum = (round: keyof (typeof rows)[number]) => rows.reduce((total, chances) => total + chances[round], 0);
        expect(sum("quarterfinal")).toBeCloseTo(8, 9);
        expect(sum("semifinal")).toBeCloseTo(4, 9);
        expect(sum("final")).toBeCloseTo(2, 9);
        expect(sum("champion")).toBeCloseTo(1, 9);
      });

      it("gives each team a Quarterfinal chance between its Cut Line Playoffs chance and Playoffs plus Play-in", () => {
        for (const { roundChances, probabilities } of on.projectedTable) {
          expect(roundChances!.quarterfinal).toBeGreaterThanOrEqual(probabilities!.playoffs - 1e-12);
          expect(roundChances!.quarterfinal).toBeLessThanOrEqual(probabilities!.playoffs + probabilities!.playIn + 1e-12);
          expect(roundChances!.semifinal).toBeLessThanOrEqual(roundChances!.quarterfinal);
          expect(roundChances!.final).toBeLessThanOrEqual(roundChances!.semifinal);
          expect(roundChances!.champion).toBeLessThanOrEqual(roundChances!.final);
        }
      });

      it("gives identical Round Chances for the same Match Day, model and What-If", () => {
        expect(roundChancesOf(project(snapshot.games, asOf, model, undefined, undefined, { postSeason: true }))).toEqual(
          roundChancesOf(on),
        );
        const { game } = off.nextRound[0]!.games[0]!;
        const whatIf = () => new Map([[game.id, "regulationLoss" as const]]);
        expect(roundChancesOf(project(snapshot.games, asOf, model, whatIf(), undefined, { postSeason: true }))).toEqual(
          roundChancesOf(project(snapshot.games, asOf, model, whatIf(), on, { postSeason: true })),
        );
      });

      it("carries the Real Projection's Round Chances on each row under a What-If, and moves them", () => {
        const { game } = off.nextRound[0]!.games[0]!;
        const whatIfOn = project(snapshot.games, asOf, model, new Map([[game.id, "regulationLoss" as const]]), undefined, {
          postSeason: true,
        });
        for (const row of whatIfOn.projectedTable) expect(row.realProjection!.roundChances).toEqual(roundChancesOf(on).get(row.teamId));
        expect(roundChancesOf(whatIfOn).get(game.awayTeamId)).not.toEqual(roundChancesOf(on).get(game.awayTeamId));
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

  it("refuses a What-If with a Real Projection made without the option, which has no Round Chances to compare with", () => {
    const real = project(snapshot.games, asOf, eloModel);
    const whatIf = new Map([[real.nextRound[0]!.games[0]!.game.id, "regulationLoss" as const]]);
    expect(() => project(snapshot.games, asOf, eloModel, whatIf, real, { postSeason: true })).toThrow();
  });

  it("follows the Elo Model's start in its Round Chances", () => {
    const carriedOver = project(snapshot.games, asOf, eloModel, undefined, undefined, { postSeason: true });
    const levelStart = project(snapshot.games, asOf, eloLevelStartModel, undefined, undefined, { postSeason: true });
    expect(roundChancesOf(levelStart)).not.toEqual(roundChancesOf(carriedOver));
  });

  describe("with a certain final ranking", () => {
    const { games, asOf, teamIds } = certainRanking;

    it("puts ranks 1 to 6 in the Quarterfinal, ranks 7 to 10 by the Play-In and no one below", () => {
      const chances = roundChancesOf(project(games, asOf, coinFlip, undefined, undefined, { postSeason: true }));
      expect(teamIds.slice(0, 6).map((teamId) => chances.get(teamId)!.quarterfinal)).toEqual([1, 1, 1, 1, 1, 1]);
      for (const teamId of teamIds.slice(6, 10)) expect(chances.get(teamId)!.quarterfinal).toBeGreaterThan(0);
      for (const teamId of teamIds.slice(6, 10)) expect(chances.get(teamId)!.quarterfinal).toBeLessThan(1);
      expect(teamIds.slice(10).map((teamId) => chances.get(teamId)!.quarterfinal)).toEqual([0, 0, 0, 0]);
    });

    it("keeps the Real Projection's Post-Season draws under a What-If: Round Chances that cannot move do not move", () => {
      // The ranking is certain and every Game a coin flip, so a What-If changes nothing a Post-Season depends on.
      const real = project(games, asOf, coinFlip, undefined, undefined, { postSeason: true });
      const whatIf = project(games, asOf, coinFlip, new Map([["remaining-1", "regulationLoss" as const]]), undefined, {
        postSeason: true,
      });
      expect(roundChancesOf(whatIf)).toEqual(roundChancesOf(real));
      for (const row of whatIf.projectedTable) expect(row.realProjection!.roundChances).toEqual(row.roundChances);
    });

    it("makes a team certain to finish 1st with an overwhelming Rating Champion all but surely", () => {
      const overwhelming = createEloModel({
        k: 10,
        homeAdvantage: 60,
        ratingUncertainty: 50,
        startingRatings: new Map([[1, 3000]]),
      });
      const projection = project(games, asOf, overwhelming, undefined, undefined, { postSeason: true });
      expect(roundChancesOf(projection).get(1)!.champion).toBeGreaterThan(0.99);
    });
  });

  describe(splitFormRate.name, () => {
    it("has no pairings, no Projected Bracket, no Round Chances and changes nothing else", () => {
      const on = project(snapshot.games, asOf, splitFormRate, undefined, undefined, { postSeason: true });
      expect(on.pairingOutcomes).toBeNull();
      expect(on.projectedBracket).toBeNull();
      expect(on.projectedTable.every((row) => row.roundChances === null)).toBe(true);
      expect(withoutPostSeason(on)).toEqual(project(snapshot.games, asOf, splitFormRate));
    });
  });

  it("is off by default: a projection has no pairings, no Projected Bracket and no Round Chances", () => {
    for (const model of ALL_MODELS) {
      const projection = project(snapshot.games, asOf, model);
      expect("pairingOutcomes" in projection).toBe(false);
      expect("projectedBracket" in projection).toBe(false);
      expect(projection.projectedTable.some((row) => "roundChances" in row)).toBe(false);
      const { game } = projection.nextRound[0]!.games[0]!;
      const whatIf = project(snapshot.games, asOf, model, new Map([[game.id, "regulationLoss" as const]]));
      expect(whatIf.projectedTable.some((row) => "roundChances" in row.realProjection!)).toBe(false);
    }
  });
});

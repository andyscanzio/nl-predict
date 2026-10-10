import { describe, expect, it } from "vitest";
import {
  bestOfSevenChance,
  playInTieChance,
  postSeasonGameWinChance,
  projectedBracket,
  simulatePostSeason,
  type PostSeasonRound,
  type Tie,
} from "./postSeason.ts";
import { seededRandom } from "./seasonSimulation.ts";
import type { TeamId } from "./types.ts";

/** Teams 1 to 10 in Regular Season order: team n finished nth. */
const ranking: TeamId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Certain results: the team with the higher strength always wins, wherever it plays. */
const certain = (strength: Record<number, number>) => (home: TeamId, away: TeamId) =>
  (strength[home] ?? -home) > (strength[away] ?? -away) ? 1 : 0;

const pair = (tie: Tie) => [tie.higher, tie.lower];

describe("postSeasonGameWinChance", () => {
  it("is the home team's regulation win plus OT/SO win, as every Post-Season Game has a winner", () => {
    expect(
      postSeasonGameWinChance({ regulationWin: 0.4, overtimeOrShootoutWin: 0.15, overtimeOrShootoutLoss: 0.1, regulationLoss: 0.35 }),
    ).toBeCloseTo(0.55, 12);
  });
});

describe("bestOfSevenChance", () => {
  it("is 0.5 for even Games", () => {
    expect(bestOfSevenChance(0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it("is 1 when one side always wins, and 0 when it always loses", () => {
    expect(bestOfSevenChance(1, 1)).toBe(1);
    expect(bestOfSevenChance(0, 0)).toBe(0);
  });

  it("is exact with the better-ranked team at home in Games 1, 3, 5 and 7", () => {
    // Four home Games won with 0.6, three away Games with 0.4: P(home wins + away wins ≥ 4), worked out by hand.
    expect(bestOfSevenChance(0.6, 0.4)).toBeCloseTo(0.532032, 12);
  });
});

describe("playInTieChance", () => {
  it("is the mean of the team's win chances at home and away", () => {
    const homeWin = (home: TeamId, away: TeamId) => (home === 7 && away === 8 ? 0.7 : home === 8 && away === 7 ? 0.6 : NaN);
    expect(playInTieChance(7, 8, homeWin)).toBeCloseTo((0.7 + (1 - 0.6)) / 2, 12);
    expect(playInTieChance(8, 7, homeWin)).toBeCloseTo((0.6 + (1 - 0.7)) / 2, 12);
  });
});

describe("projectedBracket", () => {
  it("with the better-ranked team always winning, plays the bracket by Regular Season rank", () => {
    const bracket = projectedBracket(ranking, certain({}));
    expect(pair(bracket.playIn.sevenEight)).toEqual([7, 8]);
    expect(pair(bracket.playIn.nineTen)).toEqual([9, 10]);
    expect(pair(bracket.playIn.decider)).toEqual([8, 9]);
    expect(bracket.quarterfinals.map(pair)).toEqual([[1, 8], [2, 7], [3, 6], [4, 5]]);
    expect(bracket.semifinals.map(pair)).toEqual([[1, 4], [2, 3]]);
    expect(pair(bracket.final)).toEqual([1, 2]);
    expect(bracket.champion).toBe(1);
  });

  it("keeps a team that loses 7 v 8 and then qualifies as seed 7, against seed 2", () => {
    const bracket = projectedBracket(ranking, certain({ 8: 0.5 }));
    expect(bracket.playIn.sevenEight.winner).toBe(8);
    expect(pair(bracket.playIn.decider)).toEqual([7, 9]);
    expect(bracket.playIn.decider.winner).toBe(7);
    expect(bracket.quarterfinals.map(pair)).toEqual([[1, 8], [2, 7], [3, 6], [4, 5]]);
  });

  it("puts the 9 v 10 winner through the decider as seed 8", () => {
    const bracket = projectedBracket(ranking, certain({ 10: 0.5 }));
    expect(bracket.playIn.nineTen.winner).toBe(10);
    expect(pair(bracket.playIn.decider)).toEqual([8, 10]);
    expect(bracket.quarterfinals.map(pair)).toEqual([[1, 10], [2, 7], [3, 6], [4, 5]]);
  });

  it("re-pairs best remaining against worst remaining when seed 8 beats seed 1", () => {
    const bracket = projectedBracket(ranking, certain({ 8: 0.5 }));
    expect(bracket.quarterfinals[0]!.winner).toBe(8);
    expect(bracket.semifinals.map(pair)).toEqual([[2, 8], [3, 4]]);
    expect(pair(bracket.final)).toEqual([3, 8]);
    expect(bracket.champion).toBe(8);
  });

  it("gives each tie its favourite's exact chance, and the favourite advances", () => {
    // The home team wins 0.6 of Games: every tie is even on neutral ice, and a series favours its home-ice team.
    const bracket = projectedBracket(ranking, () => 0.6);
    expect(bracket.playIn.sevenEight).toMatchObject({ winner: 7, favouriteChance: 0.5 });
    expect(bracket.quarterfinals[0]).toMatchObject({ winner: 1 });
    expect(bracket.quarterfinals[0]!.favouriteChance).toBeCloseTo(bestOfSevenChance(0.6, 0.4), 12);
  });

  it("advances the underdog by rank when it is the favourite", () => {
    const homeWin = (home: TeamId, away: TeamId) => (home === 5 ? 0.8 : away === 5 ? 0.3 : 0.6);
    const tie = projectedBracket(ranking, homeWin).quarterfinals[3]!;
    expect(pair(tie)).toEqual([4, 5]);
    expect(tie.winner).toBe(5);
    expect(tie.favouriteChance).toBeCloseTo(1 - bestOfSevenChance(0.3, 1 - 0.8), 12);
  });

  it("only reads ranks 1 to 10", () => {
    expect(projectedBracket([...ranking, 11, 12, 13, 14], certain({}))).toEqual(projectedBracket(ranking, certain({})));
  });
});

describe("simulatePostSeason", () => {
  const reached = (rounds: Map<TeamId, PostSeasonRound>) => Object.fromEntries(rounds);

  it("plays the bracket by Regular Season rank with the better-ranked team always winning", () => {
    expect(reached(simulatePostSeason(ranking, certain({}), seededRandom(1)))).toEqual({
      1: "champion",
      2: "final",
      3: "semifinal",
      4: "semifinal",
      5: "quarterfinal",
      6: "quarterfinal",
      7: "quarterfinal",
      8: "quarterfinal",
      9: "none",
      10: "none",
    });
  });

  it("keeps a team that loses 7 v 8 and then qualifies as seed 7, against seed 2", () => {
    // 8 beats everyone: it wins 7 v 8, then 7 beats 9 in the decider and, kept as seed 7, loses to seed 2.
    const rounds = simulatePostSeason(ranking, certain({ 8: 0.5 }), seededRandom(1));
    expect(rounds.get(7)).toBe("quarterfinal");
    expect(rounds.get(9)).toBe("none");
    // Seed 8 beats seed 1, then the Semifinals pair 2 v 8 and 3 v 4: 8 reaches the Final and wins it against 3.
    expect(rounds.get(1)).toBe("quarterfinal");
    expect(rounds.get(2)).toBe("semifinal");
    expect(rounds.get(3)).toBe("final");
    expect(rounds.get(4)).toBe("semifinal");
    expect(rounds.get(8)).toBe("champion");
  });

  it("puts the 9 v 10 winner through the decider, and the loser never reaches the Quarterfinal", () => {
    const rounds = simulatePostSeason(ranking, certain({ 10: 0.5 }), seededRandom(1));
    expect(rounds.get(9)).toBe("none");
    expect(rounds.get(8)).toBe("none");
    expect(rounds.get(10)).toBe("champion");
  });

  it("only reads ranks 1 to 10, and teams below them reach no round", () => {
    const rounds = simulatePostSeason([...ranking, 11, 12, 13, 14], certain({}), seededRandom(1));
    expect([11, 12, 13, 14].map((teamId) => rounds.get(teamId))).toEqual(["none", "none", "none", "none"]);
  });

  it("always has 8 Quarterfinalists, 4 Semifinalists, 2 Finalists and 1 Champion, and never the 9 v 10 loser", () => {
    const random = seededRandom(7);
    const homeWin = (home: TeamId, away: TeamId) => 0.3 + 0.04 * ((home * 7 + away * 3) % 10);
    const order: PostSeasonRound[] = ["none", "quarterfinal", "semifinal", "final", "champion"];
    for (let run = 0; run < 500; run++) {
      const rounds = simulatePostSeason(ranking, homeWin, random);
      const reaching = (round: PostSeasonRound) => [...rounds.values()].filter((r) => order.indexOf(r) >= order.indexOf(round)).length;
      expect([reaching("quarterfinal"), reaching("semifinal"), reaching("final"), reaching("champion")]).toEqual([8, 4, 2, 1]);
      expect(rounds.get(9) === "none" || rounds.get(10) === "none").toBe(true);
    }
  });

  it("wins a tie with its exact chance", () => {
    // The home team wins 0.6 of Games: seed 1 wins its Quarterfinal with the best-of-seven chance.
    const random = seededRandom(3);
    const runs = 20_000;
    let seedOneThrough = 0;
    for (let run = 0; run < runs; run++) {
      if (simulatePostSeason(ranking, () => 0.6, random).get(1) !== "quarterfinal") seedOneThrough++;
    }
    const chance = bestOfSevenChance(0.6, 0.4);
    // Within four standard errors of the exact chance.
    expect(Math.abs(seedOneThrough / runs - chance)).toBeLessThan(4 * Math.sqrt((chance * (1 - chance)) / runs));
  });
});

import { describe, expect, it } from "vitest";
import { ELO_CARRY_OVER, ELO_HOME_ADVANTAGE, ELO_K, eloRatings, INITIAL_RATING } from "./eloModel.ts";
import type { PlayedGame } from "./form.ts";
import { warmUpChain, type WarmUpSeason } from "./warmUpChain.ts";

let nextId = 1;
function played(homeTeamId: number, awayTeamId: number, homeGoals: number, awayGoals: number, day: number): PlayedGame {
  return {
    id: String(nextId++),
    startsAt: `2020-01-${String(day).padStart(2, "0")}T19:45:00+01:00`,
    homeTeamId,
    awayTeamId,
    result: { homeGoals, awayGoals, decision: "regulation" },
  };
}
const parameters = { k: ELO_K, homeAdvantage: ELO_HOME_ADVANTAGE };

describe("warmUpChain", () => {
  it("starts the first Season level and gives each Game its teams' Ratings from before it", () => {
    const first = played(1, 2, 3, 0, 1);
    const second = played(2, 1, 1, 0, 2);
    const chain = warmUpChain([{ season: 2017, teamIds: [1, 2], playedGames: [second, first] }]);
    expect(chain.get(first.id)).toEqual({ homeRating: INITIAL_RATING, awayRating: INITIAL_RATING, ratingDifference: 0 });
    const after = eloRatings([first], [1, 2], parameters);
    const row = chain.get(second.id)!;
    expect(row.homeRating).toBeCloseTo(after.get(2)!);
    expect(row.awayRating).toBeCloseTo(after.get(1)!);
    expect(row.ratingDifference).toBeCloseTo(after.get(2)! - after.get(1)!);
  });

  it("carries Ratings into the next Season", () => {
    const seasons: WarmUpSeason[] = [
      { season: 2017, teamIds: [1, 2], playedGames: [played(1, 2, 3, 0, 1)] },
      { season: 2018, teamIds: [1, 2], playedGames: [played(1, 2, 1, 0, 1)] },
    ];
    const end = eloRatings(seasons[0]!.playedGames, [1, 2], parameters);
    const row = warmUpChain(seasons).get(seasons[1]!.playedGames[0]!.id)!;
    expect(ELO_CARRY_OVER).toBe(1);
    expect(row.homeRating).toBeCloseTo(end.get(1)!);
    expect(row.awayRating).toBeCloseTo(end.get(2)!);
  });

  it("gives a promoted team the Rating of the relegated team it replaces", () => {
    const seasons: WarmUpSeason[] = [
      { season: 2017, teamIds: [1, 2, 3], playedGames: [played(1, 2, 3, 0, 1), played(2, 3, 3, 0, 2), played(1, 3, 3, 0, 3)] },
      { season: 2018, teamIds: [1, 2, 4], playedGames: [played(1, 4, 1, 0, 1)] },
    ];
    const end = eloRatings(seasons[0]!.playedGames, [1, 2, 3], parameters);
    expect(warmUpChain(seasons).get(seasons[1]!.playedGames[0]!.id)!.awayRating).toBeCloseTo(end.get(3)!);
  });

  it("starts a promoted team with no relegated team to take over from at the league's lowest Rating", () => {
    const seasons: WarmUpSeason[] = [
      { season: 2017, teamIds: [1, 2, 3], playedGames: [played(1, 2, 3, 0, 1), played(2, 3, 3, 0, 2), played(1, 3, 3, 0, 3)] },
      { season: 2018, teamIds: [1, 2, 3, 4], playedGames: [played(4, 1, 1, 0, 1)] },
    ];
    const end = eloRatings(seasons[0]!.playedGames, [1, 2, 3], parameters);
    expect(end.get(3)!).toBeLessThan(INITIAL_RATING);
    expect(warmUpChain(seasons).get(seasons[1]!.playedGames[0]!.id)!.homeRating).toBeCloseTo(end.get(3)!);
  });
});

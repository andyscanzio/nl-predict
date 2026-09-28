import { describe, expect, it } from "vitest";
import {
  createMatchupModel,
  LEAGUE_HOME_POINTS_PER_GAME,
  leagueHomePointsPerGame,
  matchupModel,
  MATCHUP_PRIOR_GAMES,
} from "./matchupModel.ts";
import type { PlayedGame } from "./form.ts";
import { project, type ProjectionModel } from "./project.ts";
import type { Decision, Game } from "./types.ts";

const asOf = new Date("2026-10-01T12:00:00+02:00");
const later = "2026-10-10T19:45:00+02:00";

let nextId = 1;
function played(homeTeamId: number, awayTeamId: number, homeGoals: number, awayGoals: number, decision: Decision = "regulation"): Game {
  return {
    id: String(nextId++),
    startsAt: "2026-09-20T19:45:00+02:00",
    homeTeamId,
    awayTeamId,
    result: { homeGoals, awayGoals, decision },
  };
}

function scheduled(homeTeamId: number, awayTeamId: number): Game {
  return { id: String(nextId++), startsAt: later, homeTeamId, awayTeamId };
}

function projectedPoints(games: Game[], model: ProjectionModel = matchupModel) {
  return Object.fromEntries(
    project(games, asOf, model).projectedTable.map((row) => [row.teamId, row.projectedPoints]),
  );
}

describe("project: Matchup Model", () => {
  it("splits a Game's 3 Points by the home team's Home Rate against the away team's Away Rate", () => {
    const games = [
      played(1, 3, 2, 3, "OT"), // 1 at home: 1
      played(1, 4, 3, 0), // 1 at home: 3 → 4 Points in 2 home Games
      played(3, 1, 5, 0), // 1 away: 0, not counted at home
      played(3, 2, 1, 2, "SO"), // 2 away: 2
      played(4, 2, 3, 0), // 2 away: 0 → 2 Points in 2 away Games
      played(2, 4, 4, 0), // 2 at home: 3, not counted away
      scheduled(1, 2),
    ];
    // Home Rate (4 + 1.74 · 16) / 18 against Away Rate (2 + 1.26 · 16) / 18: home expects (Home Rate + 3 − Away Rate) / 2
    const homeRate = (4 + 1.74 * 16) / 18;
    const awayRate = (2 + 1.26 * 16) / 18;
    const share = (homeRate + 3 - awayRate) / 2;
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(4 + share);
    expect(points[2]).toBeCloseTo(5 + 3 - share);
  });

  it("gives two teams with no Played Games the league's home split: the home side expects 1.74 of the 3 Points", () => {
    const points = projectedPoints([scheduled(1, 2)]);
    expect(points[1]).toBeCloseTo(1.74);
    expect(points[2]).toBeCloseTo(3 - 1.74);
  });

  it("rates a hot start at home well below its raw Form: one regulation home win is (3 + 1.74 · 16) / 17 ≈ 1.81", () => {
    const games = [played(1, 3, 3, 0), scheduled(1, 2)];
    // 2 has no Games, so it is the away prior 3 − 1.74 = 1.26 away
    const homeRate = (3 + 1.74 * 16) / 17;
    const share = (homeRate + 3 - 1.26) / 2;
    const points = projectedPoints(games);
    expect(homeRate).toBeCloseTo(1.81, 2);
    expect(points[1]).toBeCloseTo(3 + share);
    expect(points[2]).toBeCloseTo(3 - share);
  });

  it("gives a full Form Window at most about a quarter of the weight: five regulation home wins are (15 + 1.74 · 16) / 21 ≈ 2.04", () => {
    const games = [...Array.from({ length: 5 }, () => played(1, 3, 3, 0)), scheduled(1, 2)];
    const homeRate = (15 + 1.74 * 16) / 21;
    const share = (homeRate + 3 - 1.26) / 2;
    const points = projectedPoints(games);
    expect(homeRate).toBeCloseTo(2.04, 2);
    expect(points[1]).toBeCloseTo(15 + share);
    expect(points[2]).toBeCloseTo(3 - share);
  });

  it("rates an empty Form Window at the league venue average, not the team's other-venue Form: only an away win is 1.74 at home, not 3.0", () => {
    const games = [played(3, 1, 0, 3), scheduled(1, 2)];
    // 1 has an away win (3 Points) but no home Games; 2 has no Games: (1.74 + 3 − 1.26) / 2 = 1.74
    const points = projectedPoints(games);
    expect(points[1]).toBeCloseTo(3 + 1.74);
    expect(points[2]).toBeCloseTo(3 - 1.74);
  });

  it("flags Low Sample by Played Games, as under every Projection Model", () => {
    const nine = Array.from({ length: 9 }, () => played(1, 2, 3, 1));
    const row = (games: Game[]) => project(games, asOf, matchupModel).projectedTable.find((r) => r.teamId === 1)!;
    expect(row(nine).lowSample).toBe(true);
    expect(row([...nine, played(3, 1, 1, 3)]).lowSample).toBe(false);
  });

  it("hands out exactly 3 Points per Remaining Game", () => {
    const games = [
      played(1, 2, 3, 0),
      played(2, 3, 2, 1, "OT"),
      played(3, 1, 4, 2),
      played(4, 1, 1, 2, "SO"),
      scheduled(1, 2),
      scheduled(2, 4),
      scheduled(3, 4),
      scheduled(4, 1),
      scheduled(1, 3),
    ];
    const { projectedTable } = project(games, asOf, matchupModel);
    const gained = projectedTable.reduce((sum, row) => sum + row.projectedPoints - row.currentPoints, 0);
    expect(gained).toBeCloseTo(5 * 3);
  });
});

describe("createMatchupModel: unshrunk (priorGames 0)", () => {
  const unshrunk = createMatchupModel({ priorGames: 0, homePointsPerGame: 1.74, centre: "league" });

  it("falls back to a team's other-venue Form when a Form Window is empty, and to 1.5 with neither", () => {
    const games = [played(3, 1, 0, 3), scheduled(1, 2)];
    // 1 has only an Away Form (3) to use at home; 2 has no Games and counts as 1.5: (3 + (3 − 1.5)) / 2 = 2.25
    const points = projectedPoints(games, unshrunk);
    expect(points[1]).toBeCloseTo(3 + 2.25);
    expect(points[2]).toBeCloseTo(0.75);
  });

  it("falls back to an away team's Home Form when its away Form Window is empty", () => {
    const games = [played(1, 3, 0, 3), played(2, 4, 3, 0), scheduled(1, 2)];
    // 1 has Home Form 0; 2 has only a Home Form (3) to use away: (0 + (3 − 3)) / 2 = 0,
    // so the home side loses for sure, still taking the OT/SO share of the loser's point
    const points = projectedPoints(games, unshrunk);
    expect(points[1]).toBeCloseTo(0.23);
    expect(points[2]).toBeCloseTo(3 + 3 - 0.23);
  });

  it("caps a Game's win probability at 1: a sure winner still concedes the OT/SO share of the loser's point", () => {
    const games = [played(1, 3, 3, 0), played(4, 2, 3, 0), scheduled(1, 2)];
    // Home Form 3 against Away Form 0: the home side wins for sure, in OT/SO at the fallback OT/SO Rate 0.23
    const points = projectedPoints(games, unshrunk);
    expect(points[1]).toBeCloseTo(3 + 3 - 0.23);
    expect(points[2]).toBeCloseTo(0.23);
  });
});

describe("createMatchupModel", () => {
  const model = (priorGames: number, homePointsPerGame: number) =>
    createMatchupModel({ priorGames, homePointsPerGame, centre: "league" });

  it("ships the league centre at MATCHUP_PRIOR_GAMES and LEAGUE_HOME_POINTS_PER_GAME", () => {
    const league = model(MATCHUP_PRIOR_GAMES, LEAGUE_HOME_POINTS_PER_GAME);
    const scenarios = [
      [scheduled(1, 2)],
      [played(3, 1, 0, 3), scheduled(1, 2)],
      [played(1, 3, 2, 3, "OT"), played(1, 4, 3, 0), played(3, 2, 1, 2, "SO"), played(4, 2, 3, 0), scheduled(1, 2)],
    ];
    for (const games of scenarios) {
      expect(projectedPoints(games)).toEqual(projectedPoints(games, league));
    }
  });

  it("with priorGames 0 gives the same Points whatever the other parameters, fallbacks included", () => {
    const unshrunk = model(0, 1.5);
    const scenarios = [
      [played(3, 1, 0, 3), scheduled(1, 2)], // other-venue fallback, and 1.5 with neither
      [played(1, 3, 0, 3), played(2, 4, 3, 0), scheduled(1, 2)], // away Form Window empty
      [played(1, 3, 2, 3, "OT"), played(1, 4, 3, 0), played(3, 2, 1, 2, "SO"), played(4, 2, 3, 0), scheduled(1, 2)],
    ];
    for (const games of scenarios) {
      for (const homePointsPerGame of [1.74, 1.6]) {
        for (const centre of ["league", "team"] as const) {
          expect(projectedPoints(games, createMatchupModel({ priorGames: 0, homePointsPerGame, centre }))).toEqual(
            projectedPoints(games, unshrunk),
          );
        }
      }
    }
  });

  it("shrinks a venue's rate toward its league average: (Points + prior · m) / (Games + m)", () => {
    const games = [played(1, 3, 3, 0), played(1, 4, 3, 0), scheduled(1, 2)];
    // 1 at home: (6 + 1.74 · 5) / 7 = 2.1; 2 has no Games, so away it is the away prior 3 − 1.74 = 1.26
    // home expects (2.1 + (3 − 1.26)) / 2 = 1.92 of the 3 Points
    const points = projectedPoints(games, model(5, 1.74));
    expect(points[1]).toBeCloseTo(6 + 1.92);
    expect(points[2]).toBeCloseTo(3 - 1.92);
  });

  it("rates an empty Form Window at exactly its venue prior, not the team's other-venue Form", () => {
    const games = [played(3, 1, 0, 3), scheduled(1, 2)];
    // 1 has an Away Form of 3 but no home Games, so at home it is the home prior 1.74, as is 2's away prior 3 − 1.26
    const points = projectedPoints(games, model(5, 1.74));
    expect(points[1]).toBeCloseTo(3 + 1.74);
    expect(points[2]).toBeCloseTo(3 - 1.74);
  });

  it("with a home average of 1.5 shrinks both venues toward 1.5", () => {
    const games = [played(1, 3, 3, 0), played(1, 4, 3, 0), played(3, 2, 0, 3), scheduled(1, 2)];
    // home 1: (6 + 1.5 · 5) / 7; away 2: (3 + 1.5 · 5) / 6 = 1.75
    const home = 13.5 / 7;
    const share = (home + (3 - 1.75)) / 2;
    const points = projectedPoints(games, model(5, 1.5));
    expect(points[1]).toBeCloseTo(6 + share);
    expect(points[2]).toBeCloseTo(3 + 3 - share);
  });
});

describe("createMatchupModel: team centre", () => {
  const model = (priorGames: number, homePointsPerGame: number) =>
    createMatchupModel({ priorGames, homePointsPerGame, centre: "team" });

  it("shrinks each venue toward the team's shrunk Season Rate ± (home average − 1.5)", () => {
    const games = [played(1, 3, 3, 0), played(1, 4, 3, 0), played(2, 3, 0, 3), scheduled(1, 2)];
    // Season Rate at m = 10: 1 has 6 Points in 2 Games, (6 + 15) / 12 = 1.75; 2 has 0 in 1, 15 / 11
    const rate1 = 21 / 12;
    const rate2 = 15 / 11;
    // 1 at home: (6 + (1.75 + 0.24) · 5) / 7; 2 away has no Games, so its away prior is 15/11 − 0.24
    const home = (6 + (rate1 + 0.24) * 5) / 7;
    const away = rate2 - 0.24;
    const share = (home + (3 - away)) / 2;
    const points = projectedPoints(games, model(5, 1.74));
    expect(points[1]).toBeCloseTo(6 + share);
    expect(points[2]).toBeCloseTo(3 - share);
  });

  it("rates an empty Form Window at exactly the team's prior", () => {
    const games = [played(3, 1, 0, 3), scheduled(1, 2)];
    // 1 has Season Rate (3 + 15) / 11 but no home Games, so at home it is that + 0.24; 2 has no Games: 1.5 − 0.24 away
    const home = 18 / 11 + 0.24;
    const away = 1.5 - 0.24;
    const share = (home + (3 - away)) / 2;
    const points = projectedPoints(games, model(5, 1.74));
    expect(points[1]).toBeCloseTo(3 + share);
    expect(points[2]).toBeCloseTo(3 - share);
  });

  it("with priorGames 0 has no effect", () => {
    const games = [played(3, 1, 0, 3), played(1, 4, 3, 0), scheduled(1, 2)];
    expect(projectedPoints(games, model(0, 1.74))).toEqual(projectedPoints(games, createMatchupModel({ priorGames: 0, homePointsPerGame: 1.5, centre: "league" })));
  });
});

describe("leagueHomePointsPerGame", () => {
  it("is the home teams' mean Points per Game over the Played Games", () => {
    const games = [played(1, 2, 3, 0), played(2, 1, 1, 2, "OT"), played(3, 1, 0, 1, "SO"), played(1, 3, 0, 4)];
    // home Points 3, 1, 1, 0
    expect(leagueHomePointsPerGame(games.filter((game): game is PlayedGame => game.result !== undefined))).toBeCloseTo(5 / 4);
  });

  it("is the league average of 1.5 with no Played Games", () => {
    expect(leagueHomePointsPerGame([])).toBe(1.5);
  });
});

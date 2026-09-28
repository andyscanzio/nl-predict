import { describe, expect, it } from "vitest";
import { eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";
import { project, SEASON_START, type ProjectionModel } from "./project.ts";
import { seasonRate } from "./seasonRate.ts";
import { SIMULATION_RUNS, simulateSeason, simulationSeed } from "./seasonSimulation.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Decision, Game, Snapshot } from "./types.ts";
import recordedSnapshot from "./__fixtures__/snapshot-2026-09-27.json";

const asOf = new Date("2026-10-01T12:00:00+02:00");
const TEAMS = Array.from({ length: 14 }, (_, index) => index + 1);

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
  return { id: String(nextId++), startsAt: "2026-10-10T19:45:00+02:00", homeTeamId, awayTeamId };
}

/** Every pair of teams meets once at each venue; team 1 has won all its Played Games, the rest split theirs. */
function roundRobin(): Game[] {
  const games: Game[] = [];
  for (const home of TEAMS) {
    for (const away of TEAMS) {
      if (home === away) continue;
      if (home < away) games.push(home === 1 ? played(home, away, 4, 1) : played(home, away, 2, 1, "OT"));
      else games.push(scheduled(home, away));
    }
  }
  return games;
}

/** A model that gives every Remaining Game the same Outcome Probabilities. */
function fixedModel(outcomes: OutcomeProbabilities): ProjectionModel {
  return {
    id: "fixed",
    name: "Fixed",
    kind: "outcomes",
    predictOutcomes: ({ remainingGames }) => new Map(remainingGames.map((game) => [game.id, outcomes])),
  };
}

const homeAlwaysWins = fixedModel({ regulationWin: 1, overtimeOrShootoutWin: 0, overtimeOrShootoutLoss: 0, regulationLoss: 0 });

function probabilitiesByTeam(games: Game[], model: ProjectionModel) {
  return new Map(project(games, asOf, model).projectedTable.map((row) => [row.teamId, row.probabilities]));
}

describe("project: Season Simulation", () => {
  it("gives the same probabilities for the same Games, As-Of Date and model", () => {
    const games = roundRobin();
    expect(probabilitiesByTeam(games, seasonRate)).toEqual(probabilitiesByTeam(games, seasonRate));
  });

  it("gives every team Cut Line zone probabilities summing to 1, and 1st probabilities summing to 1 across teams", () => {
    const probabilities = [...probabilitiesByTeam(roundRobin(), seasonRate).values()];
    for (const team of probabilities) {
      expect(team!.playoffs + team!.playIn + team!.eliminated).toBeCloseTo(1, 12);
    }
    expect(probabilities.reduce((sum, team) => sum + team!.first, 0)).toBeCloseTo(1, 12);
  });

  it("gives a team that cannot be caught certain playoffs and first place", () => {
    // Team 1 has 39 Points; nobody else can reach more than 8, so no sampled outcome catches it.
    const games = [
      ...TEAMS.slice(1).map((away) => played(1, away, 3, 0)),
      ...TEAMS.slice(1, -1).map((home) => played(home, home + 1, 2, 1, "OT")),
      scheduled(2, 3),
      scheduled(4, 2),
    ];
    const team1 = probabilitiesByTeam(games, seasonRate).get(1)!;
    expect(team1).toEqual({ playoffs: 1, playIn: 0, eliminated: 0, first: 1 });
  });

  it("plays out sure Outcome Probabilities with certainty", () => {
    // Home teams win every Remaining Game in regulation, so team k ≥ 2 finishes on 23 + 2k Points and team 1 on 39,
    // level with team 8: 14 is first, 9–14 make the playoffs, 1 and 8 share 7th–8th, 2–5 are eliminated.
    const probabilities = probabilitiesByTeam(roundRobin(), homeAlwaysWins);
    expect(probabilities.get(14)).toEqual({ playoffs: 1, playIn: 0, eliminated: 0, first: 1 });
    expect(probabilities.get(9)).toEqual({ playoffs: 1, playIn: 0, eliminated: 0, first: 0 });
    expect(probabilities.get(1)).toEqual({ playoffs: 0, playIn: 1, eliminated: 0, first: 0 });
    expect(probabilities.get(8)).toEqual({ playoffs: 0, playIn: 1, eliminated: 0, first: 0 });
    expect(probabilities.get(5)).toEqual({ playoffs: 0, playIn: 0, eliminated: 1, first: 0 });
  });

  it("breaks final ties at random rather than by Current Table position", () => {
    // Teams 1 and 2 finish level on 9 Points for sure: each wins its Remaining home Game against team 3.
    const games = [played(1, 3, 3, 0), played(2, 3, 3, 0), scheduled(1, 3), scheduled(2, 3), played(1, 2, 3, 2, "OT"), played(2, 1, 3, 2, "SO")];
    const probabilities = probabilitiesByTeam(games, homeAlwaysWins);
    expect(probabilities.get(1)!.first).toBeGreaterThan(0.45);
    expect(probabilities.get(1)!.first).toBeLessThan(0.55);
    expect(probabilities.get(1)!.first + probabilities.get(2)!.first).toBe(1);
  });

  it("keeps the Projected Table ranked by expected Points", () => {
    const { projectedTable } = project(roundRobin(), asOf, seasonRate);
    const points = projectedTable.map((row) => row.projectedPoints);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it("gives no probabilities for a Points-only model", () => {
    for (const probabilities of probabilitiesByTeam(roundRobin(), splitFormRate).values()) {
      expect(probabilities).toBeNull();
    }
  });
});

function rankDistributionsByTeam(games: Game[], model: ProjectionModel) {
  return new Map(project(games, asOf, model).projectedTable.map((row) => [row.teamId, row.rankDistribution]));
}

/** The Rank Distribution entries from rank `from` to rank `to` (1-based, inclusive), summed. */
function chanceOfRanks(distribution: number[], from: number, to: number) {
  return distribution.slice(from - 1, to).reduce((sum, probability) => sum + probability, 0);
}

describe("project: Rank Distribution", () => {
  it("gives every team a distribution summing to 1, and every rank probabilities summing to 1 across teams", () => {
    const distributions = [...rankDistributionsByTeam(roundRobin(), seasonRate).values()].map((d) => d!);
    for (const distribution of distributions) {
      expect(distribution).toHaveLength(14);
      expect(distribution.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
    }
    for (let rank = 0; rank < 14; rank++) {
      expect(distributions.reduce((sum, distribution) => sum + distribution[rank]!, 0)).toBeCloseTo(1, 12);
    }
  });

  it("sums, over each Cut Line zone, to the team's Playoffs / Play-in / Eliminated, and its 1st entry to its 1st", () => {
    for (const { rankDistribution, probabilities } of project(roundRobin(), asOf, seasonRate).projectedTable) {
      const distribution = rankDistribution!;
      expect(chanceOfRanks(distribution, 1, 6)).toBeCloseTo(probabilities!.playoffs, 12);
      expect(chanceOfRanks(distribution, 7, 10)).toBeCloseTo(probabilities!.playIn, 12);
      expect(chanceOfRanks(distribution, 11, 14)).toBeCloseTo(probabilities!.eliminated, 12);
      expect(distribution[0]).toBeCloseTo(probabilities!.first, 12);
    }
  });

  it("puts a team with a certain rank on probability 1 there, and teams tied on Points about 50/50 across their ranks", () => {
    // As in the sure-outcomes case above: 14 is first, 9–14 make the playoffs, 1 and 8 share 7th–8th.
    const distributions = rankDistributionsByTeam(roundRobin(), homeAlwaysWins);
    expect(distributions.get(14)![0]).toBe(1);
    expect(distributions.get(13)![1]).toBe(1);
    expect(distributions.get(5)![10]).toBe(1);
    expect(distributions.get(2)![13]).toBe(1);
    for (const team of [1, 8]) {
      expect(distributions.get(team)![6]).toBeGreaterThan(0.45);
      expect(distributions.get(team)![6]).toBeLessThan(0.55);
      expect(distributions.get(team)![6]! + distributions.get(team)![7]!).toBe(1);
    }
  });

  it("has one entry per team for a Season with fewer than 14 teams", () => {
    const games = [played(1, 2, 3, 0), played(2, 3, 3, 0), scheduled(1, 3), scheduled(3, 2)];
    const distributions = rankDistributionsByTeam(games, seasonRate);
    expect(distributions.size).toBe(3);
    for (const distribution of distributions.values()) {
      expect(distribution).toHaveLength(3);
      expect(distribution!.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
    }
  });

  it("gives no Rank Distribution for a Points-only model", () => {
    for (const distribution of rankDistributionsByTeam(roundRobin(), splitFormRate).values()) {
      expect(distribution).toBeNull();
    }
  });
});

describe("simulateSeason: run count", () => {
  const coinFlipGame: Game = { id: "g", startsAt: "2026-10-10T19:45:00+02:00", homeTeamId: 1, awayTeamId: 2 };
  const coinFlip = new Map([
    ["g", { regulationWin: 0.5, overtimeOrShootoutWin: 0, overtimeOrShootoutLoss: 0, regulationLoss: 0.5 }],
  ]);
  const simulate = (runs?: number) =>
    simulateSeason(new Map([[1, 0], [2, 0]]), [coinFlipGame], coinFlip, 7, runs).get(1)!.rankDistribution;

  it("plays out the given number of Seasons", () => {
    // Each simulated Season puts team 1 at one rank, so every chance is a whole number of runs over the run count.
    for (const runs of [1, 3, 4]) {
      for (const probability of simulate(runs)) expect(Number.isInteger(probability * runs)).toBe(true);
    }
    expect(simulate(1).sort()).toEqual([0, 1]);
  });

  it("plays out SIMULATION_RUNS Seasons when no run count is given", () => {
    expect(simulate()).toEqual(simulate(SIMULATION_RUNS));
  });
});

describe("simulationSeed", () => {
  it("derives the same seed from the same Match Day and model, and a different one for another model or Match Day", () => {
    expect(simulationSeed("2026-09-27", "elo")).toBe(simulationSeed("2026-09-27", "elo"));
    expect(simulationSeed("2026-09-27", "elo")).not.toBe(simulationSeed("2026-09-27", "matchup"));
    expect(simulationSeed("2026-09-27", "elo")).not.toBe(simulationSeed("2026-09-28", "elo"));
    expect(simulationSeed(SEASON_START, "elo")).not.toBe(simulationSeed("2026-09-27", "elo"));
  });
});

describe("project: Season Simulation on the recorded 27.09.2026 snapshot", () => {
  const snapshot = recordedSnapshot as Snapshot;

  it.each([seasonRate, matchupModel, eloModel])("gives plausible probabilities under $name", (model) => {
    const { projectedTable } = project(snapshot.games, new Date(snapshot.snapshotAt), model);
    expect(projectedTable).toHaveLength(14);
    for (const { probabilities } of projectedTable) {
      for (const probability of Object.values(probabilities!)) {
        expect(probability).toBeGreaterThanOrEqual(0);
        expect(probability).toBeLessThanOrEqual(1);
      }
      expect(probabilities!.playoffs + probabilities!.playIn + probabilities!.eliminated).toBeCloseTo(1, 12);
    }
    expect(projectedTable.reduce((sum, row) => sum + row.probabilities!.first, 0)).toBeCloseTo(1, 12);
  });

  it.each([seasonRate, matchupModel, eloModel])("gives valid Rank Distributions under $name", (model) => {
    const { projectedTable } = project(snapshot.games, new Date(snapshot.snapshotAt), model);
    for (const { rankDistribution } of projectedTable) {
      expect(rankDistribution).toHaveLength(14);
      for (const probability of rankDistribution!) {
        expect(probability).toBeGreaterThanOrEqual(0);
        expect(probability).toBeLessThanOrEqual(1);
      }
      expect(rankDistribution!.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12);
    }
    for (let rank = 0; rank < 14; rank++) {
      expect(projectedTable.reduce((sum, row) => sum + row.rankDistribution![rank]!, 0)).toBeCloseTo(1, 12);
    }
  });
});

describe("Season Simulation seeded by Match Day", () => {
  const snapshot = recordedSnapshot as Snapshot;
  const tableAt = (model: ProjectionModel, asOf: Date) =>
    project(snapshot.games, asOf, model).projectedTable;
  const snapshotAt = new Date(snapshot.snapshotAt);
  // Same Games, no new result: refreshes an hour and a day later.
  const refreshes = [3_600_000, 86_400_000].map((offset) => new Date(snapshotAt.getTime() + offset));

  it.each([seasonRate, matchupModel, eloModel])(
    "gives identical tables under $name for snapshots of the same Games taken at different times",
    (model) => {
      for (const later of refreshes) expect(tableAt(model, later)).toEqual(tableAt(model, snapshotAt));
    },
  );

  it("gives the same numbers on every run", () => {
    expect(tableAt(eloModel, snapshotAt)).toEqual(tableAt(eloModel, snapshotAt));
  });
});

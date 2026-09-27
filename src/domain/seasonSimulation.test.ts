import { describe, expect, it } from "vitest";
import { eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";
import { project, type ProjectionModel } from "./project.ts";
import { seasonRate } from "./seasonRate.ts";
import { simulationSeed } from "./seasonSimulation.ts";
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

function probabilitiesByTeam(games: Game[], model: ProjectionModel, seed = 1) {
  return new Map(project(games, asOf, model, seed).projectedTable.map((row) => [row.teamId, row.probabilities]));
}

describe("project: Season Simulation", () => {
  it("gives the same probabilities for the same seed", () => {
    const games = roundRobin();
    expect(probabilitiesByTeam(games, seasonRate, 42)).toEqual(probabilitiesByTeam(games, seasonRate, 42));
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
    const { projectedTable } = project(roundRobin(), asOf, seasonRate, 1);
    const points = projectedTable.map((row) => row.projectedPoints);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it("gives no probabilities for a Points-only model", () => {
    for (const probabilities of probabilitiesByTeam(roundRobin(), splitFormRate).values()) {
      expect(probabilities).toBeNull();
    }
  });
});

describe("simulationSeed", () => {
  it("derives the same seed from the same snapshot time and model, and a different one for another model", () => {
    const snapshotAt = "2026-09-27T13:33:00+02:00";
    expect(simulationSeed(snapshotAt, "elo")).toBe(simulationSeed(snapshotAt, "elo"));
    expect(simulationSeed(snapshotAt, "elo")).not.toBe(simulationSeed(snapshotAt, "matchup"));
    expect(simulationSeed(snapshotAt, "elo")).not.toBe(simulationSeed("2026-09-28T07:00:00+02:00", "elo"));
  });
});

describe("project: Season Simulation on the recorded 27.09.2026 snapshot", () => {
  const snapshot = recordedSnapshot as Snapshot;

  it.each([seasonRate, matchupModel, eloModel])("gives plausible probabilities under $name", (model) => {
    const { projectedTable } = project(
      snapshot.games,
      new Date(snapshot.snapshotAt),
      model,
      simulationSeed(snapshot.snapshotAt, model.id),
    );
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
});

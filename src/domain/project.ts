import {
  FORM_WINDOW_SIZE,
  formOf,
  formWindowGame,
  pointsFor,
  type FormWindowGame,
  type FormWindows,
  type PlayedGame,
} from "./form.ts";
import { expectedPointsOf, otsoRate, type ExpectedPoints, type OutcomeProbabilities } from "./outcomes.ts";
import type { Game, TeamId } from "./types.ts";

export interface CurrentTableRow {
  rank: number;
  teamId: TeamId;
  gamesPlayed: number;
  regulationWins: number;
  overtimeOrShootoutWins: number;
  overtimeOrShootoutLosses: number;
  regulationLosses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/** Everything a Projection Model may predict from: the Season as it stood at the As-Of Date. */
export interface ProjectionModelInput {
  currentTable: CurrentTableRow[];
  formWindows: Map<TeamId, FormWindows>;
  /** Played Games, oldest first. */
  playedGames: PlayedGame[];
  remainingGames: Game[];
  /** The OT/SO Rate over the Played Games. */
  otsoRate: number;
}

/**
 * Predicts each Remaining Game; a team's projected Points are its current Points plus its expected Points over them.
 * Models give Outcome Probabilities per Game, except Points-only models such as Split Form Rate, which predict each
 * side's Points independently and so cannot give coherent probabilities (ADR 0002).
 */
export type ProjectionModel =
  | {
      name: string;
      kind: "outcomes";
      /** Outcome Probabilities for every Remaining Game, by Game id. */
      predictOutcomes(input: ProjectionModelInput): Map<string, OutcomeProbabilities>;
    }
  | {
      name: string;
      kind: "points";
      /** Expected Points of each side for every Remaining Game, by Game id. */
      predictPoints(input: ProjectionModelInput): Map<string, ExpectedPoints>;
    };

/** A Projection Model's prediction for one Game; `outcomes` is null for Points-only models. */
export interface GamePrediction {
  points: ExpectedPoints;
  outcomes: OutcomeProbabilities | null;
}

/** Runs a Projection Model over the Remaining Games, failing loudly if it skips any. */
export function predictGames(model: ProjectionModel, input: ProjectionModelInput): Map<string, GamePrediction> {
  const predictions = new Map<string, GamePrediction>();
  if (model.kind === "outcomes") {
    const outcomes = model.predictOutcomes(input);
    for (const [gameId, probabilities] of outcomes) {
      predictions.set(gameId, { points: expectedPointsOf(probabilities), outcomes: probabilities });
    }
  } else {
    for (const [gameId, points] of model.predictPoints(input)) predictions.set(gameId, { points, outcomes: null });
  }
  for (const game of input.remainingGames) {
    if (!predictions.has(game.id)) throw new Error(`${model.name} gave no prediction for Game ${game.id}`);
  }
  return predictions;
}

/** Where a rank falls against the Cut Lines. */
export type CutLine = "playoffs" | "play-in" | "eliminated";

export function cutLineFor(rank: number): CutLine {
  if (rank <= 6) return "playoffs";
  if (rank <= 10) return "play-in";
  return "eliminated";
}

export interface ProjectedTableRow {
  rank: number;
  teamId: TeamId;
  currentRank: number;
  /** Places gained (positive) or lost (negative) against the current rank. */
  movement: number;
  cutLine: CutLine;
  currentPoints: number;
  /** Points per Game over the home Form Window, or null when it is empty. */
  homeForm: number | null;
  /** Points per Game over the away Form Window, or null when it is empty. */
  awayForm: number | null;
  /** The Games of the home Form Window, newest first. */
  homeFormWindow: FormWindowGame[];
  /** The Games of the away Form Window, newest first. */
  awayFormWindow: FormWindowGame[];
  remainingHomeGames: number;
  remainingAwayGames: number;
  projectedPoints: number;
  /** The team has fewer than LOW_SAMPLE_GAMES Played Games. */
  lowSample: boolean;
}

/** A team with fewer Played Games than this is Low Sample, under every Projection Model. */
export const LOW_SAMPLE_GAMES = 10;

/** Games in a team's Regular Season: Played + Remaining must add up to this. */
export const REGULAR_SEASON_GAMES = 52;

/** A team whose Played + Remaining Games do not add up to a full Regular Season. */
export interface IntegrityIssue {
  teamId: TeamId;
  playedGames: number;
  remainingGames: number;
}

export interface Projection {
  currentTable: CurrentTableRow[];
  projectedTable: ProjectedTableRow[];
  /** Teams whose Games do not add up to REGULAR_SEASON_GAMES, in Current Table order; empty when the data is complete. */
  integrityIssues: IntegrityIssue[];
  /** False before the Season's first Game has been played. */
  anyGamesPlayed: boolean;
}

/** Projected Points closer than this are a tie, so floating-point noise never overrides Current Table position. */
const PROJECTED_TIE_TOLERANCE = 1e-9;

type UnrankedRow = Omit<CurrentTableRow, "rank">;

function pointsPerGame(row: UnrankedRow): number {
  return row.gamesPlayed === 0 ? 0 : row.points / row.gamesPlayed;
}

function goalDifference(row: UnrankedRow): number {
  return row.goalsFor - row.goalsAgainst;
}

/**
 * Current Table order: Points, then Points per Game, goal difference, goals for and regulation wins.
 * An approximation of the official SIHF order, which also uses head-to-head.
 */
function byCurrentTableOrder(a: UnrankedRow, b: UnrankedRow): number {
  return (
    b.points - a.points ||
    pointsPerGame(b) - pointsPerGame(a) ||
    goalDifference(b) - goalDifference(a) ||
    b.goalsFor - a.goalsFor ||
    b.regulationWins - a.regulationWins
  );
}

/** A Game is Played once it has a final result and started before the As-Of Date. */
function isPlayed(game: Game, asOf: Date): game is PlayedGame {
  return game.result !== undefined && new Date(game.startsAt) < asOf;
}

/** The Season as it stood at the As-Of Date, in the shape a Projection Model predicts from. */
export function projectionModelInput(games: Game[], asOf: Date): ProjectionModelInput {
  const rows = new Map<TeamId, UnrankedRow>();
  const rowFor = (teamId: TeamId) => {
    let row = rows.get(teamId);
    if (!row) {
      row = {
        teamId,
        gamesPlayed: 0,
        regulationWins: 0,
        overtimeOrShootoutWins: 0,
        overtimeOrShootoutLosses: 0,
        regulationLosses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      };
      rows.set(teamId, row);
    }
    return row;
  };

  for (const game of games) {
    const home = rowFor(game.homeTeamId);
    const away = rowFor(game.awayTeamId);
    if (!isPlayed(game, asOf)) continue;

    const { homeGoals, awayGoals, decision } = game.result;
    const [winner, loser] = homeGoals > awayGoals ? [home, away] : [away, home];
    for (const [row, goalsFor, goalsAgainst] of [
      [home, homeGoals, awayGoals],
      [away, awayGoals, homeGoals],
    ] as const) {
      row.gamesPlayed++;
      row.goalsFor += goalsFor;
      row.goalsAgainst += goalsAgainst;
      row.points += pointsFor(game, row.teamId);
    }
    if (decision === "regulation") {
      winner.regulationWins++;
      loser.regulationLosses++;
    } else {
      winner.overtimeOrShootoutWins++;
      loser.overtimeOrShootoutLosses++;
    }
  }

  const currentTable = [...rows.values()]
    .sort(byCurrentTableOrder)
    .map((row, index) => ({ rank: index + 1, ...row }));

  const playedGames = games.filter((game) => isPlayed(game, asOf));
  const remainingGames = games.filter((game) => !isPlayed(game, asOf));
  const byRecency = [...playedGames].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const formWindows = new Map<TeamId, FormWindows>(
    currentTable.map(({ teamId }) => [
      teamId,
      {
        home: byRecency.filter((game) => game.homeTeamId === teamId).slice(0, FORM_WINDOW_SIZE),
        away: byRecency.filter((game) => game.awayTeamId === teamId).slice(0, FORM_WINDOW_SIZE),
      },
    ]),
  );

  const chronological = [...playedGames].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { currentTable, formWindows, playedGames: chronological, remainingGames, otsoRate: otsoRate(playedGames) };
}

export function project(games: Game[], asOf: Date, model: ProjectionModel): Projection {
  const input = projectionModelInput(games, asOf);
  const { currentTable, formWindows, playedGames, remainingGames } = input;

  const predictions = predictGames(model, input);
  const projectedPoints = new Map(currentTable.map((row) => [row.teamId, row.points]));
  for (const game of remainingGames) {
    const { points } = predictions.get(game.id)!;
    projectedPoints.set(game.homeTeamId, projectedPoints.get(game.homeTeamId)! + points.home);
    projectedPoints.set(game.awayTeamId, projectedPoints.get(game.awayTeamId)! + points.away);
  }

  // Current Table order is the tie-break: the sort is stable.
  const projectedTable = currentTable
    .map((row) => ({ row, projected: projectedPoints.get(row.teamId)! }))
    .sort((a, b) =>
      Math.abs(b.projected - a.projected) < PROJECTED_TIE_TOLERANCE ? 0 : b.projected - a.projected,
    )
    .map(({ row, projected }, index): ProjectedTableRow => {
    const windows = formWindows.get(row.teamId)!;
    return {
      rank: index + 1,
      teamId: row.teamId,
      currentRank: row.rank,
      movement: row.rank - (index + 1),
      cutLine: cutLineFor(index + 1),
      currentPoints: row.points,
      homeForm: formOf(windows.home, row.teamId),
      awayForm: formOf(windows.away, row.teamId),
      homeFormWindow: windows.home.map((game) => formWindowGame(game, row.teamId)),
      awayFormWindow: windows.away.map((game) => formWindowGame(game, row.teamId)),
      remainingHomeGames: remainingGames.filter((game) => game.homeTeamId === row.teamId).length,
      remainingAwayGames: remainingGames.filter((game) => game.awayTeamId === row.teamId).length,
      projectedPoints: projected,
      lowSample: row.gamesPlayed < LOW_SAMPLE_GAMES,
    };
  });

  const integrityIssues = currentTable
    .map(({ teamId, gamesPlayed }) => ({
      teamId,
      playedGames: gamesPlayed,
      remainingGames: remainingGames.filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId).length,
    }))
    .filter((issue) => issue.playedGames + issue.remainingGames !== REGULAR_SEASON_GAMES);

  return { currentTable, projectedTable, integrityIssues, anyGamesPlayed: playedGames.length > 0 };
}

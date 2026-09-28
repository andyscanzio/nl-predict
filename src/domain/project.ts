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
import { cutLineFor, type CutLine } from "./cutLines.ts";
import { simulateSeason, simulationSeed, type CutLineProbabilities } from "./seasonSimulation.ts";
import { swissCalendarDay } from "./swissDay.ts";
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
export type ProjectionModel<Id extends string = string> =
  | {
      /** Stable identifier, e.g. for seeding the Season Simulation. */
      id: Id;
      name: string;
      kind: "outcomes";
      /** Outcome Probabilities for every Remaining Game, by Game id. */
      predictOutcomes(input: ProjectionModelInput): Map<string, OutcomeProbabilities>;
    }
  | {
      /** Stable identifier, e.g. for seeding the Season Simulation. */
      id: Id;
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
  /** Cut Line zone and 1st-place chances from the Season Simulation; null for Points-only models. */
  probabilities: CutLineProbabilities | null;
  /** Chance of finishing at each rank of the final table (index 0 = 1st) from the Season Simulation; null for Points-only models. */
  rankDistribution: number[] | null;
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

/** A What-If Result, from the home side: the four outcomes are the keys of OutcomeProbabilities. */
export type WhatIfOutcome = keyof OutcomeProbabilities;

/** A visitor's What-If: the What-If Result they set for each Game, by Game id. */
export type WhatIf = ReadonlyMap<string, WhatIfOutcome>;

/**
 * An Upcoming Game in the Next Round. It carries the prediction already computed for the Projected Table, or, when a
 * What-If Result is set for it, that outcome instead and no prediction.
 */
export type UpcomingGame =
  | { game: Game; prediction: GamePrediction; whatIf?: undefined }
  | { game: Game; whatIf: WhatIfOutcome; prediction?: undefined };

/** One match day of the Next Round: its Swiss calendar date (YYYY-MM-DD) and its Upcoming Games in start order. */
export interface NextRoundDay {
  date: string;
  games: UpcomingGame[];
}

export interface Projection {
  /**
   * The Match Day the projection is as of: the Swiss calendar day (YYYY-MM-DD) of the latest Played Game up to the As-Of
   * Date, or SEASON_START before any Game has been played. It seeds the Season Simulation (see simulationSeed).
   */
  matchDay: string;
  currentTable: CurrentTableRow[];
  projectedTable: ProjectedTableRow[];
  /** Teams whose Games do not add up to REGULAR_SEASON_GAMES, in Current Table order; empty when the data is complete. */
  integrityIssues: IntegrityIssue[];
  /** False before the Season's first Game has been played. */
  anyGamesPlayed: boolean;
  /** The Upcoming Games on the earliest match day, plus each following match day in full, until one full round is included. */
  nextRound: NextRoundDay[];
  /** The What-If applied: the What-If Results asked for whose Game is in the real Next Round; empty when none. */
  whatIf: WhatIf;
}

/** The Match Day of a projection made before any Game has been played. */
export const SEASON_START = "season-start";

/** Projected Points closer than this are a tie, so floating-point noise never overrides Current Table position. */
const PROJECTED_TIE_TOLERANCE = 1e-9;

type UnrankedRow = Omit<CurrentTableRow, "rank">;

function pointsPerGame(row: UnrankedRow): number {
  return row.gamesPlayed === 0 ? 0 : row.points / row.gamesPlayed;
}

function goalDifference(row: UnrankedRow): number {
  return row.goalsFor - row.goalsAgainst;
}

/** Teams still level on the Current Table order so far, in no particular order within the Group. */
type Group = UnrankedRow[];

/** Splits `rows` into Groups tied on `key`, ordered by `key` descending. */
function groupBy(rows: Group, key: (row: UnrankedRow) => number): Group[] {
  const byKey = new Map<number, Group>();
  for (const row of rows) {
    const groupKey = key(row);
    const bucket = byKey.get(groupKey);
    if (bucket) bucket.push(row);
    else byKey.set(groupKey, [row]);
  }
  return [...byKey.entries()].sort(([a], [b]) => b - a).map(([, group]) => group);
}

/** The Played Games available to a settling Group: all Played Games, and the original Group's Direct Games. */
interface SettleContext {
  playedGames: readonly PlayedGame[];
  /**
   * The Played Games among the teams of the Group as it first formed at official step 1 (see CONTEXT.md). Fixed for
   * every step, so teams left level after some of the Group has been separated still use the original Group's
   * Direct Games, never a fresh mini-league of just the teams still tied ("gemäss Kriterien aus Punkt 1").
   */
  directGames: readonly PlayedGame[];
}

/** A step settles a still-tied Group by a `key`, computed from the Group's SettleContext. */
type GroupStep = (context: SettleContext) => (row: UnrankedRow) => number;

/** Narrows every still-tied Group (more than one team) by `step`; a settled Group (one team) is left untouched. */
function narrow(groups: Group[], step: GroupStep, context: SettleContext): Group[] {
  const key = step(context);
  return groups.flatMap((group) => (group.length <= 1 ? [group] : groupBy(group, key)));
}

/**
 * The Played Games among the teams of `group`: its Direct Games (see CONTEXT.md). This ticket assumes every pair in
 * the Group has met equally often; #87 handles unequal meetings by dropping the earliest legs.
 */
function directGamesOf(group: Group, playedGames: readonly PlayedGame[]): PlayedGame[] {
  const teamIds = new Set(group.map((row) => row.teamId));
  return playedGames.filter((game) => teamIds.has(game.homeTeamId) && teamIds.has(game.awayTeamId));
}

/** Each team's Points from `games`, 0 for a team that plays none of them. */
function pointsIn(games: readonly PlayedGame[]): (row: UnrankedRow) => number {
  const points = new Map<TeamId, number>();
  for (const game of games) {
    points.set(game.homeTeamId, (points.get(game.homeTeamId) ?? 0) + pointsFor(game, game.homeTeamId));
    points.set(game.awayTeamId, (points.get(game.awayTeamId) ?? 0) + pointsFor(game, game.awayTeamId));
  }
  return (row) => points.get(row.teamId) ?? 0;
}

/** Each team's goal difference and goals for from `games`, 0 for a team that plays none of them. */
function goalTotalsIn(games: readonly PlayedGame[]): { goalDifference: (row: UnrankedRow) => number; goalsFor: (row: UnrankedRow) => number } {
  const goalsFor = new Map<TeamId, number>();
  const goalsAgainst = new Map<TeamId, number>();
  for (const game of games) {
    const { homeGoals, awayGoals } = game.result;
    goalsFor.set(game.homeTeamId, (goalsFor.get(game.homeTeamId) ?? 0) + homeGoals);
    goalsAgainst.set(game.homeTeamId, (goalsAgainst.get(game.homeTeamId) ?? 0) + awayGoals);
    goalsFor.set(game.awayTeamId, (goalsFor.get(game.awayTeamId) ?? 0) + awayGoals);
    goalsAgainst.set(game.awayTeamId, (goalsAgainst.get(game.awayTeamId) ?? 0) + homeGoals);
  }
  return {
    goalDifference: (row) => (goalsFor.get(row.teamId) ?? 0) - (goalsAgainst.get(row.teamId) ?? 0),
    goalsFor: (row) => goalsFor.get(row.teamId) ?? 0,
  };
}

/** Each team's goals scored as the away side in `games`, 0 for a team that plays none of them as away side. */
function awayGoalsIn(games: readonly PlayedGame[]): (row: UnrankedRow) => number {
  const awayGoals = new Map<TeamId, number>();
  for (const game of games) awayGoals.set(game.awayTeamId, (awayGoals.get(game.awayTeamId) ?? 0) + game.result.awayGoals);
  return (row) => awayGoals.get(row.teamId) ?? 0;
}

/**
 * Points in the Group's Direct Games: official step 1 of Art. 6.2, "Weisungen für den Spielbetrieb der National
 * League, Saison 2026/27" (02.09.2026). A team with no Direct Games, or Direct Games it took no Points from, scores
 * 0, same as every other team still level here, so the step decides nothing and the Group falls through untouched.
 */
const directGamePoints: GroupStep = ({ directGames }) => pointsIn(directGames);

/** A GroupStep that ignores the SettleContext, settling purely by a per-row `key`. */
function byKey(key: (row: UnrankedRow) => number): GroupStep {
  return () => key;
}

const GROUP_STEPS: GroupStep[] = [
  directGamePoints,
  // Official steps 2-3, Art. 6.2: goal difference, then goals for, over all Played Games.
  byKey(goalDifference),
  byKey((row) => row.goalsFor),
  // Official steps 4-5, Art. 6.2: goal difference, then goals for, in the Group's Direct Games.
  ({ directGames }) => goalTotalsIn(directGames).goalDifference,
  ({ directGames }) => goalTotalsIn(directGames).goalsFor,
  // Official steps 6-7, Art. 6.2: away goals, over all Played Games, then in the Group's Direct Games.
  ({ playedGames }) => awayGoalsIn(playedGames),
  ({ directGames }) => awayGoalsIn(directGames),
  // Our own last resort, so the order is always total: regulation wins, then a fixed team order.
  byKey((row) => row.regulationWins),
  byKey((row) => -row.teamId),
];

/**
 * Settles a Group of teams level on Points and Points per Game by the full official Art. 6.2 order: Points, goal
 * difference and goals for in the Group's Direct Games and over all Played Games, then away goals the same way, and
 * finally our own last resort (regulation wins, then a fixed team order) so the order is always total. Direct Games
 * are fixed once from the Group as it first forms (see SettleContext), so teams left level after part of the Group
 * has been separated still use the original Group's Direct Games for every later step.
 */
function settleGroup(group: Group, playedGames: readonly PlayedGame[]): Group {
  const context: SettleContext = { playedGames, directGames: directGamesOf(group, playedGames) };
  return GROUP_STEPS.reduce((groups, step) => narrow(groups, step, context), [group]).flat();
}

/**
 * Current Table order: Points, then Points per Game (as the official live table does mid-season). Teams still level
 * form a Group, settled with the Played Games available to it rather than compared pairwise — see settleGroup.
 */
function currentTableOrder(rows: Group, playedGames: readonly PlayedGame[]): Group {
  return groupBy(rows, (row) => row.points)
    .flatMap((group) => groupBy(group, pointsPerGame))
    .flatMap((group) => settleGroup(group, playedGames));
}

/** A Game is Played once it has a final result and started before the As-Of Date. */
export function isPlayed(game: Game, asOf: Date): game is PlayedGame {
  return game.result !== undefined && new Date(game.startsAt) < asOf;
}

/**
 * The Season as it stood at the As-Of Date, in the shape a Projection Model predicts from. Games in `alsoPlayed` count as
 * Played even though they start after it (a What-If Result's Game).
 */
export function projectionModelInput(games: Game[], asOf: Date, alsoPlayed: ReadonlySet<string> = new Set()): ProjectionModelInput {
  const played = (game: Game): game is PlayedGame => game.result !== undefined && (alsoPlayed.has(game.id) || isPlayed(game, asOf));
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
    if (!played(game)) continue;

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

  const playedGames = games.filter(played);
  const remainingGames = games.filter((game) => !played(game));

  const currentTable = currentTableOrder([...rows.values()], playedGames).map((row, index) => ({
    rank: index + 1,
    ...row,
  }));

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

/**
 * The Next Round: the Upcoming Games (Remaining Games starting strictly after the As-Of Date) on the earliest Swiss
 * match day, plus each following match day in full, until at least one full round (half the teams in the Season) is
 * included, or none are left. Games are ordered by start time within a day, ties by Game id.
 */
function nextRoundOf(remainingGames: Game[], asOf: Date, teamCount: number): { date: string; games: Game[] }[] {
  const upcoming = remainingGames.filter((game) => Date.parse(game.startsAt) > asOf.getTime());

  const byDay = new Map<string, Game[]>();
  for (const game of upcoming) {
    const date = swissCalendarDay(Date.parse(game.startsAt));
    const day = byDay.get(date);
    if (day) day.push(game);
    else byDay.set(date, [game]);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, games]) => ({
      date,
      games: [...games].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id)),
    }));

  const roundSize = Math.floor(teamCount / 2);
  const nextRound: { date: string; games: Game[] }[] = [];
  let gamesSoFar = 0;
  for (const day of days) {
    if (gamesSoFar >= roundSize) break;
    nextRound.push(day);
    gamesSoFar += day.games.length;
  }
  return nextRound;
}

/**
 * The Match Day a projection is as of: the latest Swiss calendar day, as of the As-Of Date, on which a Played Game started
 * (YYYY-MM-DD), or SEASON_START before any Game. Remaining Games never count, however late their start.
 */
export function matchDayOf(playedGames: readonly PlayedGame[]): string {
  let latest: number | undefined;
  for (const game of playedGames) {
    const startsAt = Date.parse(game.startsAt);
    if (latest === undefined || startsAt > latest) latest = startsAt;
  }
  return latest === undefined ? SEASON_START : swissCalendarDay(latest);
}

/** The Game as it would be Played with a What-If Result: a one-goal win, in regulation or OT/SO. */
function whatIfGame(game: Game, outcome: WhatIfOutcome): Game {
  const decision = outcome === "regulationWin" || outcome === "regulationLoss" ? "regulation" : "OT";
  const homeWins = outcome === "regulationWin" || outcome === "overtimeOrShootoutWin";
  return { ...game, result: { homeGoals: homeWins ? 1 : 0, awayGoals: homeWins ? 0 : 1, decision } };
}

/**
 * Projects the Season as it stood at the As-Of Date. The Season Simulation, which runs for models with Outcome
 * Probabilities, is seeded from the projection's Match Day and the model's id (see simulationSeed), so the same Games,
 * As-Of Date, model and What-If always give the same numbers, and a refresh with no new results changes nothing.
 *
 * With a What-If, every What-If Result whose Game is in the real Next Round is treated as a Played Game won by one goal,
 * for the Projected Table, Season Simulation and Match Day. The Current Table, integrity issues and the Next Round's
 * Games stay real. Other What-If Results are ignored quietly.
 */
export function project(games: Game[], asOf: Date, model: ProjectionModel, whatIf: WhatIf = new Map()): Projection {
  const realInput = projectionModelInput(games, asOf);
  const realNextRound = nextRoundOf(realInput.remainingGames, asOf, realInput.currentTable.length);

  const nextRoundIds = new Set(realNextRound.flatMap((day) => day.games.map((game) => game.id)));
  const applied = new Map([...whatIf].filter(([gameId]) => nextRoundIds.has(gameId)));
  const input =
    applied.size === 0
      ? realInput
      : projectionModelInput(
          games.map((game) => (applied.has(game.id) ? whatIfGame(game, applied.get(game.id)!) : game)),
          asOf,
          new Set(applied.keys()),
        );
  const { currentTable, formWindows, playedGames, remainingGames } = input;
  const realRanks = new Map(realInput.currentTable.map((row) => [row.teamId, row.rank]));
  const matchDay = matchDayOf(playedGames);

  const predictions = predictGames(model, input);
  const projectedPoints = new Map(currentTable.map((row) => [row.teamId, row.points]));
  for (const game of remainingGames) {
    const { points } = predictions.get(game.id)!;
    projectedPoints.set(game.homeTeamId, projectedPoints.get(game.homeTeamId)! + points.home);
    projectedPoints.set(game.awayTeamId, projectedPoints.get(game.awayTeamId)! + points.away);
  }

  const simulation =
    model.kind === "outcomes"
      ? simulateSeason(
          new Map(currentTable.map((row) => [row.teamId, row.points])),
          remainingGames,
          new Map(remainingGames.map((game) => [game.id, predictions.get(game.id)!.outcomes!])),
          simulationSeed(matchDay, model.id),
        )
      : null;

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
      currentRank: realRanks.get(row.teamId)!,
      movement: realRanks.get(row.teamId)! - (index + 1),
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
      probabilities: simulation?.get(row.teamId)?.probabilities ?? null,
      rankDistribution: simulation?.get(row.teamId)?.rankDistribution ?? null,
    };
  });

  const integrityIssues = realInput.currentTable
    .map(({ teamId, gamesPlayed }) => ({
      teamId,
      playedGames: gamesPlayed,
      remainingGames: realInput.remainingGames.filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
        .length,
    }))
    .filter((issue) => issue.playedGames + issue.remainingGames !== REGULAR_SEASON_GAMES);

  const nextRound = realNextRound.map(({ date, games }) => ({
    date,
    games: games.map((game): UpcomingGame => {
      const outcome = applied.get(game.id);
      return outcome ? { game, whatIf: outcome } : { game, prediction: predictions.get(game.id)! };
    }),
  }));

  return {
    matchDay,
    currentTable: realInput.currentTable,
    projectedTable,
    integrityIssues,
    anyGamesPlayed: realInput.playedGames.length > 0,
    nextRound,
    whatIf: applied,
  };
}

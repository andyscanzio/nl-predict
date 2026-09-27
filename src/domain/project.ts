import type { Game, GameResult, TeamId } from "./types.ts";

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

export interface Projection {
  currentTable: CurrentTableRow[];
}

type PlayedGame = Game & { result: GameResult };

/** A Game is Played once it has a final result and started before the As-Of Date. */
function isPlayed(game: Game, asOf: Date): game is PlayedGame {
  return game.result !== undefined && new Date(game.startsAt) < asOf;
}

export function project(games: Game[], asOf: Date): Projection {
  const rows = new Map<TeamId, Omit<CurrentTableRow, "rank">>();
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
    }
    if (decision === "regulation") {
      winner.regulationWins++;
      winner.points += 3;
      loser.regulationLosses++;
    } else {
      winner.overtimeOrShootoutWins++;
      winner.points += 2;
      loser.overtimeOrShootoutLosses++;
      loser.points += 1;
    }
  }

  const currentTable = [...rows.values()]
    .sort((a, b) => b.points - a.points)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return { currentTable };
}

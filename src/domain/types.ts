/** How a Played Game ended. */
export type Decision = "regulation" | "OT" | "SO";

export type TeamId = number;

export interface Team {
  id: TeamId;
  name: string;
  acronym: string;
}

export interface GameResult {
  homeGoals: number;
  awayGoals: number;
  decision: Decision;
}

/** One Regular Season Game. `result` is present only once the Game has a final score. */
export interface Game {
  id: string;
  /** ISO 8601 scheduled start, with offset. */
  startsAt: string;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  result?: GameResult;
}

export interface Snapshot {
  /** The Season, identified by the year it starts (2026/27 is 2026). */
  season: number;
  /** ISO 8601 time the snapshot was taken. */
  snapshotAt: string;
  teams: Team[];
  games: Game[];
}

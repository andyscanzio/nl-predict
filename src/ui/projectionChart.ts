import { SEASON_START } from "../domain/matchDay.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import type { TeamId } from "../domain/types.ts";
import { formatPercent } from "./winSplit.ts";

/** A point of a chart line, as a share of the plot: x from the left edge, y from the top (0 = 100%, 1 = 0%). */
export interface ChartPoint {
  x: number;
  y: number;
}

/** One team's playoff-chance line. */
export interface ChartLine {
  teamId: TeamId;
  /** The team the visitor opened; drawn bold, the others faint. */
  chosen: boolean;
  points: ChartPoint[];
}

/** Everything the Projection History chart draws, in shares of the plot so the component picks its own size. */
export interface ProjectionChart {
  /** One line per team; the chosen team's comes last, so it is drawn on top. */
  lines: ChartLine[];
  /** Where the faint 50% guide sits, as a `y`. */
  guideY: number;
  /** Sparse date labels for the x-axis. */
  xLabels: { x: number; text: string }[];
  /** A text version for screen readers. */
  summary: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-15" as "15 Sep", or "Start" for the point before the first Game. */
function dateLabel(matchDay: string): string {
  if (matchDay === SEASON_START) return "Start";
  const [, month, day] = matchDay.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]}`;
}

/** The point indexes to label: the first, the middle and the last. */
function labelledIndexes(count: number): number[] {
  return [...new Set([0, Math.round((count - 1) / 2), count - 1])];
}

function summaryOf(now: number, previous: number, start: number): string {
  const change = Math.round((now - previous) * 100);
  const since = change === 0 ? "unchanged" : `${change > 0 ? "up" : "down"} ${Math.abs(change)} pts`;
  return `Playoff chance ${formatPercent(now)}% now, ${formatPercent(start)}% at the start of the Season, ${since} since the previous Match Day.`;
}

/**
 * The playoff-chance chart of a team's Projection History under one model: a line per team on a fixed 0–100% scale.
 * Null when there is nothing to show: only the Season-start point, or a Points-only model with no chances.
 */
export function projectionChart(history: ProjectionHistory, teamId: TeamId): ProjectionChart | null {
  if (history.length < 2) return null;
  const chances = (id: TeamId) => history.map((point) => point.teams[id]!.playoffs);
  const teamIds = Object.keys(history[0]!.teams).map(Number);
  if (teamIds.some((id) => chances(id).includes(null))) return null;

  const lineOf = (id: TeamId): ChartLine => ({
    teamId: id,
    chosen: id === teamId,
    points: chances(id).map((chance, index) => ({ x: index / (history.length - 1), y: 1 - chance! })),
  });
  const chosen = chances(teamId) as number[];
  return {
    lines: [...teamIds.filter((id) => id !== teamId).map(lineOf), lineOf(teamId)],
    guideY: 0.5,
    xLabels: labelledIndexes(history.length).map((index) => ({ x: index / (history.length - 1), text: dateLabel(history[index]!.matchDay) })),
    summary: summaryOf(chosen.at(-1)!, chosen.at(-2)!, chosen[0]!),
  };
}

import { SEASON_START } from "../domain/matchDay.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import { LOW_SAMPLE_GAMES } from "../domain/project.ts";
import type { TeamId } from "../domain/types.ts";
import { formatPercent } from "./winSplit.ts";

/** A point of a chart line, as a share of the plot: x from the left edge, y from the top (0 = 100%, 1 = 0%). */
export interface ChartPoint {
  x: number;
  y: number;
}

/** What the Projection History chart plots: each team's playoff chance, or its projected Points. */
export type ChartMetric = "playoffs" | "points";

/** One team's line. */
export interface ChartLine {
  teamId: TeamId;
  /** The team the visitor opened; drawn bold, the others faint. */
  chosen: boolean;
  points: ChartPoint[];
}

/** A y-axis label, at a `y` share of the plot. */
export interface ChartTick {
  y: number;
  text: string;
}

/** What the tooltip says about one Match Day of the chosen team, anchored at that point of its line. */
export interface ChartTooltip extends ChartPoint {
  /** The date, the value, the 1st-place chance (where the model has one) and the signed change since the previous Match Day (from the second point on). */
  lines: string[];
}

/** Everything the Projection History chart draws, in shares of the plot so the component picks its own size. */
export interface ProjectionChart {
  /** One line per team; the chosen team's comes last, so it is drawn on top. */
  lines: ChartLine[];
  /** Where the faint 50% guide sits, as a `y`; null on the Points scale, which has none. */
  guideY: number | null;
  /** Labels for the y-axis, top to bottom. */
  yTicks: ChartTick[];
  /** Sparse date labels for the x-axis. */
  xLabels: { x: number; text: string }[];
  /** One tooltip per Match Day, on the chosen team's line only; index i belongs to point i. */
  tooltips: ChartTooltip[];
  /** The stretch of the plot, as x shares, where the chosen team had fewer than ten Played Games (Low Sample); null when never. */
  lowSample: { from: number; to: number } | null;
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

/** The date of a tooltip: the Season-start point has no day of its own. */
function tooltipDate(matchDay: string): string {
  return matchDay === SEASON_START ? "Season start" : dateLabel(matchDay);
}

/** A signed change with a true minus sign, e.g. "+4 pts" or "−1.2 Points"; a change that rounds to nothing carries no sign. */
function signedChange(change: number, unit: string, decimals: number): string {
  const rounded = Number(change.toFixed(decimals));
  const text = `${Math.abs(rounded).toFixed(decimals)} ${unit}`;
  return rounded === 0 ? text : `${rounded > 0 ? "+" : "−"}${text}`;
}

/** The index of the Match Day nearest a share of the plot's width, for pointing at the chart. */
export function nearestMatchDay(share: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(share * (count - 1))));
}

function changeText(change: number, unit: string, decimals: number): string {
  const rounded = Number(Math.abs(change).toFixed(decimals));
  return rounded === 0 ? "unchanged" : `${change > 0 ? "up" : "down"} ${rounded.toFixed(decimals)}${unit}`;
}

function playoffsSummary(start: number, previous: number, latest: number): string {
  const since = changeText(Math.round((latest - previous) * 100), " pts", 0);
  return `Playoff chance ${formatPercent(latest)}% now, ${formatPercent(start)}% at the start of the Season, ${since} since the previous Match Day.`;
}

function pointsSummary(start: number, previous: number, latest: number): string {
  const since = changeText(latest - previous, "", 1);
  return `Projected Points ${latest.toFixed(1)} now, ${start.toFixed(1)} at the start of the Season, ${since} since the previous Match Day.`;
}

/** The metrics a model's history can chart: playoff % only where the model has Outcome Probabilities (ADR 0002). None while only the Season-start point exists. */
export function chartMetrics(history: ProjectionHistory): ChartMetric[] {
  if (history.length < 2) return [];
  const hasChances = history.every((point) => Object.values(point.teams).every((team) => team.playoffs !== null));
  return hasChances ? ["playoffs", "points"] : ["points"];
}

/** The metric to draw: the visitor's choice where the model supports it, otherwise the first it does. */
export function shownMetric(chosen: ChartMetric, available: ChartMetric[]): ChartMetric | null {
  return available.includes(chosen) ? chosen : (available[0] ?? null);
}

/**
 * The Projection History chart of a team under one model: a line per team.
 * Playoff % is on a fixed 0–100% scale; projected Points span the whole field's lowest to highest value at every point,
 * so small changes are not exaggerated and no team's line is clipped. Null when the model can't chart that metric.
 */
export function projectionChart(history: ProjectionHistory, teamId: TeamId, metric: ChartMetric): ProjectionChart | null {
  if (!chartMetrics(history).includes(metric)) return null;
  const teamIds = Object.keys(history[0]!.teams).map(Number);
  const values = (id: TeamId) => history.map((point) => (metric === "playoffs" ? point.teams[id]!.playoffs! : point.teams[id]!.projectedPoints));

  let yOf: (value: number) => number;
  let guideY: number | null = null;
  let yTicks: ChartTick[];
  if (metric === "playoffs") {
    yOf = (value) => 1 - value;
    guideY = 0.5;
    yTicks = [
      { y: 0, text: "100%" },
      { y: 0.5, text: "50%" },
      { y: 1, text: "0%" },
    ];
  } else {
    const field = teamIds.flatMap(values);
    const low = Math.min(...field);
    const high = Math.max(...field);
    yOf = (value) => (high === low ? 0.5 : (high - value) / (high - low));
    yTicks = [high, (high + low) / 2, low].map((value) => ({ y: yOf(value), text: value.toFixed(1) }));
  }

  const xOf = (index: number) => index / (history.length - 1);
  const lineOf = (id: TeamId): ChartLine => ({
    teamId: id,
    chosen: id === teamId,
    points: values(id).map((value, index) => ({ x: xOf(index), y: yOf(value) })),
  });
  const chosen = values(teamId);
  const chosenLine = lineOf(teamId);
  const tooltips = history.map((entry, index): ChartTooltip => {
    const { first } = entry.teams[teamId]!;
    const value = metric === "playoffs" ? `Playoffs ${formatPercent(chosen[index]!)}%` : `Points ${chosen[index]!.toFixed(1)}`;
    const change =
      index === 0
        ? []
        : [metric === "playoffs" ? signedChange((chosen[index]! - chosen[index - 1]!) * 100, "pts", 0) : signedChange(chosen[index]! - chosen[index - 1]!, "Points", 1)];
    return {
      ...chosenLine.points[index]!,
      lines: [tooltipDate(entry.matchDay), value, ...(first === null ? [] : [`1st place ${formatPercent(first)}%`]), ...change],
    };
  });
  const lastLowSample = history.findLastIndex((entry) => entry.teams[teamId]!.gamesPlayed < LOW_SAMPLE_GAMES);
  return {
    lines: [...teamIds.filter((id) => id !== teamId).map(lineOf), chosenLine],
    guideY,
    yTicks,
    xLabels: labelledIndexes(history.length).map((index) => ({ x: xOf(index), text: dateLabel(history[index]!.matchDay) })),
    tooltips,
    lowSample: lastLowSample < 0 ? null : { from: 0, to: xOf(lastLowSample) },
    summary: (metric === "playoffs" ? playoffsSummary : pointsSummary)(chosen[0]!, chosen.at(-2)!, chosen.at(-1)!),
  };
}

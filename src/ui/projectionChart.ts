import type { ProjectionHistory, TeamHistoryPoint } from "../domain/projectionHistory.ts";
import { PLAY_IN_CUT, PLAYOFF_CUT } from "../domain/cutLines.ts";
import { LOW_SAMPLE_GAMES, SEASON_START } from "../domain/project.ts";
import type { TeamId } from "../domain/types.ts";
import { ordinal } from "./format.ts";
import { formatPercent } from "./winSplit.ts";

/** A point of a chart line, as a share of the plot: x from the left edge, y from the top (0 = 100%, 1 = 0%). */
export interface ChartPoint {
  x: number;
  y: number;
}

/** What the Projection History chart plots: each team's playoff chance, its projected Points, or its Projected Rank. */
export type ChartMetric = "playoffs" | "points" | "rank";

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
  /** Where the faint guides sit, as `y`s: the 50% line, or the Cut Lines on the Rank scale; none on the Points scale. */
  guides: number[];
  /** Labels for the y-axis, top to bottom. */
  yTicks: ChartTick[];
  /** Sparse date labels for the x-axis. */
  xLabels: { x: number; text: string }[];
  /** The Match Days on the x scale, the same in every view: the Season-start point keeps its place even where a line leaves it out. */
  steps: number;
  /** One tooltip per drawn point of the chosen team's line, the last `tooltips.length` of the `steps`; index i belongs to drawn point i. */
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
  return `Playoff chance ${formatPercent(latest)}% now, ${formatPercent(start)}% at the start of the season, ${since} since the previous match day.`;
}

function pointsSummary(start: number, previous: number, latest: number): string {
  const since = changeText(latest - previous, "", 1);
  return `Projected points ${latest.toFixed(1)} now, ${start.toFixed(1)} at the start of the season, ${since} since the previous match day.`;
}

/** "up 2 places", "down 1 place" or "unchanged", where up is a climb to a smaller rank number. */
function placesText(gained: number): string {
  if (gained === 0) return "unchanged";
  return `${gained > 0 ? "up" : "down"} ${placesCount(gained)}`;
}

function placesCount(gained: number): string {
  return `${Math.abs(gained)} ${Math.abs(gained) === 1 ? "place" : "places"}`;
}

/** "+2 places", "−1 place" or "0 places", signed as the Projected Table's places gained: + for a climb. */
function signedPlaces(gained: number): string {
  return gained === 0 ? "0 places" : `${gained > 0 ? "+" : "−"}${placesCount(gained)}`;
}

function rankHistorySummary(start: number, startsAfterFirstMatchDay: boolean, previous: number, latest: number): string {
  const baseline = startsAfterFirstMatchDay ? "after the first match day" : "at the start of the season";
  return `Projected ${ordinal(latest)} now, ${ordinal(start)} ${baseline}, ${placesText(previous - latest)} since the previous match day.`;
}

/**
 * Where the Rank view's line starts: one step in when every team is level at the Season start (Split Form Rate, Season Rate and
 * the Matchup Model), whose tie-break falls through to the fixed team order and would draw a meaningless order.
 */
function firstRankIndex(history: ProjectionHistory): number {
  const start = history[0];
  if (start?.matchDay !== SEASON_START) return 0;
  const points = Object.values(start.teams).map((team) => team.projectedPoints);
  return points.every((value) => Math.abs(value - points[0]!) < 1e-9) ? 1 : 0;
}

/**
 * The metrics a model's history can chart: playoff % only where the model has Outcome Probabilities (ADR 0002), Projected Rank
 * once it has two points to draw. None while only the Season-start point exists.
 */
export function chartMetrics(history: ProjectionHistory): ChartMetric[] {
  if (history.length < 2) return [];
  const hasChances = history.every((point) => Object.values(point.teams).every((team) => team.playoffs !== null));
  const hasRank = history.length - firstRankIndex(history) >= 2;
  return [...(hasChances ? ["playoffs" as const] : []), "points", ...(hasRank ? ["rank" as const] : [])];
}

/** The tooltip for a Match Day on the x scale: the first drawn one where the line has not started yet. */
export function tooltipAt(chart: ProjectionChart, matchDay: number): number {
  return Math.max(0, matchDay - (chart.steps - chart.tooltips.length));
}

/** The metric to draw: the visitor's choice where the model supports it, otherwise the first it does. */
export function shownMetric(chosen: ChartMetric, available: ChartMetric[]): ChartMetric | null {
  return available.includes(chosen) ? chosen : (available[0] ?? null);
}

/**
 * The Projection History chart of a team under one model: a line per team.
 * Playoff % is on a fixed 0–100% scale; projected Points span the whole field's lowest to highest value at every point,
 * so small changes are not exaggerated and no team's line is clipped; Projected Rank runs from 1st at the top to last at the
 * bottom, without the Season-start point when every team is level there. Null when the model can't chart that metric.
 */
export function projectionChart(history: ProjectionHistory, teamId: TeamId, metric: ChartMetric): ProjectionChart | null {
  if (!chartMetrics(history).includes(metric)) return null;
  const teamIds = Object.keys(history[0]!.teams).map(Number);
  const first = metric === "rank" ? firstRankIndex(history) : 0;
  const drawn = history.slice(first);
  const valueOf = (team: TeamHistoryPoint) => (metric === "playoffs" ? team.playoffs! : metric === "points" ? team.projectedPoints : team.rank);
  const values = (id: TeamId) => drawn.map((point) => valueOf(point.teams[id]!));

  let yOf: (value: number) => number;
  let guides: number[] = [];
  let yTicks: ChartTick[];
  if (metric === "playoffs") {
    yOf = (value) => 1 - value;
    guides = [0.5];
    yTicks = [
      { y: 0, text: "100%" },
      { y: 0.5, text: "50%" },
      { y: 1, text: "0%" },
    ];
  } else if (metric === "rank") {
    const last = teamIds.length;
    yOf = (rank) => (last === 1 ? 0.5 : (rank - 1) / (last - 1));
    // Each Cut Line falls halfway between the last rank above it and the first below.
    guides = [PLAYOFF_CUT + 0.5, PLAY_IN_CUT + 0.5].filter((rank) => rank < last).map(yOf);
    yTicks = [...new Set([1, PLAYOFF_CUT, PLAY_IN_CUT, last])].filter((rank) => rank <= last).map((rank) => ({ y: yOf(rank), text: String(rank) }));
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
    points: values(id).map((value, index) => ({ x: xOf(first + index), y: yOf(value) })),
  });
  const chosen = values(teamId);
  const chosenLine = lineOf(teamId);
  const valueText = (value: number) =>
    metric === "playoffs" ? `Playoffs ${formatPercent(value)}%` : metric === "points" ? `Points ${value.toFixed(1)}` : `Projected ${ordinal(value)}`;
  const changeOf = (previous: number, value: number) =>
    metric === "playoffs" ? signedChange((value - previous) * 100, "pts", 0) : metric === "points" ? signedChange(value - previous, "points", 1) : signedPlaces(previous - value);
  const tooltips = drawn.map((entry, index): ChartTooltip => {
    const firstPlace = entry.teams[teamId]!.first;
    const change = index === 0 ? [] : [changeOf(chosen[index - 1]!, chosen[index]!)];
    return {
      ...chosenLine.points[index]!,
      lines: [tooltipDate(entry.matchDay), valueText(chosen[index]!), ...(firstPlace === null ? [] : [`1st place ${formatPercent(firstPlace)}%`]), ...change],
    };
  });
  const [start, previous, latest] = [chosen[0]!, chosen.at(-2)!, chosen.at(-1)!];
  const summary =
    metric === "playoffs" ? playoffsSummary(start, previous, latest) : metric === "points" ? pointsSummary(start, previous, latest) : rankHistorySummary(start, first > 0, previous, latest);
  const lastLowSample = history.findLastIndex((entry) => entry.teams[teamId]!.gamesPlayed < LOW_SAMPLE_GAMES);
  return {
    lines: [...teamIds.filter((id) => id !== teamId).map(lineOf), chosenLine],
    guides,
    yTicks,
    xLabels: labelledIndexes(history.length).map((index) => ({ x: xOf(index), text: dateLabel(history[index]!.matchDay) })),
    steps: history.length,
    tooltips,
    lowSample: lastLowSample < 0 ? null : { from: 0, to: xOf(lastLowSample) },
    summary,
  };
}

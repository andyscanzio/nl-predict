import { nearestMatchDay, type ChartTooltip } from "./projectionChart.ts";

/** Box of the Projection History chart and the margins around its plot, in SVG units; the SVG scales to its box, so the aspect ratio stays fixed. */
export const CHART = { width: 320, height: 130, left: 34, right: 8, top: 8, bottom: 20 };

/** The chart tooltip's box, in SVG units. */
export const TIP = { width: 78, line: 11, padding: 5, gap: 8 };

const PLOT_WIDTH = CHART.width - CHART.left - CHART.right;
const PLOT_HEIGHT = CHART.height - CHART.top - CHART.bottom;

/** Where the y-axis labels end and the x-axis labels sit, in SVG units. */
export const AXIS_LABEL = { x: CHART.left - 4, y: CHART.height - 4 };

const round = (value: number) => Number(value.toFixed(1));

/** An x share of the plot as an SVG x, to one decimal. */
export function plotX(share: number): number {
  return round(CHART.left + share * PLOT_WIDTH);
}

/** A y share of the plot (0 = top) as an SVG y, to one decimal. */
export function plotY(share: number): number {
  return round(CHART.top + share * PLOT_HEIGHT);
}

/** An SVG `points` attribute for a line given as plot shares. */
export function polylinePoints(points: { x: number; y: number }[]): string {
  return points.map((point) => `${plotX(point.x)},${plotY(point.y)}`).join(" ");
}

/** A box in SVG units, with where its text lines start. */
export interface TooltipBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The x every text line starts at. */
  textX: number;
  /** The baseline of each text line, top to bottom. */
  textYs: number[];
}

/**
 * Where a tooltip is drawn: centred on its point but clamped to stay inside the chart at both edges, above the point,
 * or below it when the line runs too close to the top for the box to fit.
 */
export function tooltipBox(tooltip: ChartTooltip): TooltipBox {
  const height = tooltip.lines.length * TIP.line + TIP.padding * 2 - 2;
  const x = Math.min(Math.max(plotX(tooltip.x) - TIP.width / 2, 0), CHART.width - TIP.width);
  const pointY = plotY(tooltip.y);
  const above = pointY - height - TIP.gap;
  const y = above >= 0 ? above : pointY + TIP.gap;
  return {
    x,
    y,
    width: TIP.width,
    height,
    textX: x + TIP.padding,
    textYs: tooltip.lines.map((_, index) => y + TIP.padding + TIP.line * index + 7),
  };
}

/**
 * The index of the Match Day under the pointer, from its screen x and the SVG's on-screen box; the first or last
 * beyond either end of the line.
 */
export function matchDayAtPointer(clientX: number, svg: { left: number; width: number }, count: number): number {
  const svgX = ((clientX - svg.left) / svg.width) * CHART.width;
  return nearestMatchDay((svgX - CHART.left) / PLOT_WIDTH, count);
}

/** Wide enough a stretch of the plot (as an x share) to hold the "Low Sample" label. */
const LOW_SAMPLE_LABEL_SHARE = 0.2;

/**
 * The shaded band over the stretch of the plot where the team had too few Played Games, and where its label goes;
 * null when the stretch is empty. `labelled` is false when the band is too narrow for its label.
 */
export function lowSampleBox(span: { from: number; to: number } | null) {
  if (!span || span.to <= span.from) return null;
  const x = plotX(span.from);
  const y = plotY(0);
  return {
    x,
    y,
    width: round(plotX(span.to) - x),
    height: PLOT_HEIGHT,
    labelled: span.to - span.from > LOW_SAMPLE_LABEL_SHARE,
    textX: x + 3,
    textY: y + 8,
  };
}

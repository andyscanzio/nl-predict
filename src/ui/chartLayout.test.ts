import { describe, expect, it } from "vitest";
import { CHART, TIP, lowSampleBox, matchDayAtPointer, plotX, plotY, polylinePoints, tooltipBox } from "./chartLayout.ts";

/** A tooltip of `lineCount` lines anchored at a point given as shares of the plot. */
function tip(x: number, y: number, lineCount = 3) {
  return { x, y, lines: Array.from({ length: lineCount }, (_, index) => `line ${index}`) };
}

describe("plotX and plotY", () => {
  it("map plot shares onto the plot area, inside the chart's margins", () => {
    expect(plotX(0)).toBe(CHART.left);
    expect(plotX(1)).toBe(CHART.width - CHART.right);
    expect(plotY(0)).toBe(CHART.top);
    expect(plotY(1)).toBe(CHART.height - CHART.bottom);
  });

  it("round to one decimal, as drawn", () => {
    expect(plotX(1 / 3)).toBe(126.7);
  });
});

describe("polylinePoints", () => {
  it("lists each point as SVG x,y", () => {
    expect(polylinePoints([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(`${plotX(0)},${plotY(0)} ${plotX(1)},${plotY(1)}`);
  });
});

describe("tooltipBox", () => {
  it("is centred on the point, above it", () => {
    const box = tooltipBox(tip(0.5, 0.8));
    expect(box.x).toBe(plotX(0.5) - TIP.width / 2);
    expect(box.y + box.height + TIP.gap).toBe(plotY(0.8));
  });

  it("is sized to its lines", () => {
    expect(tooltipBox(tip(0.5, 0.8, 4)).height).toBe(4 * TIP.line + TIP.padding * 2 - 2);
    expect(tooltipBox(tip(0.5, 0.8, 3)).width).toBe(TIP.width);
  });

  it("is clamped inside the chart at the left edge", () => {
    expect(tooltipBox(tip(0, 0.8)).x).toBe(0);
  });

  it("is clamped inside the chart at the right edge", () => {
    expect(tooltipBox(tip(1, 0.8)).x).toBe(CHART.width - TIP.width);
  });

  it("sits above the point when it fits", () => {
    const box = tooltipBox(tip(0.5, 1));
    expect(box.y).toBeLessThan(plotY(1));
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it("flips below the point when there is no room above", () => {
    const box = tooltipBox(tip(0.5, 0));
    expect(box.y).toBe(plotY(0) + TIP.gap);
  });

  it("stays above while the box just fits, and flips once it would cross the top", () => {
    const height = 3 * TIP.line + TIP.padding * 2 - 2;
    const lastFitting = (height + TIP.gap - CHART.top) / (CHART.height - CHART.top - CHART.bottom);
    expect(tooltipBox(tip(0.5, lastFitting + 0.01)).y).toBeLessThan(plotY(lastFitting));
    expect(tooltipBox(tip(0.5, lastFitting - 0.01)).y).toBeGreaterThan(plotY(lastFitting - 0.01));
  });

  it("puts each text line inside the box", () => {
    const box = tooltipBox(tip(0.5, 0.8));
    expect(box.textX).toBe(box.x + TIP.padding);
    expect(box.textYs).toHaveLength(3);
    expect(box.textYs[0]).toBeGreaterThan(box.y);
    expect(box.textYs[2]!).toBeLessThan(box.y + box.height);
    expect(box.textYs[1]! - box.textYs[0]!).toBe(TIP.line);
  });
});

describe("matchDayAtPointer", () => {
  const box = { left: 100, width: 640 }; // the SVG drawn at twice its size
  const clientXOf = (share: number) => box.left + ((CHART.left + share * (CHART.width - CHART.left - CHART.right)) / CHART.width) * box.width;

  it("picks the Match Day nearest the pointer", () => {
    expect(matchDayAtPointer(clientXOf(0), box, 5)).toBe(0);
    expect(matchDayAtPointer(clientXOf(0.13), box, 5)).toBe(1);
    expect(matchDayAtPointer(clientXOf(0.5), box, 5)).toBe(2);
    expect(matchDayAtPointer(clientXOf(1), box, 5)).toBe(4);
  });

  it("picks the first Match Day beyond the left end of the line", () => {
    expect(matchDayAtPointer(box.left - 50, box, 5)).toBe(0);
    expect(matchDayAtPointer(box.left + 10, box, 5)).toBe(0);
  });

  it("picks the last Match Day beyond the right end of the line", () => {
    expect(matchDayAtPointer(box.left + box.width + 50, box, 5)).toBe(4);
    expect(matchDayAtPointer(box.left + box.width - 5, box, 5)).toBe(4);
  });
});

describe("lowSampleBox", () => {
  it("spans the given stretch of the plot, full height", () => {
    const low = lowSampleBox({ from: 0, to: 0.5 })!;
    expect(low.x).toBe(plotX(0));
    expect(low.y).toBe(plotY(0));
    expect(low.width).toBe(plotX(0.5) - plotX(0));
    expect(low.height).toBe(plotY(1) - plotY(0));
  });

  it("anchors its label just inside the top-left corner", () => {
    const low = lowSampleBox({ from: 0.2, to: 0.6 })!;
    expect(low.textX).toBe(low.x + 3);
    expect(low.textY).toBe(low.y + 8);
  });

  it("carries its label only when the stretch is wide enough for it", () => {
    expect(lowSampleBox({ from: 0, to: 0.5 })!.labelled).toBe(true);
    expect(lowSampleBox({ from: 0, to: 0.2 })!.labelled).toBe(false);
  });

  it("is absent when there is no stretch, or an empty one", () => {
    expect(lowSampleBox(null)).toBeNull();
    expect(lowSampleBox({ from: 0, to: 0 })).toBeNull();
  });
});

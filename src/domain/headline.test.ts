import { describe, expect, it } from "vitest";
import { headlineOf, type HeadlineRow } from "./headline.ts";

/** Rows in Projected Table order, one movement per row; teamId is 100 + projected rank. */
function table(...movements: number[]): HeadlineRow[] {
  return movements.map((movement, index) => ({
    rank: index + 1,
    teamId: 101 + index,
    movement,
  }));
}

describe("headlineOf", () => {
  it("names the first and last teams of the Projected Table", () => {
    const headline = headlineOf(table(0, 0, 0));
    expect(headline?.first).toBe(101);
    expect(headline?.last).toBe(103);
  });

  it("names the biggest riser with places gained and projected rank", () => {
    expect(headlineOf(table(1, 2, -3, 0))?.riser).toEqual({ teamId: 102, places: 2, rank: 2 });
  });

  it("breaks a tie on movement by the better projected rank", () => {
    expect(headlineOf(table(0, 3, 3, -3, -3, 0))?.riser).toEqual({ teamId: 102, places: 3, rank: 2 });
  });

  it("leaves out the riser when nobody rises", () => {
    expect(headlineOf(table(0, 0, 0))?.riser).toBeUndefined();
  });

  it("ignores fallers when choosing the riser", () => {
    expect(headlineOf(table(4, -1, -1, -1, -1))?.riser).toEqual({ teamId: 101, places: 4, rank: 1 });
  });

  it("is null for an empty Projected Table", () => {
    expect(headlineOf([])).toBeNull();
  });
});

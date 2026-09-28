import { describe, expect, it } from "vitest";
import {
  formatExpectedPoints,
  formatForm,
  formatGameDate,
  formatGameTime,
  formatMatchDayHeading,
  formatScoreboardTime,
  formatSnapshotTime,
  ordinal,
} from "./format.ts";

describe("ordinal", () => {
  it("uses st, nd and rd for 1, 2 and 3", () => {
    expect([1, 2, 3].map(ordinal)).toEqual(["1st", "2nd", "3rd"]);
  });

  it("uses th from 4 to 10", () => {
    expect([4, 5, 10].map(ordinal)).toEqual(["4th", "5th", "10th"]);
  });

  it("uses th for 11 to 13, not st, nd and rd", () => {
    expect([11, 12, 13].map(ordinal)).toEqual(["11th", "12th", "13th"]);
  });

  it("goes back to st and nd from 21", () => {
    expect([21, 22, 23].map(ordinal)).toEqual(["21st", "22nd", "23rd"]);
  });
});

describe("formatForm", () => {
  it("shows Points per Game to two decimals", () => {
    expect(formatForm(1.5)).toBe("1.50");
  });

  it("shows a dash for no Form", () => {
    expect(formatForm(null)).toBe("–");
  });
});

describe("formatExpectedPoints", () => {
  it("shows one decimal place", () => {
    expect(formatExpectedPoints(1.46)).toBe("1.5");
    expect(formatExpectedPoints(3)).toBe("3.0");
  });
});

describe("Swiss-time formatters", () => {
  // 17:45 UTC is 19:45 in Zurich until the clocks go back in late October, and 18:45 after.
  const summer = new Date("2026-10-04T17:45:00Z");
  const winter = new Date("2026-12-05T17:45:00Z");

  it("formats a Game's time in Swiss time", () => {
    expect(formatGameTime(summer)).toBe("19:45");
    expect(formatGameTime(winter)).toBe("18:45");
  });

  it("formats a Game's date in Swiss time, even just before midnight UTC", () => {
    expect(formatGameDate(summer)).toBe("4 Oct");
    expect(formatGameDate(new Date("2026-10-04T22:30:00Z"))).toBe("5 Oct");
  });

  it("formats the scoreboard time as day.month hours:minutes", () => {
    expect(formatScoreboardTime(summer)).toBe("04.10 19:45");
  });

  it("formats the Snapshot time with its date and time", () => {
    expect(formatSnapshotTime(summer)).toBe("4 Oct 2026, 19:45");
  });

  it("formats a match day's calendar date without shifting it", () => {
    expect(formatMatchDayHeading("2026-10-06")).toBe("Tue 6 Oct");
  });
});

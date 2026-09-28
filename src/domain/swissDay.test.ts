import { describe, expect, it } from "vitest";
import { swissCalendarDay, swissDayEnd } from "./swissDay.ts";

describe("swissCalendarDay", () => {
  it("gives the calendar date in Swiss local time", () => {
    expect(swissCalendarDay(Date.parse("2026-09-29T19:45:00+02:00"))).toBe("2026-09-29");
  });

  it("groups a late UTC instant into the next Swiss day", () => {
    // 22:30 UTC on the 29th is 00:30 on the 30th in Swiss summer time (UTC+2).
    expect(swissCalendarDay(Date.parse("2026-09-29T22:30:00Z"))).toBe("2026-09-30");
  });

  it("uses Swiss winter time (UTC+1) once the clocks fall back", () => {
    expect(swissCalendarDay(Date.parse("2026-12-15T23:30:00Z"))).toBe("2026-12-16");
  });
});

describe("swissDayEnd", () => {
  it("gives Swiss midnight at the end of the day", () => {
    expect(swissDayEnd("2026-09-29").toISOString()).toBe("2026-09-29T22:00:00.000Z");
    expect(swissDayEnd("2026-12-15").toISOString()).toBe("2026-12-15T23:00:00.000Z");
  });

  it("follows the clock change: 25-hour and 23-hour days", () => {
    expect(swissDayEnd("2026-10-25").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(swissDayEnd("2026-03-29").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("is the first instant of the next Swiss day", () => {
    const end = swissDayEnd("2026-09-29").getTime();
    expect(swissCalendarDay(end - 1)).toBe("2026-09-29");
    expect(swissCalendarDay(end)).toBe("2026-09-30");
  });
});

import { describe, expect, it } from "vitest";
import { swissCalendarDay } from "./swissDay.ts";

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

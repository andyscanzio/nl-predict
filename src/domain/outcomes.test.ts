import { describe, expect, it } from "vitest";
import { otsoRate } from "./outcomes.ts";
import type { PlayedGame } from "./form.ts";
import type { Decision } from "./types.ts";

function played(decision: Decision): PlayedGame {
  return {
    id: "1",
    startsAt: "2026-09-20T19:45:00+02:00",
    homeTeamId: 1,
    awayTeamId: 2,
    result: { homeGoals: 3, awayGoals: 2, decision },
  };
}

describe("otsoRate", () => {
  it("is the share of Played Games decided in overtime or a shootout", () => {
    const games = [
      ...Array.from({ length: 3 }, () => played("OT")),
      ...Array.from({ length: 2 }, () => played("SO")),
      ...Array.from({ length: 15 }, () => played("regulation")),
    ];
    expect(otsoRate(games)).toBe(0.25);
  });

  it("falls back to 0.23 while fewer than 20 Games are Played", () => {
    expect(otsoRate([])).toBe(0.23);
    expect(otsoRate(Array.from({ length: 19 }, () => played("OT")))).toBe(0.23);
  });
});

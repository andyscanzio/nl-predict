import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ProjectedBracket } from "./ProjectedBracket.tsx";
import type { Teams } from "./TeamName.tsx";
import { projectedBracket } from "../domain/postSeason.ts";
import type { TeamId } from "../domain/types.ts";

/** Team n finished nth, named Team n (Tn). */
const ranking: TeamId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const teams: Teams = new Map(ranking.map((id) => [id, { id, name: `Team ${id}`, acronym: `T${id}` }]));
const ranks = new Map(ranking.map((teamId, index) => [teamId, index + 1]));

/** The better-ranked team wins 0.7 of its home Games and 0.55 of its away Games; Team 8 beats Team 7 in the Play-In. */
const homeWin = (home: TeamId, away: TeamId) => (home === 8 && away === 7 ? 1 : home === 7 && away === 8 ? 0 : home < away ? 0.7 : 0.45);
const bracket = projectedBracket(ranking, homeWin);

const html = render(<ProjectedBracket bracket={bracket} ranks={ranks} teams={teams} />);

/** The text of each element with `cls`, each tag read as a space. */
function texts(markup: string, tag: string, cls: string) {
  return [...markup.matchAll(new RegExp(`<${tag} class="${cls}[^"]*"[^>]*>(.*?)</${tag}>`, "gs"))].map((match) =>
    match[1]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

describe("ProjectedBracket", () => {
  it("is headed as the Projected Bracket and says it assumes the table finishes as projected, not title odds", () => {
    expect(html).toContain("<h2>Projected bracket</h2>");
    const caption = texts(html, "p", "meta")[0]!;
    expect(caption).toContain("ends exactly as the projected table");
    expect(caption).toContain("not title odds");
  });

  it("shows the Play-In, the quarterfinals, the semifinals and the final, in that order", () => {
    expect(texts(html, "h3", "bracket-round-heading")).toEqual(["Play-in", "Quarterfinals", "Semifinals", "Final"]);
    expect(texts(html, "li", "bracket-tie")).toHaveLength(3 + 4 + 2 + 1);
  });

  it("shows both teams of each tie with their Regular Season rank, and the favourite's chance next to it", () => {
    const [sevenEight, nineTen, decider] = texts(html, "li", "bracket-tie");
    expect(sevenEight).toBe("7 v 8 07 Team 7 T7 08 Team 8 T8 100%");
    expect(nineTen).toMatch(/^9 v 10 09 Team 9 T9 \d+% 10 Team 10 T10$/);
    expect(decider).toMatch(/^Decider 07 Team 7 T7 \d+% 09 Team 9 T9$/);
    const winners = texts(html, "div", "bracket-team winner");
    expect(winners.slice(0, 3)).toEqual([
      "08 Team 8 T8 100%",
      expect.stringMatching(/^09 Team 9 T9/),
      expect.stringMatching(/^07 Team 7 T7/),
    ]);
  });

  it("prints each favourite's exact chance as a whole percent", () => {
    const chance = Math.round(bracket.quarterfinals[0]!.favouriteChance * 100);
    expect(texts(html, "li", "bracket-tie")[3]).toBe(`01 Team 1 T1 ${chance}% 08 Team 8 T8`);
  });

  it("names the projected Champion", () => {
    expect(texts(html, "p", "bracket-champion")).toEqual(["Projected champion: Team 1 T1"]);
  });
});

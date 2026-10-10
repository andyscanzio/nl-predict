import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ProjectedBracket, playoffSeeds, treeOrder } from "./ProjectedBracket.tsx";
import type { Teams } from "./TeamName.tsx";
import { projectedBracket, type ProjectedTie } from "../domain/postSeason.ts";
import type { TeamId } from "../domain/types.ts";

/** Team n finished nth, named Team n (Tn). */
const ranking: TeamId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const teams: Teams = new Map(ranking.map((id) => [id, { id, name: `Team ${id}`, acronym: `T${id}` }]));
const ranks = new Map(ranking.map((teamId, index) => [teamId, index + 1]));

/** The better-ranked team wins 0.7 of its home Games and 0.55 of its away Games; Team 8 beats Team 7 in the Play-In. */
const homeWin = (home: TeamId, away: TeamId) => (home === 8 && away === 7 ? 1 : home === 7 && away === 8 ? 0 : home < away ? 0.7 : 0.45);
const bracket = projectedBracket(ranking, homeWin);

const html = render(<ProjectedBracket bracket={bracket} ranks={ranks} teams={teams} />);

/** The text of each element with `cls` (holding no element of the same tag), each tag read as a space. */
function texts(markup: string, tag: string, cls: string) {
  return [...markup.matchAll(new RegExp(`<${tag} class="${cls}[^"]*"[^>]*>(.*?)</${tag}>`, "gs"))].map((match) =>
    match[1]!.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  );
}

/** Each tie's two sides, in the order shown: the three Play-In ties, then the tree's quarterfinals, semifinals and final. */
const ties = (() => {
  const sides = texts(html, "div", "bracket-team");
  return Array.from({ length: sides.length / 2 }, (_, i): [string, string] => [sides[2 * i]!, sides[2 * i + 1]!]);
})();

const percent = (chance: number) => String(Math.round(chance * 100));

describe("ProjectedBracket", () => {
  it("is headed as the Projected Bracket and says it assumes the table finishes as projected, not title odds", () => {
    expect(html).toContain("<h2>Projected bracket</h2>");
    const caption = texts(html, "p", "meta")[0]!;
    expect(caption).toContain("ends exactly as the projected table");
    expect(caption).toContain("not title odds");
  });

  it("shows the Play-In, then the tree from the quarterfinals to the Champion", () => {
    expect(texts(html, "h3", "bracket-round-heading")).toEqual([
      "Play-in · ranks 7–10 play for seeds 7 and 8",
      "Quarter\u00adfinals",
      "Semifinals",
      "Final",
      "Champion",
    ]);
    expect(ties).toHaveLength(3 + 4 + 2 + 1);
  });

  it("says where each Play-In tie sends its sides, the qualifiers by their Playoff seed", () => {
    expect(texts(html, "h4", "bracket-tie-label")).toEqual([
      "7 v 8 · winner qualifies",
      "9 v 10 · loser is out",
      "Second chance · winner qualifies",
    ]);
    expect(texts(html, "p", "bracket-exits")).toEqual([
      "T8 → seed 8 T7 ↘ second chance",
      "T9 ↗ second chance T10 out",
      "T7 → seed 7 T9 out",
    ]);
  });

  it("numbers the Play-In by Regular Season rank and marks the side that goes through", () => {
    expect(ties.slice(0, 3).map(([higher, lower]) => [higher.split(" ")[0], lower.split(" ")[0]])).toEqual([
      ["7", "8"],
      ["9", "10"],
      ["7", "9"],
    ]);
    expect(texts(html, "div", "bracket-team winner").slice(0, 3)).toEqual([
      expect.stringMatching(/^8 Team 8 T8 /),
      expect.stringMatching(/^9 Team 9 T9 /),
      expect.stringMatching(/^7 Team 7 T7 /),
    ]);
  });

  it("numbers the Playoffs by seed and orders the tree so its lines never cross", () => {
    expect(ties.slice(3).map((tie) => tie.map((side) => side.replace(/ \d+$/, "")))).toEqual([
      ["1 Team 1 T1", "8 Team 8 T8"],
      ["4 Team 4 T4", "5 Team 5 T5"],
      ["2 Team 2 T2", "7 Team 7 T7"],
      ["3 Team 3 T3", "6 Team 6 T6"],
      ["1 Team 1 T1", "4 Team 4 T4"],
      ["2 Team 2 T2", "3 Team 3 T3"],
      ["1 Team 1 T1", "2 Team 2 T2"],
    ]);
  });

  it("marks the seeds of the two Play-In qualifiers, and only theirs", () => {
    expect(texts(html, "span", "bracket-seed via-play-in")).toEqual(["8", "7"]);
  });

  it("shows both sides' chances of winning each tie as whole percents", () => {
    const shown = (tie: ProjectedTie) => [percent(tie.favouriteChance), percent(1 - tie.favouriteChance)];
    const firstQuarterfinal = bracket.quarterfinals.find((tie) => tie.higher === 1)!;
    expect(ties[3]!.map((side) => side.split(" ").at(-1))).toEqual(shown(firstQuarterfinal));
    expect(ties[0]!.map((side) => side.split(" ").at(-1))).toEqual(["0", "100"]);
  });

  it("ends the tree at the Projected Bracket's Champion", () => {
    expect(texts(html, "p", "bracket-champion")).toEqual(["🏆 Team 1 T1 Projected champion Seed 1"]);
  });
});

describe("playoffSeeds", () => {
  it("seeds the quarterfinalists 1–8 in Regular Season order", () => {
    expect([...playoffSeeds(bracket, ranks)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((teamId, i) => [teamId, i + 1]));
  });
});

describe("treeOrder", () => {
  it("keeps each semifinal's quarterfinals together after an upset re-pairs the semifinals", () => {
    // Team 5 wins every Playoff tie: the semifinals are 1 v 5 and 2 v 3, and the final 2 v 5.
    const upsets = projectedBracket(ranking, (home, away) => (home === 5 ? 1 : away === 5 ? 0 : home < away ? 0.7 : 0.45));
    const { quarterfinals, semifinals } = treeOrder(upsets);
    const pair = (tie: ProjectedTie) => [tie.higher, tie.lower];
    expect(semifinals.map(pair)).toEqual([
      [2, 3],
      [1, 5],
    ]);
    expect(quarterfinals.map(pair)).toEqual([
      [2, 7],
      [3, 6],
      [1, 8],
      [4, 5],
    ]);
  });
});

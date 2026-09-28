import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { CurrentTable } from "./CurrentTable.tsx";
import type { Teams } from "./TeamName.tsx";
import type { CurrentTableRow } from "../domain/project.ts";

const teams: Teams = new Map([
  [1, { id: 1, name: "HC Davos", acronym: "HCD" }],
  [2, { id: 2, name: "SC Bern", acronym: "SCB" }],
]);

function row(overrides: Partial<CurrentTableRow> = {}): CurrentTableRow {
  return {
    rank: 1,
    teamId: 1,
    gamesPlayed: 10,
    regulationWins: 4,
    overtimeOrShootoutWins: 2,
    overtimeOrShootoutLosses: 1,
    regulationLosses: 3,
    goalsFor: 31,
    goalsAgainst: 25,
    points: 19,
    ...overrides,
  };
}

function panel(rows: CurrentTableRow[]) {
  return render(<CurrentTable rows={rows} teams={teams} whatIfActive={false} />);
}

/** Each team row's inner HTML, without the header row. */
function bodyRows(html: string) {
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  return [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) => match[1]!);
}

/** The text a visitor reads, without markup. */
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

describe("CurrentTable", () => {
  it("shows a row per team, in the order given", () => {
    const html = panel([row(), row({ rank: 2, teamId: 2 })]);
    const rows = bodyRows(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("HC Davos");
    expect(rows[1]).toContain("SC Bern");
  });

  it("shows each row's rank, team, games played, wins and losses, goals and Points", () => {
    const [only] = bodyRows(panel([row({ rank: 3 })]));
    const cells = [...only!.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((match) => text(match[1]!));
    expect(cells).toEqual(["03", "HC Davos HCD", "10", "4", "2", "1", "3", "31:25", "19"]);
  });

  it("pads the rank to two digits", () => {
    expect(panel([row({ rank: 12 })])).toContain('<td class="num rank">12</td>');
    expect(panel([row({ rank: 1 })])).toContain('<td class="num rank">01</td>');
  });

  it("labels each column, with the wins and losses split by regulation and OT/SO", () => {
    const html = panel([row()]);
    const headers = [...html.matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => text(match[1]!));
    expect(headers).toEqual(["#", "Team", "GP", "W", "OTW", "OTL", "L", "Goals", "Pts"]);
    expect(html).toContain('title="Regulation wins"');
    expect(html).toContain('title="Overtime / shootout wins"');
    expect(html).toContain('title="Overtime / shootout losses"');
    expect(html).toContain('title="Regulation losses"');
  });

  it("keeps the tie-break note under the table, linking the official rule", () => {
    const html = panel([row()]);
    expect(html.indexOf("</table>")).toBeLessThan(html.indexOf("Teams level on Points"));
    expect(text(html)).toContain(
      "Teams level on Points are ordered by Points per Game (which only matters while teams have played different numbers of Games), then by the official National League rule (head-to-head first).",
    );
    expect(html).toContain(
      '<a href="https://www.nationalleague.ch/media/bvinatrg/weisungen_spielbetrieb_nl_26_27_d.pdf">official National League rule</a>',
    );
  });
});

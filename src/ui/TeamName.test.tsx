import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { fullTeamName, TeamName, type Teams } from "./TeamName.tsx";

const teams: Teams = new Map([[7, { id: 7, name: "HC Davos", acronym: "HCD" }]]);

describe("TeamName", () => {
  it("shows the full name and the acronym, each in its own span for the responsive styles", () => {
    const html = render(<TeamName teams={teams} teamId={7} />);
    expect(html).toContain('<span class="team-name">HC Davos</span>');
    expect(html).toContain('<span class="team-acronym">HCD</span>');
  });

  it("falls back to the team id for a team it does not know", () => {
    const html = render(<TeamName teams={teams} teamId={99} />);
    expect(html).toContain('<span class="team-name">99</span>');
    expect(html).toContain('<span class="team-acronym">99</span>');
  });
});

describe("fullTeamName", () => {
  it("is the team's full name, or the team id for an unknown team", () => {
    expect(fullTeamName(teams, 7)).toBe("HC Davos");
    expect(fullTeamName(teams, 99)).toBe("99");
  });
});

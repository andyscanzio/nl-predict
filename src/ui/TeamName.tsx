import type { Team, TeamId } from "../domain/types.ts";

/** Every team by id: the one lookup panels take to show team names. */
export type Teams = ReadonlyMap<TeamId, Team>;

/** A team's full name for text such as hover titles; the team id when the team is unknown. */
export function fullTeamName(teams: Teams, teamId: TeamId) {
  return teams.get(teamId)?.name ?? String(teamId);
}

/** A team's acronym for compact text such as the What-If banner; the team id when the team is unknown. */
export function teamAcronym(teams: Teams, teamId: TeamId) {
  return teams.get(teamId)?.acronym ?? String(teamId);
}

/** A team's full name and acronym; CSS shows one or the other by screen width. Falls back to the team id. */
export function TeamName({ teams, teamId }: { teams: Teams; teamId: TeamId }) {
  const team = teams.get(teamId);
  return (
    <>
      <span class="team-name">{team?.name ?? teamId}</span>
      <span class="team-acronym">{team?.acronym ?? teamId}</span>
    </>
  );
}

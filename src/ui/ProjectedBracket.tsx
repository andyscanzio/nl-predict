import type { ProjectedBracket as Bracket, ProjectedTie } from "../domain/postSeason.ts";
import type { TeamId } from "../domain/types.ts";
import { fullTeamName, TeamName, type Teams } from "./TeamName.tsx";
import { formatPercent } from "./winSplit.ts";

/** One side of a tie: its Regular Season rank and team, and, for the favourite, its chance of winning the tie. */
function TieTeam({ tie, teamId, rank, teams }: { tie: ProjectedTie; teamId: TeamId; rank: number; teams: Teams }) {
  const favourite = teamId === tie.winner;
  return (
    <div class={favourite ? "bracket-team winner" : "bracket-team"}>
      <span class="bracket-seed">{String(rank).padStart(2, "0")}</span>
      <span class="team">
        <TeamName teams={teams} teamId={teamId} />
      </span>
      {favourite && (
        <span class="bracket-pct" title={`${fullTeamName(teams, teamId)}'s chance of winning this tie`}>
          {formatPercent(tie.favouriteChance)}%
        </span>
      )}
    </div>
  );
}

function Round({
  heading,
  ties,
  labels,
  ranks,
  teams,
}: {
  heading: string;
  ties: ProjectedTie[];
  /** A label per tie, for Play-In ties that are told apart by who plays them. */
  labels?: string[];
  ranks: ReadonlyMap<TeamId, number>;
  teams: Teams;
}) {
  return (
    <section class="bracket-round">
      <h3 class="bracket-round-heading">{heading}</h3>
      <ol class="bracket-ties">
        {ties.map((tie, i) => (
          <li key={`${tie.higher}-${tie.lower}`} class="bracket-tie">
            {labels && <span class="bracket-tie-label">{labels[i]}</span>}
            <TieTeam tie={tie} teamId={tie.higher} rank={ranks.get(tie.higher)!} teams={teams} />
            <TieTeam tie={tie} teamId={tie.lower} rank={ranks.get(tie.lower)!} teams={teams} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The Projected Bracket: the Play-In and Playoffs as they would go if the Regular Season finished exactly as the
 * Projected Table, each tie's favourite advancing. Its caption keeps it from being read as title odds.
 */
export function ProjectedBracket({
  bracket,
  ranks,
  teams,
}: {
  bracket: Bracket;
  /** Each team's Projected Table rank. */
  ranks: ReadonlyMap<TeamId, number>;
  teams: Teams;
}) {
  const { playIn, quarterfinals, semifinals, final, champion } = bracket;
  return (
    <section class="panel">
      <h2>Projected bracket</h2>
      <p class="meta panel-body">
        If the regular season ends exactly as the projected table above, this is how the play-in and playoffs go: the
        favourite of each tie goes through, and the percentage is its chance of winning that tie. These are not title odds.
      </p>
      <div class="bracket panel-body">
        <Round
          heading="Play-in"
          ties={[playIn.sevenEight, playIn.nineTen, playIn.decider]}
          labels={["7 v 8", "9 v 10", "Decider"]}
          ranks={ranks}
          teams={teams}
        />
        <Round heading="Quarterfinals" ties={quarterfinals} ranks={ranks} teams={teams} />
        <Round heading="Semifinals" ties={semifinals} ranks={ranks} teams={teams} />
        <Round heading="Final" ties={[final]} ranks={ranks} teams={teams} />
        <p class="bracket-champion">
          Projected champion:{" "}
          <strong class="team">
            <TeamName teams={teams} teamId={champion} />
          </strong>
        </p>
      </div>
    </section>
  );
}

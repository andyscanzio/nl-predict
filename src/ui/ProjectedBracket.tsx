import type { ComponentChildren } from "preact";
import type { ProjectedBracket as ProjectedBracketTies, ProjectedTie } from "../domain/postSeason.ts";
import type { TeamId } from "../domain/types.ts";
import { fullTeamName, teamAcronym, TeamName, type Teams } from "./TeamName.tsx";
import { formatPercent } from "./winSplit.ts";

/** A side's chance of winning its tie. */
function tieChance(tie: ProjectedTie, teamId: TeamId) {
  return teamId === tie.winner ? tie.favouriteChance : 1 - tie.favouriteChance;
}

function tieLoser(tie: ProjectedTie) {
  return tie.winner === tie.higher ? tie.lower : tie.higher;
}

/** Playoff seeds 1–8: the quarterfinalists in Regular Season order, so the two Play-In qualifiers are seeds 7 and 8. */
export function playoffSeeds(bracket: ProjectedBracketTies, ranks: ReadonlyMap<TeamId, number>): Map<TeamId, number> {
  const seeded = bracket.quarterfinals.flatMap((tie) => [tie.higher, tie.lower]).toSorted((a, b) => ranks.get(a)! - ranks.get(b)!);
  return new Map(seeded.map((teamId, index) => [teamId, index + 1]));
}

/**
 * The Playoff ties in tree order: the final's better seed's semifinal first, and each semifinal's two quarterfinals next
 * to each other, better seed first. The Playoffs are re-paired every round, so this order is only known once each tie is
 * decided; it keeps the tree's lines from crossing.
 */
export function treeOrder(bracket: ProjectedBracketTies): { quarterfinals: ProjectedTie[]; semifinals: ProjectedTie[] } {
  const playedBy = (ties: ProjectedTie[], teamId: TeamId) => ties.find((tie) => tie.winner === teamId)!;
  const semifinals = [playedBy(bracket.semifinals, bracket.final.higher), playedBy(bracket.semifinals, bracket.final.lower)];
  const quarterfinals = semifinals.flatMap((tie) => [playedBy(bracket.quarterfinals, tie.higher), playedBy(bracket.quarterfinals, tie.lower)]);
  return { quarterfinals, semifinals };
}

/**
 * One side of a tie: its seed or rank, its team, and its chance of winning the tie; the side that goes through stands out.
 * A Play-In qualifier's seed is marked.
 */
function TieSide({ tie, teamId, seed, viaPlayIn, teams }: { tie: ProjectedTie; teamId: TeamId; seed: number; viaPlayIn: boolean; teams: Teams }) {
  const percent = formatPercent(tieChance(tie, teamId));
  return (
    <div
      class={teamId === tie.winner ? "bracket-team winner" : "bracket-team"}
      title={`${fullTeamName(teams, teamId)}'s chance of winning this tie: ${percent}%`}
    >
      <span class={viaPlayIn ? "bracket-seed via-play-in" : "bracket-seed"} title={viaPlayIn ? "Through the play-in" : undefined}>
        {seed}
      </span>
      <span class="team">
        <TeamName teams={teams} teamId={teamId} />
      </span>
      <span class="bracket-pct">{percent}</span>
    </div>
  );
}

function Tie({
  tie,
  seeds,
  viaPlayIn,
  teams,
}: {
  tie: ProjectedTie;
  seeds: ReadonlyMap<TeamId, number>;
  /** The two Play-In qualifiers, marked in the Playoffs. */
  viaPlayIn?: ReadonlySet<TeamId>;
  teams: Teams;
}) {
  return (
    <div class="bracket-tie">
      {[tie.higher, tie.lower].map((teamId) => (
        <TieSide key={teamId} tie={tie} teamId={teamId} seed={seeds.get(teamId)!} viaPlayIn={viaPlayIn?.has(teamId) ?? false} teams={teams} />
      ))}
    </div>
  );
}

/** Where a Play-In tie sends each side: `in` is a Playoff place, `out` the end of the Post-Season. */
function Exits({ exits }: { exits: { text: string; kind?: "in" | "out" }[] }) {
  return (
    <p class="bracket-exits">
      {exits.map(({ text, kind }) => (
        <span key={text} class={kind ? `bracket-exit ${kind}` : "bracket-exit"}>
          {text}
        </span>
      ))}
    </p>
  );
}

/**
 * The Play-In as a flow: 7 v 8 and 9 v 10, then the decider, each tie saying where its sides go. Its numbers are
 * Regular Season ranks; the qualifiers' seeds name where they land in the Playoffs.
 */
function PlayIn({ bracket, ranks, seeds, teams }: { bracket: ProjectedBracketTies; ranks: ReadonlyMap<TeamId, number>; seeds: ReadonlyMap<TeamId, number>; teams: Teams }) {
  const { sevenEight, nineTen, decider } = bracket.playIn;
  const name = (teamId: TeamId) => teamAcronym(teams, teamId);
  const qualifies = (teamId: TeamId) => ({ text: `${name(teamId)} → seed ${seeds.get(teamId)}`, kind: "in" as const });
  const out = (teamId: TeamId) => ({ text: `${name(teamId)} out`, kind: "out" as const });
  return (
    <div class="bracket-play-in panel-body">
      <h3 class="bracket-round-heading">Play-in · ranks 7–10 play for seeds 7 and 8</h3>
      <div class="bracket-play-in-flow">
        <div>
          <h4 class="bracket-tie-label">7 v 8 · winner qualifies</h4>
          <Tie tie={sevenEight} seeds={ranks} teams={teams} />
          <Exits exits={[qualifies(sevenEight.winner), { text: `${name(tieLoser(sevenEight))} ↘ second chance` }]} />
          <h4 class="bracket-tie-label">9 v 10 · loser is out</h4>
          <Tie tie={nineTen} seeds={ranks} teams={teams} />
          <Exits exits={[{ text: `${name(nineTen.winner)} ↗ second chance` }, out(tieLoser(nineTen))]} />
        </div>
        <span class="bracket-play-in-arrow" aria-hidden="true">
          →
        </span>
        <div>
          <h4 class="bracket-tie-label">Second chance · winner qualifies</h4>
          <Tie tie={decider} seeds={ranks} teams={teams} />
          <Exits exits={[qualifies(decider.winner), out(tieLoser(decider))]} />
        </div>
      </div>
      <p class="bracket-key">
        Play-in numbers are regular-season ranks; playoff numbers are seeds 1–8, <span class="via-play-in">amber</span> for the
        two play-in qualifiers.
      </p>
    </div>
  );
}

function Round({ heading, children }: { heading: string; children: ComponentChildren }) {
  return (
    <div class="bracket-round">
      <h3 class="bracket-round-heading">{heading}</h3>
      <div class="bracket-slots">{children}</div>
    </div>
  );
}

/**
 * The Projected Bracket: the Play-In and Playoffs as they would go if the Regular Season finished exactly as the
 * Projected Table, each tie's favourite advancing. The Play-In flows into a left-to-right tree that ends at the Champion;
 * every tie shows both sides' chances. Its caption keeps it from being read as title odds.
 */
export function ProjectedBracket({
  bracket,
  ranks,
  teams,
}: {
  bracket: ProjectedBracketTies;
  /** Each team's Projected Table rank. */
  ranks: ReadonlyMap<TeamId, number>;
  teams: Teams;
}) {
  const seeds = playoffSeeds(bracket, ranks);
  const { quarterfinals, semifinals } = treeOrder(bracket);
  const { sevenEight, decider } = bracket.playIn;
  const viaPlayIn = new Set([sevenEight.winner, decider.winner]);
  return (
    <section class="panel">
      <h2>Projected bracket</h2>
      <p class="meta panel-body">
        If the regular season ends exactly as the projected table above. Each number on the right is that side's chance of
        winning the tie; the favourite goes through. These are not title odds.
      </p>
      <PlayIn bracket={bracket} ranks={ranks} seeds={seeds} teams={teams} />
      <div class="bracket-body">
        <div class="bracket-tree">
          {/* The soft hyphen lets the heading break in a phone-width column. */}
          <Round heading={"Quarter\u00adfinals"}>
            {quarterfinals.map((tie) => (
              <div key={tie.higher} class="bracket-slot">
                <Tie tie={tie} seeds={seeds} viaPlayIn={viaPlayIn} teams={teams} />
              </div>
            ))}
          </Round>
          <Round heading="Semifinals">
            {semifinals.map((tie) => (
              <div key={tie.higher} class="bracket-slot">
                <Tie tie={tie} seeds={seeds} teams={teams} />
              </div>
            ))}
          </Round>
          <Round heading="Final">
            <div class="bracket-slot">
              <Tie tie={bracket.final} seeds={seeds} teams={teams} />
            </div>
          </Round>
          <Round heading="Champion">
            <div class="bracket-slot">
              <p class="bracket-champion">
                <span class="bracket-trophy" aria-hidden="true">
                  🏆
                </span>
                <strong class="team">
                  <TeamName teams={teams} teamId={bracket.champion} />
                </strong>
                <span class="bracket-champion-seed">Projected champion</span>
                <span class="bracket-champion-seed">Seed {seeds.get(bracket.champion)}</span>
              </p>
            </div>
          </Round>
        </div>
      </div>
    </section>
  );
}

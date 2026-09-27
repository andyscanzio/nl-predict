import { project } from "../domain/project.ts";
import type { Snapshot } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

const snapshotTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

export function App({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { currentTable } = project(snapshot.games, now);
  const teams = new Map(snapshot.teams.map((team) => [team.id, team]));
  const season = seasonLabel(snapshot.season);

  return (
    <>
      <header>
        <h1>NL Predict</h1>
        <p class="subtitle">National League {season} · Regular Season</p>
      </header>
      <main>
        <h2>Current Table</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th class="num" scope="col" title="Rank">#</th>
                <th scope="col">Team</th>
                <th class="num" scope="col" title="Games played">GP</th>
                <th class="num" scope="col" title="Regulation wins">W</th>
                <th class="num" scope="col" title="Overtime / shootout wins">OTW</th>
                <th class="num" scope="col" title="Overtime / shootout losses">OTL</th>
                <th class="num" scope="col" title="Regulation losses">L</th>
                <th class="num" scope="col" title="Goals for : goals against">Goals</th>
                <th class="num" scope="col" title="Points">Pts</th>
              </tr>
            </thead>
            <tbody>
              {currentTable.map((row) => {
                const team = teams.get(row.teamId);
                return (
                  <tr key={row.teamId}>
                    <td class="num">{row.rank}</td>
                    <th scope="row" class="team">
                      <span class="team-name">{team?.name ?? row.teamId}</span>
                      <span class="team-acronym">{team?.acronym ?? row.teamId}</span>
                    </th>
                    <td class="num">{row.gamesPlayed}</td>
                    <td class="num">{row.regulationWins}</td>
                    <td class="num">{row.overtimeOrShootoutWins}</td>
                    <td class="num">{row.overtimeOrShootoutLosses}</td>
                    <td class="num">{row.regulationLosses}</td>
                    <td class="num">
                      {row.goalsFor}:{row.goalsAgainst}
                    </td>
                    <td class="num points">{row.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="meta">
          Data as of <time dateTime={snapshot.snapshotAt}>{snapshotTime.format(new Date(snapshot.snapshotAt))}</time>{" "}
          (Swiss time).
        </p>
      </main>
      <footer>
        Game data from the Swiss Ice Hockey Federation (SIHF), used for personal, non-commercial purposes under
        their <a href={SIHF_TERMS}>terms of use</a>. Not affiliated with SIHF or the National League.
      </footer>
    </>
  );
}

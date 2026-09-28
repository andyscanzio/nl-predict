import type { CurrentTableRow } from "../domain/project.ts";
import { TeamName, type Teams } from "./TeamName.tsx";

/** The Season's standings as they stand today, with the note on how ties are broken. */
export function CurrentTable({ rows, teams }: { rows: CurrentTableRow[]; teams: Teams }) {
  return (
    <section class="panel">
      <h2>Current Table</h2>
      <div class="table-scroll">
        <table class="current">
          <thead>
            <tr>
              <th class="rank-head" scope="col" title="Rank">#</th>
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
            {rows.map((row) => (
              <tr key={row.teamId}>
                <td class="num rank">{String(row.rank).padStart(2, "0")}</td>
                <th scope="row" class="team">
                  <TeamName teams={teams} teamId={row.teamId} />
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
            ))}
          </tbody>
        </table>
      </div>
      <p class="meta panel-body">
        Teams level on Points are ordered by Points per Game, then goal difference, goals for and regulation wins.
        This approximates the official SIHF rule, which also uses head-to-head results, so the order can differ
        slightly from the official table.
      </p>
    </section>
  );
}

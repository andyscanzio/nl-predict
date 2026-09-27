import { project, type CutLine, type ProjectedTableRow } from "../domain/project.ts";
import { splitFormRate } from "../domain/splitFormRate.ts";
import { FORM_WINDOW_SIZE } from "../domain/form.ts";
import type { Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

const snapshotTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

const CUT_LINE_LABELS: Record<CutLine, string> = {
  playoffs: "Playoffs",
  "play-in": "Play-in",
  eliminated: "Eliminated",
};

function formatForm(form: number | null) {
  return form === null ? "–" : form.toFixed(2);
}

function Movement({ movement }: { movement: number }) {
  if (movement > 0) {
    return (
      <span class="movement up" title={`Up ${movement} from current rank`}>
        ▲{movement}
      </span>
    );
  }
  if (movement < 0) {
    return (
      <span class="movement down" title={`Down ${-movement} from current rank`}>
        ▼{-movement}
      </span>
    );
  }
  return (
    <span class="movement same" title="Same as current rank">
      –
    </span>
  );
}

export function App({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { currentTable, projectedTable } = project(snapshot.games, now, splitFormRate);
  const teams = new Map(snapshot.teams.map((team) => [team.id, team]));
  const season = seasonLabel(snapshot.season);
  const teamCell = (teamId: TeamId) => {
    const team = teams.get(teamId);
    return (
      <>
        <span class="team-name">{team?.name ?? teamId}</span>
        <span class="team-acronym">{team?.acronym ?? teamId}</span>
      </>
    );
  };
  const isFirstOfCutLine = (row: ProjectedTableRow, index: number) =>
    index > 0 && projectedTable[index - 1]?.cutLine !== row.cutLine;

  return (
    <>
      <header>
        <h1>NL Predict</h1>
        <p class="subtitle">National League {season} · Regular Season</p>
      </header>
      <main>
        <h2>Projected Table</h2>
        <div class="table-scroll">
          <table class="projected">
            <thead>
              <tr>
                <th class="num" scope="col" title="Projected rank">#</th>
                <th scope="col" title="Movement against current rank">
                  <span class="visually-hidden">Movement</span>
                </th>
                <th scope="col">Team</th>
                <th class="num" scope="col" title="Current rank">Now</th>
                <th class="num" scope="col" title="Current Points">Pts</th>
                <th class="num" scope="col" title={`Home Form: Points per Game over the last ≤${FORM_WINDOW_SIZE} home Games`}>
                  Home
                </th>
                <th class="num" scope="col" title={`Away Form: Points per Game over the last ≤${FORM_WINDOW_SIZE} away Games`}>
                  Away
                </th>
                <th class="num" scope="col" title="Projected Points">Proj</th>
              </tr>
            </thead>
            <tbody>
              {projectedTable.map((row, index) => (
                <tr
                  key={row.teamId}
                  class={`cut-${row.cutLine}${isFirstOfCutLine(row, index) ? " cut-line" : ""}`}
                  title={CUT_LINE_LABELS[row.cutLine]}
                >
                  <td class="num">{row.rank}</td>
                  <td>
                    <Movement movement={row.movement} />
                  </td>
                  <th scope="row" class="team">
                    {teamCell(row.teamId)}
                    {row.lowSample && (
                      <abbr class="low-sample" title={`Low Sample: a Form Window holds fewer than ${FORM_WINDOW_SIZE} Games`}>
                        LS
                      </abbr>
                    )}
                  </th>
                  <td class="num">{row.currentRank}</td>
                  <td class="num">{row.currentPoints}</td>
                  <td class="num">{formatForm(row.homeForm)}</td>
                  <td class="num">{formatForm(row.awayForm)}</td>
                  <td class="num points">{Math.round(row.projectedPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul class="legend">
          <li class="cut-playoffs">1–6 Playoffs</li>
          <li class="cut-play-in">7–10 Play-in</li>
          <li class="cut-eliminated">11–14 Eliminated</li>
          <li>
            <abbr class="low-sample">LS</abbr> Low Sample: fewer than {FORM_WINDOW_SIZE} Games in a Form Window
          </li>
        </ul>

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
                return (
                  <tr key={row.teamId}>
                    <td class="num">{row.rank}</td>
                    <th scope="row" class="team">
                      {teamCell(row.teamId)}
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

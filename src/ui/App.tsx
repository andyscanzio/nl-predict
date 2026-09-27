import { useState } from "preact/hooks";
import {
  project,
  REGULAR_SEASON_GAMES,
  type CutLine,
  type IntegrityIssue,
  type ProjectedTableRow,
} from "../domain/project.ts";
import { splitFormRate } from "../domain/splitFormRate.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import type { Decision, Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

const snapshotTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

const gameDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Zurich",
});

const DECISION_LABELS: Record<Decision, string> = {
  regulation: "",
  OT: "OT",
  SO: "SO",
};

const PROJECTED_COLUMNS = 9;

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

const SIDES = {
  home: { form: "Home Form", other: "Away Form" },
  away: { form: "Away Form", other: "Home Form" },
} as const;

function FormWindowDetail({
  side,
  form,
  otherForm,
  remaining,
  games,
  teamName,
}: {
  side: "home" | "away";
  form: number | null;
  otherForm: number | null;
  remaining: number;
  games: FormWindowGame[];
  teamName: (teamId: TeamId) => string;
}) {
  const labels = SIDES[side];
  // Mirrors Split Form Rate: an empty Form Window borrows the other Form, or earns nothing without either.
  const rate =
    form !== null
      ? `${formatForm(form)} per Game`
      : otherForm !== null
        ? `${formatForm(otherForm)} per Game (${labels.other})`
        : "0 per Game";
  return (
    <section class="form-window">
      <h3>
        {labels.form}: {rate} × {remaining} Remaining
      </h3>
      {games.length === 0 ? (
        <p class="meta">No Played {side} Games yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Opponent</th>
              <th class="num" scope="col" title="Goals for : goals against">Score</th>
              <th scope="col" title="Decision: blank for regulation, OT for overtime, SO for shootout">
                <span class="visually-hidden">Decision</span>
              </th>
              <th class="num" scope="col" title="Points earned">Pts</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.gameId}>
                <td>
                  <time dateTime={game.startsAt}>{gameDate.format(new Date(game.startsAt))}</time>
                </td>
                <td>
                  {side === "home" ? "vs " : "@ "}
                  {teamName(game.opponentId)}
                </td>
                <td class="num">
                  {game.goalsFor}:{game.goalsAgainst}
                </td>
                <td class="decision">{DECISION_LABELS[game.decision]}</td>
                <td class="num points">{game.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function IntegrityWarning({
  issues,
  teamName,
}: {
  issues: IntegrityIssue[];
  teamName: (teamId: TeamId) => string;
}) {
  return (
    <div class="warning" role="alert">
      <p>
        <strong>Incomplete schedule.</strong> These teams' Played and Remaining Games don't add up to{" "}
        {REGULAR_SEASON_GAMES}, so their projections may be off:
      </p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.teamId}>
            {teamName(issue.teamId)}: {issue.playedGames} Played + {issue.remainingGames} Remaining ={" "}
            {issue.playedGames + issue.remainingGames}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function App({ snapshot, now }: { snapshot: Snapshot; now: Date }) {
  const { currentTable, projectedTable, integrityIssues, anyGamesPlayed } = project(
    snapshot.games,
    now,
    splitFormRate,
  );
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
  const teamName = (teamId: TeamId) => teams.get(teamId)?.name ?? String(teamId);
  const [expanded, setExpanded] = useState<ReadonlySet<TeamId>>(new Set());
  const toggle = (teamId: TeamId) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(teamId)) next.add(teamId);
      return next;
    });
  const isFirstOfCutLine = (row: ProjectedTableRow, index: number) =>
    index > 0 && projectedTable[index - 1]?.cutLine !== row.cutLine;

  return (
    <>
      <header>
        <h1>NL Predict</h1>
        <p class="subtitle">National League {season} · Regular Season</p>
      </header>
      <main>
        {integrityIssues.length > 0 && <IntegrityWarning issues={integrityIssues} teamName={teamName} />}
        {anyGamesPlayed ? (
          <>
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
                    <th class="num" scope="col" title="Remaining Games: home · away">
                      Left
                    </th>
                    <th class="num" scope="col" title="Projected Points">Proj</th>
                  </tr>
                </thead>
                {projectedTable.map((row, index) => {
                  const isExpanded = expanded.has(row.teamId);
                  const detailId = `form-windows-${row.teamId}`;
                  return (
                    <tbody key={row.teamId} class={`cut-${row.cutLine}`}>
                      <tr
                        class={isFirstOfCutLine(row, index) ? "cut-line" : undefined}
                        title={CUT_LINE_LABELS[row.cutLine]}
                      >
                        <td class="num">{row.rank}</td>
                        <td>
                          <Movement movement={row.movement} />
                        </td>
                        <th scope="row" class="team">
                          <button
                            type="button"
                            class="expand"
                            aria-expanded={isExpanded}
                            aria-controls={detailId}
                            title={isExpanded ? "Hide Form Window Games" : "Show Form Window Games"}
                            onClick={() => toggle(row.teamId)}
                          >
                            <span class="chevron" aria-hidden="true">
                              {isExpanded ? "▾" : "▸"}
                            </span>
                            {teamCell(row.teamId)}
                          </button>
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
                        <td class="num" title={`${row.remainingHomeGames} home, ${row.remainingAwayGames} away`}>
                          {row.remainingHomeGames}·{row.remainingAwayGames}
                        </td>
                        <td class="num points">{Math.round(row.projectedPoints)}</td>
                      </tr>
                      {isExpanded && (
                        <tr class="detail" id={detailId}>
                          <td colSpan={PROJECTED_COLUMNS}>
                            <div class="form-windows">
                              <FormWindowDetail
                                side="home"
                                form={row.homeForm}
                                otherForm={row.awayForm}
                                remaining={row.remainingHomeGames}
                                games={row.homeFormWindow}
                                teamName={teamName}
                              />
                              <FormWindowDetail
                                side="away"
                                form={row.awayForm}
                                otherForm={row.homeForm}
                                remaining={row.remainingAwayGames}
                                games={row.awayFormWindow}
                                teamName={teamName}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </table>
            </div>
            <ul class="legend">
              <li class="cut-playoffs">1–6 Playoffs</li>
              <li class="cut-play-in">7–10 Play-in</li>
              <li class="cut-eliminated">11–14 Eliminated</li>
              <li>
                <abbr class="low-sample">LS</abbr> Low Sample: fewer than {FORM_WINDOW_SIZE} Games in a Form Window
              </li>
              <li>Left: Remaining home · away Games</li>
            </ul>

            <section class="explanation">
              <h3>How the projection works</h3>
              <p>
                This is the Split Form Rate model. Each team keeps the Points it has today and earns its Home Form on every
                Remaining home Game and its Away Form on every Remaining away Game. Home Form is the Points per Game over
                the team's home Form Window, its up to {FORM_WINDOW_SIZE} most recent Played home Games; Away Form is the
                same over its away Form Window. Projected Points = current Points + Remaining home Games × Home Form +
                Remaining away Games × Away Form.
              </p>
              <p>
                Opponents are ignored, so a team in good form is assumed to keep it up against anyone. A team with no Played
                home Games yet uses its Away Form for its Remaining home Games, and the reverse; with neither, it stays on its
                current Points. Teams level on projected Points keep their Current Table order. Select a team to see the
                Games in its Form Windows.
              </p>
            </section>

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
              Teams level on Points are ordered by Points per Game, then goal difference, goals for and regulation wins.
              This approximates the official SIHF rule, which also uses head-to-head results, so the order can differ
              slightly from the official table.
            </p>
          </>
        ) : (
          <section class="empty-state">
            <h2>No Games played yet</h2>
            <p>
              The {season} Regular Season hasn't started, so there is no Home Form or Away Form to project from. The Projected Table
              and Current Table appear here once the first Game has a result.
            </p>
          </section>
        )}
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

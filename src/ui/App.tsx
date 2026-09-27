import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  project,
  REGULAR_SEASON_GAMES,
  type CutLine,
  type IntegrityIssue,
  type ProjectedTableRow,
} from "../domain/project.ts";
import { splitFormRate } from "../domain/splitFormRate.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import { headlineOf, type Headline } from "../domain/headline.ts";
import type { Decision, Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

const snapshotTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

/** Scoreboard-style Snapshot time, e.g. "27.09 13:33". */
const scoreboardTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Zurich",
});

function formatScoreboardTime(date: Date) {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    scoreboardTime.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")} ${part("hour")}:${part("minute")}`;
}

const gameDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Zurich",
});

const ordinalRules = new Intl.PluralRules("en-GB", { type: "ordinal" });
const ORDINAL_SUFFIXES: Partial<Record<Intl.LDMLPluralRule, string>> = { one: "st", two: "nd", few: "rd" };

function ordinal(n: number) {
  return `${n}${ORDINAL_SUFFIXES[ordinalRules.select(n)] ?? "th"}`;
}

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

function resultLabel(game: FormWindowGame) {
  const outcome = game.goalsFor > game.goalsAgainst ? "win" : "loss";
  return game.decision === "regulation" ? `Regulation ${outcome}` : `${game.decision} ${outcome}`;
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
  home: { form: "Home Form", other: "Away Form", letter: "H" },
  away: { form: "Away Form", other: "Home Form", letter: "A" },
} as const;

/** One chip per Form Window Game, newest first: filled for wins, outlined for losses, dimmer for OT/SO. */
function FormChips({
  side,
  form,
  games,
  teamName,
}: {
  side: "home" | "away";
  form: number | null;
  games: FormWindowGame[];
  teamName: (teamId: TeamId) => string;
}) {
  const labels = SIDES[side];
  return (
    <span class="chips" title={`${labels.form}: ${formatForm(form)} Points per Game`}>
      <span class="chips-side" aria-hidden="true">
        {labels.letter}
      </span>
      <span class="visually-hidden">
        {labels.form} {formatForm(form)}
      </span>
      {games.length === 0 ? (
        <span class="chips-empty" aria-hidden="true">
          –
        </span>
      ) : (
        games.map((game) => (
          <span
            key={game.gameId}
            class={`chip chip-${game.points}`}
            aria-hidden="true"
            title={`${gameDate.format(new Date(game.startsAt))} ${side === "home" ? "vs" : "@"} ${teamName(game.opponentId)}: ${game.goalsFor}:${game.goalsAgainst} ${resultLabel(game)} (${game.points} Pts)`}
          />
        ))
      )}
    </span>
  );
}

/** Current Points solid, Projected Gain striped, on a scale shared by every row. */
function GainBar({ row, scale }: { row: ProjectedTableRow; scale: number }) {
  const gain = Math.max(0, row.projectedPoints - row.currentPoints);
  const percent = (points: number) => `${(points / scale) * 100}%`;
  return (
    <span
      class="gain-bar"
      aria-hidden="true"
      title={`${row.currentPoints} Points + ${Math.round(gain)} Projected Gain`}
    >
      <span class="gain-bar-now" style={{ width: percent(row.currentPoints) }} />
      <span class="gain-bar-gain" style={{ left: percent(row.currentPoints), width: percent(gain) }} />
    </span>
  );
}

function HeadlineSentence({ headline, teamName }: { headline: Headline; teamName: (teamId: TeamId) => string }) {
  const { first, last, riser } = headline;
  return (
    <>
      If every team keeps its current form, <strong>{teamName(first)}</strong> finish top,{" "}
      <strong>{teamName(last)}</strong> finish last
      {riser && (
        <>
          , and <strong>{teamName(riser.teamId)}</strong> climb {riser.places}{" "}
          {riser.places === 1 ? "place" : "places"} to {ordinal(riser.rank)}
        </>
      )}
      .
    </>
  );
}

/** Scrolls the headline like a scoreboard crawl; pauses on hover, focus or the button, and stands still for reduced motion. */
function Ticker({ children }: { children: ComponentChildren }) {
  const [paused, setPaused] = useState(false);
  return (
    <section class={paused ? "ticker paused" : "ticker"} aria-label="Projection headline">
      <span class="ticker-tag" aria-hidden="true">
        Projection
      </span>
      <div class="ticker-rail">
        <div class="ticker-track">
          <p>{children}</p>
          <p aria-hidden="true">{children}</p>
        </div>
      </div>
      <button
        type="button"
        class="ticker-toggle"
        aria-pressed={paused}
        title={paused ? "Resume headline" : "Pause headline"}
        onClick={() => setPaused(!paused)}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="currentColor">
          {paused ? (
            <path d="M2 1 L9 5 L2 9 Z" />
          ) : (
            <>
              <rect x="2" y="1" width="2" height="8" />
              <rect x="6" y="1" width="2" height="8" />
            </>
          )}
        </svg>
        <span class="visually-hidden">Pause headline</span>
      </button>
    </section>
  );
}

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
  const snapshotAt = new Date(snapshot.snapshotAt);
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
  const headline = headlineOf(projectedTable);
  const barScale = Math.max(1, ...projectedTable.map((row) => row.projectedPoints));
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
      <header class="scoreboard panel">
        <div>
          <h1>
            NL <span class="dot" aria-hidden="true">●</span> Predict
          </h1>
          <p class="subtitle">National League {season} · Regular Season</p>
        </div>
        <p class="as-of">
          <span class="as-of-label">Data as of</span>
          <time dateTime={snapshot.snapshotAt} title={`${snapshotTime.format(snapshotAt)} (Swiss time)`}>
            {formatScoreboardTime(snapshotAt)}
          </time>
        </p>
      </header>
      <main>
        {integrityIssues.length > 0 && <IntegrityWarning issues={integrityIssues} teamName={teamName} />}
        {anyGamesPlayed ? (
          <>
            {headline && (
              <Ticker>
                <HeadlineSentence headline={headline} teamName={teamName} />
              </Ticker>
            )}
            <section class="panel">
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
                      <th class="wide" scope="col" title={`Home and away Form Windows: the last ≤${FORM_WINDOW_SIZE} Games each, newest first`}>
                        Form
                      </th>
                      <th class="num" scope="col" title="Remaining Games: home · away">
                        Left
                      </th>
                      <th class="num" scope="col" title="Current Points">Pts</th>
                      <th class="wide bar-col" scope="col" title="Current Points plus Projected Gain">
                        + Projected Gain
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
                          <td class="num rank">{String(row.rank).padStart(2, "0")}</td>
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
                          <td class="wide">
                            <span class="form-chips">
                              <FormChips side="home" form={row.homeForm} games={row.homeFormWindow} teamName={teamName} />
                              <FormChips side="away" form={row.awayForm} games={row.awayFormWindow} teamName={teamName} />
                            </span>
                          </td>
                          <td class="num" title={`${row.remainingHomeGames} home, ${row.remainingAwayGames} away`}>
                            {row.remainingHomeGames}·{row.remainingAwayGames}
                          </td>
                          <td class="num">{row.currentPoints}</td>
                          <td class="wide bar-col">
                            <GainBar row={row} scale={barScale} />
                          </td>
                          <td class="num projected-points">{Math.round(row.projectedPoints)}</td>
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
                <li class="wide">
                  <span class="chip chip-3" /> Win <span class="chip chip-2" /> OT/SO win{" "}
                  <span class="chip chip-1" /> OT/SO loss <span class="chip chip-0" /> Loss
                </li>
                <li class="wide">
                  <span class="gain-bar legend-bar">
                    <span class="gain-bar-now" style={{ width: "40%" }} />
                    <span class="gain-bar-gain" style={{ left: "40%", width: "60%" }} />
                  </span>{" "}
                  Points + Projected Gain
                </li>
                <li>
                  <abbr class="low-sample">LS</abbr> Low Sample: fewer than {FORM_WINDOW_SIZE} Games in a Form Window
                </li>
                <li>Left: Remaining home · away Games</li>
              </ul>
            </section>

            <section class="panel explanation">
              <h2>How the projection works</h2>
              <div class="panel-body">
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
              </div>
            </section>

            <section class="panel">
              <h2>Current Table</h2>
              <div class="table-scroll">
                <table class="current">
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
                          <td class="num rank">{String(row.rank).padStart(2, "0")}</td>
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
              <p class="meta panel-body">
                Teams level on Points are ordered by Points per Game, then goal difference, goals for and regulation wins.
                This approximates the official SIHF rule, which also uses head-to-head results, so the order can differ
                slightly from the official table.
              </p>
            </section>
          </>
        ) : (
          <section class="panel empty-state">
            <h2>No Games played yet</h2>
            <p class="panel-body">
              The {season} Regular Season hasn't started, so there is no Home Form or Away Form to project from. The Projected Table
              and Current Table appear here once the first Game has a result.
            </p>
          </section>
        )}
      </main>
      <footer>
        Game data from the Swiss Ice Hockey Federation (SIHF), used for personal, non-commercial purposes under
        their <a href={SIHF_TERMS}>terms of use</a>. Not affiliated with SIHF or the National League.
      </footer>
    </>
  );
}

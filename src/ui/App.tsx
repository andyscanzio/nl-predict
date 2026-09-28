import { useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  LOW_SAMPLE_GAMES,
  project,
  REGULAR_SEASON_GAMES,
  type IntegrityIssue,
  type ProjectedTableRow,
  type ProjectionModel,
} from "../domain/project.ts";
import type { CutLineProbabilities } from "../domain/seasonSimulation.ts";
import type { CutLine } from "../domain/cutLines.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import { headlineOf, type Headline } from "../domain/headline.ts";
import type { Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";
import { PROJECTION_MODELS, type ProjectionModelId } from "../domain/projectionModels.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import type { ChartMetric } from "./projectionChart.ts";
import { applyTheme, readTheme, storeTheme, THEMES, type Theme } from "./theme.ts";
import { formatForm, formatGameDate, formatScoreboardTime, formatSnapshotTime, ordinal, SIMULATION_RUNS_LABEL } from "./format.ts";
import { SIDES } from "./formSides.ts";
import { CurrentTable } from "./CurrentTable.tsx";
import { ModelExplanation } from "./ModelExplanation.tsx";
import { TeamDetail } from "./TeamDetail.tsx";
import { fullTeamName, TeamName } from "./TeamName.tsx";
import { UpcomingGames } from "./UpcomingGames.tsx";
import { formatPercent } from "./winSplit.ts";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

const PROJECTED_COLUMNS = 10;

const PROBABILITY_COLUMNS: { key: keyof CutLineProbabilities; label: string; short: string; title: string }[] = [
  { key: "playoffs", label: "Playoffs", short: "PO", title: "Chance of finishing 1–6: straight to the playoffs" },
  { key: "playIn", label: "Play-in", short: "PI", title: "Chance of finishing 7–10: the play-in" },
  { key: "eliminated", label: "Eliminated", short: "Out", title: "Chance of finishing 11–14: eliminated" },
  { key: "first", label: "1st", short: "1st", title: "Chance of finishing first" },
];

const CUT_LINE_LABELS: Record<CutLine, string> = {
  playoffs: "Playoffs",
  "play-in": "Play-in",
  eliminated: "Eliminated",
};

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
            title={`${formatGameDate(new Date(game.startsAt))} ${side === "home" ? "vs" : "@"} ${teamName(game.opponentId)}: ${game.goalsFor}:${game.goalsAgainst} ${resultLabel(game)} (${game.points} Pts)`}
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

function HeadlineSentence({
  headline,
  modelName,
  teamName,
}: {
  headline: Headline;
  modelName: string;
  teamName: (teamId: TeamId) => string;
}) {
  const { first, last, riser } = headline;
  return (
    <>
      {modelName} projection: <strong>{teamName(first)}</strong> finish top,{" "}
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

const THEME_LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

/** Light, dark, or whatever the system says; remembered in this browser. index.html applies it before first paint. */
function ThemeToggle() {
  const [theme, setTheme] = useState(() => readTheme(localStorageOrUndefined()));
  const pick = (next: Theme) => {
    applyTheme(document.documentElement, next);
    storeTheme(localStorageOrUndefined(), next);
    setTheme(next);
  };
  return (
    <fieldset class="theme-toggle">
      <legend class="visually-hidden">Colour theme</legend>
      {THEMES.map((option) => (
        <label key={option}>
          <input type="radio" name="theme" value={option} checked={option === theme} onChange={() => pick(option)} />
          <span>{THEME_LABELS[option]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Reading `localStorage` itself throws where site data is blocked. */
function localStorageOrUndefined() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function ModelPicker({
  model,
  onChange,
}: {
  model: ProjectionModel<ProjectionModelId>;
  onChange: (model: ProjectionModel<ProjectionModelId>) => void;
}) {
  return (
    <fieldset class="model-picker">
      <legend class="visually-hidden">Projection Model</legend>
      <span class="model-picker-label" aria-hidden="true">
        Model
      </span>
      <div class="model-options">
        {PROJECTION_MODELS.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name="model"
              value={option.id}
              checked={option.id === model.id}
              onChange={() => onChange(option)}
            />
            <span>{option.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function App({
  snapshot,
  now,
  model,
  history,
  onModelChange,
}: {
  snapshot: Snapshot;
  now: Date;
  model: ProjectionModel<ProjectionModelId>;
  /** The picked model's Projection History, computed while the site was built. */
  history: ProjectionHistory;
  onModelChange: (model: ProjectionModel<ProjectionModelId>) => void;
}) {
  // The Season Simulation is too slow to rerun on every render, such as expanding a team.
  const { currentTable, projectedTable, integrityIssues, anyGamesPlayed, nextRound } = useMemo(
    () => project(snapshot.games, now, model),
    [snapshot, now, model],
  );
  const showProbabilities = model.kind === "outcomes";
  const expandTarget = showProbabilities ? "finishing ranks and Form Window Games" : "Form Window Games";
  const columns = PROJECTED_COLUMNS + (showProbabilities ? PROBABILITY_COLUMNS.length : 0);
  const teams = new Map(snapshot.teams.map((team) => [team.id, team]));
  const season = seasonLabel(snapshot.season);
  const snapshotAt = new Date(snapshot.snapshotAt);
  const teamName = (teamId: TeamId) => fullTeamName(teams, teamId);
  const headline = headlineOf(projectedTable);
  const barScale = Math.max(1, ...projectedTable.map((row) => row.projectedPoints));
  const [expanded, setExpanded] = useState<ReadonlySet<TeamId>>(new Set());
  // Kept here rather than per chart, so the choice survives switching model and opening another team.
  const [chartMetric, setChartMetric] = useState<ChartMetric>("playoffs");
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
        <div class="scoreboard-side">
          <ThemeToggle />
          <p class="as-of">
            <span class="as-of-label">Data as of</span>
            <time dateTime={snapshot.snapshotAt} title={`${formatSnapshotTime(snapshotAt)} (Swiss time)`}>
              {formatScoreboardTime(snapshotAt)}
            </time>
          </p>
        </div>
      </header>
      <main>
        {integrityIssues.length > 0 && <IntegrityWarning issues={integrityIssues} teamName={teamName} />}
        {anyGamesPlayed ? (
          <>
            {headline && (
              <Ticker>
                <HeadlineSentence headline={headline} modelName={model.name} teamName={teamName} />
              </Ticker>
            )}
            <section class="panel">
              <h2>Projected Table</h2>
              <ModelPicker model={model} onChange={onModelChange} />
              <div class="table-scroll">
                <table class="projected">
                  <thead>
                    <tr>
                      <th class="rank-head" scope="col" title="Projected rank">#</th>
                      <th scope="col" title="Movement against current rank">
                        <span class="visually-hidden">Movement</span>
                      </th>
                      <th scope="col">Team</th>
                      <th class="num roomy" scope="col" title="Current rank">Now</th>
                      <th class="wide" scope="col" colSpan={2} title={`Home and away Form Windows: the last ≤${FORM_WINDOW_SIZE} Games each, newest first`}>
                        Form
                      </th>
                      <th class="num roomy" scope="col" title="Remaining Games: home · away">
                        Left
                      </th>
                      <th class="num roomy" scope="col" title="Current Points">Pts</th>
                      <th class="wide bar-col" scope="col" title="Current Points plus Projected Gain">
                        <span aria-hidden="true">+ Gain</span>
                        <span class="visually-hidden">Projected Gain</span>
                      </th>
                      <th class="num" scope="col" title="Projected Points">Proj</th>
                      {showProbabilities &&
                        PROBABILITY_COLUMNS.map((column) => (
                          <th key={column.key} class="num pct" scope="col" title={column.title}>
                            <span aria-hidden="true">{column.short}</span>
                            <span class="visually-hidden">{column.label} %</span>
                          </th>
                        ))}
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
                              title={`${isExpanded ? "Hide" : "Show"} ${expandTarget}`}
                              onClick={() => toggle(row.teamId)}
                            >
                              <span class="chevron" aria-hidden="true">
                                {isExpanded ? "▾" : "▸"}
                              </span>
                              <TeamName teams={teams} teamId={row.teamId} />
                            </button>
                            {row.lowSample && (
                              <abbr class="low-sample" title={`Low Sample: fewer than ${LOW_SAMPLE_GAMES} Played Games`}>
                                LS
                              </abbr>
                            )}
                          </th>
                          <td class="num roomy">{row.currentRank}</td>
                          <td class="wide form-home">
                            <FormChips side="home" form={row.homeForm} games={row.homeFormWindow} teamName={teamName} />
                          </td>
                          <td class="wide form-away">
                            <FormChips side="away" form={row.awayForm} games={row.awayFormWindow} teamName={teamName} />
                          </td>
                          <td class="num roomy" title={`${row.remainingHomeGames} home, ${row.remainingAwayGames} away`}>
                            {row.remainingHomeGames}·{row.remainingAwayGames}
                          </td>
                          <td class="num roomy">{row.currentPoints}</td>
                          <td class="wide bar-col">
                            <GainBar row={row} scale={barScale} />
                          </td>
                          <td class="num projected-points">{Math.round(row.projectedPoints)}</td>
                          {row.probabilities &&
                            PROBABILITY_COLUMNS.map(({ key }) => {
                              const probability = row.probabilities![key];
                              return (
                                <td key={key} class={probability === 0 ? "num pct none" : "num pct"}>
                                  {formatPercent(probability)}
                                </td>
                              );
                            })}
                        </tr>
                        {isExpanded && (
                          <tr class="detail" id={detailId}>
                            <td colSpan={columns}>
                              <TeamDetail
                                row={row}
                                history={history}
                                teams={teams}
                                showProbabilities={showProbabilities}
                                chartMetric={chartMetric}
                                onChartMetricChange={setChartMetric}
                              />
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
                  <abbr class="low-sample">LS</abbr> Low Sample: fewer than {LOW_SAMPLE_GAMES} Played Games
                </li>
                <li>Left: Remaining home · away Games</li>
                {showProbabilities ? (
                  <li>Playoffs (PO) · Play-in (PI) · Eliminated (Out) · 1st: % of {SIMULATION_RUNS_LABEL} simulated Seasons</li>
                ) : (
                  <li>No % columns: {model.name} gives no Outcome Probabilities (see below)</li>
                )}
              </ul>
            </section>

            <UpcomingGames nextRound={nextRound} lowSample={projectedTable.some((row) => row.lowSample)} teams={teams} />

            <ModelExplanation model={model} />

            <CurrentTable rows={currentTable} teams={teams} />
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

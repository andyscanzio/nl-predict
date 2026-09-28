import { useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { project, REGULAR_SEASON_GAMES, type IntegrityIssue, type ProjectionModel } from "../domain/project.ts";
import { headlineOf, type Headline } from "../domain/headline.ts";
import type { Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";
import type { ProjectionModelId } from "../domain/projectionModels.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import { applyTheme, readTheme, storeTheme, THEMES, type Theme } from "./theme.ts";
import { formatScoreboardTime, formatSnapshotTime, ordinal } from "./format.ts";
import { CurrentTable } from "./CurrentTable.tsx";
import { ModelExplanation } from "./ModelExplanation.tsx";
import { ProjectedTable } from "./ProjectedTable.tsx";
import { fullTeamName } from "./TeamName.tsx";
import { UpcomingGames } from "./UpcomingGames.tsx";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

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
  const teams = new Map(snapshot.teams.map((team) => [team.id, team]));
  const season = seasonLabel(snapshot.season);
  const snapshotAt = new Date(snapshot.snapshotAt);
  const teamName = (teamId: TeamId) => fullTeamName(teams, teamId);
  const headline = headlineOf(projectedTable);

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
            <ProjectedTable
              rows={projectedTable}
              model={model}
              history={history}
              teams={teams}
              onModelChange={onModelChange}
            />

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

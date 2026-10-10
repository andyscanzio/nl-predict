import { useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  project,
  REGULAR_SEASON_GAMES,
  type IntegrityIssue,
  type NextRoundDay,
  type ProjectionModel,
  type WhatIf,
  type WhatIfOutcome,
} from "../domain/project.ts";
import { headlineOf, type Headline } from "../domain/headline.ts";
import type { Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";
import type { ProjectionModelId } from "../domain/projectionModels.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import { applyTheme, readTheme, storeTheme, THEMES, type Theme } from "./theme.ts";
import { formatScoreboardTime, formatSnapshotTime, ordinal } from "./format.ts";
import { CurrentTable } from "./CurrentTable.tsx";
import { ModelExplanation } from "./ModelExplanation.tsx";
import { ProjectedBracket } from "./ProjectedBracket.tsx";
import { ProjectedTable } from "./ProjectedTable.tsx";
import { fullTeamName, teamAcronym, type Teams } from "./TeamName.tsx";
import { lowSampleShare } from "./lowSample.ts";
import { UpcomingGames, whatIfLabel } from "./UpcomingGames.tsx";

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

/** The Headline on the LED screen, tagged with whether it shows the Real Projection or a What-If; wraps on narrow screens. */
function HeadlineScreen({ whatIfActive, children }: { whatIfActive: boolean; children: ComponentChildren }) {
  return (
    <section class="headline" aria-label="Projection headline">
      <span class="headline-tag" aria-hidden="true">
        {whatIfActive ? "What-if" : "Projection"}
      </span>
      <p>{children}</p>
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
        <strong>Incomplete schedule.</strong> These teams' played and remaining games don't add up to{" "}
        {REGULAR_SEASON_GAMES}, so their projections may be off:
      </p>
      <ul>
        {issues.map((issue) => (
          <li key={issue.teamId}>
            {teamName(issue.teamId)}: {issue.playedGames} played + {issue.remainingGames} remaining ={" "}
            {issue.playedGames + issue.remainingGames}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tells the visitor the tables and Headline assume their What-If Results, lists them in Next Round order with a ✕ to
 * remove each, and lets them go back to the Real Projection.
 */
function WhatIfBanner({
  nextRound,
  teams,
  onRemove,
  onReset,
}: {
  nextRound: NextRoundDay[];
  teams: Teams;
  onRemove: (gameId: string) => void;
  onReset: () => void;
}) {
  const results = nextRound.flatMap((day) => day.games.flatMap(({ game, whatIf }) => (whatIf ? [{ game, whatIf }] : [])));
  return (
    <div class="warning what-if-banner" role="status">
      <p>
        <strong>What-if:</strong> the projected table, chances and headline assume these results; small numbers and ▲▼
        compare with the real projection.
      </p>
      <ul class="what-if-results">
        {results.map(({ game, whatIf }) => {
          const home = fullTeamName(teams, game.homeTeamId);
          const away = fullTeamName(teams, game.awayTeamId);
          return (
            <li key={game.id} class="what-if-result">
              {teamAcronym(teams, game.homeTeamId)}–{teamAcronym(teams, game.awayTeamId)}: {whatIfLabel(whatIf, home, away)}{" "}
              <button
                type="button"
                aria-label={`Remove the what-if result of ${home} vs ${away}`}
                onClick={() => onRemove(game.id)}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onReset}>
        Reset
      </button>
    </div>
  );
}

/** Whether two What-Ifs hold the same What-If Results. */
function sameWhatIf(a: WhatIf, b: WhatIf): boolean {
  return a.size === b.size && [...a].every(([gameId, outcome]) => b.get(gameId) === outcome);
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
  playoffs,
  history,
  whatIf,
  onModelChange,
  onWhatIfChange,
}: {
  snapshot: Snapshot;
  now: Date;
  model: ProjectionModel<ProjectionModelId>;
  /** The Post-Season feature flag (VITE_PLAYOFFS, read by the entry point): shows the Projected Bracket. */
  playoffs: boolean;
  /** The picked model's Projection History, computed while the site was built. */
  history: ProjectionHistory;
  /** The What-If asked for, e.g. by the URL; only its Results for the real Next Round's Games are applied. */
  whatIf: WhatIf;
  onModelChange: (model: ProjectionModel<ProjectionModelId>) => void;
  /**
   * Called to `replace` the What-If asked for with the one applied, when stale entries were dropped, or to `push` a new
   * one chosen by the visitor (Reset).
   */
  onWhatIfChange: (whatIf: WhatIf, mode: "push" | "replace") => void;
}) {
  // Kept per snapshot, As-Of Date and model, so picking a What-If Result reruns only the What-If projection.
  const realProjection = useMemo(
    () => project(snapshot.games, now, model, undefined, undefined, { postSeason: playoffs }),
    [snapshot, now, model, playoffs],
  );
  // The Season Simulation is too slow to rerun on every render, such as expanding a team.
  const {
    currentTable,
    projectedTable,
    integrityIssues,
    anyGamesPlayed,
    nextRound,
    whatIf: appliedWhatIf,
    projectedBracket,
  } = useMemo(
    () => project(snapshot.games, now, model, whatIf, realProjection, { postSeason: playoffs }),
    [snapshot, now, model, whatIf, realProjection, playoffs],
  );
  // Entries that did not apply (Played, out of the Next Round, unknown) must not linger in the URL.
  const stale = !sameWhatIf(whatIf, appliedWhatIf);
  useEffect(() => {
    if (stale) onWhatIfChange(appliedWhatIf, "replace");
  }, [stale, appliedWhatIf]);
  const teams = new Map(snapshot.teams.map((team) => [team.id, team]));
  const season = seasonLabel(snapshot.season);
  const snapshotAt = new Date(snapshot.snapshotAt);
  const teamName = (teamId: TeamId) => fullTeamName(teams, teamId);
  const headline = headlineOf(projectedTable);
  // While active, the Projected Table and Headline follow the What-If; the Current Table and Projection History stay real.
  const whatIfActive = appliedWhatIf.size > 0;
  const pickWhatIfResult = (gameId: string, outcome: WhatIfOutcome | undefined) => {
    const next = new Map(appliedWhatIf);
    if (outcome) next.set(gameId, outcome);
    else next.delete(gameId);
    onWhatIfChange(next, "push");
  };

  return (
    <>
      <header class="scoreboard panel">
        <div>
          <h1>
            NL <span class="dot" aria-hidden="true">●</span> Predict
          </h1>
          <p class="subtitle">National League {season} · Regular season</p>
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
              <HeadlineScreen whatIfActive={whatIfActive}>
                <HeadlineSentence headline={headline} modelName={model.name} teamName={teamName} />
              </HeadlineScreen>
            )}
            {whatIfActive && (
              <WhatIfBanner
                nextRound={nextRound}
                teams={teams}
                onRemove={(gameId) => pickWhatIfResult(gameId, undefined)}
                onReset={() => onWhatIfChange(new Map(), "push")}
              />
            )}
            <ProjectedTable
              rows={projectedTable}
              model={model}
              history={history}
              whatIfActive={whatIfActive}
              teams={teams}
              onModelChange={onModelChange}
            />

            {projectedBracket && (
              <ProjectedBracket
                bracket={projectedBracket}
                ranks={new Map(projectedTable.map((row) => [row.teamId, row.rank]))}
                teams={teams}
              />
            )}

            <UpcomingGames
              nextRound={nextRound}
              lowSample={lowSampleShare(projectedTable)}
              teams={teams}
              onWhatIfPick={pickWhatIfResult}
            />

            <CurrentTable rows={currentTable} teams={teams} whatIfActive={whatIfActive} />

            <ModelExplanation model={model} />
          </>
        ) : (
          <section class="panel empty-state">
            <h2>No games played yet</h2>
            <p class="panel-body">
              The {season} regular season hasn't started, so there is no home or away form to project from. The projected table
              and current table appear here once the first game has a result.
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

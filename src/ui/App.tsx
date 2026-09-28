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
import { SIMULATION_RUNS, type CutLineProbabilities } from "../domain/seasonSimulation.ts";
import type { CutLine } from "../domain/cutLines.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import { splitFormRatesOf } from "../domain/splitFormRate.ts";
import { headlineOf, type Headline } from "../domain/headline.ts";
import type { Decision, Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";
import { ELO_HOME_ADVANTAGE, ELO_K, INITIAL_RATING } from "../domain/eloModel.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME } from "../domain/outcomes.ts";
import { PROJECTION_MODELS, type ProjectionModelId } from "../domain/projectionModels.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import { AXIS_LABEL, CHART, lowSampleBox, matchDayAtPointer, plotX, plotY, polylinePoints, tooltipBox } from "./chartLayout.ts";
import { chartMetrics, projectionChart, shownMetric, type ChartMetric } from "./projectionChart.ts";
import { rankBars } from "./rankHistogram.ts";
import { rankSummary } from "./rankSummary.ts";
import { applyTheme, readTheme, storeTheme, THEMES, type Theme } from "./theme.ts";
import { formatForm, formatGameDate, formatScoreboardTime, formatSnapshotTime, ordinal } from "./format.ts";
import { fullTeamName, TeamName } from "./TeamName.tsx";
import { UpcomingGames } from "./UpcomingGames.tsx";
import { formatPercent } from "./winSplit.ts";

const SIHF_TERMS = "https://www.sihf.ch/de/nutzungsbedingungen/";

const DECISION_LABELS: Record<Decision, string> = {
  regulation: "",
  OT: "OT",
  SO: "SO",
};

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

function FormWindowDetail({
  side,
  form,
  otherForm,
  remaining,
  games,
  teamName,
  showProjectedRate,
}: {
  side: "home" | "away";
  form: number | null;
  otherForm: number | null;
  remaining: number;
  games: FormWindowGame[];
  teamName: (teamId: TeamId) => string;
  /** Show the Form as the rate a Points-only model (Split Form Rate) projects each Remaining Game at. */
  showProjectedRate: boolean;
}) {
  const labels = SIDES[side];
  const borrowed = form === null && otherForm !== null;
  const rates = side === "home" ? splitFormRatesOf(form, otherForm) : splitFormRatesOf(otherForm, form);
  const projectedRate = rates[side];
  // Neither Form exists: the rate is a bare 0, not a formatted Form.
  const rate = `${form === null && otherForm === null ? "0" : formatForm(projectedRate)} per Game${borrowed ? ` (${labels.other})` : ""}`;
  return (
    <section class="form-window">
      <h3>
        {showProjectedRate
          ? `${labels.form}: ${rate} × ${remaining} Remaining`
          : `${labels.form}: ${formatForm(form)} · ${remaining} Remaining`}
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
                  <time dateTime={game.startsAt}>{formatGameDate(new Date(game.startsAt))}</time>
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

/** A team's Rank Distribution as a histogram: one bar per rank, colored by Cut Line zone, scaled to the team's highest bar, with a tick at the projected rank. */
function RankHistogram({ distribution, projectedRank }: { distribution: readonly number[]; projectedRank: number }) {
  const bars = rankBars(distribution, projectedRank);
  const summary = rankSummary(distribution);
  return (
    <section class="rank-histogram">
      <h3>Rank Distribution</h3>
      <p class="rank-summary">
        {summary.around80 ? (
          <>
            {summary.around80.before}
            <span class="rank-summary-share" title={`${formatPercent(summary.share)}% of simulated Seasons`}>
              80%
            </span>
            {summary.around80.after}
          </>
        ) : (
          summary.text
        )}
      </p>
      <div class="rank-bars" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.rank} class="rank-bar" title={bar.label}>
            <span class="rank-bar-track">
              <span
                class={`rank-bar-fill zone-${bar.zone}${bar.height > 0 ? " chance" : ""}`}
                style={{ height: `${bar.height * 100}%` }}
              />
            </span>
            <span class="rank-bar-rank">{bar.rank}</span>
            {bar.projected && <span class="rank-bar-tick" />}
          </span>
        ))}
      </div>
      <p class="visually-hidden">Projected rank in the table, by expected Points: {ordinal(projectedRank)}</p>
      <ul class="visually-hidden">
        {bars
          .filter((bar) => bar.height > 0)
          .map((bar) => (
            <li key={bar.rank}>{bar.label}</li>
          ))}
      </ul>
    </section>
  );
}

const METRIC_LABELS: Record<ChartMetric, { title: string; toggle: string }> = {
  playoffs: { title: "Playoff chance over the Season", toggle: "Playoff %" },
  points: { title: "Projected Points over the Season", toggle: "Points" },
};

/**
 * A team's playoff chance or projected Points over the Season: its line bold, the other teams' faint. A model without
 * Outcome Probabilities has only the Points view, and so no toggle.
 */
function ProjectionHistoryChart({
  history,
  teamId,
  teamName,
  metric: chosenMetric,
  onMetricChange,
}: {
  history: ProjectionHistory;
  teamId: TeamId;
  teamName: string;
  metric: ChartMetric;
  onMetricChange: (metric: ChartMetric) => void;
}) {
  // The Match Day being pointed at, on the chosen team's line: hovered with a mouse, or tapped on a phone.
  const [active, setActive] = useState<number | null>(null);
  const metrics = chartMetrics(history);
  const metric = shownMetric(chosenMetric, metrics);
  const chart = metric && projectionChart(history, teamId, metric);
  if (!metric || !chart) return null;
  const pointAt = (event: PointerEvent) => {
    const svg = (event.currentTarget as SVGElement).ownerSVGElement!;
    setActive(matchDayAtPointer(event.clientX, svg.getBoundingClientRect(), chart.tooltips.length));
  };
  const tip = active === null ? null : chart.tooltips[active];
  const tipBox = tip && tooltipBox(tip);
  const lowSample = lowSampleBox(chart.lowSample);
  return (
    <section class="history-chart">
      <div class="history-head">
        <h3>{METRIC_LABELS[metric].title}</h3>
        {metrics.length > 1 && (
          <div class="history-toggle" role="group" aria-label="Chart metric">
            {metrics.map((option) => (
              <button key={option} type="button" aria-pressed={option === metric} onClick={() => onMetricChange(option)}>
                {METRIC_LABELS[option].toggle}
              </button>
            ))}
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={`${teamName}: ${chart.summary}`}
        onPointerDown={(event) => {
          // A tap anywhere but the chosen line dismisses the tooltip.
          if (!(event.target as Element).classList.contains("history-hit")) setActive(null);
        }}
      >
        {lowSample && (
          <g class="history-low-sample">
            <rect x={lowSample.x} y={lowSample.y} width={lowSample.width} height={lowSample.height} />
            {lowSample.labelled && (
              <text x={lowSample.textX} y={lowSample.textY}>
                Low Sample
              </text>
            )}
          </g>
        )}
        {[0, 1].map((share) => (
          <line key={share} class="history-edge" x1={plotX(0)} x2={plotX(1)} y1={plotY(share)} y2={plotY(share)} />
        ))}
        {chart.guideY !== null && <line class="history-guide" x1={plotX(0)} x2={plotX(1)} y1={plotY(chart.guideY)} y2={plotY(chart.guideY)} />}
        {chart.yTicks.map(({ y: share, text }) => (
          <text key={text} class="history-label" x={AXIS_LABEL.x} y={plotY(share)} text-anchor="end" dominant-baseline="middle">
            {text}
          </text>
        ))}
        {chart.xLabels.map(({ x: share, text }, index) => (
          <text
            key={index}
            class="history-label"
            x={plotX(share)}
            y={AXIS_LABEL.y}
            text-anchor={index === 0 ? "start" : index === chart.xLabels.length - 1 ? "end" : "middle"}
          >
            {text}
          </text>
        ))}
        {chart.lines.map((line) => (
          <polyline
            key={line.teamId}
            class={line.chosen ? "history-line chosen" : "history-line"}
            points={polylinePoints(line.points)}
          />
        ))}
        {tip && tipBox && (
          <g class="history-tip" pointer-events="none">
            <line class="history-tip-rule" x1={plotX(tip.x)} x2={plotX(tip.x)} y1={plotY(0)} y2={plotY(1)} />
            <circle class="history-tip-dot" cx={plotX(tip.x)} cy={plotY(tip.y)} r={3.5} />
            <rect x={tipBox.x} y={tipBox.y} width={tipBox.width} height={tipBox.height} rx={3} />
            {tip.lines.map((line, index) => (
              <text key={index} class={index === 0 ? "history-tip-date" : undefined} x={tipBox.textX} y={tipBox.textYs[index]}>
                {line}
              </text>
            ))}
          </g>
        )}
        {/* A wide invisible stroke over the chosen line is the only thing that answers to a tap or the mouse. */}
        <polyline
          class="history-hit"
          points={polylinePoints(chart.tooltips)}
          onPointerDown={pointAt}
          onPointerMove={pointAt}
          onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
        />
      </svg>
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

const SIMULATION_RUNS_LABEL = SIMULATION_RUNS.toLocaleString("en-GB");

/** How each Projection Model turns Played Games into projected Points; a model without an entry fails type-checking. */
const MODEL_EXPLANATIONS: Record<ProjectionModelId, ComponentChildren> = {
  "split-form-rate": (
    <>
      <p>
        Each team keeps the Points it has today and earns its Home Form on every Remaining home Game and its Away Form
        on every Remaining away Game. Home Form is the Points per Game over the team's home Form Window, its up to{" "}
        {FORM_WINDOW_SIZE} most recent Played home Games; Away Form is the same over its away Form Window. Projected
        Points = current Points + Remaining home Games × Home Form + Remaining away Games × Away Form.
      </p>
      <p>
        Opponents are ignored, so a team in good form is assumed to keep it up against anyone. A team with no Played
        home Games yet uses its Away Form for its Remaining home Games, and the reverse; with neither, it stays on its
        current Points.
      </p>
      <p>
        <strong>No percentages.</strong> Split Form Rate predicts each side of a Game on its own, so a Game's two
        predictions need not add up to its 3 Points and there are no Outcome Probabilities to play the Season out from.
        Pick another model to see each team's Playoffs, Play-in, Eliminated and 1st chances.
      </p>
    </>
  ),
  "season-rate": (
    <p>
      Each team keeps earning its Points per Game over all its Played Games this Season, whatever the venue or
      opponent; a team with no Played Games counts as {LEAGUE_AVERAGE_POINTS_PER_GAME}, half of a Game's 3 Points. A
      Remaining Game's 3 Points can't honour both teams' rates at once, so the home team expects the mean of its own
      rate and what the away team's rate leaves it: (home rate + 3 − away rate) ÷ 2.
    </p>
  ),
  matchup: (
    <p>
      Each Remaining Game weighs the home team's Home Form against the away team's Away Form. Home Form is the Points
      per Game over a team's home Form Window, its up to {FORM_WINDOW_SIZE} most recent Played home Games; Away Form is
      the same over its away Form Window. The home team expects (Home Form + 3 − the away team's Away Form) ÷ 2 of the
      Game's 3 Points. A team with no Played Games at one venue uses its Form from the other; with neither, it counts
      as {LEAGUE_AVERAGE_POINTS_PER_GAME}.
    </p>
  ),
  elo: (
    <p>
      Every team starts the Season on a Rating of {INITIAL_RATING}. After each Played Game, the home team's Rating rises by{" "}
      {ELO_K} × (the share of the 3 Points it took − the share the Ratings expected) and the away team's falls by the
      same, so beating a strong team counts for more than beating a weak one. The home team gets a Home Advantage of {ELO_HOME_ADVANTAGE} Rating
      points. For each Remaining Game, the two current Ratings plus Home Advantage give the home team its expected
      share of the 3 Points. K and Home Advantage were tuned by Back-Testing the 2024/25 and 2025/26 Regular Seasons.
    </p>
  ),
};

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
                              <div class="form-windows">
                                <div class="rank-row">
                                  {row.rankDistribution && (
                                    <RankHistogram distribution={row.rankDistribution} projectedRank={row.rank} />
                                  )}
                                  <ProjectionHistoryChart
                                    history={history}
                                    teamId={row.teamId}
                                    teamName={teamName(row.teamId)}
                                    metric={chartMetric}
                                    onMetricChange={setChartMetric}
                                  />
                                </div>
                                <FormWindowDetail
                                  side="home"
                                  form={row.homeForm}
                                  otherForm={row.awayForm}
                                  remaining={row.remainingHomeGames}
                                  games={row.homeFormWindow}
                                  teamName={teamName}
                                  showProjectedRate={!showProbabilities}
                                />
                                <FormWindowDetail
                                  side="away"
                                  form={row.awayForm}
                                  otherForm={row.homeForm}
                                  remaining={row.remainingAwayGames}
                                  games={row.awayFormWindow}
                                  teamName={teamName}
                                  showProjectedRate={!showProbabilities}
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

            <section class="panel explanation">
              <h2>How the projection works: {model.name}</h2>
              <div class="panel-body">
                {MODEL_EXPLANATIONS[model.id]}
                {showProbabilities && (
                  <>
                    <p>
                      That expectation becomes Outcome Probabilities (regulation win, OT/SO win, OT/SO loss, regulation
                      loss), with Games going to overtime or a shootout at the OT/SO Rate: the league-wide share of Played
                      Games decided that way. A team's projected Points are its current Points plus its expected Points over
                      its Remaining Games.
                    </p>
                    <p>
                      The percentages come from a Season Simulation: every Remaining Game is played out {SIMULATION_RUNS_LABEL}{" "}
                      times by drawing its result from the model's Outcome Probabilities, and each simulated Season's final
                      table is ranked by Points, with ties broken at random. Playoffs, Play-in and Eliminated are the share of
                      Seasons a team finishes 1–6, 7–10 and 11–14; 1st is the share it finishes top. The table itself stays
                      ranked by expected Points. The same data always gives the same numbers.
                    </p>
                    <p>
                      A team's Rank Distribution charts how often it finished at each rank across those Seasons, with a tick
                      at its projected rank. The most likely rank can differ from #, because # ranks teams by expected Points
                      while the chart counts where the team finished in each simulated Season.
                    </p>
                  </>
                )}
                <p>
                  Teams level on projected Points keep their Current Table order. Select a team to see{" "}
                  {showProbabilities ? "its finishing ranks and the Games in its Form Windows." : "the Games in its Form Windows."}
                </p>
              </div>
            </section>

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
                    {currentTable.map((row) => {
                      return (
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

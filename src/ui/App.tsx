import { useMemo, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  LOW_SAMPLE_GAMES,
  project,
  REGULAR_SEASON_GAMES,
  type IntegrityIssue,
  type NextRoundDay,
  type ProjectedTableRow,
  type ProjectionModel,
} from "../domain/project.ts";
import { simulationSeedAsOf } from "../domain/matchDay.ts";
import { SIMULATION_RUNS, type CutLineProbabilities } from "../domain/seasonSimulation.ts";
import type { CutLine } from "../domain/cutLines.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import { headlineOf, type Headline } from "../domain/headline.ts";
import type { Decision, Snapshot, TeamId } from "../domain/types.ts";
import { seasonLabel } from "../domain/season.ts";
import { ELO_HOME_ADVANTAGE, ELO_K, INITIAL_RATING } from "../domain/eloModel.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME, type OutcomeProbabilities } from "../domain/outcomes.ts";
import { PROJECTION_MODELS } from "./modelUrl.ts";
import { rankBars } from "./rankHistogram.ts";
import { rankSummary } from "./rankSummary.ts";
import { formatPercent, winSplit } from "./winSplit.ts";

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

const upcomingGameTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Zurich",
});

/** A Next Round match day's Swiss calendar date (YYYY-MM-DD) as e.g. "Tue 29 Sep"; UTC avoids reinterpreting the date. */
const matchDayHeading = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatExpectedPoints(points: number) {
  return points.toFixed(1);
}

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

const oneDecimalPercent = (probability: number) => `${(probability * 100).toFixed(1)}%`;

/** Hover text listing a Game's four Outcome Probabilities, each named for the side that wins. */
function outcomesTitle(outcomes: OutcomeProbabilities, home: string, away: string) {
  return [
    `${home} win in regulation ${oneDecimalPercent(outcomes.regulationWin)}`,
    `${home} win in OT/SO ${oneDecimalPercent(outcomes.overtimeOrShootoutWin)}`,
    `${away} win in OT/SO ${oneDecimalPercent(outcomes.overtimeOrShootoutLoss)}`,
    `${away} win in regulation ${oneDecimalPercent(outcomes.regulationLoss)}`,
  ].join(" · ");
}

/** Home win against away win (each including its OT/SO wins), with a lighter slice in each side for its OT/SO wins. */
function WinSplitBar({ outcomes }: { outcomes: OutcomeProbabilities }) {
  const split = winSplit(outcomes);
  const homeWin = outcomes.regulationWin + outcomes.overtimeOrShootoutWin;
  const awayWin = outcomes.overtimeOrShootoutLoss + outcomes.regulationLoss;
  const segment = (side: "home" | "away", win: number, overtimeOrShootoutWin: number) => (
    <span class={`win-split-side ${side}${split[side].exact ? " none" : ""}`} style={{ flexGrow: win }}>
      <span class="win-split-otso" style={{ width: `${win > 0 ? (overtimeOrShootoutWin / win) * 100 : 0}%` }} />
    </span>
  );
  return (
    <div class="win-split">
      <span class={split.home.exact ? "win-split-pct none" : "win-split-pct"}>{split.home.label}</span>
      <span class="win-split-bar" aria-hidden="true">
        {segment("home", homeWin, outcomes.overtimeOrShootoutWin)}
        {segment("away", awayWin, outcomes.overtimeOrShootoutLoss)}
      </span>
      <span class={split.away.exact ? "win-split-pct none" : "win-split-pct"}>{split.away.label}</span>
    </div>
  );
}

/** The Next Round, grouped under match-day subheadings; hidden entirely when there are no Upcoming Games. */
function UpcomingGamesPanel({
  nextRound,
  lowSample,
  teamCell,
  teamName,
}: {
  nextRound: NextRoundDay[];
  lowSample: boolean;
  teamCell: (teamId: TeamId) => ComponentChildren;
  teamName: (teamId: TeamId) => string;
}) {
  if (nextRound.length === 0) return null;
  return (
    <section class="panel">
      <h2>Upcoming Games</h2>
      {nextRound.map((day) => (
        <div class="upcoming-day" key={day.date}>
          <h3 class="upcoming-day-heading">{matchDayHeading.format(new Date(`${day.date}T00:00:00Z`))}</h3>
          <ul class="upcoming-games">
            {day.games.map(({ game, prediction }) => (
              <li
                key={game.id}
                class="upcoming-game"
                title={
                  prediction.outcomes
                    ? outcomesTitle(prediction.outcomes, teamName(game.homeTeamId), teamName(game.awayTeamId))
                    : undefined
                }
              >
                <div class="upcoming-game-main">
                  <time class="upcoming-time" dateTime={game.startsAt}>
                    {upcomingGameTime.format(new Date(game.startsAt))}
                  </time>
                  <span class="upcoming-teams">
                    <span class="upcoming-team">{teamCell(game.homeTeamId)}</span>
                    <span class="upcoming-vs" aria-hidden="true">
                      vs
                    </span>
                    <span class="upcoming-team">{teamCell(game.awayTeamId)}</span>
                  </span>
                </div>
                {prediction.outcomes ? (
                  <WinSplitBar outcomes={prediction.outcomes} />
                ) : (
                  <p class="upcoming-points">
                    {formatExpectedPoints(prediction.points.home)} Pts – {formatExpectedPoints(prediction.points.away)} Pts
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {lowSample && (
        <p class="meta panel-body upcoming-note">
          Some teams are Low Sample, with fewer than {LOW_SAMPLE_GAMES} Played Games, so these predictions rest on
          little data.
        </p>
      )}
      <ul class="legend">
        {nextRound.some((day) => day.games.some(({ prediction }) => prediction.outcomes)) ? (
          <>
            <li>
              <span class="legend-swatch win-split-side home"></span>{" "}
              Home win
            </li>
            <li>
              <span class="legend-swatch win-split-side home">
                <span class="win-split-otso" style={{ width: "100%" }} />
              </span>{" "}
              Home win in OT/SO
            </li>
            <li>
              <span class="legend-swatch win-split-side away">
                <span class="win-split-otso" style={{ width: "100%" }} />
              </span>{" "}
              Away win in OT/SO
            </li>
            <li>
              <span class="legend-swatch win-split-side away"></span>{" "}
              Away win
            </li>
            <li>Percentages are the chance of winning, in regulation or OT/SO</li>
          </>
        ) : (
          <li>Pts – Pts: expected Points for the home – away team</li>
        )}
      </ul>
    </section>
  );
}

function ModelPicker({ model, onChange }: { model: ProjectionModel; onChange: (model: ProjectionModel) => void }) {
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

/** How a Projection Model turns Played Games into projected Points, by model id. */
function ModelExplanation({ model }: { model: ProjectionModel }) {
  switch (model.id) {
    case "split-form-rate":
      return (
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
      );
    case "season-rate":
      return (
        <p>
          Each team keeps earning its Points per Game over all its Played Games this Season, whatever the venue or
          opponent; a team with no Played Games counts as {LEAGUE_AVERAGE_POINTS_PER_GAME}, half of a Game's 3 Points. A
          Remaining Game's 3 Points can't honour both teams' rates at once, so the home team expects the mean of its own
          rate and what the away team's rate leaves it: (home rate + 3 − away rate) ÷ 2.
        </p>
      );
    case "matchup":
      return (
        <p>
          Each Remaining Game weighs the home team's Home Form against the away team's Away Form. Home Form is the Points
          per Game over a team's home Form Window, its up to {FORM_WINDOW_SIZE} most recent Played home Games; Away Form is
          the same over its away Form Window. The home team expects (Home Form + 3 − the away team's Away Form) ÷ 2 of the
          Game's 3 Points. A team with no Played Games at one venue uses its Form from the other; with neither, it counts
          as {LEAGUE_AVERAGE_POINTS_PER_GAME}.
        </p>
      );
    case "elo":
      return (
        <p>
          Every team starts the Season on a Rating of {INITIAL_RATING}. After each Played Game, the home team's Rating rises by{" "}
          {ELO_K} × (the share of the 3 Points it took − the share the Ratings expected) and the away team's falls by the
          same, so beating a strong team counts for more than beating a weak one. The home team gets a Home Advantage of {ELO_HOME_ADVANTAGE} Rating
          points. For each Remaining Game, the two current Ratings plus Home Advantage give the home team its expected
          share of the 3 Points. K and Home Advantage were tuned by Back-Testing the 2024/25 and 2025/26 Regular Seasons.
        </p>
      );
    default:
      return null;
  }
}

export function App({
  snapshot,
  now,
  model,
  onModelChange,
}: {
  snapshot: Snapshot;
  now: Date;
  model: ProjectionModel;
  onModelChange: (model: ProjectionModel) => void;
}) {
  // The Season Simulation is too slow to rerun on every render, such as expanding a team.
  const { currentTable, projectedTable, integrityIssues, anyGamesPlayed, nextRound } = useMemo(
    () => project(snapshot.games, now, model, simulationSeedAsOf(snapshot.games, now, model.id)),
    [snapshot, now, model],
  );
  const showProbabilities = model.kind === "outcomes";
  const expandTarget = showProbabilities ? "finishing ranks and Form Window Games" : "Form Window Games";
  const columns = PROJECTED_COLUMNS + (showProbabilities ? PROBABILITY_COLUMNS.length : 0);
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
                              {teamCell(row.teamId)}
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
                                {row.rankDistribution && <RankHistogram distribution={row.rankDistribution} projectedRank={row.rank} />}
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

            <UpcomingGamesPanel
              nextRound={nextRound}
              lowSample={projectedTable.some((row) => row.lowSample)}
              teamCell={teamCell}
              teamName={teamName}
            />

            <section class="panel explanation">
              <h2>How the projection works: {model.name}</h2>
              <div class="panel-body">
                <ModelExplanation model={model} />
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

import { useState } from "preact/hooks";
import { LOW_SAMPLE_GAMES, type ProjectedTableRow, type ProjectionModel } from "../domain/project.ts";
import type { CutLineProbabilities } from "../domain/seasonSimulation.ts";
import type { CutLine } from "../domain/cutLines.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import type { TeamId } from "../domain/types.ts";
import { DEFAULT_MODEL, pickerModelOf, PROJECTION_MODELS, type PickerModelId, type ProjectionModelId } from "../domain/projectionModels.ts";
import { eloLevelStartModel, eloModel, INITIAL_RATING } from "../domain/eloModel.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import type { ChartMetric } from "./projectionChart.ts";
import { formatForm, formatGameDate, SIMULATION_RUNS_LABEL } from "./format.ts";
import { lowSampleSentence, lowSampleShare } from "./lowSample.ts";
import { SIDES } from "./formSides.ts";
import { TeamDetail } from "./TeamDetail.tsx";
import { fullTeamName, TeamName, type Teams } from "./TeamName.tsx";
import { formatPercent } from "./winSplit.ts";

const PROJECTED_COLUMNS = 9;

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

/** A Form Window Game's result, e.g. "3:1 Regulation win"; a What-If Result has no real score and was picked as OT/SO, not OT or SO. */
function resultLabel(game: FormWindowGame) {
  const outcome = game.goalsFor > game.goalsAgainst ? "win" : "loss";
  if (game.whatIf) return `What-if ${game.decision === "regulation" ? "regulation" : "OT/SO"} ${outcome}`;
  return `${game.goalsFor}:${game.goalsAgainst} ${game.decision === "regulation" ? "Regulation" : game.decision} ${outcome}`;
}

/** Movement against the current rank, or against the real projected rank when `comparison` says so. */
function Movement({ movement, comparison }: { movement: number; comparison: string }) {
  if (movement > 0) {
    return (
      <span class="movement up" title={`Up ${movement} from ${comparison}`}>
        ▲{movement}
      </span>
    );
  }
  if (movement < 0) {
    return (
      <span class="movement down" title={`Down ${-movement} from ${comparison}`}>
        ▼{-movement}
      </span>
    );
  }
  return (
    <span class="movement same" title={`Same as ${comparison}`}>
      –
    </span>
  );
}

/** A signed number with a real minus sign. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : `−${-value}`;
}

/** The projected Points, with the What-If Change from the Real Projection stacked under it when the rounded values differ. */
function ProjectedPoints({ row }: { row: ProjectedTableRow }) {
  const points = Math.round(row.projectedPoints);
  const change = row.realProjection ? points - Math.round(row.realProjection.projectedPoints) : 0;
  if (change === 0) return <>{points}</>;
  return (
    <>
      <span class="visually-hidden">
        {points}, {change > 0 ? "up" : "down"} {Math.abs(change)} from the real projection
      </span>
      <span aria-hidden="true">{points}</span>
      <small class={`what-if-change ${change > 0 ? "up" : "down"}`} aria-hidden="true">
        {signed(change)}
      </small>
    </>
  );
}

/** A printed percent as a number: "<1" counts as 0 and ">99" as 100. */
function printedPercent(probability: number): number {
  const printed = formatPercent(probability);
  return printed === "<1" ? 0 : printed === ">99" ? 100 : Number(printed);
}

/**
 * A chance percent, with its What-If Change from the Real Projection stacked under it when the printed values differ.
 * A rise in PO or 1st is good and a fall bad, Out is the other way round, and PI is neutral.
 */
function Chance({ column, row }: { column: (typeof PROBABILITY_COLUMNS)[number]; row: ProjectedTableRow }) {
  const probability = row.probabilities![column.key];
  const printed = formatPercent(probability);
  const real = row.realProjection?.probabilities;
  const change = real ? printedPercent(probability) - printedPercent(real[column.key]) : 0;
  if (change === 0) return <>{printed}</>;
  const direction = change > 0 ? "up" : "down";
  const tone = column.key === "playIn" ? "neutral" : (change > 0) === (column.key !== "eliminated") ? "good" : "bad";
  return (
    <>
      <span class="visually-hidden">
        {printed} percent, {direction} {Math.abs(change)} from the real projection
      </span>
      <span aria-hidden="true">{printed}</span>
      <small class={`what-if-change ${tone}`} aria-hidden="true">
        {signed(change)}
      </small>
    </>
  );
}

/** One chip per Form Window Game, newest first: green for wins, red for losses, half-filled for OT/SO. */
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
    <span class="chips" title={`${labels.form}: ${formatForm(form)} points per game`}>
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
            title={`${formatGameDate(new Date(game.startsAt))} ${side === "home" ? "vs" : "@"} ${teamName(game.opponentId)}: ${resultLabel(game)} (${game.points} Pts)`}
          />
        ))
      )}
    </span>
  );
}

/** Each Projection Model in one line, under its name in the picker; a model without an entry fails type-checking. */
const MODEL_SUMMARIES: Record<PickerModelId, string> = {
  elo: "Ratings updated after every game; strong opponents count more",
  "season-rate": "Points per game this season, whatever the venue or opponent",
  matchup: "The home team's home form against the away team's away form",
  "split-form-rate": "Home and away form, ignoring opponents; gives no chances",
};

/** The Elo Model's two starts, in switch order: the Carried-Over Start (the default) and the Level Start. */
const ELO_STARTS = [
  { model: eloModel, label: "Last Season" },
  { model: eloLevelStartModel, label: `Level (${INITIAL_RATING})` },
];

/** Switches the Elo Model between its Carried-Over Start and its Level Start; shown only while the Elo Model is picked. */
function EloStartSwitch({
  model,
  onChange,
}: {
  model: ProjectionModel<ProjectionModelId>;
  onChange: (model: ProjectionModel<ProjectionModelId>) => void;
}) {
  return (
    <div class="elo-start">
      <span class="elo-start-label" aria-hidden="true">
        Start
      </span>
      <div class="history-toggle start-toggle" role="group" aria-label="Elo Model start">
        {ELO_STARTS.map((start) => {
          const pressed = start.model.id === model.id;
          // Like a radio: pressing the current start again changes nothing, so it adds no history entry.
          return (
            <button key={start.model.id} type="button" aria-pressed={pressed} onClick={() => pressed || onChange(start.model)}>
              {start.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelPicker({
  model,
  onChange,
}: {
  model: ProjectionModel<ProjectionModelId>;
  onChange: (model: ProjectionModel<ProjectionModelId>) => void;
}) {
  // The Level Start shows as the Elo Model's row, with its switch set to Level.
  const picked = pickerModelOf(model);
  return (
    <fieldset class="model-picker">
      <legend class="visually-hidden">Projection model</legend>
      <span class="model-picker-label" aria-hidden="true">
        Model
      </span>
      <div class="model-options">
        {PROJECTION_MODELS.map((option) => (
          // The switch sits beside the label, not in it: a label may hold no other control than its own.
          <div key={option.id} class="model-option">
            <label>
              <input
                type="radio"
                name="model"
                value={option.id}
                checked={option.id === picked.id}
                onChange={() => onChange(option)}
              />
              <span>
                <span class="model-name">{option.name}</span>
                {option.id === DEFAULT_MODEL.id && <span class="model-default">Default · best in back-test</span>}
                <span class="model-summary">{MODEL_SUMMARIES[option.id]}</span>
              </span>
            </label>
            {option.id === eloModel.id && picked.id === eloModel.id && <EloStartSwitch model={model} onChange={onChange} />}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** The Projected Table with its legend and model picker. Owns which teams are expanded and the chosen chart metric. */
export function ProjectedTable({
  rows,
  model,
  history,
  whatIfActive,
  teams,
  onModelChange,
}: {
  rows: ProjectedTableRow[];
  model: ProjectionModel<ProjectionModelId>;
  /** The picked model's Projection History, computed while the site was built. */
  history: ProjectionHistory;
  /** A What-If is applied to `rows`; the Projection History in each team's detail ignores it and says so. */
  whatIfActive: boolean;
  teams: Teams;
  onModelChange: (model: ProjectionModel<ProjectionModelId>) => void;
}) {
  // Rows carry the Real Projection only while a What-If is applied.
  const showChanges = rows.some((row) => row.realProjection);
  const movementComparison = showChanges ? "the real projected rank" : "current rank";
  const showProbabilities = model.kind === "outcomes";
  const expandTarget = showProbabilities ? "finishing ranks and form window games" : "form window games";
  const columns = PROJECTED_COLUMNS + (showProbabilities ? PROBABILITY_COLUMNS.length : 0);
  const teamName = (teamId: TeamId) => fullTeamName(teams, teamId);
  // When every team is Low Sample, one legend line says so instead of a badge on every row.
  const lowSampleTeams = lowSampleShare(rows);
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
    index > 0 && rows[index - 1]?.cutLine !== row.cutLine;

  return (
    <section class="panel">
      <h2>Projected table</h2>
      <ModelPicker model={model} onChange={onModelChange} />
      <div class="table-scroll">
        <table class="projected">
          <thead>
            <tr>
              <th class="rank-head" scope="col" title="Projected rank">#</th>
              <th scope="col" title={`Movement against ${movementComparison}`}>
                <span class="visually-hidden">Movement</span>
              </th>
              <th scope="col">Team</th>
              <th class="num roomy" scope="col" title="Current rank">Now</th>
              <th class="wide" scope="col" colSpan={2} title={`Home and away form windows: the last ≤${FORM_WINDOW_SIZE} games each, newest first`}>
                Form
              </th>
              <th class="num roomy" scope="col" title="Remaining games: home · away">
                Left
              </th>
              <th class="num roomy" scope="col" title="Current points">Pts</th>
              <th class="num" scope="col" title="Projected points">Proj</th>
              {showProbabilities &&
                PROBABILITY_COLUMNS.map((column) => (
                  <th key={column.key} class="num pct" scope="col" title={column.title}>
                    <span aria-hidden="true">{column.short}%</span>
                    <span class="visually-hidden">{column.label} %</span>
                  </th>
                ))}
            </tr>
          </thead>
          {rows.map((row, index) => {
            const isExpanded = expanded.has(row.teamId);
            const detailId = `form-windows-${row.teamId}`;
            return (
              <tbody key={row.teamId} class={`cut-${row.cutLine}`}>
                {/* The whole row expands on click; the button, for the keyboard and screen readers, bubbles its click here. */}
                <tr
                  class={isFirstOfCutLine(row, index) ? "cut-line" : undefined}
                  onClick={() => toggle(row.teamId)}
                  title={CUT_LINE_LABELS[row.cutLine]}
                >
                  <td class="num rank">{String(row.rank).padStart(2, "0")}</td>
                  <td>
                    <Movement
                      movement={row.realProjection ? row.realProjection.rank - row.rank : row.movement}
                      comparison={movementComparison}
                    />
                  </td>
                  <th scope="row" class="team">
                    <button
                      type="button"
                      class="expand"
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      title={`${isExpanded ? "Hide" : "Show"} ${expandTarget}`}
                    >
                      <span class="chevron" aria-hidden="true">
                        {isExpanded ? "▾" : "▸"}
                      </span>
                      <TeamName teams={teams} teamId={row.teamId} />
                    </button>
                    {row.lowSample && lowSampleTeams !== "all" && (
                      <abbr class="low-sample" title={`Low sample: fewer than ${LOW_SAMPLE_GAMES} played games`}>
                        LS
                      </abbr>
                    )}
                  </th>
                  <td class="num roomy now">{row.currentRank}</td>
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
                  <td class="num projected-points">
                    <ProjectedPoints row={row} />
                  </td>
                  {row.probabilities &&
                    PROBABILITY_COLUMNS.map((column) => {
                      const probability = row.probabilities![column.key];
                      return (
                        <td key={column.key} class={probability === 0 ? "num pct none" : "num pct"}>
                          <Chance column={column} row={row} />
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
                        whatIfActive={whatIfActive}
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
        {lowSampleTeams === "all" ? (
          <li>{lowSampleSentence(lowSampleTeams)}, so these projections rest on little data.</li>
        ) : (
          <li>
            <abbr class="low-sample">LS</abbr> Low sample: fewer than {LOW_SAMPLE_GAMES} played games
          </li>
        )}
        <li>Left: remaining home · away games</li>
        {showProbabilities ? (
          <li>Playoffs (PO) · Play-in (PI) · Eliminated (Out) · 1st: % of {SIMULATION_RUNS_LABEL} simulated seasons</li>
        ) : (
          <li>No % columns: {model.name} gives no outcome probabilities (see below)</li>
        )}
      </ul>
    </section>
  );
}

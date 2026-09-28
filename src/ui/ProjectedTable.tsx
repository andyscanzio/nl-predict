import { useState } from "preact/hooks";
import { LOW_SAMPLE_GAMES, type ProjectedTableRow, type ProjectionModel } from "../domain/project.ts";
import type { CutLineProbabilities } from "../domain/seasonSimulation.ts";
import type { CutLine } from "../domain/cutLines.ts";
import { FORM_WINDOW_SIZE, type FormWindowGame } from "../domain/form.ts";
import type { TeamId } from "../domain/types.ts";
import { PROJECTION_MODELS, type ProjectionModelId } from "../domain/projectionModels.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import type { ChartMetric } from "./projectionChart.ts";
import { formatForm, formatGameDate, SIMULATION_RUNS_LABEL } from "./format.ts";
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

function resultLabel(game: FormWindowGame) {
  const outcome = game.goalsFor > game.goalsAgainst ? "win" : "loss";
  return game.decision === "regulation" ? `Regulation ${outcome}` : `${game.decision} ${outcome}`;
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
        {points}, {change > 0 ? "up" : "down"} {Math.abs(change)} from the Real Projection
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
        {printed} percent, {direction} {Math.abs(change)} from the Real Projection
      </span>
      <span aria-hidden="true">{printed}</span>
      <small class={`what-if-change ${tone}`} aria-hidden="true">
        {signed(change)}
      </small>
    </>
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
  const expandTarget = showProbabilities ? "finishing ranks and Form Window Games" : "Form Window Games";
  const columns = PROJECTED_COLUMNS + (showProbabilities ? PROBABILITY_COLUMNS.length : 0);
  const teamName = (teamId: TeamId) => fullTeamName(teams, teamId);
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
      <h2>Projected Table</h2>
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
              <th class="wide" scope="col" colSpan={2} title={`Home and away Form Windows: the last ≤${FORM_WINDOW_SIZE} Games each, newest first`}>
                Form
              </th>
              <th class="num roomy" scope="col" title="Remaining Games: home · away">
                Left
              </th>
              <th class="num roomy" scope="col" title="Current Points">Pts</th>
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
          {rows.map((row, index) => {
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
  );
}

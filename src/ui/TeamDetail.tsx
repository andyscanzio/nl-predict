import { useState } from "preact/hooks";
import type { ProjectedTableRow } from "../domain/project.ts";
import type { FormWindowGame } from "../domain/form.ts";
import { splitFormRatesOf } from "../domain/splitFormRate.ts";
import type { ProjectionHistory } from "../domain/projectionHistory.ts";
import type { Decision, TeamId } from "../domain/types.ts";
import { AXIS_LABEL, CHART, lowSampleBox, matchDayAtPointer, plotX, plotY, polylinePoints, tooltipBox } from "./chartLayout.ts";
import { formatForm, formatGameDate, ordinal } from "./format.ts";
import { chartMetrics, projectionChart, shownMetric, type ChartMetric } from "./projectionChart.ts";
import { rankBars } from "./rankHistogram.ts";
import { rankSummary } from "./rankSummary.ts";
import { SIDES } from "./formSides.ts";
import { fullTeamName, type Teams } from "./TeamName.tsx";
import { formatPercent } from "./winSplit.ts";

const DECISION_LABELS: Record<Decision, string> = {
  regulation: "",
  OT: "OT",
  SO: "SO",
};

/** A What-If Result in the Score column: "What-if · OT/SO", or "What-if" in regulation; it never says OT or SO alone, as the visitor picked neither. */
function whatIfScore(decision: Decision) {
  return decision === "regulation" ? "What-if" : "What-if · OT/SO";
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
  const rate = `${form === null && otherForm === null ? "0" : formatForm(projectedRate)} per game${borrowed ? ` (${labels.other})` : ""}`;
  const heading = showProjectedRate
    ? `${labels.form}: ${rate} × ${remaining} remaining`
    : `${labels.form}: ${formatForm(form)} · ${remaining} remaining`;
  // An empty Form Window collapses to its heading; TeamDetail lets the other one take the full width.
  if (games.length === 0) {
    return (
      <section class="form-window empty">
        <h3>
          {heading} · no {side} games played yet
        </h3>
      </section>
    );
  }
  return (
    <section class="form-window">
      <h3>{heading}</h3>
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
            <tr key={game.gameId} class={game.whatIf ? "what-if" : undefined}>
              <td>
                <time dateTime={game.startsAt}>{formatGameDate(new Date(game.startsAt))}</time>
              </td>
              <td>
                {side === "home" ? "vs " : "@ "}
                {teamName(game.opponentId)}
              </td>
              {/* A What-If Result's one-goal score is made up, so it shows only how it was won. */}
              <td class="num">
                {game.whatIf ? whatIfScore(game.decision) : `${game.goalsFor}:${game.goalsAgainst}`}
              </td>
              <td class="decision">{game.whatIf ? "" : DECISION_LABELS[game.decision]}</td>
              <td class="num points">{game.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A team's Rank Distribution as a histogram: one bar per rank, colored by Cut Line zone, scaled to the team's highest bar, with a tick at the projected rank and, during a What-If, caps at the Real Projection's chances. */
function RankHistogram({
  distribution,
  projectedRank,
  real,
}: {
  distribution: readonly number[];
  projectedRank: number;
  /** The Real Projection's Rank Distribution during a What-If; drawn as caps when it differs from `distribution`. */
  real?: readonly number[] | null;
}) {
  const bars = rankBars(distribution, projectedRank, real);
  const hasCaps = bars.some((bar) => bar.cap !== null);
  const summary = rankSummary(distribution);
  return (
    <section class="rank-histogram">
      <h3>Rank distribution</h3>
      <p class="rank-summary">
        {summary.around80 ? (
          <>
            {summary.around80.before}
            <span class="rank-summary-share" title={`${formatPercent(summary.share)}% of simulated seasons`}>
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
              {bar.cap !== null && <span class="rank-bar-cap" style={{ bottom: `${bar.cap * 100}%` }} />}
            </span>
            <span class="rank-bar-rank">{bar.rank}</span>
            {bar.projected && <span class="rank-bar-tick" />}
          </span>
        ))}
      </div>
      {hasCaps && <p class="meta history-note">Marks show the real projection.</p>}
      <p class="visually-hidden">Projected rank in the table, by expected points: {ordinal(projectedRank)}</p>
      <ul class="visually-hidden">
        {bars
          .filter((bar) => bar.height > 0 || bar.cap !== null)
          .map((bar) => (
            <li key={bar.rank}>{bar.label}</li>
          ))}
      </ul>
    </section>
  );
}

const METRIC_LABELS: Record<ChartMetric, { title: string; toggle: string }> = {
  playoffs: { title: "Playoff chance over the season", toggle: "Playoff %" },
  points: { title: "Projected points over the season", toggle: "Points" },
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
  whatIfActive,
}: {
  history: ProjectionHistory;
  teamId: TeamId;
  teamName: string;
  metric: ChartMetric;
  onMetricChange: (metric: ChartMetric) => void;
  whatIfActive: boolean;
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
                Low sample
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
      {whatIfActive && <p class="meta history-note">Projection history ignores the what-if.</p>}
    </section>
  );
}

/** What a team's row of the Projected Table expands to: its Rank Distribution (where the model has one), Projection History chart and home and away Form Windows. */
export function TeamDetail({
  row,
  history,
  teams,
  showProbabilities,
  chartMetric,
  onChartMetricChange,
  whatIfActive,
}: {
  row: ProjectedTableRow;
  history: ProjectionHistory;
  teams: Teams;
  /** The model has Outcome Probabilities; without them each Form Window shows the rate it projects at. */
  showProbabilities: boolean;
  chartMetric: ChartMetric;
  onChartMetricChange: (metric: ChartMetric) => void;
  /** A What-If is applied to the row; the chart stays real and says so. */
  whatIfActive: boolean;
}) {
  const teamName = (teamId: TeamId) => fullTeamName(teams, teamId);
  const anyEmpty = row.homeFormWindow.length === 0 || row.awayFormWindow.length === 0;
  return (
    <div class={anyEmpty ? "form-windows single" : "form-windows"}>
      <div class="rank-row">
        {row.rankDistribution && <RankHistogram distribution={row.rankDistribution} projectedRank={row.rank} real={row.realProjection?.rankDistribution} />}
        <ProjectionHistoryChart
          history={history}
          teamId={row.teamId}
          teamName={teamName(row.teamId)}
          metric={chartMetric}
          onMetricChange={onChartMetricChange}
          whatIfActive={whatIfActive}
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
  );
}

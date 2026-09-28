import { LOW_SAMPLE_GAMES, type NextRoundDay } from "../domain/project.ts";
import type { OutcomeProbabilities } from "../domain/outcomes.ts";
import { formatExpectedPoints, formatGameTime, formatMatchDayHeading } from "./format.ts";
import { fullTeamName, TeamName, type Teams } from "./TeamName.tsx";
import { winSplit } from "./winSplit.ts";

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
  const segment = (side: "home" | "away") => (
    <span class={`win-split-side ${side}${split[side].exact ? " none" : ""}`} style={{ flexGrow: split[side].win }}>
      <span class="win-split-otso" style={{ width: `${split[side].overtimeOrShootoutShare * 100}%` }} />
    </span>
  );
  return (
    <div class="win-split">
      <span class={split.home.exact ? "win-split-pct none" : "win-split-pct"}>{split.home.label}</span>
      <span class="win-split-bar" aria-hidden="true">
        {segment("home")}
        {segment("away")}
      </span>
      <span class={split.away.exact ? "win-split-pct none" : "win-split-pct"}>{split.away.label}</span>
    </div>
  );
}

/** The Next Round, grouped under match-day subheadings; hidden entirely when there are no Upcoming Games. */
export function UpcomingGames({
  nextRound,
  lowSample,
  teams,
}: {
  nextRound: NextRoundDay[];
  lowSample: boolean;
  teams: Teams;
}) {
  if (nextRound.length === 0) return null;
  return (
    <section class="panel">
      <h2>Upcoming Games</h2>
      {nextRound.map((day) => (
        <div class="upcoming-day" key={day.date}>
          <h3 class="upcoming-day-heading">{formatMatchDayHeading(day.date)}</h3>
          <ul class="upcoming-games">
            {day.games.map(({ game, prediction }) => (
              <li
                key={game.id}
                class="upcoming-game"
                title={
                  prediction.outcomes
                    ? outcomesTitle(prediction.outcomes, fullTeamName(teams, game.homeTeamId), fullTeamName(teams, game.awayTeamId))
                    : undefined
                }
              >
                <div class="upcoming-game-main">
                  <time class="upcoming-time" dateTime={game.startsAt}>
                    {formatGameTime(new Date(game.startsAt))}
                  </time>
                  <span class="upcoming-teams">
                    <span class="upcoming-team">
                      <TeamName teams={teams} teamId={game.homeTeamId} />
                    </span>
                    <span class="upcoming-vs" aria-hidden="true">
                      vs
                    </span>
                    <span class="upcoming-team">
                      <TeamName teams={teams} teamId={game.awayTeamId} />
                    </span>
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

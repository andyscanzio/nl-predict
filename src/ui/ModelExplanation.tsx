import type { ComponentChildren } from "preact";
import type { ProjectionModel } from "../domain/project.ts";
import { FORM_WINDOW_SIZE } from "../domain/form.ts";
import { ELO_HOME_ADVANTAGE, ELO_K, INITIAL_RATING } from "../domain/eloModel.ts";
import { LEAGUE_HOME_POINTS_PER_GAME, MATCHUP_PRIOR_GAMES } from "../domain/matchupModel.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME } from "../domain/outcomes.ts";
import type { ProjectionModelId } from "../domain/projectionModels.ts";
import { SEASON_RATE_PRIOR_GAMES } from "../domain/seasonRate.ts";
import { SIMULATION_RUNS_LABEL } from "./format.ts";

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
      Each team keeps earning its Points per Game over its Played Games, whatever the venue or opponent, as if it had
      also played {SEASON_RATE_PRIOR_GAMES} Games at the league-average {LEAGUE_AVERAGE_POINTS_PER_GAME}. Early results
      therefore count for less, and the effect fades as the Season goes on. A Remaining Game's 3 Points can't honour
      both teams' rates at once, so the home team expects the mean of its own rate and what the away team's rate leaves
      it: (home rate + 3 − away rate) ÷ 2.
    </p>
  ),
  matchup: (
    <p>
      Each Remaining Game weighs the home team's Home Rate against the away team's Away Rate. Home Form is the Points
      per Game over a team's home Form Window, its up to {FORM_WINDOW_SIZE} most recent Played home Games; Away Form is
      the same over its away Form Window. A team is rated at home as if it had also played {MATCHUP_PRIOR_GAMES} home
      Games at the league's home average, {LEAGUE_HOME_POINTS_PER_GAME.toFixed(2)}, and away as if it had also played as
      many away Games at the league's away average, {(3 - LEAGUE_HOME_POINTS_PER_GAME).toFixed(2)}; that is its Home
      Rate and Away Rate, so a short run of results counts for less. The home team expects (Home Rate + 3 − the away
      team's Away Rate) ÷ 2 of the Game's 3 Points.
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

/** How the picked Projection Model turns Played Games into projected Points, and what the Projected Table's columns and team details then show. */
export function ModelExplanation({ model }: { model: ProjectionModel<ProjectionModelId> }) {
  const showProbabilities = model.kind === "outcomes";
  return (
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
  );
}

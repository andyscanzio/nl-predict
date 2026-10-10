import type { ComponentChildren } from "preact";
import type { ProjectionModel } from "../domain/project.ts";
import { FORM_WINDOW_SIZE } from "../domain/form.ts";
import { ELO_HOME_ADVANTAGE, ELO_K, ELO_RATING_UNCERTAINTY, INITIAL_RATING, STARTING_RATINGS } from "../domain/eloModel.ts";
import { seasonLabel } from "../domain/season.ts";
import { LEAGUE_HOME_POINTS_PER_GAME, MATCHUP_PRIOR_GAMES } from "../domain/matchupModel.ts";
import { LEAGUE_AVERAGE_POINTS_PER_GAME } from "../domain/outcomes.ts";
import type { ProjectionModelId } from "../domain/projectionModels.ts";
import { SEASON_RATE_PRIOR_GAMES } from "../domain/seasonRate.ts";
import { SIMULATION_RUNS_LABEL } from "./format.ts";

/** How the Elo Model moves Ratings and predicts a Remaining Game, whichever start it has. */
const ELO_UPDATES = (
  <>
    After each played game, the home team's rating rises by {ELO_K} × (the share of the 3 points it took − the share the
    ratings expected) and the away team's falls by the same, so beating a strong team counts for more than beating a weak
    one. The home team gets a home advantage of {ELO_HOME_ADVANTAGE} rating points. For each remaining game, the two
    current ratings plus home advantage give the home team its expected share of the 3 points.
  </>
);

const ELO_RATING_UNCERTAINTY_PARAGRAPH = (
  <p>
    Ratings are only estimates, so each simulated season first moves every team's rating by its own random amount,
    typically within ±{ELO_RATING_UNCERTAINTY} points, before playing the remaining games out. K, home advantage and that
    spread were tuned by back-testing the 2023/24 to 2025/26 regular seasons.
  </p>
);

/** How each Projection Model, and the Elo Model's Level Start, turns Played Games into projected Points; a model without an entry fails type-checking. */
const MODEL_EXPLANATIONS: Record<ProjectionModelId, ComponentChildren> = {
  "split-form-rate": (
    <>
      <p>
        Each team keeps the points it has today and earns its home form on every remaining home game and its away form
        on every remaining away game. Home form is the points per game over the team's home form window, its up to{" "}
        {FORM_WINDOW_SIZE} most recent played home games; away form is the same over its away form window. Projected
        points = current points + remaining home games × home form + remaining away games × away form.
      </p>
      <p>
        Opponents are ignored, so a team in good form is assumed to keep it up against anyone. A team with no played
        home games yet uses its away form for its remaining home games, and the reverse; with neither, it stays on its
        current points.
      </p>
      <p>
        <strong>No percentages.</strong> Split Form Rate predicts each side of a game on its own, so a game's two
        predictions need not add up to its 3 points and there are no outcome probabilities to play the season out from.
        Pick another model to see each team's Playoffs, Play-in, Eliminated and 1st chances.
      </p>
    </>
  ),
  "season-rate": (
    <p>
      Each team keeps earning its points per game over its played games, whatever the venue or opponent, as if it had
      also played {SEASON_RATE_PRIOR_GAMES} games at the league-average {LEAGUE_AVERAGE_POINTS_PER_GAME}. Early results
      therefore count for less, and the effect fades as the season goes on. A remaining game's 3 points can't honour
      both teams' rates at once, so the home team expects the mean of its own rate and what the away team's rate leaves
      it: (home rate + 3 − away rate) ÷ 2.
    </p>
  ),
  matchup: (
    <p>
      Each remaining game weighs the home team's home rate against the away team's away rate. Home form is the points
      per game over a team's home form window, its up to {FORM_WINDOW_SIZE} most recent played home games; away form is
      the same over its away form window. A team is rated at home as if it had also played {MATCHUP_PRIOR_GAMES} home
      games at the league's home average, {LEAGUE_HOME_POINTS_PER_GAME.toFixed(2)}, and away as if it had also played as
      many away games at the league's away average, {(3 - LEAGUE_HOME_POINTS_PER_GAME).toFixed(2)}; that is its home
      rate and away rate, so a short run of results counts for less. The home team expects (home rate + 3 − the away
      team's away rate) ÷ 2 of the game's 3 points.
    </p>
  ),
  elo: (
    <>
      <p>
        Every team starts the season on the rating it ended last season with, carried through every season since{" "}
        {seasonLabel(STARTING_RATINGS.fromSeasons[0]!)}; {INITIAL_RATING} is the league average, and a promoted team
        takes over the rating of the team it replaced. {ELO_UPDATES}
      </p>
      {ELO_RATING_UNCERTAINTY_PARAGRAPH}
    </>
  ),
  "elo-level": (
    <>
      <p>
        Every team starts the season level on {INITIAL_RATING}, the league average, so last season counts for nothing.{" "}
        {ELO_UPDATES}
      </p>
      {ELO_RATING_UNCERTAINTY_PARAGRAPH}
      <p>
        This is the Elo Model's level start. Carrying every rating over from last season predicted better in
        back-testing, so that stays the Elo Model's default start.
      </p>
    </>
  ),
};

/** Collapsed until opened: how the picked Projection Model turns Played Games into projected Points, and what the Projected Table's columns and team details then show. */
export function ModelExplanation({ model }: { model: ProjectionModel<ProjectionModelId> }) {
  const showProbabilities = model.kind === "outcomes";
  return (
    <details class="panel explanation">
      <summary>
        <h2>How the projection works: {model.name}</h2>
      </summary>
      <div class="panel-body">
        {MODEL_EXPLANATIONS[model.id]}
        {showProbabilities && (
          <>
            <p>
              That expectation becomes outcome probabilities (regulation win, OT/SO win, OT/SO loss, regulation
              loss), with games going to overtime or a shootout at the OT/SO rate: the league-wide share of played
              games decided that way. A team's projected points are its current points plus its expected points over
              its remaining games.
            </p>
            <p>
              The percentages come from a season simulation: every remaining game is played out {SIMULATION_RUNS_LABEL}{" "}
              times by drawing its result from the model's outcome probabilities, and each simulated season's final
              table is ranked by points, with ties broken at random. Playoffs, Play-in and Eliminated are the share of
              seasons a team finishes 1–6, 7–10 and 11–14; 1st is the share it finishes top. The table itself stays
              ranked by expected points. The same data always gives the same numbers.
            </p>
            <p>
              A team's rank distribution charts how often it finished at each rank across those seasons, with a tick
              at its projected rank. The most likely rank can differ from #, because # ranks teams by expected points
              while the chart counts where the team finished in each simulated season.
            </p>
          </>
        )}
        <p>
          Teams level on projected points keep their current table order. Select a team to see{" "}
          {showProbabilities ? "its finishing ranks and the games in its form windows." : "the games in its form windows."}
        </p>
      </div>
    </details>
  );
}

import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ModelExplanation } from "./ModelExplanation.tsx";
import { PROJECTION_MODELS } from "../domain/projectionModels.ts";
import { LEAGUE_HOME_POINTS_PER_GAME, MATCHUP_PRIOR_GAMES } from "../domain/matchupModel.ts";
import { SEASON_RATE_PRIOR_GAMES } from "../domain/seasonRate.ts";
import { SIMULATION_RUNS } from "../domain/seasonSimulation.ts";

function panel(model: (typeof PROJECTION_MODELS)[number]) {
  return render(<ModelExplanation model={model} />);
}

/** The text a visitor reads, without markup. */
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const withOutcomes = PROJECTION_MODELS.filter((model) => model.kind === "outcomes");
const pointsOnly = PROJECTION_MODELS.filter((model) => model.kind === "points");

describe("ModelExplanation", () => {
  it.each(PROJECTION_MODELS.map((model) => [model.name, model] as const))(
    "explains %s under a heading with the model's name",
    (name, model) => {
      const html = panel(model);
      expect(html).toContain(`<h2>How the projection works: ${name}</h2>`);
      expect(html.indexOf("</h2>")).toBeLessThan(html.indexOf("<p>"));
    },
  );

  it("starts collapsed, with the heading as the summary to open it", () => {
    const html = panel(PROJECTION_MODELS[0]);
    expect(html).toMatch(/^<details class="panel explanation"><summary><h2>How the projection works: [^<]*<\/h2><\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("gives each model its own explanation", () => {
    const explanations = PROJECTION_MODELS.map((model) => text(panel(model)));
    expect(new Set(explanations).size).toBe(PROJECTION_MODELS.length);
    expect(text(panel(PROJECTION_MODELS.find((model) => model.id === "elo")!))).toContain("Every team starts the season on the rating it ended last season with");
    const seasonRateText = text(panel(PROJECTION_MODELS.find((model) => model.id === "season-rate")!));
    expect(seasonRateText).toContain(`as if it had also played ${SEASON_RATE_PRIOR_GAMES} games at the league-average 1.5`);
    expect(seasonRateText).not.toContain("no played games");
  });

  it("explains the Matchup Model's shrinkage toward the league's home and away averages, without the other-venue fallback", () => {
    const matchupText = text(panel(PROJECTION_MODELS.find((model) => model.id === "matchup")!));
    expect(matchupText).toContain(`${MATCHUP_PRIOR_GAMES} home games`);
    expect(matchupText).toContain(`the league's home average, ${LEAGUE_HOME_POINTS_PER_GAME.toFixed(2)}`);
    expect(matchupText).toContain(`the league's away average, ${(3 - LEAGUE_HOME_POINTS_PER_GAME).toFixed(2)}`);
    expect(matchupText).toContain("(home rate + 3 − the away team's away rate) ÷ 2");
    expect(matchupText).not.toContain("other venue");
    expect(matchupText).not.toContain("no played games");
  });

  it.each(withOutcomes.map((model) => [model.name, model] as const))(
    "explains Outcome Probabilities, the Season Simulation and the Rank Distribution for %s",
    (_name, model) => {
      const read = text(panel(model));
      expect(read).toContain("That expectation becomes outcome probabilities");
      expect(read).toContain(`played out ${SIMULATION_RUNS.toLocaleString("en-GB")} times`);
      expect(read).toContain("A team's rank distribution charts how often it finished at each rank");
    },
  );

  it.each(pointsOnly.map((model) => [model.name, model] as const))(
    "leaves out Outcome Probabilities, the Season Simulation and the Rank Distribution for %s",
    (_name, model) => {
      const read = text(panel(model));
      expect(read).not.toContain("That expectation becomes outcome probabilities");
      expect(read).not.toContain("season simulation:");
      expect(read).not.toContain("rank distribution charts");
    },
  );

  it("closes by pointing a Points-only model's visitor at the Games in a team's Form Windows", () => {
    for (const model of pointsOnly) {
      const read = text(panel(model));
      expect(read).toContain("Teams level on projected points keep their current table order. Select a team to see the games in its form windows.");
      expect(read).not.toContain("finishing ranks");
    }
  });

  it("closes by pointing an Outcome Probabilities model's visitor at a team's finishing ranks too", () => {
    for (const model of withOutcomes) {
      expect(text(panel(model))).toContain(
        "Teams level on projected points keep their current table order. Select a team to see its finishing ranks and the games in its form windows.",
      );
    }
  });

  it("puts the closing line last", () => {
    for (const model of PROJECTION_MODELS) {
      const html = panel(model);
      expect(html.lastIndexOf("Select a team")).toBeGreaterThan(html.lastIndexOf("rank distribution charts"));
    }
  });
});

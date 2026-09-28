import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { ModelExplanation } from "./ModelExplanation.tsx";
import { PROJECTION_MODELS } from "../domain/projectionModels.ts";
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

  it("gives each model its own explanation", () => {
    const explanations = PROJECTION_MODELS.map((model) => text(panel(model)));
    expect(new Set(explanations).size).toBe(PROJECTION_MODELS.length);
    expect(text(panel(PROJECTION_MODELS.find((model) => model.id === "elo")!))).toContain("Every team starts the Season on a Rating of");
    expect(text(panel(PROJECTION_MODELS.find((model) => model.id === "season-rate")!))).toContain("all its Played Games this Season");
  });

  it.each(withOutcomes.map((model) => [model.name, model] as const))(
    "explains Outcome Probabilities, the Season Simulation and the Rank Distribution for %s",
    (_name, model) => {
      const read = text(panel(model));
      expect(read).toContain("That expectation becomes Outcome Probabilities");
      expect(read).toContain(`played out ${SIMULATION_RUNS.toLocaleString("en-GB")} times`);
      expect(read).toContain("A team's Rank Distribution charts how often it finished at each rank");
    },
  );

  it.each(pointsOnly.map((model) => [model.name, model] as const))(
    "leaves out Outcome Probabilities, the Season Simulation and the Rank Distribution for %s",
    (_name, model) => {
      const read = text(panel(model));
      expect(read).not.toContain("That expectation becomes Outcome Probabilities");
      expect(read).not.toContain("Season Simulation:");
      expect(read).not.toContain("Rank Distribution charts");
    },
  );

  it("closes by pointing a Points-only model's visitor at the Games in a team's Form Windows", () => {
    for (const model of pointsOnly) {
      const read = text(panel(model));
      expect(read).toContain("Teams level on projected Points keep their Current Table order. Select a team to see the Games in its Form Windows.");
      expect(read).not.toContain("finishing ranks");
    }
  });

  it("closes by pointing an Outcome Probabilities model's visitor at a team's finishing ranks too", () => {
    for (const model of withOutcomes) {
      expect(text(panel(model))).toContain(
        "Teams level on projected Points keep their Current Table order. Select a team to see its finishing ranks and the Games in its Form Windows.",
      );
    }
  });

  it("puts the closing line last", () => {
    for (const model of PROJECTION_MODELS) {
      const html = panel(model);
      expect(html.lastIndexOf("Select a team")).toBeGreaterThan(html.lastIndexOf("Rank Distribution charts"));
    }
  });
});

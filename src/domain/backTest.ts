import { pointsFor, type PlayedGame } from "./form.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";
import { predictGames, projectionModelInput, type ProjectionModel } from "./project.ts";
import type { Game } from "./types.ts";

export interface BackTestScore {
  model: string;
  /** Played Games scored. */
  games: number;
  /** Mean over Games of the squared errors summed across the four outcomes (0 is perfect, 2 the worst); null for Points-only models. */
  brierScore: number | null;
  /** Mean absolute error between predicted and actual Points, over both sides of every Game. */
  pointsMae: number;
}

function actualOutcomes(game: PlayedGame): OutcomeProbabilities {
  const homeWon = game.result.homeGoals > game.result.awayGoals;
  const regulation = game.result.decision === "regulation";
  return {
    regulationWin: Number(homeWon && regulation),
    overtimeOrShootoutWin: Number(homeWon && !regulation),
    overtimeOrShootoutLoss: Number(!homeWon && !regulation),
    regulationLoss: Number(!homeWon && regulation),
  };
}

function brier(predicted: OutcomeProbabilities, actual: OutcomeProbabilities): number {
  return (Object.keys(actual) as (keyof OutcomeProbabilities)[]).reduce(
    (sum, outcome) => sum + (predicted[outcome] - actual[outcome]) ** 2,
    0,
  );
}

/**
 * Back-Test: predicts every Game Played by the As-Of Date from only the Games played before it started, and scores
 * each Projection Model against the actual results.
 */
export function backTest(games: Game[], asOf: Date, models: readonly ProjectionModel[]): BackTestScore[] {
  const played = projectionModelInput(games, asOf).playedGames;
  // Games starting together share what was known before them, so each start time is predicted once.
  const byStart = new Map<string, PlayedGame[]>();
  for (const game of played) byStart.set(game.startsAt, [...(byStart.get(game.startsAt) ?? []), game]);

  const inputs = [...byStart].map(([startsAt, startingGames]) => ({
    startingGames,
    input: projectionModelInput(games, new Date(startsAt)),
  }));

  return models.map((model) => {
    let brierSum = 0;
    let errorSum = 0;
    for (const { startingGames, input } of inputs) {
      const predictions = predictGames(model, input);
      for (const game of startingGames) {
        const { points, outcomes } = predictions.get(game.id)!;
        errorSum += Math.abs(points.home - pointsFor(game, game.homeTeamId));
        errorSum += Math.abs(points.away - pointsFor(game, game.awayTeamId));
        if (outcomes) brierSum += brier(outcomes, actualOutcomes(game));
      }
    }
    return {
      model: model.name,
      games: played.length,
      brierScore: model.kind === "outcomes" ? brierSum / played.length : null,
      pointsMae: errorSum / (2 * played.length),
    };
  });
}

import { describe, expect, it } from "vitest";
import { fitOrderedLogit, linearPredictor, outcomeProbabilitiesOf, type OrderedLogitRow, type OrdinalOutcome } from "./orderedLogit.ts";
import { seededRandom } from "./seasonSimulation.ts";

const TRUE_COEFFICIENTS = [0.8, -0.5];
const TRUE_CUTS: [number, number, number] = [-1.2, 0.1, 1];

/** Rows drawn from the cumulative logit itself: latent η + logistic noise, cut at the true cut points. */
function syntheticRows(n: number, seed: number): OrderedLogitRow[] {
  const random = seededRandom(seed);
  return Array.from({ length: n }, () => {
    const features = [random() * 4 - 2, random() * 4 - 2];
    const u = random();
    const latent = linearPredictor(TRUE_COEFFICIENTS, features) + Math.log(u / (1 - u));
    const outcome = TRUE_CUTS.filter((cut) => cut < latent).length as OrdinalOutcome;
    return { features, outcome };
  });
}

describe("fitOrderedLogit", () => {
  it("recovers known coefficients and cut points from synthetic data", () => {
    const fit = fitOrderedLogit(syntheticRows(20_000, 7));
    TRUE_COEFFICIENTS.forEach((beta, i) => expect(fit.coefficients[i]).toBeCloseTo(beta, 1));
    TRUE_CUTS.forEach((cut, i) => expect(fit.cutPoints[i]).toBeCloseTo(cut, 1));
  });

  it("gives byte-identical coefficients for the same rows", () => {
    const rows = syntheticRows(2_000, 3);
    expect(JSON.stringify(fitOrderedLogit(rows, { l2: 1 }))).toBe(JSON.stringify(fitOrderedLogit(rows, { l2: 1 })));
  });

  it("shrinks the coefficients under L2 regularisation", () => {
    const rows = syntheticRows(2_000, 3);
    const plain = fitOrderedLogit(rows);
    const ridge = fitOrderedLogit(rows, { l2: 500 });
    expect(Math.abs(ridge.coefficients[0]!)).toBeLessThan(Math.abs(plain.coefficients[0]!));
  });

  it("keeps the cut points increasing", () => {
    const { cutPoints } = fitOrderedLogit(syntheticRows(500, 11));
    expect(cutPoints[0]).toBeLessThan(cutPoints[1]);
    expect(cutPoints[1]).toBeLessThan(cutPoints[2]);
  });
});

describe("outcomeProbabilitiesOf", () => {
  const sum = (o: ReturnType<typeof outcomeProbabilitiesOf>) =>
    o.regulationWin + o.overtimeOrShootoutWin + o.overtimeOrShootoutLoss + o.regulationLoss;

  it("sums to 1", () => {
    for (const eta of [-3, 0, 0.7, 4]) expect(sum(outcomeProbabilitiesOf(eta, TRUE_CUTS))).toBeCloseTo(1, 12);
  });

  it("shifts toward the home team as η rises", () => {
    const low = outcomeProbabilitiesOf(-1, TRUE_CUTS);
    const high = outcomeProbabilitiesOf(1, TRUE_CUTS);
    expect(high.regulationWin).toBeGreaterThan(low.regulationWin);
    expect(high.regulationLoss).toBeLessThan(low.regulationLoss);
    expect(high.regulationWin + high.overtimeOrShootoutWin).toBeGreaterThan(low.regulationWin + low.overtimeOrShootoutWin);
  });
});

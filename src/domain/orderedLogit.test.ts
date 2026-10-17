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

describe("fitOrderedLogit: non-proportional OT/SO", () => {
  const TRUE_CLOSENESS: [number, number] = [0.15, -0.15];

  /** As syntheticRows, but the OT/SO cut points move with |η|: cut k becomes cut k + closeness[k − 1]·|η|. */
  function closenessRows(n: number, seed: number, effect: readonly [number, number]): OrderedLogitRow[] {
    const random = seededRandom(seed);
    return Array.from({ length: n }, () => {
      const features = [random() * 4 - 2, random() * 4 - 2];
      const eta = linearPredictor(TRUE_COEFFICIENTS, features);
      const cuts = [TRUE_CUTS[0], TRUE_CUTS[1] + effect[0] * Math.abs(eta), TRUE_CUTS[2] + effect[1] * Math.abs(eta)];
      const u = random();
      const latent = eta + Math.log(u / (1 - u));
      return { features, outcome: cuts.filter((cut) => cut < latent).length as OrdinalOutcome };
    });
  }

  it("recovers a known closeness effect from synthetic data", () => {
    const fit = fitOrderedLogit(closenessRows(60_000, 5, TRUE_CLOSENESS), { closeness: true });
    TRUE_CLOSENESS.forEach((effect, i) => expect(fit.closeness![i]).toBeCloseTo(effect, 1));
    TRUE_COEFFICIENTS.forEach((beta, i) => expect(fit.coefficients[i]).toBeCloseTo(beta, 1));
    TRUE_CUTS.forEach((cut, i) => expect(fit.cutPoints[i]).toBeCloseTo(cut, 1));
  });

  it("finds no effect when the data has none", () => {
    const fit = fitOrderedLogit(closenessRows(60_000, 6, [0, 0]), { closeness: true });
    for (const effect of fit.closeness!) expect(Math.abs(effect)).toBeLessThan(0.06);
  });

  it("leaves the fit without a closeness effect unless asked", () => {
    expect(fitOrderedLogit(syntheticRows(500, 2)).closeness).toBeUndefined();
  });

  it("gives byte-identical fits for the same rows", () => {
    const rows = closenessRows(2_000, 3, TRUE_CLOSENESS);
    expect(JSON.stringify(fitOrderedLogit(rows, { closeness: true }))).toBe(JSON.stringify(fitOrderedLogit(rows, { closeness: true })));
  });

  it("gives valid Outcome Probabilities summing to 1 across and beyond the fitted range", () => {
    const fit = fitOrderedLogit(closenessRows(20_000, 8, TRUE_CLOSENESS), { closeness: true });
    for (let eta = -8; eta <= 8; eta += 0.25) {
      const o = outcomeProbabilitiesOf(eta, fit.cutPoints, fit.closeness);
      for (const p of Object.values(o)) expect(p).toBeGreaterThanOrEqual(0);
      expect(o.regulationWin + o.overtimeOrShootoutWin + o.overtimeOrShootoutLoss + o.regulationLoss).toBeCloseTo(1, 12);
    }
  });
});

describe("outcomeProbabilitiesOf with a closeness effect", () => {
  it("moves the OT/SO cut points with |η| by the closeness effect", () => {
    const closeness: [number, number] = [0.2, -0.1];
    const o = outcomeProbabilitiesOf(-1.5, TRUE_CUTS, closeness);
    const c = [TRUE_CUTS[0], TRUE_CUTS[1] + 0.2 * 1.5, TRUE_CUTS[2] - 0.1 * 1.5].map((cut) => 1 / (1 + Math.exp(-(cut + 1.5))));
    expect(o.regulationLoss).toBeCloseTo(c[0]!, 12);
    expect(o.overtimeOrShootoutLoss).toBeCloseTo(c[1]! - c[0]!, 12);
    expect(o.overtimeOrShootoutWin).toBeCloseTo(c[2]! - c[1]!, 12);
  });

  it("never gives a negative probability when the moved cut points would cross", () => {
    const o = outcomeProbabilitiesOf(5, TRUE_CUTS, [0.5, -0.5]);
    for (const p of Object.values(o)) expect(p).toBeGreaterThanOrEqual(0);
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

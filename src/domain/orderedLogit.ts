import type { PlayedGame } from "./form.ts";
import type { OutcomeProbabilities } from "./outcomes.ts";

/** A Played Game's outcome from the home side, ordered worst to best: 0 regulation loss, 1 OT/SO loss, 2 OT/SO win, 3 regulation win. */
export type OrdinalOutcome = 0 | 1 | 2 | 3;

export function ordinalOutcomeOf(game: PlayedGame): OrdinalOutcome {
  const { homeGoals, awayGoals, decision } = game.result;
  const regulation = decision === "regulation";
  return homeGoals > awayGoals ? (regulation ? 3 : 2) : regulation ? 0 : 1;
}

export interface OrderedLogitRow {
  features: readonly number[];
  outcome: OrdinalOutcome;
}

/** A fitted cumulative logit: P(outcome ≤ k) = σ(cutPoints[k] − η), with η = coefficients · features. */
export interface OrderedLogitFit {
  coefficients: number[];
  /** Increasing: the logit thresholds between regulation loss | OT/SO loss | OT/SO win | regulation win. */
  cutPoints: [number, number, number];
}

export interface OrderedLogitOptions {
  /** L2 penalty (λ/2)·Σβ² on the coefficients, not the cut points; 0 when omitted. */
  l2?: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function linearPredictor(coefficients: readonly number[], features: readonly number[]): number {
  let eta = 0;
  for (let i = 0; i < coefficients.length; i++) eta += coefficients[i]! * features[i]!;
  return eta;
}

/** The four Outcome Probabilities of a linear predictor η and the cut points; they sum to 1 and move toward the home side as η rises. */
export function outcomeProbabilitiesOf(eta: number, cutPoints: readonly [number, number, number]): OutcomeProbabilities {
  const [c0, c1, c2] = cutPoints.map((cut) => sigmoid(cut - eta)) as [number, number, number];
  return {
    regulationLoss: c0,
    overtimeOrShootoutLoss: c1 - c0,
    overtimeOrShootoutWin: c2 - c1,
    regulationWin: 1 - c2,
  };
}

const CUTS = 3;
const MAX_ITERATIONS = 100;
const TOLERANCE = 1e-10;

/** Solves A x = b by Gaussian elimination with partial pivoting; A is symmetric positive definite here. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = col + 1; r < n; r++) {
      const factor = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = m[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= m[i]![j]! * x[j]!;
    x[i] = sum / m[i]![i]!;
  }
  return x;
}

/** Parameters are [cut 0, cut 1, cut 2, β…]; undefined when the cut points are not increasing. */
function negativeLogLikelihood(params: readonly number[], rows: readonly OrderedLogitRow[], l2: number): number | undefined {
  if (!(params[0]! < params[1]! && params[1]! < params[2]!)) return undefined;
  let total = 0;
  for (const { features, outcome } of rows) {
    const eta = linearPredictor(params.slice(CUTS), features);
    const upper = outcome === CUTS ? 1 : sigmoid(params[outcome]! - eta);
    const lower = outcome === 0 ? 0 : sigmoid(params[outcome - 1]! - eta);
    total -= Math.log(Math.max(upper - lower, 1e-300));
  }
  for (let j = CUTS; j < params.length; j++) total += 0.5 * l2 * params[j]! ** 2;
  return total;
}

/**
 * Fits the cumulative logit on RL < OTL < OTW < RW by Newton's method with step halving on the penalised negative
 * log-likelihood. Pure arithmetic in a fixed order, so the same rows give byte-identical coefficients.
 */
export function fitOrderedLogit(rows: readonly OrderedLogitRow[], options: OrderedLogitOptions = {}): OrderedLogitFit {
  const l2 = options.l2 ?? 0;
  const d = rows[0]?.features.length ?? 0;
  const size = CUTS + d;
  if (rows.length === 0) throw new Error("Cannot fit an ordered logit without rows");

  // Start at the marginal cut points with no effect from the features.
  const counts = [0, 0, 0, 0];
  for (const { outcome } of rows) counts[outcome]!++;
  let cumulative = 0;
  let params = Array.from({ length: size }, (_, i) => {
    if (i >= CUTS) return 0;
    cumulative += counts[i]!;
    const share = Math.min(Math.max(cumulative / rows.length, 0.01), 0.99);
    return Math.log(share / (1 - share));
  });
  for (let i = 1; i < CUTS; i++) if (params[i]! <= params[i - 1]!) params[i] = params[i - 1]! + 0.1;

  let current = negativeLogLikelihood(params, rows, l2)!;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const gradient = new Array<number>(size).fill(0);
    const hessian = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    for (const { features, outcome } of rows) {
      const eta = linearPredictor(params.slice(CUTS), features);
      // P(outcome) = F(a_upper) − F(a_lower), a = cut − η; each term is F(u·params) for a direction u in parameter space.
      const terms: { sign: number; cut: number }[] = [];
      if (outcome < CUTS) terms.push({ sign: 1, cut: outcome });
      if (outcome > 0) terms.push({ sign: -1, cut: outcome - 1 });
      let probability = outcome === CUTS ? 1 : 0;
      const directed = terms.map(({ sign, cut }) => {
        const u = new Array<number>(size).fill(0);
        u[cut] = 1;
        for (let j = 0; j < d; j++) u[CUTS + j] = -features[j]!;
        const F = sigmoid(params[cut]! - eta);
        probability += sign * F;
        return { sign, u, f: F * (1 - F), fPrime: F * (1 - F) * (1 - 2 * F) };
      });
      probability = Math.max(probability, 1e-300);
      for (const { sign, u, f } of directed) for (let i = 0; i < size; i++) gradient[i]! -= (sign * f * u[i]!) / probability;
      // ∇²(−log p) = −∇²p / p + ∇p ∇pᵀ / p²
      const slope = new Array<number>(size).fill(0);
      for (const { sign, u, f } of directed) for (let i = 0; i < size; i++) slope[i]! += sign * f * u[i]!;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          let curvature = 0;
          for (const { sign, u, fPrime } of directed) curvature += sign * fPrime * u[i]! * u[j]!;
          hessian[i]![j]! += slope[i]! * slope[j]! / probability ** 2 - curvature / probability;
        }
      }
    }
    for (let j = CUTS; j < size; j++) {
      gradient[j]! += l2 * params[j]!;
      hessian[j]![j]! += l2;
    }
    const step = solve(hessian, gradient);
    let scale = 1;
    let next: number[] | undefined;
    let nextValue: number | undefined;
    while (scale > 1e-12) {
      const candidate = params.map((p, i) => p - scale * step[i]!);
      const value = negativeLogLikelihood(candidate, rows, l2);
      if (value !== undefined && value <= current) {
        next = candidate;
        nextValue = value;
        break;
      }
      scale /= 2;
    }
    if (!next) break;
    const moved = Math.max(...step.map((s) => Math.abs(scale * s)));
    params = next;
    current = nextValue!;
    if (moved < TOLERANCE) break;
  }
  return { coefficients: params.slice(CUTS), cutPoints: [params[0]!, params[1]!, params[2]!] };
}

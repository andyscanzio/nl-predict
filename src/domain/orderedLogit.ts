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
  /**
   * Only on a non-proportional OT/SO fit: how far the two OT/SO cut points move per unit of closeness |η|, so cut k is
   * cutPoints[k] + closeness[k − 1]·|η|. Closeness is the Game's distance from an even match on the logit scale.
   */
  closeness?: [number, number];
}

export interface OrderedLogitOptions {
  /** L2 penalty (λ/2)·Σβ² on the coefficients, not the cut points or closeness effects; 0 when omitted. */
  l2?: number;
  /** Fit a partial proportional odds model: the OT/SO cut points get a closeness effect. Off when omitted. */
  closeness?: boolean;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function linearPredictor(coefficients: readonly number[], features: readonly number[]): number {
  let eta = 0;
  for (let i = 0; i < coefficients.length; i++) eta += coefficients[i]! * features[i]!;
  return eta;
}

/**
 * The four Outcome Probabilities of a linear predictor η and the cut points; they sum to 1 and move toward the home side
 * as η rises. With a closeness effect the OT/SO cut points move with |η|; where that would make them cross, the OT/SO
 * outcomes get no probability rather than a negative one.
 */
export function outcomeProbabilitiesOf(
  eta: number,
  cutPoints: readonly [number, number, number],
  closeness?: readonly [number, number],
): OutcomeProbabilities {
  const closenessOf = Math.abs(eta);
  const cut1 = closeness ? Math.max(cutPoints[1] + closeness[0] * closenessOf, cutPoints[0]) : cutPoints[1];
  const cut2 = closeness ? Math.max(cutPoints[2] + closeness[1] * closenessOf, cut1) : cutPoints[2];
  const [c0, c1, c2] = [cutPoints[0], cut1, cut2].map((cut) => sigmoid(cut - eta)) as [number, number, number];
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

/**
 * Parameters are [cut 0, cut 1, cut 2, β…] plus, for a closeness fit, [closeness effect on cut 1, on cut 2]. Cut k of a
 * Game is params[k] + effect·|η|, with no effect on cut 0. Undefined when a Game's cut points are not increasing.
 */
function negativeLogLikelihood(params: readonly number[], rows: readonly OrderedLogitRow[], l2: number, d: number): number | undefined {
  if (!(params[0]! < params[1]! && params[1]! < params[2]!)) return undefined;
  const withCloseness = params.length > CUTS + d;
  const beta = params.slice(CUTS, CUTS + d);
  let total = 0;
  for (const { features, outcome } of rows) {
    const eta = linearPredictor(beta, features);
    const cut = (k: number) => (withCloseness && k > 0 ? params[k]! + params[CUTS + d + k - 1]! * Math.abs(eta) : params[k]!);
    if (withCloseness && !(cut(0) < cut(1) && cut(1) < cut(2))) return undefined;
    const upper = outcome === CUTS ? 1 : sigmoid(cut(outcome) - eta);
    const lower = outcome === 0 ? 0 : sigmoid(cut(outcome - 1) - eta);
    total -= Math.log(Math.max(upper - lower, 1e-300));
  }
  for (let j = CUTS; j < CUTS + d; j++) total += 0.5 * l2 * params[j]! ** 2;
  return total;
}

/**
 * Fits the cumulative logit on RL < OTL < OTW < RW by Newton's method with step halving on the penalised negative
 * log-likelihood. Pure arithmetic in a fixed order, so the same rows give byte-identical coefficients.
 */
export function fitOrderedLogit(rows: readonly OrderedLogitRow[], options: OrderedLogitOptions = {}): OrderedLogitFit {
  const l2 = options.l2 ?? 0;
  const d = rows[0]?.features.length ?? 0;
  const closeness = options.closeness ?? false;
  const size = CUTS + d + (closeness ? 2 : 0);
  if (rows.length === 0) throw new Error("Cannot fit an ordered logit without rows");

  // Start at the marginal cut points with no effect from the features.
  const counts = [0, 0, 0, 0];
  for (const { outcome } of rows) counts[outcome]!++;
  let cumulative = 0;
  let params = Array.from({ length: size }, (_, i) => {
    if (i >= CUTS) return 0; // β and closeness effects start at none
    cumulative += counts[i]!;
    const share = Math.min(Math.max(cumulative / rows.length, 0.01), 0.99);
    return Math.log(share / (1 - share));
  });
  for (let i = 1; i < CUTS; i++) if (params[i]! <= params[i - 1]!) params[i] = params[i - 1]! + 0.1;
  if (closeness) {
    // At β = 0 every |η| is 0 and the closeness effects have no gradient: start from the proportional fit instead.
    const proportional = fitOrderedLogit(rows, { l2 });
    params = [...proportional.cutPoints, ...proportional.coefficients, 0, 0];
  }

  let current = negativeLogLikelihood(params, rows, l2, d)!;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const gradient = new Array<number>(size).fill(0);
    const hessian = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    for (const { features, outcome } of rows) {
      const eta = linearPredictor(params.slice(CUTS, CUTS + d), features);
      const sign = Math.sign(eta);
      // P(outcome) = F(a_upper) − F(a_lower), a_k = cut_k + effect_k·|η| − η. Each a is bilinear in the parameters, with
      // gradient u and a second derivative only between its closeness effect and the β (∂|η|/∂β = sign(η)·x).
      const terms: { sign: number; cut: number }[] = [];
      if (outcome < CUTS) terms.push({ sign: 1, cut: outcome });
      if (outcome > 0) terms.push({ sign: -1, cut: outcome - 1 });
      let probability = outcome === CUTS ? 1 : 0;
      const directed = terms.map(({ sign: termSign, cut }) => {
        const effect = closeness && cut > 0 ? params[CUTS + d + cut - 1]! : 0;
        const u = new Array<number>(size).fill(0);
        u[cut] = 1;
        for (let j = 0; j < d; j++) u[CUTS + j] = (effect * sign - 1) * features[j]!;
        if (closeness && cut > 0) u[CUTS + d + cut - 1] = Math.abs(eta);
        const a = params[cut]! + effect * Math.abs(eta) - eta;
        const F = sigmoid(a);
        probability += termSign * F;
        return { sign: termSign, cut, u, f: F * (1 - F), fPrime: F * (1 - F) * (1 - 2 * F), curved: closeness && cut > 0 };
      });
      probability = Math.max(probability, 1e-300);
      for (const { sign: termSign, u, f } of directed) for (let i = 0; i < size; i++) gradient[i]! -= (termSign * f * u[i]!) / probability;
      // ∇²(−log p) = −∇²p / p + ∇p ∇pᵀ / p²
      const slope = new Array<number>(size).fill(0);
      for (const { sign: termSign, u, f } of directed) for (let i = 0; i < size; i++) slope[i]! += termSign * f * u[i]!;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          let curvature = 0;
          for (const { sign: termSign, u, fPrime } of directed) curvature += termSign * fPrime * u[i]! * u[j]!;
          hessian[i]![j]! += slope[i]! * slope[j]! / probability ** 2 - curvature / probability;
        }
      }
      // −f(a)·∇²a / p for the closeness effect × β cross terms.
      for (const { sign: termSign, cut, f, curved } of directed) {
        if (!curved) continue;
        const e = CUTS + d + cut - 1;
        for (let j = 0; j < d; j++) {
          const cross = -(termSign * f * sign * features[j]!) / probability;
          hessian[e]![CUTS + j]! += cross;
          hessian[CUTS + j]![e]! += cross;
        }
      }
    }
    for (let j = CUTS; j < CUTS + d; j++) {
      gradient[j]! += l2 * params[j]!;
      hessian[j]![j]! += l2;
    }
    const step = solve(hessian, gradient);
    let scale = 1;
    let next: number[] | undefined;
    let nextValue: number | undefined;
    while (scale > 1e-12) {
      const candidate = params.map((p, i) => p - scale * step[i]!);
      const value = negativeLogLikelihood(candidate, rows, l2, d);
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
  return {
    coefficients: params.slice(CUTS, CUTS + d),
    cutPoints: [params[0]!, params[1]!, params[2]!],
    ...(closeness && { closeness: [params[CUTS + d]!, params[CUTS + d + 1]!] as [number, number] }),
  };
}

/** Slack for a cumulative probability summed from many parts to count as having reached a percentile. */
const TOLERANCE = 1e-9;

/** The rank (1 = first) where the running total of `distribution` first reaches `target`. */
function rankReaching(distribution: readonly number[], target: number): number {
  let cumulative = 0;
  for (const [index, probability] of distribution.entries()) {
    cumulative += probability;
    if (cumulative >= target - TOLERANCE) return index + 1;
  }
  return distribution.length;
}

/** The middle 80% of a Rank Distribution (index 0 = 1st): the ranks from its 10th to its 90th percentile, both inclusive. */
export function middle80(distribution: readonly number[]): { low: number; high: number } {
  return { low: rankReaching(distribution, 0.1), high: rankReaching(distribution, 0.9) };
}

/** Uncertainty of a paired model comparison, shared by the studies: see study.ts for how #41 set it up. */

/** A seeded generator (mulberry32) so a report is reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? NaN : xs.reduce((sum, x) => sum + x, 0) / xs.length);

export interface Uncertainty {
  /** Challenger minus baseline, pooled over team-seasons; negative means the challenger is better. */
  diff: number;
  /** Baseline's pooled score, for the relative difference. */
  baseline: number;
  /** 95% percentile interval of the cluster bootstrap over team-seasons. */
  low: number;
  high: number;
  /** Two-sided sign-flip test over the team-seasons' differences. */
  p: number;
  /** Seasons where the challenger's pooled difference is negative. */
  seasonsBetter: number;
  /** Two-sided exact sign-flip test over the Seasons' differences: it cannot go below 2 / 2^(Seasons). */
  seasonP: number;
}

/** One team-season's difference, challenger minus baseline: the independent unit of the uncertainty, as in #41. */
export interface TeamSeasonDiff {
  season: number;
  diff: number;
}

/**
 * The uncertainty of the pooled difference over team-seasons: a cluster bootstrap (`resamples` resamples) and a
 * sign-flip test (`signFlips` random flips) over the team-seasons, and an exact sign-flip test over the `seasons`.
 */
export function pairedUncertainty(
  diffs: readonly TeamSeasonDiff[],
  baseline: number,
  seasons: readonly number[],
  { resamples, signFlips, seed }: { resamples: number; signFlips: number; seed: number },
): Uncertainty {
  const values = diffs.map(({ diff }) => diff);
  const n = values.length;
  const observed = mean(values);
  const next = seededRandom(seed);

  // Cluster bootstrap: resample whole team-seasons, since one team's forecasts share a final rank and a schedule.
  const boot = Array.from({ length: resamples }, () => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(next() * n)]!;
    return sum / n;
  }).sort((a, b) => a - b);

  // Sign-flip: under "no difference" each team-season's difference is as likely to have the other sign.
  let extreme = 0;
  for (let i = 0; i < signFlips; i++) {
    let sum = 0;
    for (const value of values) sum += next() < 0.5 ? -value : value;
    if (Math.abs(sum / n) >= Math.abs(observed) - 1e-12) extreme++;
  }

  const seasonDiffs = seasons.map((season) => mean(diffs.filter((d) => d.season === season).map((d) => d.diff)));
  let seasonExtreme = 0;
  for (let flips = 0; flips < 2 ** seasons.length; flips++) {
    const sum = seasonDiffs.reduce((acc, diff, i) => acc + (flips & (1 << i) ? -diff : diff), 0);
    if (Math.abs(sum / seasons.length) >= Math.abs(mean(seasonDiffs)) - 1e-12) seasonExtreme++;
  }

  return {
    diff: observed,
    baseline,
    low: boot[Math.floor(0.025 * resamples)]!,
    high: boot[Math.ceil(0.975 * resamples) - 1]!,
    p: (extreme + 1) / (signFlips + 1),
    seasonsBetter: seasonDiffs.filter((diff) => diff < 0).length,
    seasonP: seasonExtreme / 2 ** seasons.length,
  };
}

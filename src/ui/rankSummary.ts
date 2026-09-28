import { middle80 } from "../domain/middle80.ts";
import { ordinal } from "./rankHistogram.ts";

/** A Rank Distribution boiled down to its most likely rank and its middle 80%. */
export interface RankSummary {
  /** The rank with the highest probability; the better rank on a tie. */
  mostLikely: number;
  /** The first rank whose cumulative probability reaches 10%. */
  low: number;
  /** The first rank whose cumulative probability reaches 90%. */
  high: number;
  /** The exact probability of finishing from `low` to `high`, both inclusive. */
  share: number;
  /** The sentence in full. */
  text: string;
  /** The text around the "80%" that a tooltip can attach to; null when the sentence has no "80%" (a certain rank). */
  around80: { before: string; after: string } | null;
}

/** Slack for a probability summed from many parts to count as certain. */
const TOLERANCE = 1e-9;

/** The most likely rank and middle 80% of a Rank Distribution (index 0 = 1st), with the sentence that says so. */
export function rankSummary(distribution: readonly number[]): RankSummary {
  const peak = Math.max(0, ...distribution);
  const mostLikely = distribution.indexOf(peak) + 1;
  const { low, high } = middle80(distribution);
  const share = distribution.slice(low - 1, high).reduce((sum, probability) => sum + probability, 0);

  if (peak >= 1 - TOLERANCE) return { mostLikely, low, high, share, text: `${ordinal(mostLikely)} in every simulated season`, around80: null };
  const around80 = {
    before: `Most likely ${ordinal(mostLikely)} · `,
    after: low === high ? ` at ${ordinal(low)}` : ` between ${ordinal(low)} and ${ordinal(high)}`,
  };
  return { mostLikely, low, high, share, text: `${around80.before}80%${around80.after}`, around80 };
}

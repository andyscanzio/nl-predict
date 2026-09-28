import { cutLineFor, type CutLine } from "../domain/cutLines.ts";
import { formatPercent } from "./winSplit.ts";

/** One bar of a Rank Distribution histogram. */
export interface RankBar {
  rank: number;
  /** Tooltip and screen-reader text, e.g. "5th: 18%", or "5th: 18% (real 12%)" during a What-If. */
  label: string;
  zone: CutLine;
  /** Height as a share of the team's own highest bar, 0 to 1. */
  height: number;
  /** Height of the Real Projection's chance under a What-If, on the same scale as `height`; null when there is no cap. */
  cap: number | null;
  /** Whether this is the team's projected rank (the `#` column), the one the histogram marks with a tick. */
  projected: boolean;
}

export function ordinal(rank: number): string {
  const lastTwo = rank % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th";
  return `${rank}${suffix}`;
}

/**
 * The bars for a Rank Distribution (index 0 = 1st), with the projected rank flagged. Bars scale to the team's own
 * highest bar. With a `real` distribution that differs from it, both scale to the higher of the two peaks, and each
 * rank with a real chance gets a cap at its height and a label saying the real chance.
 */
export function rankBars(distribution: readonly number[], projectedRank?: number, real?: readonly number[] | null): RankBar[] {
  const differs = !!real && real.some((probability, index) => probability !== distribution[index]);
  const peak = Math.max(0, ...distribution, ...(differs ? real! : []));
  return distribution.map((probability, index) => {
    const realChance = differs ? real![index]! : null;
    const showReal = realChance !== null && (probability > 0 || realChance > 0);
    return {
      rank: index + 1,
      label: `${ordinal(index + 1)}: ${formatPercent(probability)}%${showReal ? ` (real ${formatPercent(realChance)}%)` : ""}`,
      zone: cutLineFor(index + 1),
      height: peak === 0 ? 0 : probability / peak,
      cap: realChance !== null && realChance > 0 ? realChance / peak : null,
      projected: index + 1 === projectedRank,
    };
  });
}

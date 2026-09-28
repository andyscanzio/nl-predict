import { cutLineFor, type CutLine } from "../domain/cutLines.ts";
import { formatPercent } from "./winSplit.ts";

/** One bar of a Rank Distribution histogram. */
export interface RankBar {
  rank: number;
  /** Tooltip and screen-reader text, e.g. "5th: 18%". */
  label: string;
  zone: CutLine;
  /** Height as a share of the team's own highest bar, 0 to 1. */
  height: number;
}

function ordinal(rank: number): string {
  const lastTwo = rank % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th";
  return `${rank}${suffix}`;
}

/** The bars for a Rank Distribution (index 0 = 1st), each scaled to the team's own highest bar. */
export function rankBars(distribution: readonly number[]): RankBar[] {
  const peak = Math.max(0, ...distribution);
  return distribution.map((probability, index) => ({
    rank: index + 1,
    label: `${ordinal(index + 1)}: ${formatPercent(probability)}%`,
    zone: cutLineFor(index + 1),
    height: peak === 0 ? 0 : probability / peak,
  }));
}

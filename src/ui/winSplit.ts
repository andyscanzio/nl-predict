import type { OutcomeProbabilities } from "../domain/outcomes.ts";

/** A probability as a whole percent; "<1" and ">99" keep a remote chance from reading as impossible or certain. */
export function formatPercent(probability: number) {
  if (probability > 0 && probability < 0.005) return "<1";
  if (probability < 1 && probability >= 0.995) return ">99";
  return String(Math.round(probability * 100));
}

/** One side of a Game's win split: its printed percent, and whether its chance is exactly 0 or 1 (shown greyed out). */
export interface SideSplit {
  label: string;
  exact: boolean;
}

/** Slack for a home win probability summed from two parts to count as exactly 0 or 1. */
const EXACT_TOLERANCE = 1e-9;

/**
 * A Game's win split for printing: the home side's chance of winning (regulation or OT/SO) and the away side's.
 * The away figure is the complement of the home one, so the pair always reads as 100.
 */
export function winSplit(outcomes: OutcomeProbabilities): { home: SideSplit; away: SideSplit } {
  const homeWin = outcomes.regulationWin + outcomes.overtimeOrShootoutWin;
  const exact = homeWin < EXACT_TOLERANCE || homeWin > 1 - EXACT_TOLERANCE;
  const home = exact ? (homeWin < 0.5 ? "0" : "100") : formatPercent(homeWin);
  const away = home === "<1" ? ">99" : home === ">99" ? "<1" : String(100 - Number(home));
  return { home: { label: home, exact }, away: { label: away, exact } };
}

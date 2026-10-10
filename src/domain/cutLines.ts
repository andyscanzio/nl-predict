/** Where a rank falls against the Cut Lines. */
export type CutLine = "playoffs" | "play-in" | "eliminated";

/** The last rank that goes straight to the Playoffs, and the last that reaches the Play-In. */
export const PLAYOFF_CUT = 6;
export const PLAY_IN_CUT = 10;

export function cutLineFor(rank: number): CutLine {
  if (rank <= PLAYOFF_CUT) return "playoffs";
  if (rank <= PLAY_IN_CUT) return "play-in";
  return "eliminated";
}

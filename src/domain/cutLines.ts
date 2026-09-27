/** Where a rank falls against the Cut Lines. */
export type CutLine = "playoffs" | "play-in" | "eliminated";

export function cutLineFor(rank: number): CutLine {
  if (rank <= 6) return "playoffs";
  if (rank <= 10) return "play-in";
  return "eliminated";
}

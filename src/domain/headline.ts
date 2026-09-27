import type { ProjectedTableRow } from "./project.ts";
import type { TeamId } from "./types.ts";

export type HeadlineRow = Pick<ProjectedTableRow, "rank" | "teamId" | "movement">;

/** The facts the headline states, read straight off the Projected Table. */
export interface Headline {
  first: TeamId;
  last: TeamId;
  /** The team gaining the most places against its current rank; absent when nobody rises. */
  riser?: { teamId: TeamId; places: number; rank: number };
}

/** Ties on movement go to the better projected rank; the Projected Table itself has no ties. */
export function headlineOf(projectedTable: readonly HeadlineRow[]): Headline | null {
  const first = projectedTable[0];
  const last = projectedTable.at(-1);
  if (!first || !last) return null;

  const riser = projectedTable
    .filter((row) => row.movement > 0)
    .reduce<HeadlineRow | undefined>(
      (best, row) =>
        !best || row.movement > best.movement || (row.movement === best.movement && row.rank < best.rank) ? row : best,
      undefined,
    );

  return {
    first: first.teamId,
    last: last.teamId,
    ...(riser && { riser: { teamId: riser.teamId, places: riser.movement, rank: riser.rank } }),
  };
}

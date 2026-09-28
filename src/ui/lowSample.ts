import { LOW_SAMPLE_GAMES } from "../domain/project.ts";

/** How many teams are Low Sample: none, some, or every one. */
export type LowSampleShare = "none" | "some" | "all";

/** Whether none, some or all of `rows` are Low Sample. */
export function lowSampleShare(rows: { lowSample: boolean }[]): LowSampleShare {
  const count = rows.filter((row) => row.lowSample).length;
  return count === 0 ? "none" : count === rows.length ? "all" : "some";
}

/** "Some teams are low sample, …" or "All teams are low sample, …", without the closing clause. */
export function lowSampleSentence(share: Exclude<LowSampleShare, "none">): string {
  return `${share === "all" ? "All" : "Some"} teams are low sample, with fewer than ${LOW_SAMPLE_GAMES} played games`;
}

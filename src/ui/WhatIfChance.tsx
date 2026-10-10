import { signed } from "./format.ts";
import { formatPercent } from "./winSplit.ts";

/** A printed percent as a number: "<1" counts as 0 and ">99" as 100. */
function printedPercent(probability: number): number {
  const printed = formatPercent(probability);
  return printed === "<1" ? 0 : printed === ">99" ? 100 : Number(printed);
}

/**
 * A chance percent, with its What-If Change from the Real Projection stacked under it when the printed values differ.
 * `rise` says how a rise reads: good (a fall is then bad), bad (a fall is then good) or neutral.
 */
export function WhatIfChance({
  probability,
  real,
  rise,
  unit = "",
}: {
  probability: number;
  /** The Real Projection's chance; absent without a What-If. */
  real: number | undefined;
  rise: "good" | "bad" | "neutral";
  /** Printed after the percent, e.g. "%" where no header says it. */
  unit?: string;
}) {
  const printed = formatPercent(probability);
  const change = real === undefined ? 0 : printedPercent(probability) - printedPercent(real);
  if (change === 0) return <>{printed}{unit}</>;
  const direction = change > 0 ? "up" : "down";
  const tone = rise === "neutral" ? "neutral" : (change > 0) === (rise === "good") ? "good" : "bad";
  return (
    <>
      <span class="visually-hidden">
        {printed} percent, {direction} {Math.abs(change)} from the real projection
      </span>
      <span aria-hidden="true">
        {printed}
        {unit}
      </span>
      <small class={`what-if-change ${tone}`} aria-hidden="true">
        {signed(change)}
      </small>
    </>
  );
}

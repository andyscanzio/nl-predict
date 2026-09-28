import type { WhatIf, WhatIfOutcome } from "../domain/project.ts";

/** The query parameter carrying the What-If, e.g. `?whatif=20271105000001.H,20271105000002.AOT`. */
const WHAT_IF_PARAM = "whatif";

/** Outcome codes from the home side: `H`/`A` win in regulation, `HOT`/`AOT` win in OT/SO. */
const OUTCOME_CODES: Record<string, WhatIfOutcome> = {
  H: "regulationWin",
  HOT: "overtimeOrShootoutWin",
  AOT: "overtimeOrShootoutLoss",
  A: "regulationLoss",
};

const CODES = new Map(Object.entries(OUTCOME_CODES).map(([code, outcome]) => [outcome, code]));

/** The What-If a URL carries. Malformed entries are dropped, and a Game id given twice keeps its last entry. */
export function whatIfFromUrl(url: string | URL): WhatIf {
  const whatIf = new Map<string, WhatIfOutcome>();
  const value = new URL(url).searchParams.get(WHAT_IF_PARAM) ?? "";
  for (const entry of value.split(",")) {
    const [gameId, code, ...rest] = entry.split(".");
    if (!gameId || code === undefined || rest.length > 0 || !Object.hasOwn(OUTCOME_CODES, code)) continue;
    whatIf.set(gameId, OUTCOME_CODES[code]!);
  }
  return whatIf;
}

/** The URL carrying `whatIf`, keeping everything else (including the model); an empty What-If removes the parameter. */
export function urlWithWhatIf(url: string | URL, whatIf: WhatIf): string {
  const next = new URL(url);
  if (whatIf.size === 0) next.searchParams.delete(WHAT_IF_PARAM);
  else next.searchParams.set(WHAT_IF_PARAM, [...whatIf].map(([gameId, outcome]) => `${gameId}.${CODES.get(outcome)}`).join(","));
  return next.href;
}

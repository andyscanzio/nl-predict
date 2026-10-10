/** The Post-Season feature flag from the build-time VITE_PLAYOFFS: on when set, unless empty, "false" or "0". */
export function postSeasonFlag(value: string | undefined): boolean {
  return value !== undefined && !["", "false", "0"].includes(value);
}

/** The Season in progress on a date, by its starting year: Seasons start in autumn, so before July it is still last year's. */
export function seasonFor(date: Date): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

/** A Season's display name, e.g. 2026 → "2026/27". */
export function seasonLabel(season: number): string {
  return `${season}/${String(season + 1).slice(2)}`;
}

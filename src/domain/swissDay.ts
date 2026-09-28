const swissDateFormatter = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Zurich",
});

/** The Swiss (Europe/Zurich) calendar day of an instant, as YYYY-MM-DD. */
export function swissCalendarDay(time: number): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    swissDateFormatter.formatToParts(new Date(time)).find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const HOUR = 3_600_000;

/** Swiss midnight at the end of a Swiss calendar day (YYYY-MM-DD): the first instant of the next one. */
export function swissDayEnd(day: string): Date {
  // Noon UTC is inside the Swiss day (13:00 or 14:00) and 24 hours later inside the next: the boundary lies between them.
  const noon = Date.parse(`${day}T12:00:00Z`);
  let [before, after] = [noon, noon + 24 * HOUR];
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (swissCalendarDay(middle) === day) before = middle;
    else after = middle;
  }
  return new Date(after);
}

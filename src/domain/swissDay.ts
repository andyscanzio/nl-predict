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

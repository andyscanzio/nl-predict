import { SIMULATION_RUNS } from "../domain/seasonSimulation.ts";

/** How the page prints dates, times, Form, expected Points and ranks, so every panel formats them the same way. */

const snapshotTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

/** A Snapshot time in Swiss time, e.g. "27 Sep 2026, 13:33". */
export function formatSnapshotTime(date: Date) {
  return snapshotTime.format(date);
}

const scoreboardTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Zurich",
});

/** Scoreboard-style Snapshot time, e.g. "27.09 13:33". */
export function formatScoreboardTime(date: Date) {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    scoreboardTime.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")} ${part("hour")}:${part("minute")}`;
}

const gameDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Zurich",
});

/** A Game's Swiss calendar date, e.g. "27 Sep". */
export function formatGameDate(date: Date) {
  return gameDate.format(date);
}

const gameTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Zurich",
});

/** A Game's Swiss start time, e.g. "19:45". */
export function formatGameTime(date: Date) {
  return gameTime.format(date);
}

const matchDayHeading = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A match day's Swiss calendar date (YYYY-MM-DD) as e.g. "Tue 29 Sep"; UTC avoids reinterpreting the date. */
export function formatMatchDayHeading(date: string) {
  return matchDayHeading.format(new Date(`${date}T00:00:00Z`));
}

/** A Form in Points per Game, with a dash for no Form. */
export function formatForm(form: number | null) {
  return form === null ? "–" : form.toFixed(2);
}

/** Expected Points to one decimal place. */
export function formatExpectedPoints(points: number) {
  return points.toFixed(1);
}

const ordinalRules = new Intl.PluralRules("en-GB", { type: "ordinal" });
const ORDINAL_SUFFIXES: Partial<Record<Intl.LDMLPluralRule, string>> = { one: "st", two: "nd", few: "rd" };

/** A rank as an ordinal: "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number) {
  return `${n}${ORDINAL_SUFFIXES[ordinalRules.select(n)] ?? "th"}`;
}

/** The Season Simulation's run count as the page prints it, e.g. "10,000". */
export const SIMULATION_RUNS_LABEL = SIMULATION_RUNS.toLocaleString("en-GB");

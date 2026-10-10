/**
 * Turns the line coverage from `npm run coverage` into a shields.io endpoint file, which the deploy publishes next
 * to the site for the README's coverage badge.
 *
 *   npm run coverage-badge                         dist/coverage.json
 *   npm run coverage-badge -- --out path/to.json   somewhere else
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { out: { type: "string", default: "dist/coverage.json" } } });
const summary = JSON.parse(await readFile("coverage/coverage-summary.json", "utf8")) as {
  total: { lines: { pct: number } };
};
const pct = summary.total.lines.pct;
const color = pct >= 90 ? "brightgreen" : pct >= 80 ? "green" : pct >= 70 ? "yellow" : pct >= 60 ? "orange" : "red";
const badge = { schemaVersion: 1, label: "coverage", message: `${Math.floor(pct)}%`, color };
await writeFile(values.out, JSON.stringify(badge) + "\n");
console.log(`Wrote ${values.out}: ${badge.message}`);

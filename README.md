# NL Predict

[![Refresh and deploy](https://github.com/andyscanzio/nl-predict/actions/workflows/refresh-and-deploy.yml/badge.svg?branch=main)](https://github.com/andyscanzio/nl-predict/actions/workflows/refresh-and-deploy.yml)
[![Test](https://github.com/andyscanzio/nl-predict/actions/workflows/test.yml/badge.svg)](https://github.com/andyscanzio/nl-predict/actions/workflows/test.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fandyscanzio.github.io%2Fnl-predict%2Fcoverage.json)](https://andyscanzio.github.io/nl-predict/coverage.json)
[![Snapshot](https://img.shields.io/github/last-commit/andyscanzio/nl-predict/main?path=data%2Fgames.json&label=snapshot)](data/games.json)
[![Live site](https://img.shields.io/badge/live-github.io-blue)](https://andyscanzio.github.io/nl-predict/)
![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Preact](https://img.shields.io/badge/Preact-673AB8?logo=preact&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

Projects the final Regular Season standings of the Swiss ice hockey National League.

**Live site: <https://andyscanzio.github.io/nl-predict/>**

The page shows a Projected Table for the current Season, each team's chances of finishing in the playoff, play-in and elimination spots, how those chances have moved over the Season, the Upcoming Games and the Current Table.

## Projection Models

Every model predicts each Remaining Game from the Games played so far. Pick one on the page, or link to it with `?model=<id>`.

| Model | Id | Idea |
| --- | --- | --- |
| **Elo Model** (default) | `elo` | A running Rating per team, updated after every Game, with a Home Advantage bonus. |
| **Season Rate** | `season-rate` | Each team keeps earning its Points per Game so far, shrunk toward the league average, ignoring venue and opponent. |
| **Matchup Model** | `matchup` | The home team's Home Form against the away team's Away Form, over each team's last five Games at that venue, each shrunk toward the league's home or away average. |
| **Split Form Rate** | `split-form-rate` | Each team earns its Home Form at home and Away Form away, ignoring opponents. Gives Points only, no probabilities. |

The Elo Model carries every team's Rating over from last Season. Its Start switch (`?model=elo-level`) starts every team level at 1500 instead, to show how much last Season shapes the projection.

All models except Split Form Rate give Outcome Probabilities per Game (regulation win, OT/SO win, OT/SO loss, regulation loss), which drive a Season Simulation that plays out the rest of the Season many times to estimate each team's Rank Distribution. The Default Model is the one that scores best in the Back-Test (`npm run backtest`).

The exact terms are defined in [CONTEXT.md](CONTEXT.md); the design decisions behind them are in [docs/adr/](docs/adr/).

## How it works

- **Data.** The only source for results is the unofficial SIHF data API, which a browser cannot call directly (no CORS). A scheduled GitHub Action fetches the Season into [`data/games.json`](data/games.json) and commits it ([ADR 0001](docs/adr/0001-build-time-data-snapshot.md)).
- **Projection.** The page is static. It loads the snapshot and projects the live table in the browser.
- **Projection History.** Replaying the Season for the history charts is too slow for phones, so it is computed during the Vite build and shipped as precomputed data ([ADR 0003](docs/adr/0003-projection-history-recomputed-at-build-time.md)). It is cached in `.cache/` in dev.

## Development

Requires Node 24 or later.

```sh
npm install
npm run dev          # local dev server
npm test             # run the tests (Vitest)
npm run coverage     # run the tests with a coverage summary
npm run typecheck    # TypeScript check
npm run build        # type-check and build to dist/
npm run preview      # serve the built site
```

### Scripts

```sh
npm run snapshot                          # refresh data/games.json for the current Season
npm run snapshot -- --season 2025         # fetch the 2025/26 Season instead
npm run snapshot -- --out path/to.json    # write somewhere else

npm run backtest                          # score every model against data/games.json
npm run backtest -- --in path/to.json     # score against another snapshot
npm run study                             # Season Rate shrinkage study, with bootstrap intervals, over data/local/seasons; report in data/local/
npm run study:matchup                     # Matchup Model shrinkage variants (league, flat, team centre) next to Season Rate and Elo, same reports
```

`data/local/` is gitignored and holds past Season snapshots and study outputs.

### Project layout

```
src/domain/     projection models, Season Simulation, Back-Test, tables
src/snapshot/   turning SIHF API responses into a snapshot
src/ui/         Preact page
scripts/        snapshot, backtest and study CLIs, build-time Projection History plugin
data/           the committed Games snapshot
docs/adr/       architecture decision records
```

## Deployment

[`.github/workflows/refresh-and-deploy.yml`](.github/workflows/refresh-and-deploy.yml) deploys to GitHub Pages:

- At about 23:00 and 07:00 Swiss time it refreshes the snapshot, commits it only if Games changed, and redeploys when they did.
- Pushes to `main` redeploy without refreshing.
- A manual run (`gh workflow run refresh-and-deploy.yml`, or "Run workflow" on the Actions tab) refreshes and always redeploys.

Each deploy also runs the tests with coverage and publishes the result as `coverage.json` next to the site, which the README's coverage badge reads. Pushes that touch only tests don't deploy, so the badge catches up at the next deploy.

The page shows when the snapshot was last changed.

Visits are counted with [GoatCounter](https://www.goatcounter.com/), without cookies or personal data. To keep your own browser out of the counts, open <https://andyscanzio.github.io/nl-predict/#toggle-goatcounter> once.

## Disclaimer

A hobby project, not affiliated with the National League or the SIHF. Results data comes from the unofficial SIHF data API.

The code is released under the [MIT License](LICENSE). The Games data in `data/` comes from SIHF and is not covered by it.

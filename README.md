# NL Predict

Projects the final Regular Season standings of the Swiss ice hockey National League.

**Live site: <https://andyscanzio.github.io/nl-predict/>**

The page shows a Projected Table for the current Season, each team's chances of finishing in the playoff, play-in and elimination spots, how those chances have moved over the Season, the Upcoming Games and the Current Table.

## Projection Models

Every model predicts each Remaining Game from the Games played so far. Pick one on the page, or link to it with `?model=<id>`.

| Model | Id | Idea |
| --- | --- | --- |
| **Elo Model** (default) | `elo` | A running Rating per team, updated after every Game, with a Home Advantage bonus. |
| **Season Rate** | `season-rate` | Each team keeps earning its Points per Game so far, shrunk toward the league average, ignoring venue and opponent. |
| **Matchup Model** | `matchup` | The home team's Home Form against the away team's Away Form, over each team's last five Games at that venue. |
| **Split Form Rate** | `split-form-rate` | Each team earns its Home Form at home and Away Form away, ignoring opponents. Gives Points only, no probabilities. |

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
```

`data/local/` is gitignored and holds past Season snapshots and study outputs.

### Project layout

```
src/domain/     projection models, Season Simulation, Back-Test, tables
src/snapshot/   turning SIHF API responses into a snapshot
src/ui/         Preact page
scripts/        snapshot and backtest CLIs, build-time Projection History plugin
data/           the committed Games snapshot
docs/adr/       architecture decision records
```

## Deployment

[`.github/workflows/refresh-and-deploy.yml`](.github/workflows/refresh-and-deploy.yml) deploys to GitHub Pages:

- At about 23:00 and 07:00 Swiss time it refreshes the snapshot, commits it only if Games changed, and redeploys when they did.
- Pushes to `main` redeploy without refreshing.
- A manual run (`gh workflow run refresh-and-deploy.yml`, or "Run workflow" on the Actions tab) refreshes and always redeploys.

The page shows when the snapshot was last changed.

## Disclaimer

A hobby project, not affiliated with the National League or the SIHF. Results data comes from the unofficial SIHF data API.

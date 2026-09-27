# Game data is snapshotted at build time, not fetched by the browser

The only usable source for National League results is the unofficial SIHF data API (`data.sihf.ch`), which sends no CORS headers and returns a single match day per request (~93 requests for a full Season). A scheduled GitHub Action therefore fetches the Season into a `games.json` snapshot committed to the repo, and the static page reads only that file; all projection logic still runs in the browser.

## Considered Options

- **Public CORS proxy from the browser**: rejected — ~93 requests per page load through a third-party service, fragile and impolite to SIHF.
- **Own proxy (e.g. Cloudflare Worker)**: rejected for now — works, but adds a deployed service to a hobby project and the page stops being truly static.

## Consequences

- Data is only as fresh as the last scheduled run (~23:00 and ~07:00 Swiss time, plus manual trigger); the page must show when the snapshot was taken.
- Committing snapshots gives a free history of past states, which a future back-testing feature relies on.
- Refreshes re-read the Season's date list, re-fetch the last ~7 days and fetch match days the snapshot doesn't have yet; older match days are treated as settled.

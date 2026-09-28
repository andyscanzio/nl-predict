# Projection History is recomputed at build time, not recorded

Projection History (each team's playoff chance and projected Points at the end of every Match Day) is derived from the Games snapshot by replaying the Season during `vite build` and `vite dev`, then shipped to the page as precomputed data. It is never written by the refresh workflow or committed. This amends ADR 0001's "all projection logic runs in the browser": the browser still projects the live table, but history is computed ahead of time because a full replay (about one Season Simulation per Match Day per model, roughly 3 s per model on a laptop) is too slow for phones.

Every Season Simulation, the live table's included, is seeded from the Match Day it is projected as of plus the model, not from the snapshot time. The chart's last point therefore equals the table, and a refresh that brings no new results changes nothing.

## Considered Options

- **Record history from the refresh workflow** into a new committed file: rejected. It adds committed state, freezes old points under whatever model code ran that day, and cannot fill in the Season's past.
- **Recompute in the browser** in a Web Worker: rejected. It needs no build change, but phones would wait several seconds per model.

## Consequences

- Changing a Projection Model rewrites its whole Projection History; the chart shows what the current model would have said, not what the page showed at the time.
- The build gets roughly 10 s slower. The result is cached by a hash of the snapshot, so dev restarts stay fast.
- Reseeding moved the live table's percentages once, by Monte Carlo noise (about ±0.5 points), when this shipped.

# NL Predict

## Live site

https://andyscanzio.github.io/nl-predict/ — deployed by `.github/workflows/refresh-and-deploy.yml`, which refreshes `data/games.json` at about 23:00 and 07:00 Swiss time, commits it only when Games changed and redeploys. Pushes to `main` redeploy without refreshing, but only when they touch the site's code or data (see the `paths` filter in the workflow); docs-, test- or script-only pushes don't deploy.

Manual refresh: `gh workflow run refresh-and-deploy.yml` (or "Run workflow" on the Actions tab). A manual run always redeploys.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for andyscanzio/nl-predict, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Stats-minded fans of the Swiss National League. They care about the models as much as the outcome: they compare Projection Models, read how each one works, check the Back-Test, flip the Elo Model's Start switch, and follow how their team's chances move over the Season. Most visits come from phones.

## Product Purpose

NL Predict projects the final Regular Season table of the Swiss ice hockey National League and each team's chances of finishing in the playoff, play-in and elimination spots, reaching each Post-Season round and becoming Champion. Success means a fan can see where their team is likely to finish, how sure the projection is, and why, and can trust it because the method is visible and tested.

## Positioning

- **Full-season simulation.** The Season Simulation plays out every Remaining Game many times, so the page shows Rank Distributions, Cut Line chances and Post-Season chances, not just a single predicted table.
- **Transparent models.** Every Projection Model is named, explained in plain terms, selectable on the page (`?model=<id>`) and scored in a Back-Test. The Default Model is the one that scores best. Nothing is a black box.

## Operating Context

- A static site on GitHub Pages: https://andyscanzio.github.io/nl-predict/. A scheduled GitHub Action refreshes `data/games.json` from the unofficial SIHF data API at about 23:00 and 07:00 Swiss time, so results show up the night of a Game or the next morning.
- The browser projects the live table from the snapshot. Projection History is precomputed at build time because replaying the Season is too slow on phones.
- Page sections: Headline, Projected Table, team detail with Rank Distribution and history charts, Projected Bracket, Upcoming Games with what-if results, Current Table, model explanation.
- Domain vocabulary is fixed in `CONTEXT.md` (Game, Played/Remaining/Upcoming Game, Cut Line, Projected Table, Projected Rank, Headline and so on); UI copy uses those terms and avoids the listed _Avoid_ words.

## Capabilities and Constraints

- Preact + Vite + TypeScript, static, no backend. Light and dark themes, with a stored choice applied before first paint.
- Projection Models: Elo Model (default, with a level-start variant), Season Rate, Matchup Model, Split Form Rate (Points only, no probabilities). A Learned Model is being studied.
- English only. No German, French or Italian versions planned.
- Phone-first: the phone layout leads, and desktop extends it.
- No club or league branding: teams are shown by name only, with no club logos or National League/SIHF marks.
- Not affiliated with the National League or the SIHF; data comes from the unofficial SIHF API.

## Brand Commitments

- Name: **NL Predict** (wordmark currently "NL ● Predict").
- Voice: precise and plain, following `CONTEXT.md` terminology; claims about chances are probabilistic, never certain.
- A hobby project, independent and free. Visits are counted with cookieless GoatCounter only.

## Evidence on Hand

- Real Games data for the current Season in `data/games.json`; past Seasons and study reports in the gitignored `data/local/`.
- Back-Test scores (`npm run backtest`) and model studies (`scripts/*Study.ts`), with design decisions in `docs/adr/`.
- Test coverage published as `coverage.json` with the site.
- No testimonials, user numbers, press or endorsements exist; never invent them.

## Product Principles

1. **Show the uncertainty.** Chances and distributions over single answers; a Projected Rank never pretends to be a certainty.
2. **Every number is explainable.** A fan can find out which model produced a figure and how.
3. **Earn trust with tests, not claims.** Model choices rest on the Back-Test and studies, and the page says so.
4. **Phone first, data dense.** Fit serious statistics on a small screen without hiding them.
5. **One vocabulary.** The terms in `CONTEXT.md` mean the same thing in code, docs and on the page.

## Accessibility & Inclusion

Target WCAG 2.2 AA, including colour-blind-safe encodings for chances, tiers and chart series (never colour alone), and support for both light and dark themes.

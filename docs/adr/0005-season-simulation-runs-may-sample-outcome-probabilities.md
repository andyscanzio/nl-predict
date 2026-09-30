# Each Season Simulation run may sample its own Outcome Probabilities: the Elo Model's Rating Uncertainty

Before this change, the Season Simulation played every run from the same Outcome Probabilities, as if the model's view of each team were exact. That view is only an estimate. With a level start this did little harm, because the teams are close to level early on. With Starting Ratings carried over (ADR 0004), it made early Rank Distributions overconfident: in the first 13 Games, 28% of actual ranks fell in the outer tenths of the forecast, against about 20% for a calibrated forecast.

A Projection Model with Outcome Probabilities may now also give a sampler (`sampleOutcomes`), which the Season Simulation calls once per run for that run's Outcome Probabilities. The Elo Model uses it for Rating Uncertainty: each run moves every team's Rating by its own draw from N(0, σ), with σ = 50, before predicting the Remaining Games. This amends ADR 0002: a model still predicts one set of Outcome Probabilities per Game for projected Points, the Back-Test and the Next Round. Only the Season Simulation's runs may differ from it.

σ was tuned by pooled Rank RPS on the training Seasons of each fold of the Starting Rating study, then on 2023/24 to 2025/26 for the shipped value. With it, early outer tenths fell back to 21.8%, pooled Rank RPS improved from 0.0829 to 0.0821, and Cut Line Brier from 0.3629 to 0.3587.

## Considered Options

- **Lower the carry-over share instead**: rejected. It would give up per-Game accuracy to hide a flaw in the simulation.
- **Hot simulation** (update Ratings with K inside each run): rejected. The earlier hot-simulation study (#41) found it no better for the Elo Model. Its spread also comes from K, not from how far the Ratings may be off.
- **A σ that shrinks with Games played**: rejected (#102). A team's σ would fall with its own Played Games n as σ₀·√(n₀/(n₀+n)). The Starting Rating study tuned σ₀ over 0–150 and n₀ over {4, 8, 13, 26, 52, 104, ∞} per fold and compared the shrinking σ with a constant σ re-tuned over the same σ₀ range (#106). The ship rule, agreed before running, required a better pooled Rank RPS and a better Rank RPS in at least 2 of the 3 test Seasons. The shrinking σ did neither:
  - Pooled Rank RPS was 0.0823 against 0.0821.
  - Per Season, 2023/24, 2024/25 and 2025/26 scored 0.0830, 0.0890 and 0.0744 against 0.0830, 0.0884 and 0.0744.
  - The pooled difference was +0.0002, with a paired 95% cluster-bootstrap interval of −0.0001 to +0.0005.
  
  It did bring late-Season outer tenths closer to Level + σ (13.5% against 11.6% at Games 27–39), but at no gain in Rank RPS or Cut Line Brier. `createEloModel` keeps the option (`ratingUncertaintyHalfLife`), off by default, and the site's Elo Model stays at a constant σ = 50.

## Consequences

- The sampler draws from a second generator, seeded from the same Match Day and model. The Games' and ties' draws are unchanged, so a model without a sampler gives the same numbers as before. A What-If also keeps the Real Projection's Rating draws, so What-If Change still shows only the What-If Results.
- The Elo Model's Season Simulation does about one Outcome Probabilities calculation per Remaining Game per run, so it takes longer in the browser and in the build's Projection History.

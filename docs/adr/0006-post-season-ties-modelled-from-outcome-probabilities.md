# Post-Season ties are modelled from Outcome Probabilities, with a Play-In tie played as one neutral Game

The Playoff Simulation and the Projected Bracket need a winner for every Play-In tie and Playoff Game, but every Projection Model predicts only Outcome Probabilities (ADR 0002), never goals. A Playoff Game is easy: overtime is sudden death with no shootout, so the home team wins with its regulation-win plus OT/SO-win probability at that venue, and a best-of-seven series alternates venues from the better-ranked team's home. A Play-In tie is not: since 2024/25 it is a home-and-away pair decided on aggregate goals, with a draw possible in the first Game.

We play each Play-In tie as one Game on neutral ice: a team's chance of winning it is the mean of its win chances (regulation plus OT/SO) at home and away against that opponent. Home ice roughly cancels over the two legs, and no goal margins are invented.

## Considered Options

- **A goals model (e.g. Poisson scores)**: rejected for now. It would be a new modelling layer that no Projection Model has been fitted or back-tested for, only to decide two ties a Season.
- **Two Games plus a neutral decider on a split**: rejected. Without margins it treats a one-goal loss in the first leg like a heavy one, and it gives a team that wins one leg 50% regardless of strength.

## Consequences

- The tie's chance is approximate: it ignores that a big first-leg margin all but settles the tie, so it probably understates how often the stronger team goes through. Changing it later changes every Round Chance and Projected Bracket.
- The Projected Bracket computes each tie's chance exactly from the model's point Outcome Probabilities (no Rating Uncertainty), the same rule the Playoff Simulation samples from, and advances the favourite.
- The Playoff Simulation draws its Post-Season from its own generator, so Rank Distributions, Cut Line chances and What-If Change are unchanged by it.

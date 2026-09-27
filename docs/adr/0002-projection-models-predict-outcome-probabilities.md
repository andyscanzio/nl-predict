# Projection Models predict Outcome Probabilities per Game, with Split Form Rate as a Points-only exception

A Projection Model's core job is to give Outcome Probabilities (regulation win, OT/SO win, OT/SO loss, regulation loss) for each Remaining Game; a team's projected Points are the sum of its expected Points over those Games. This lets any model drive a Season Simulation for Cut Line and first-place chances, lets the Back-Test score every model with a Brier score on the same footing, and makes every Game hand out exactly 3 Points. Split Form Rate predicts each team's side of a Game independently, so it cannot give coherent Outcome Probabilities; it is kept as a Points-only model, scored by Points MAE only and shown without probability columns.

## Considered Options

- **Keep models returning projected Points per team**: rejected — the Season Simulation would need a second, separate interface, and opponent-aware models could not be compared on probability quality.
- **Invent Outcome Probabilities for Split Form Rate** (treat each side's Form as its share of the split): rejected — the two sides need not sum to 3 Points, so the probabilities would be incoherent.
- **Retire Split Form Rate** once the Matchup Model exists: rejected for now — it is the page's original, most explainable model and remains useful for comparison.

## Consequences

- Every screen that shows probabilities must handle a model that has none.
- Split Form Rate can compete for Default Model only on Points MAE, not Brier score.

# Post-Season Games fix the bracket but never update Ratings

Once the Regular Season ends, the snapshot also loads the real Play-In and Playoff results, so the Playoff Simulation and the Projected Bracket fix decided ties and carry series on from their real score. Those Post-Season Games are not Games: they never feed Points, Form, the Current Table, Match Days, the Back-Test or the Elo Model's Ratings. Every Post-Season tie still to be played is predicted from the Ratings (and Form) as they stood after the last Regular Season Game.

An Elo Model would usually learn from every Game, so this is deliberate. The Post-Season is about 40 Games a Season, against 364 in the Regular Season. Feeding them to the Ratings would change the Carried-Over Start (ADR 0004): each team's Starting Rating would then depend on how far it went in the Playoffs, and `data/starting-ratings.json`, the Starting Rating study and every Back-Test built on it would have to be redone, without a study showing that Post-Season Games predict next Season any better.

## Considered Options

- **Update Ratings during the Post-Season only, not carried over**: rejected for now. Later ties would gain a little from current form, but Rating Uncertainty already covers part of that, and there would be two rules for when a Game counts.
- **Update Ratings and carry them over**: rejected. It changes the Carried-Over Start and every study tuned on it, unmeasured.

## Consequences

- Within the Post-Season, a team on a hot run is still rated on its Regular Season. Round Chances move only through real results fixing ties and series.
- The Season Simulation's random draws are seeded by the latest Match Day, which is a Regular Season concept, so after the Regular Season the draws stay fixed and only tie chances change with each new Post-Season result.
- Changing this later means regenerating the Starting Ratings and rerunning the Starting Rating study.

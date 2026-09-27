# NL Predict

Projects the final regular-season standings of the Swiss ice hockey National League from each team's recent home and away form.

## Language

### League

**Season**:
One National League campaign spanning two calendar years (e.g. 2026/27), identified by the year it starts. Chosen automatically from today's date unless explicitly overridden.
_Avoid_: Year, campaign

**Regular Season**:
The 52-game-per-team phase of a Season whose final table is what we project; playoffs are out of scope.
_Avoid_: Qualification, league phase

**Game**:
One scheduled or played Regular Season fixture between a home team and an away team.
_Avoid_: Match, fixture

**Played Game**:
A Game with a final score, including results still awaiting official confirmation.

**Remaining Game**:
Any Regular Season Game that is not a Played Game, regardless of its scheduled date (postponed Games stay Remaining). Played + Remaining always equals 52 per team.

**Decision**:
How a played Game ended: in regulation, in overtime (OT), or in a shootout (SO).
_Avoid_: Result type

**Points**:
Table points earned from a Game: 3 for a regulation win, 2 for an OT/SO win, 1 for an OT/SO loss, 0 for a regulation loss.

### Form

**Form Window**:
A team's most recent played home Games, or most recent played away Games, capped at five each.
_Avoid_: Last N, recent games

**Home Form**:
A team's Points per Game over its home Form Window.

**Away Form**:
A team's Points per Game over its away Form Window.

**Low Sample**:
A Form Window holding fewer than five Games; projections still run but are flagged.

### Projection

**As-Of Date**:
The moment a projection is made from: only Games played up to it count as Played; everything later is Remaining. Defaults to now.

**Current Table**:
The real standings built from Played Games up to the As-Of Date, ordered by Points, then Points per Game, goal difference, goals for, and regulation wins (an approximation of the official SIHF order, which also uses head-to-head).
_Avoid_: Leaderboard, standings (when ambiguous)

**Projected Table**:
The expected final Regular Season standings produced by a Projection Model, ranked by projected Points with ties broken by Current Table position.
_Avoid_: Leaderboard, prediction

**Projection Model**:
A method for turning Home Form, Away Form and the remaining Games into a Projected Table.

**Split Form Rate**:
The Projection Model that adds remaining home Games × Home Form plus remaining away Games × Away Form to current Points, ignoring opponents.

**Matchup Model**:
A (future) Projection Model predicting each remaining Game from the home team's Home Form against the away team's Away Form.

**Monte Carlo Model**:
A (future) Projection Model that simulates each remaining Game many times to yield finishing-position probabilities.

**Cut Lines**:
The Regular Season boundaries: ranks 1–6 go straight to the playoffs, 7–10 to the play-in, 11–14 are eliminated.

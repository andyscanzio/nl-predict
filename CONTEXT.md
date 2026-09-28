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

**Upcoming Game**:
A Remaining Game scheduled to start after the As-Of Date. Remaining Games whose start has passed (in progress, awaiting a result, or postponed without a new date) are not Upcoming.
_Avoid_: Next game, fixture

**Next Round**:
The Upcoming Games on the earliest match day plus each following match day, whole, until at least one full round's worth of Games (half the teams) is included, or none are left.
_Avoid_: Match day (when more than one day is meant), gameweek

**Decision**:
How a played Game ended: in regulation, in overtime (OT), or in a shootout (SO).
_Avoid_: Result type

**Points**:
Table points earned from a Game: 3 for a regulation win, 2 for an OT/SO win, 1 for an OT/SO loss, 0 for a regulation loss. Every Game hands out exactly 3 Points between its two teams.

### Form

**Form Window**:
A team's most recent played home Games, or most recent played away Games, capped at five each.
_Avoid_: Last N, recent games

**Home Form**:
A team's Points per Game over its home Form Window.

**Away Form**:
A team's Points per Game over its away Form Window.

**Low Sample**:
A team with fewer than ten Played Games; its projection still runs under every Projection Model but is flagged.

### Projection

**As-Of Date**:
The moment a projection is made from: only Games played up to it count as Played; everything later is Remaining. Defaults to now.

**Current Table**:
The real standings built from Played Games up to the As-Of Date, ordered by Points, then Points per Game, goal difference, goals for, and regulation wins (an approximation of the official SIHF order, which also uses head-to-head).
_Avoid_: Leaderboard, standings (when ambiguous)

**Projected Table**:
The expected final Regular Season standings produced by a Projection Model, ranked by projected Points with ties broken by Current Table position.
_Avoid_: Leaderboard, prediction

**Projected Gain**:
The Points a Projection Model expects a team to add over its Remaining Games: projected Points minus current Points.
_Avoid_: Remaining Points (that suggests the Points still available to win)

**Projection Model**:
A method for predicting each Remaining Game's outcome from Played Games; summing those predictions over a team's Remaining Games gives its projected Points.

**Split Form Rate**:
The Projection Model that expects each team to earn its Home Form in every remaining home Game and its Away Form in every remaining away Game, ignoring opponents. Because the two sides are predicted independently, a Game's predicted Points need not add up to 3. It yields no Outcome Probabilities, so it cannot drive a Season Simulation.

**Matchup Model**:
A Projection Model predicting each Remaining Game from the home team's Home Form against the away team's Away Form: the home side expects (Home Form + 3 − Away Form) / 2, turned into Outcome Probabilities with the OT/SO Rate. An empty Form Window falls back to the team's other-venue Form; with neither, 1.5.

**Season Rate**:
The baseline Projection Model: each team keeps earning its Points per Game over all its Played Games of the Season, ignoring venue and opponent strength. A Game's home side expects the mean of its own rate and what the away side's rate leaves it, (home rate + 3 − away rate) / 2, turned into Outcome Probabilities with the OT/SO Rate; a team with no Played Games counts as 1.5.

**Elo Model**:
A Projection Model that keeps a Rating per team, updated after every Played Game by the share of its 3 Points each team took against the share its Rating and Home Advantage expected, and predicts each Game's expected Points share from the two Ratings plus Home Advantage, turned into Outcome Probabilities with the OT/SO Rate.

**Rating**:
An Elo Model's running estimate of a team's strength; every team starts the Season level.

**Home Advantage**:
The Rating bonus an Elo Model gives the home team when predicting a Game, and when judging a Played Game to update Ratings.

**Outcome Probabilities**:
A Projection Model's prediction for one Game: the probability of each of the four outcomes from the home team's side (regulation win, OT/SO win, OT/SO loss, regulation loss).

**OT/SO Rate**:
The league-wide share of Played Games decided in overtime or a shootout, used to split a win probability into regulation and OT/SO outcomes.

**Season Simulation**:
Playing out every Remaining Game many times from a Projection Model's Outcome Probabilities, breaking final ties at random, to estimate each team's Rank Distribution.
_Avoid_: Monte Carlo Model

**Rank Distribution**:
A team's probability of finishing at each rank of the final Regular Season table, from a Season Simulation. Its Cut Line chances (Playoffs, Play-in, Eliminated) and first-place chance are sums over it. Summarised by the most likely rank (the better rank on a tie) and the middle 80%: the ranks from its 10th to its 90th percentile.
_Avoid_: Rank spread, finishing chances

**Default Model**:
The Projection Model a visitor sees unless they pick another.

**Back-Test**:
Scoring a Projection Model by predicting every Played Game from only the Games played before it and comparing with the actual result.

**Cut Lines**:
The Regular Season boundaries: ranks 1–6 go straight to the playoffs, 7–10 to the play-in, 11–14 are eliminated.

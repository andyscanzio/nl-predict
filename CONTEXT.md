# NL Predict

Projects the final regular-season standings of the Swiss ice hockey National League from each team's recent home and away form.

## Language

### League

**Season**:
One National League campaign spanning two calendar years (e.g. 2026/27), identified by the year it starts. Chosen automatically from today's date unless explicitly overridden.
_Avoid_: Year, campaign

**Regular Season**:
The 52-game-per-team phase of a Season whose final table is what we project, and which seeds the Post-Season.
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

**Match Day**:
A Swiss calendar day on which at least one Regular Season Game is scheduled or was played.
_Avoid_: Game day, gameweek

**Next Round**:
The Upcoming Games on the earliest Match Day plus each following Match Day, whole, until at least one full round's worth of Games (half the teams) is included, or none are left.
_Avoid_: Match day (when more than one day is meant), gameweek

**Decision**:
How a played Game ended: in regulation, in overtime (OT), or in a shootout (SO).
_Avoid_: Result type

**Points**:
Table points earned from a Game: 3 for a regulation win, 2 for an OT/SO win, 1 for an OT/SO loss, 0 for a regulation loss. Every Game hands out exactly 3 Points between its two teams.

### Post-Season

**Post-Season**:
The Play-In and the Playoffs that follow the Regular Season. Ranks 11–14 (Playouts, relegation) are out of scope.
_Avoid_: Playoffs (when the Play-In is meant too)

**Play-In**:
The two-round contest among Regular Season ranks 7–10 for the last two Playoff places: 7 v 8 (the winner qualifies) and 9 v 10 (the loser is out), then the 7 v 8 loser against the 9 v 10 winner (the winner qualifies). Each tie is a home-and-away pair of Games on aggregate goals; the two qualifiers take Playoff seeds 7 and 8 in their Regular Season order.
_Avoid_: Pre-Playoffs (the format before 2023/24)

**Playoffs**:
Three best-of-seven rounds (quarterfinals, semifinals, final) among Regular Season ranks 1–6 and the two Play-In qualifiers, re-paired by Regular Season rank before every round (best remaining against worst remaining). The better-ranked team hosts the first, third, fifth and seventh Games. Every Post-Season Game has a winner: overtime is sudden death, with no shootout.

**Champion**:
The winner of the Playoff final.

**Playoff Simulation**:
A Season Simulation whose every run carries on past the Regular Season through the Play-In and the Playoffs, with that run's Outcome Probabilities and What-If Results, to estimate each team's chance of reaching each Playoff round and of becoming Champion.
_Avoid_: Post-season simulation, bracket simulation

**Round Chances**:
A team's Playoff Simulation chances of reaching the Quarterfinal (by Cut Line or through the Play-In), the Semifinal and the Final, and of becoming Champion.
_Avoid_: Playoff chance (that is the Cut Line's direct qualification), playoff odds

**Projected Bracket**:
The Play-In and Playoffs as they would go if the Regular Season finished exactly as the Projected Table. Each tie shows its favourite's chance of winning it, and the favourite advances. It answers "if the table ends as projected, who wins?", so it is never a team's title chance; that comes from the Playoff Simulation.
_Avoid_: Predicted bracket, playoff odds

### Form

**Form Window**:
A team's most recent played home Games, or most recent played away Games, capped at five each.
_Avoid_: Last N, recent games

**Home Form**:
A team's Points per Game over its home Form Window.

**Away Form**:
A team's Points per Game over its away Form Window.

**Prior Games**:
The imaginary Games a Projection Model rates a team as if it had also played, at a prior Points per Game, so early or short runs of results count for less. Season Rate uses 10 at the league-average 1.5; the Matchup Model 16 at each venue's league average.

**Home Rate**:
The Matchup Model's rating of a team at home: its Home Form shrunk toward the league's home Points per Game by Prior Games. An empty Form Window gives the league average.

**Away Rate**:
The Matchup Model's rating of a team away: its Away Form shrunk toward the league's away Points per Game by Prior Games. An empty Form Window gives the league average.

**Low Sample**:
A team with fewer than ten Played Games; its projection still runs under every Projection Model but is flagged.

### Projection

**As-Of Date**:
The moment a projection is made from: only Games played up to it count as Played; everything later is Remaining. Defaults to now.

**Current Table**:
The real standings built from Played Games up to the As-Of Date, ordered by Points, then Points per Game (as the official live table does mid-season), then the official National League tie-break: Points in Direct Games, goal difference, goals for, goal difference in Direct Games, goals for in Direct Games, away goals, away goals in Direct Games; then regulation wins and a fixed team order (our own, where the official rule leaves it to NL Operations). Once every team has played all its Games, Points per Game separates no one, so the final table follows the official rule exactly.
_Avoid_: Leaderboard, standings (when ambiguous)

**Direct Games**:
The Played Games among a group of teams level on Points and Points per Game, fixed when the group is first formed and kept even after some of them are separated. When the teams have met each other unequally often, only the smallest number counts for all of them, dropping each pairing's earliest home and away Games by date.
_Avoid_: Head-to-head games, mini-league

**Projected Table**:
The expected final Regular Season standings produced by a Projection Model, ranked by projected Points with ties broken by Current Table position.
_Avoid_: Leaderboard, prediction

**Projected Rank**:
A team's position in the Projected Table. It is a single place, not a probability, so it can differ from the most likely rank of the team's Rank Distribution.
_Avoid_: Expected rank, expected final ranking (that suggests the mean of the Rank Distribution)

**Headline**:
The one-sentence summary of the Projected Table shown above it: who finishes first, who finishes last, and the team climbing the most places, if any.
_Avoid_: Ticker, crawl

**Projected Gain**:
The Points a Projection Model expects a team to add over its Remaining Games: projected Points minus current Points.
_Avoid_: Remaining Points (that suggests the Points still available to win)

**Projection Model**:
A method for predicting each Remaining Game's outcome from Played Games; summing those predictions over a team's Remaining Games gives its projected Points.

**Split Form Rate**:
The Projection Model that expects each team to earn its Home Form in every remaining home Game and its Away Form in every remaining away Game, ignoring opponents. Because the two sides are predicted independently, a Game's predicted Points need not add up to 3. It yields no Outcome Probabilities, so it cannot drive a Season Simulation.

**Matchup Model**:
A Projection Model predicting each Remaining Game from the home team's Home Rate against the away team's Away Rate: the home side expects (Home Rate + 3 − Away Rate) / 2, turned into Outcome Probabilities with the OT/SO Rate.

**Season Rate**:
The baseline Projection Model: each team keeps earning its Points per Game over its Played Games of the Season, ignoring venue and opponent strength, shrunk toward the league-average 1.5 by 10 Prior Games, so early results count for less and the effect fades as the Season goes on. A Game's home side expects the mean of its own rate and what the away side's rate leaves it, (home rate + 3 − away rate) / 2, turned into Outcome Probabilities with the OT/SO Rate.

**Elo Model**:
A Projection Model that keeps a Rating per team, updated after every Played Game by the share of its 3 Points each team took against the share its Rating and Home Advantage expected, and predicts each Game's expected Points share from the two Ratings plus Home Advantage, turned into Outcome Probabilities with the OT/SO Rate.

**Rating**:
An Elo Model's running estimate of a team's strength, starting each Season from its Starting Rating.

**Starting Rating**:
A team's Rating before its first Game of a Season, set by the Elo Model's start: the Carried-Over Start unless a visitor picks the Level Start.
_Avoid_: Seed, seeding (the Season Simulation's random draws are seeded), initial rating, starting rate

**Carried-Over Start**:
The Elo Model's default start: each team's Starting Rating is its Rating at the end of the previous Season, carried over in full, with a promoted team taking over the Starting Rating of the team it replaces (the league average on an expansion).
_Avoid_: Historical start, historical rating

**Level Start**:
The Elo Model's alternative start: every team's Starting Rating is the league-average 1500, so last Season counts for nothing. Everything else about the Elo Model stays the same. It is a variant of the Elo Model, not a Projection Model of its own, so it is never the Default Model.
_Avoid_: Flat start, reset, 1500 start

**Rating Uncertainty**:
How far an Elo Model's Ratings may be off, in Rating points: each Season Simulation run moves every team's Rating by its own random draw of that spread before playing out the Remaining Games, so the Rank Distributions allow for the Ratings being estimates.
_Avoid_: Noise, hot simulation (Ratings updated inside each run, a different idea)

**Home Advantage**:
The Rating bonus an Elo Model gives the home team when predicting a Game, and when judging a Played Game to update Ratings.

**Outcome Probabilities**:
A Projection Model's prediction for one Game: the probability of each of the four outcomes from the home team's side (regulation win, OT/SO win, OT/SO loss, regulation loss).

**OT/SO Rate**:
The league-wide share of Played Games decided in overtime or a shootout, used to split a win probability into regulation and OT/SO outcomes.

**Season Simulation**:
Playing out every Remaining Game many times from a Projection Model's Outcome Probabilities, breaking final ties at random, to estimate each team's Rank Distribution. A model may give each run its own Outcome Probabilities, as the Elo Model does with Rating Uncertainty. Its random draws are fixed by the latest Match Day with a real Played Game as of the As-Of Date and the Projection Model, one per Remaining Game per run, so projecting again with no new results gives the same numbers.
_Avoid_: Monte Carlo Model

**Rank Distribution**:
A team's probability of finishing at each rank of the final Regular Season table, from a Season Simulation. Its Cut Line chances (Playoffs, Play-in, Eliminated) and first-place chance are sums over it. Summarised by the most likely rank (the better rank on a tie) and the middle 80%: the ranks from its 10th to its 90th percentile.
_Avoid_: Rank spread, finishing chances

**Projection History**:
A team's projected Points, Projected Rank and Season Simulation results under one Projection Model, as they stood before the first Game of the Season and at the end of every Match Day played since. It shows what the model as it is today would have said at each point, not what the page showed then, so changing a model changes its whole history.
_Avoid_: Trend, timeline

**What-If Result**:
An outcome a visitor sets for a Game in the Next Round: home or away win, in regulation or OT/SO. The projection treats it as a Played Game won by one goal, in every Projection Model, Form Window and Season Simulation, but it never touches the Current Table or Projection History. It is dropped once the Game is actually Played or leaves the Next Round.
_Avoid_: Forced result, pick, prediction

**What-If**:
The set of What-If Results a visitor currently has; while it is non-empty, the Projected Table and Headline show the What-If projection rather than the Real Projection, and the Projected Table shows each What-If Change.
_Avoid_: Scenario, simulation (that is the Season Simulation)

**Real Projection**:
The projection made with no What-If, from real Played Games only.

**What-If Change**:
How far a team's projected rank, projected Points, a chance or its Rank Distribution moves from the Real Projection to the What-If projection under the same Projection Model. The What-If projection's Season Simulation reuses the Real Projection's random draws, so a team the What-If Results do not reach shows no What-If Change.
_Avoid_: Delta, impact, swing

**Default Model**:
The Projection Model a visitor sees unless they pick another: the one that scores best in the Back-Test, which is why the page can call it best in back-test.

**Back-Test**:
Scoring a Projection Model by predicting every Played Game from only the Games played before it and comparing with the actual result.

**Season Simulation Back-Test**:
Scoring an outcome Projection Model's Rank Distributions over a complete Season against where each team actually finished in the final Current Table, at every Projection History point except the last. Each team at each point gets a Rank RPS, a Cut Line Brier and whether it finished in the Outer Tenths. Points-only models have none (ADR 0002).

**Rank RPS**:
A Rank Distribution's score for one team: the mean, over ranks 1 to K−1 for K teams, of the squared difference between the forecast and actual cumulative rank probabilities (0 is perfect).

**Cut Line Brier**:
A Rank Distribution's score for one team against its Cut Line: the squared error summed over Playoffs, Play-in and Eliminated (0 is perfect, 2 the worst).

**Outer Tenths**:
Where a team's actual final rank falls at the extremes of its Rank Distribution: the chance of finishing above it plus half the chance of finishing at it is below 0.1 or above 0.9. A calibrated forecast spread over many ranks lands there for about 20% of teams, so much more means it was overconfident; a forecast concentrated on a few ranks, as late in the Season, scores lower even when calibrated. Unlike the middle 80%, it is not flattered by a forecast that puts its weight on a few ranks.

**Cut Lines**:
The Regular Season boundaries: ranks 1–6 go straight to the playoffs, 7–10 to the play-in, 11–14 are eliminated. A Cut Line's "Playoffs" always means direct qualification; reaching the Playoffs by either route is the Quarterfinal chance.

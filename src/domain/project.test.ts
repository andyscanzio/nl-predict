import { describe, expect, it } from "vitest";
import { eloModel } from "./eloModel.ts";
import { matchupModel } from "./matchupModel.ts";
import { seasonRate } from "./seasonRate.ts";
import { project, SEASON_START } from "./project.ts";
import { splitFormRate } from "./splitFormRate.ts";
import type { Decision, Game } from "./types.ts";

const asOf = new Date("2026-10-01T12:00:00+02:00");

let nextId = 1;
function played(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  decision: Decision = "regulation",
  startsAt = "2026-09-20T19:45:00+02:00",
): Game {
  return {
    id: String(nextId++),
    startsAt,
    homeTeamId,
    awayTeamId,
    result: { homeGoals, awayGoals, decision },
  };
}

function scheduled(homeTeamId: number, awayTeamId: number, startsAt: string): Game {
  return { id: String(nextId++), startsAt, homeTeamId, awayTeamId };
}

function pointsByTeam(games: Game[]) {
  return Object.fromEntries(
    project(games, asOf, splitFormRate).currentTable.map((row) => [row.teamId, row.points]),
  );
}

function currentTableOrder(games: Game[]) {
  return project(games, asOf, splitFormRate).currentTable.map((row) => row.teamId);
}

describe("project: Current Table", () => {
  it("awards 3 Points for a regulation win and 0 for a regulation loss", () => {
    expect(pointsByTeam([played(1, 2, 4, 2)])).toEqual({ 1: 3, 2: 0 });
  });

  it("awards 2 Points for an OT win and 1 for an OT loss", () => {
    expect(pointsByTeam([played(1, 2, 2, 3, "OT")])).toEqual({ 1: 1, 2: 2 });
  });

  it("awards 2 Points for an SO win and 1 for an SO loss", () => {
    expect(pointsByTeam([played(1, 2, 3, 2, "SO")])).toEqual({ 1: 2, 2: 1 });
  });

  it("sums Points over all Played Games, home and away", () => {
    const games = [
      played(1, 2, 4, 2), // 1: +3
      played(2, 1, 3, 2, "OT"), // 1: +1, 2: +2
      played(3, 1, 0, 1), // 1: +3
    ];
    expect(pointsByTeam(games)).toEqual({ 1: 7, 2: 2, 3: 0 });
  });

  it("orders the Current Table by Points and assigns ranks", () => {
    const games = [played(1, 2, 1, 3), played(3, 1, 2, 1, "SO"), played(2, 3, 5, 0)];
    const table = project(games, asOf, splitFormRate).currentTable;
    expect(table.map((row) => [row.rank, row.teamId, row.points])).toEqual([
      [1, 2, 6],
      [2, 3, 2],
      [3, 1, 1],
    ]);
  });

  it("breaks Current Table ties on Points by Points per Game", () => {
    const games = [
      played(3, 4, 2, 1, "OT"), // 3: +2, 4: +1
      played(4, 3, 2, 1, "OT"), // 3: +1, 4: +2 → both 3 Points in 2 Games
      played(1, 2, 4, 2), // 1: 3 Points in 1 Game
    ];
    // 3 and 4 are level on every tie-break, so only team 1 leading is asserted.
    expect(currentTableOrder(games)[0]).toBe(1);
  });

  // Art. 6.2, "Weisungen für den Spielbetrieb der National League, Saison 2026/27" (02.09.2026), official step 1.
  it("breaks a two-team tie on Points and Points per Game by Points in Direct Games, even against the overall goal difference", () => {
    const games = [
      played(1, 2, 1, 0), // Direct Game: 1 beats 2, so 1 leads the Direct Games Points despite the worse overall goal difference below
      played(1, 3, 0, 5), // 1's other Game: a heavy loss, GD -5
      played(2, 4, 5, 0), // 2's other Game: a heavy win, GD +5
    ];
    // Overall goal difference favours 2 (+4) over 1 (-4); Direct Games Points (1 beat 2) still settles it for 1.
    expect(currentTableOrder(games)).toEqual([3, 1, 2, 4]);
  });

  // Art. 6.2, official step 1: three or more level teams are ranked by a mini-table of their Direct Games.
  it("ranks three teams level on Points and Points per Game by a mini-table of their Direct Games", () => {
    const games = [
      // The mini-table among 1, 2 and 3: 1 beats both, 2 beats 3 — a clear order of Direct Games Points 6, 2, 1.
      played(1, 2, 3, 0),
      played(1, 3, 4, 0),
      played(2, 3, 2, 1, "OT"),
      // Other Games bring all three to 6 Points in 4 Games (Points per Game 1.5), so the mini-table alone decides.
      played(4, 1, 5, 0),
      played(5, 1, 5, 0),
      played(2, 6, 3, 0),
      played(7, 2, 2, 1, "OT"),
      played(3, 8, 4, 0),
      played(3, 9, 3, 2, "OT"),
    ];
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2 || id === 3)).toEqual([1, 2, 3]);
  });

  // Art. 6.2, official step 1: teams that have met each other unequally often count only the Group's smallest number
  // of meetings, for every pairing — dropping 1 and 2's earliest home and away legs changes who leads the mini-table.
  it("trims a pairing that met more often than the rest of the Group to the smallest number of meetings", () => {
    const games = [
      // 1 and 2 meet 4 times, twice as many as either meets 3: the Group's smallest count (2) governs, so only 1's
      // later home leg (a 2 win) and 2's later away leg (also a 2 win) count for 1 vs 2, worth 0 Points to 1, 6 to 2.
      played(1, 2, 5, 0, "regulation", "2026-09-01T19:45:00+02:00"), // earliest home leg: dropped
      played(2, 1, 0, 5, "regulation", "2026-09-02T19:45:00+02:00"), // earliest away leg: dropped
      played(1, 2, 0, 3, "regulation", "2026-09-20T19:45:00+02:00"), // latest home leg: kept, 2 wins
      played(2, 1, 3, 0, "regulation", "2026-09-21T19:45:00+02:00"), // latest away leg: kept, 2 wins
      // 1 vs 3, once each way: 3 Points each, so 3 in Direct Games so far.
      played(1, 3, 3, 0, "regulation", "2026-09-05T19:45:00+02:00"),
      played(3, 1, 3, 0, "regulation", "2026-09-06T19:45:00+02:00"),
      // 2 vs 3, once each way: 3 Points each too.
      played(2, 3, 3, 0, "regulation", "2026-09-07T19:45:00+02:00"),
      played(3, 2, 3, 0, "regulation", "2026-09-08T19:45:00+02:00"),
      // Filler Games bring all three to 9 Points in 6 Games (Points per Game 1.5).
      played(3, 10, 3, 0),
      played(11, 3, 3, 0),
    ];
    // Trimmed Direct Games Points: 2 gets 3 (vs 3) + 6 (vs 1, kept legs only) = 9; 3 gets 3 + 3 = 6; 1 gets
    // 3 (vs 3) + 0 (vs 2, kept legs only) = 3. Counting all 4 Games against 1 vs 2 would instead tie 1 and 2 at 9.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2 || id === 3)).toEqual([2, 3, 1]);
  });

  // Art. 6.2, official step 1: when the Group's smallest number of meetings is odd, the two legs kept for a pairing
  // can't split evenly; the extra home Game dropped is the earliest of the club with more home Games in the pairing.
  it("drops the extra home Game of the club with more home Games, when the smallest meeting count is odd", () => {
    const games = [
      // 1 hosts 2 three times, 2 hosts 1 only twice: 1 is the club with more home Games in this pairing. The Group's
      // smallest count (3, from 1 vs 3 and 2 vs 3 below) trims this pairing from 5 to 3, dropping 1's two earliest
      // home legs — both, since the count to keep is odd, so the two legs can't split evenly (1 vs 2 home each).
      played(1, 2, 5, 0, "regulation", "2026-09-01T19:45:00+02:00"), // 1's earliest home leg: dropped
      played(1, 2, 5, 0, "regulation", "2026-09-05T19:45:00+02:00"), // 1's 2nd-earliest home leg: dropped
      played(1, 2, 0, 3, "regulation", "2026-09-25T19:45:00+02:00"), // 1's latest home leg: kept, 2 wins
      played(2, 1, 3, 0, "regulation", "2026-09-10T19:45:00+02:00"), // 2's home leg: kept, 2 wins
      played(2, 1, 3, 0, "regulation", "2026-09-15T19:45:00+02:00"), // 2's home leg: kept, 2 wins
      // 1 vs 3, three Games: 1 wins the home leg, 3 wins both away legs.
      played(1, 3, 3, 0, "regulation", "2026-09-02T19:45:00+02:00"),
      played(3, 1, 3, 0, "regulation", "2026-09-03T19:45:00+02:00"),
      played(3, 1, 3, 0, "regulation", "2026-09-04T19:45:00+02:00"),
      // 2 vs 3, three Games: 2 wins one, 3 wins the other two.
      played(2, 3, 3, 0, "regulation", "2026-09-06T19:45:00+02:00"),
      played(3, 2, 3, 0, "regulation", "2026-09-07T19:45:00+02:00"),
      played(3, 2, 0, 3, "regulation", "2026-09-08T19:45:00+02:00"),
      // Filler Games bring all three to 15 Points in 10 Games (Points per Game 1.5).
      played(1, 30, 3, 0),
      played(31, 1, 0, 3),
      played(2, 32, 0, 3),
      played(33, 2, 3, 0),
      played(3, 34, 3, 0),
      played(35, 3, 0, 3),
      played(3, 36, 0, 3),
      played(37, 3, 3, 0),
    ];
    // Trimmed, 1 gets 0 (all 3 kept legs against 2 are losses) + 3 (vs 3) = 3; 2 gets 9 (all 3 kept legs against 1
    // are wins) + 6 (vs 3) = 15; 3 gets 6 (vs 1) + 3 (vs 2) = 9. Counting all 5 Games against 1 vs 2 would instead
    // tie all three at 9, since 1's two dropped home losses are exactly offset by its two dropped-Game absences.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2 || id === 3)).toEqual([2, 3, 1]);
  });

  // Art. 6.2, official step 1: a Group containing a team that has met none of the others has a smallest meeting
  // count of 0, so Points in Direct Games decides nothing for anyone in the Group, not only for the pair that hasn't met.
  it("decides a Group without head-to-head when one team has met none of the others", () => {
    const games = [
      played(1, 2, 5, 0, "regulation", "2026-09-01T19:45:00+02:00"), // 1 beats 2 — would favour 1 if it counted
      played(3, 1, 5, 0, "regulation", "2026-09-02T19:45:00+02:00"), // 3 beats 1 — would favour 3 if it counted
      // 2 and 3 never meet, so the Group's smallest meeting count is 0 and Direct Games Points settles nothing.
      played(2, 40, 3, 0), // brings 2 to 3 Points in 2 Games (Points per Game 1.5), GD -5 + 3 = -2
      played(41, 3, 3, 0), // brings 3 to 3 Points in 2 Games (Points per Game 1.5), GD +5 - 3 = +2
    ];
    // 1: 3 Points in 2 Games, GD +5 - 5 = 0; 2: GD -2; 3: GD +2. Goal difference over all Games settles it: 3, 1, 2 —
    // not the 1-over-2, 3-over-1 order the two head-to-head results would each suggest on their own.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2 || id === 3)).toEqual([3, 1, 2]);
  });

  // Art. 6.2, official steps 1-2: Direct Games level on Points fall through to goal difference over all Games.
  it("falls through a Direct Games tie on Points to goal difference over all Games", () => {
    const games = [
      played(1, 2, 3, 0), // Direct Games: 1 wins the home leg, 2 wins the away leg — level at 3 Points each
      played(2, 1, 3, 0),
      played(1, 3, 5, 0), // 1's other Game: a 5-0 win, GD +5
      played(4, 2, 1, 5), // 2's other Game: a 5-1 win, GD +4
    ];
    // Both level on Points in Direct Games (3 each) and on overall goals for (8 each); goal difference (5 vs 4) decides.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2)).toEqual([1, 2]);
  });

  // Art. 6.2, official steps 1-3: teams with no Direct Games skip straight to goal difference, then goals for.
  // Outcome unchanged from before Direct Games were added: 1 and 3 have never met, so Points in Direct Games decides nothing.
  it("breaks Current Table ties on Points per Game by goal difference, when the tied teams have no Direct Games", () => {
    const games = [played(1, 2, 1, 0), played(3, 4, 5, 0)];
    expect(currentTableOrder(games)).toEqual([3, 1, 2, 4]);
  });

  // Points per Game runs ahead of the official Art. 6.2 steps, even when the tied teams have met each other.
  it("breaks Current Table ties on Points per Game before Points in Direct Games, when Games played differ", () => {
    const games = [
      played(2, 1, 3, 0), // their only meeting: 2 beats 1 — Direct Games alone would favour team 2
      played(1, 3, 5, 0), // 1's other Game lifts it to 1.5 Points per Game over 2 Games
      played(4, 2, 3, 0), // 2's other Games keep it at 1.0 Points per Game over 3 Games
      played(5, 2, 3, 0),
    ];
    // Team 1's higher Points per Game (1.5 vs 1.0) settles it before Direct Games are even considered.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2)).toEqual([1, 2]);
  });

  it("breaks Current Table ties on goal difference by goals for", () => {
    const games = [played(1, 2, 1, 0), played(3, 4, 4, 3)];
    expect(currentTableOrder(games)).toEqual([3, 1, 4, 2]);
  });

  // Art. 6.2, official step 4: a Direct Games tie on goal difference and goals for over all Games falls to goal
  // difference in the Group's Direct Games.
  it("breaks a Current Table tie on goal difference and goals for over all Games by goal difference in Direct Games", () => {
    const games = [
      played(1, 2, 3, 0), // Direct Games: 1 wins the home leg 3-0, 2 wins the away leg 1-0 — level at 3 Points each
      played(2, 1, 1, 0),
      // Filler Games bring both to 6 Points in 3 Games with identical overall goal difference (+1) and goals for (9),
      // so steps 2-3 decide nothing; only the Direct Games goal difference (+2 for 1, -2 for 2) is left to settle it.
      played(1, 3, 12, 4),
      played(2, 4, 14, 2),
    ];
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2)).toEqual([1, 2]);
  });

  // Art. 6.2, official step 5: a Direct Games tie on goal difference (as well as Points, and goal difference and
  // goals for over all Games) falls to goals for in Direct Games.
  it("breaks a Current Table tie on goal difference in Direct Games by goals for in Direct Games", () => {
    const games = [
      // The three-team Group's Direct Games: each of 1, 2 and 3 beats one and loses to the other, level at 3 Points
      // in Direct Games (step 1) each.
      played(1, 2, 3, 0),
      played(3, 1, 5, 1),
      played(2, 3, 3, 1),
      // Filler Games bring all three to 6 Points in 4 Games, level on overall goal difference (+2) and goals for (9)
      // too (steps 2-3 decide nothing).
      played(1, 20, 5, 0),
      played(21, 1, 2, 0),
      played(2, 22, 6, 0),
      played(23, 2, 3, 0),
      played(3, 24, 3, 0),
      played(25, 3, 3, 0),
    ];
    // 3's Direct Games goal difference (+2) separates it first (step 4); 1 and 2 stay level on Direct Games goal
    // difference (-1 each), so their Direct Games goals for (4 vs 3) settles it for 1 (step 5).
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2 || id === 3)).toEqual([3, 1, 2]);
  });

  // Art. 6.2, official step 6: a tie through Direct Games, and goal difference and goals for over all Games, falls
  // to away goals over all Games — the goals a team scored as the away team.
  it("breaks a Current Table tie on goal difference and goals for over all Games by away goals over all Games", () => {
    const games = [
      played(1, 2, 3, 0), // Direct Games: 1 wins the home leg, 2 wins the away leg — level at 3 Points, 0 GD, 4 GF
      played(2, 1, 4, 1),
      played(1, 9, 5, 0), // 1's other Game: a home win, no away goals for 1
      played(10, 2, 0, 5), // 2's other Game: an away win, 5 away goals for 2
    ];
    // 1's only away goal (in the Direct Game above) is 1; 2's away goals are 0 (Direct) + 5 (filler) = 5.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2)).toEqual([2, 1]);
  });

  // Art. 6.2, official step 7, the last of the official steps: a tie through away goals over all Games falls to away
  // goals in Direct Games.
  it("breaks a Current Table tie on away goals over all Games by away goals in Direct Games", () => {
    const games = [
      played(1, 2, 3, 0), // Direct Games: 1 wins the home leg, 2 wins the away leg — level at 3 Points, 0 GD, 4 GF
      played(2, 1, 4, 1), // 1 scores 1 away goal here; 2 scores 0 away goals in the other Direct leg
      played(5, 1, 1, 0, "OT"), // Filler Games equalise Points, overall GD (+2), GF (7) and away goals (1) for both
      played(1, 6, 3, 0),
      played(7, 2, 0, 1, "OT"),
      played(2, 8, 2, 1, "OT"),
    ];
    // Both score 1 away goal overall; but of that, 1's came in its Direct Games (against 2) and 2's came from a
    // filler Game, so 2 has 0 away goals in Direct Games against 1's 1.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2)).toEqual([1, 2]);
  });

  // Art. 6.2: a Group partly separated by an earlier step keeps using the original Group's Direct Games for a later
  // step — "(gemäss Kriterien aus Punkt 1)" — never a fresh mini-league of just the teams still tied.
  it("settles the two teams a Group's overall goal difference leaves tied by the original Group's Direct Games", () => {
    const games = [
      // The original three-team Group's Direct Games: each of 1, 2 and 3 beats one and loses to the other, all level
      // at 3 Points in Direct Games (official step 1 decides nothing).
      played(1, 2, 1, 0),
      played(3, 1, 6, 0),
      played(2, 3, 4, 0),
      // Filler Games bring all three to 6 Points in 4 Games (Points per Game 1.5), entering one Group. Team 3's
      // overall goal difference (+2) separates it from 1 and 2, who stay level (-2 each) over all Games.
      played(1, 4, 4, 0),
      played(5, 1, 1, 0),
      played(2, 6, 1, 0),
      played(7, 2, 6, 0),
      played(3, 8, 3, 0),
      played(9, 3, 3, 0),
    ];
    // 1 and 2 are settled by the original three-team Group's Direct Games goal difference (1: -5, 2: +3), so 2 ranks
    // above 1 — the opposite of what a fresh two-team head-to-head on their one meeting (1 wins 1-0) would give.
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2 || id === 3)).toEqual([3, 2, 1]);
  });

  // Art. 6.2: 1 and 2 never meet, so every Direct Games step (1, 4, 5, 7) decides nothing; they are also level on
  // overall goal difference, goals for and away goals (steps 2, 3, 6), so all seven official steps fall through to
  // regulation wins, our own step after them.
  it("breaks Current Table ties on goals for by regulation wins", () => {
    const games = [
      // team 2: OT win + OT loss = 3 Points, 3:3 goals, 1 away goal, no regulation win
      played(2, 5, 2, 1, "OT"),
      played(6, 2, 2, 1, "OT"),
      // team 1: regulation win + regulation loss = 3 Points, 3:3 goals, 1 away goal, one regulation win
      played(1, 7, 2, 1),
      played(8, 1, 2, 1),
    ];
    expect(currentTableOrder(games).filter((id) => id === 1 || id === 2)).toEqual([1, 2]);
  });

  // Art. 6.2: with no Played Games, all seven official steps and regulation wins are level for every team, so our
  // own last resort, a fixed team order, is what settles the table.
  it("breaks Current Table ties on every criterion by a fixed team order (ascending team id)", () => {
    const games = [scheduled(5, 2, "2026-10-05T19:45:00+02:00"), scheduled(6, 4, "2026-10-05T19:45:00+02:00")];
    // No Played Games, so all four teams are level on every criterion; insertion order would give 5, 2, 6, 4.
    expect(currentTableOrder(games)).toEqual([2, 4, 5, 6]);
  });

  it("counts Games with a result as Played only if they started before the As-Of Date", () => {
    const games = [
      played(1, 2, 4, 2, "regulation", "2026-09-30T19:45:00+02:00"),
      played(2, 1, 4, 2, "regulation", "2026-10-02T19:45:00+02:00"),
    ];
    const table = project(games, asOf, splitFormRate).currentTable;
    expect(table.find((row) => row.teamId === 1)).toMatchObject({ gamesPlayed: 1, points: 3 });
  });

  it("lists every team in the schedule, including teams with no Played Games", () => {
    const games = [played(1, 2, 4, 2), scheduled(3, 1, "2026-10-03T19:45:00+02:00")];
    expect(pointsByTeam(games)).toEqual({ 1: 3, 2: 0, 3: 0 });
  });

  it("does not count past Games without a result, such as postponed ones", () => {
    const games = [played(1, 2, 4, 2), scheduled(2, 1, "2026-09-25T19:45:00+02:00")];
    const table = project(games, asOf, splitFormRate).currentTable;
    expect(table.map((row) => row.gamesPlayed)).toEqual([1, 1]);
  });

  it("tallies the win/loss record and goals for each team", () => {
    const games = [
      played(1, 2, 4, 2),
      played(2, 1, 3, 2, "OT"),
      played(1, 2, 1, 2, "SO"),
      played(2, 1, 5, 1),
    ];
    const row = project(games, asOf, splitFormRate).currentTable.find((r) => r.teamId === 1);
    expect(row).toEqual({
      rank: 2,
      teamId: 1,
      gamesPlayed: 4,
      regulationWins: 1,
      overtimeOrShootoutWins: 0,
      overtimeOrShootoutLosses: 2,
      regulationLosses: 1,
      goalsFor: 8,
      goalsAgainst: 12,
      points: 5,
    });
  });
});

function projectedRow(games: Game[], teamId: number) {
  const row = project(games, asOf, splitFormRate).projectedTable.find((r) => r.teamId === teamId);
  if (!row) throw new Error(`no Projected Table row for team ${teamId}`);
  return row;
}

const later = "2026-10-10T19:45:00+02:00";

describe("project: Split Form Rate", () => {
  it("adds Remaining home Games × Home Form and Remaining away Games × Away Form to current Points", () => {
    const games = [
      played(1, 2, 4, 2), // 1 home: 3
      played(1, 3, 1, 2, "OT"), // 1 home: 1 → Home Form 2
      played(2, 1, 3, 2, "SO"), // 1 away: 1 → Away Form 1
      scheduled(1, 2, later),
      scheduled(1, 3, later),
      scheduled(1, 2, later),
      scheduled(3, 1, later),
    ];
    // current 5 + 3 home × 2 + 1 away × 1
    expect(projectedRow(games, 1)).toMatchObject({
      currentPoints: 5,
      homeForm: 2,
      awayForm: 1,
      remainingHomeGames: 3,
      remainingAwayGames: 1,
      projectedPoints: 12,
    });
  });

  it("builds the home Form Window from only the five most recent Played home Games", () => {
    const games = [
      played(1, 2, 0, 1, "regulation", "2026-09-28T19:45:00+02:00"), // 0
      played(1, 2, 2, 1, "OT", "2026-09-26T19:45:00+02:00"), // 2
      played(1, 2, 5, 1, "regulation", "2026-09-10T19:45:00+02:00"), // oldest, outside the window
      played(1, 2, 1, 2, "SO", "2026-09-24T19:45:00+02:00"), // 1
      played(1, 2, 5, 1, "regulation", "2026-09-12T19:45:00+02:00"), // outside the window
      played(1, 2, 0, 1, "regulation", "2026-09-22T19:45:00+02:00"), // 0
      played(1, 2, 3, 1, "regulation", "2026-09-20T19:45:00+02:00"), // 3
    ];
    expect(projectedRow(games, 1).homeForm).toBe(1.2);
  });

  it("builds the away Form Window from only the five most recent Played away Games", () => {
    const games = [
      played(2, 1, 1, 0, "regulation", "2026-09-10T19:45:00+02:00"), // outside the window
      played(2, 1, 0, 1, "regulation", "2026-09-20T19:45:00+02:00"), // 3
      played(2, 1, 0, 1, "regulation", "2026-09-21T19:45:00+02:00"), // 3
      played(2, 1, 1, 2, "OT", "2026-09-22T19:45:00+02:00"), // 2
      played(2, 1, 2, 1, "SO", "2026-09-23T19:45:00+02:00"), // 1
      played(2, 1, 0, 1, "regulation", "2026-09-24T19:45:00+02:00"), // 3
    ];
    expect(projectedRow(games, 1).awayForm).toBe(2.4);
  });

  it("treats Games after the As-Of Date as Remaining, even when they already have a result", () => {
    const games = [
      played(1, 2, 4, 2), // before As-Of: Home Form 3
      played(1, 2, 0, 5, "regulation", "2026-10-02T19:45:00+02:00"), // after As-Of: Remaining
    ];
    expect(projectedRow(games, 1)).toMatchObject({
      currentPoints: 3,
      homeForm: 3,
      remainingHomeGames: 1,
      projectedPoints: 6,
    });
  });

  it("treats past Games without a result, such as postponed ones, as Remaining", () => {
    const games = [played(1, 2, 4, 2), scheduled(1, 2, "2026-09-25T19:45:00+02:00")];
    expect(projectedRow(games, 1)).toMatchObject({ remainingHomeGames: 1, projectedPoints: 6 });
  });

  it("flags Low Sample when the team has fewer than ten Played Games, whatever its Form Windows hold", () => {
    const nineHome = Array.from({ length: 9 }, () => played(1, 2, 3, 1));
    expect(projectedRow(nineHome, 1).lowSample).toBe(true);
    expect(projectedRow([...nineHome, played(3, 1, 1, 3)], 1).lowSample).toBe(false);
    expect(projectedRow([...nineHome, played(3, 1, 1, 3)], 3).lowSample).toBe(true);
  });

  it("uses Home Form for away Games too when the away Form Window is empty", () => {
    const games = [played(1, 2, 2, 1, "OT"), scheduled(1, 2, later), scheduled(2, 1, later)];
    // current 2 + 1 home × 2 + 1 away × 2
    expect(projectedRow(games, 1)).toMatchObject({ homeForm: 2, awayForm: null, projectedPoints: 6 });
  });

  it("uses Away Form for home Games too when the home Form Window is empty", () => {
    const games = [played(1, 2, 2, 1, "OT"), scheduled(1, 2, later), scheduled(2, 1, later)];
    // team 2: current 1 + 1 home × 1 + 1 away × 1
    expect(projectedRow(games, 2)).toMatchObject({ homeForm: null, awayForm: 1, projectedPoints: 3 });
  });

  it("keeps projected Points at current Points when both Form Windows are empty", () => {
    const games = [scheduled(1, 2, later), scheduled(2, 1, later)];
    expect(projectedRow(games, 1)).toMatchObject({
      currentPoints: 0,
      homeForm: null,
      awayForm: null,
      remainingHomeGames: 1,
      remainingAwayGames: 1,
      projectedPoints: 0,
      lowSample: true,
    });
  });

  it("projects every team at 0 Points in team id order when no Games have been played", () => {
    // Level on every Current Table criterion, so the fixed team order (ascending team id) settles it.
    const games = [scheduled(3, 1, later), scheduled(2, 3, later), scheduled(1, 2, later)];
    const table = project(games, asOf, splitFormRate).projectedTable;
    expect(table.map((row) => [row.rank, row.teamId, row.projectedPoints])).toEqual([
      [1, 1, 0],
      [2, 2, 0],
      [3, 3, 0],
    ]);
  });

  it("ranks the Projected Table by projected Points", () => {
    const games = [
      played(1, 2, 4, 2), // 1: 3 Points; 2: Away Form 0
      played(3, 2, 2, 3, "SO"), // 2: 2 Points, Away Form 1 overall; 3: 1 Point, Home Form 1
      ...Array.from({ length: 4 }, () => scheduled(2, 3, later)),
    ];
    // 1: 3 (nothing Remaining); 2: 2 + 4 home × 1 = 6; 3: 1 + 4 away × 1 = 5
    const table = project(games, asOf, splitFormRate).projectedTable;
    expect(table.map((row) => [row.rank, row.teamId, row.projectedPoints])).toEqual([
      [1, 2, 6],
      [2, 3, 5],
      [3, 1, 3],
    ]);
  });

  it("breaks projected ties by Current Table position, even through floating-point noise", () => {
    const games = [
      // team 2: 6 Points, Home Form 1/3 over 3 Games, 7 Remaining home → 6 + 7/3 = 25/3
      played(2, 3, 2, 3, "SO"),
      played(2, 3, 0, 1),
      played(2, 3, 0, 1),
      played(3, 2, 1, 4),
      played(3, 2, 1, 2, "OT"),
      ...Array.from({ length: 7 }, () => scheduled(2, 3, later)),
      // team 1: 5 Points, Home Form 5/3 over 3 Games, 2 Remaining home → 5 + 10/3 = 25/3
      played(1, 3, 3, 0),
      played(1, 3, 3, 2, "OT"),
      played(1, 3, 0, 1),
      ...Array.from({ length: 2 }, () => scheduled(1, 3, later)),
    ];
    const { currentTable, projectedTable } = project(games, asOf, splitFormRate);
    const order = (rows: { teamId: number }[]) => rows.map((row) => row.teamId).filter((id) => id !== 3);
    expect(order(currentTable)).toEqual([2, 1]);
    expect(projectedTable.find((row) => row.teamId === 1)?.projectedPoints).toBeCloseTo(25 / 3);
    expect(projectedTable.find((row) => row.teamId === 2)?.projectedPoints).toBeCloseTo(25 / 3);
    expect(order(projectedTable)).toEqual([2, 1]);
  });

  it("assigns Cut Lines by projected rank: 1–6 playoffs, 7–10 play-in, 11–14 eliminated", () => {
    const games = Array.from({ length: 13 }, (_, i) => scheduled(i + 1, i + 2, later));
    const table = project(games, asOf, splitFormRate).projectedTable;
    expect(table.map((row) => [row.rank, row.cutLine])).toEqual([
      [1, "playoffs"],
      [2, "playoffs"],
      [3, "playoffs"],
      [4, "playoffs"],
      [5, "playoffs"],
      [6, "playoffs"],
      [7, "play-in"],
      [8, "play-in"],
      [9, "play-in"],
      [10, "play-in"],
      [11, "eliminated"],
      [12, "eliminated"],
      [13, "eliminated"],
      [14, "eliminated"],
    ]);
  });

  it("reports movement against the current rank: positive when rising, negative when falling", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 2, 2, 3, "SO"),
      ...Array.from({ length: 4 }, () => scheduled(2, 3, later)),
    ];
    const table = project(games, asOf, splitFormRate).projectedTable;
    expect(table.map((row) => [row.teamId, row.currentRank, row.rank, row.movement])).toEqual([
      [2, 2, 1, 1],
      [3, 3, 2, 1],
      [1, 1, 3, -2],
    ]);
  });

  it("reports no movement when the projected rank equals the current rank", () => {
    const games = [played(1, 2, 4, 2), scheduled(1, 2, later)];
    expect(projectedRow(games, 1)).toMatchObject({ currentRank: 1, rank: 1, movement: 0 });
  });
});

describe("project: Form Window detail", () => {
  it("lists the home Form Window Games newest first, from the team's side, with Decision and Points earned", () => {
    const games = [
      played(1, 2, 4, 2, "regulation", "2026-09-20T19:45:00+02:00"),
      played(1, 3, 2, 3, "SO", "2026-09-24T19:45:00+02:00"),
      played(2, 1, 1, 2, "OT", "2026-09-22T19:45:00+02:00"), // away: not in the home Form Window
    ];
    const [olderHome, newerHome, away] = games;
    expect(projectedRow(games, 1).homeFormWindow).toEqual([
      {
        gameId: newerHome!.id,
        startsAt: "2026-09-24T19:45:00+02:00",
        opponentId: 3,
        goalsFor: 2,
        goalsAgainst: 3,
        decision: "SO",
        points: 1,
        whatIf: false,
      },
      {
        gameId: olderHome!.id,
        startsAt: "2026-09-20T19:45:00+02:00",
        opponentId: 2,
        goalsFor: 4,
        goalsAgainst: 2,
        decision: "regulation",
        points: 3,
        whatIf: false,
      },
    ]);
    expect(projectedRow(games, 1).awayFormWindow).toEqual([
      {
        gameId: away!.id,
        startsAt: "2026-09-22T19:45:00+02:00",
        opponentId: 2,
        goalsFor: 2,
        goalsAgainst: 1,
        decision: "OT",
        points: 2,
        whatIf: false,
      },
    ]);
  });

  it("caps each Form Window at five Games and leaves out Games after the As-Of Date", () => {
    const games = [
      ...Array.from({ length: 6 }, (_, day) => played(1, 2, 3, 1, "regulation", `2026-09-1${day}T19:45:00+02:00`)),
      played(1, 2, 3, 1, "regulation", "2026-10-02T19:45:00+02:00"),
    ];
    const window = projectedRow(games, 1).homeFormWindow;
    expect(window.map((game) => game.startsAt.slice(0, 10))).toEqual([
      "2026-09-15",
      "2026-09-14",
      "2026-09-13",
      "2026-09-12",
      "2026-09-11",
    ]);
  });

  it("gives empty Form Windows to a team with no Played Games", () => {
    const games = [scheduled(1, 2, later)];
    expect(projectedRow(games, 1)).toMatchObject({ homeFormWindow: [], awayFormWindow: [] });
  });
});

describe("project: data integrity", () => {
  const later = "2026-10-10T19:45:00+02:00";

  /** A full 52-Game Regular Season between two teams: 26 home Games each. */
  function fullSeason(playedCount: number): Game[] {
    return Array.from({ length: 52 }, (_, index) => {
      const [home, away] = index % 2 === 0 ? [1, 2] : [2, 1];
      return index < playedCount ? played(home, away, 3, 1) : scheduled(home, away, later);
    });
  }

  it("reports no integrity issues when every team has 52 Played + Remaining Games", () => {
    expect(project(fullSeason(10), asOf, splitFormRate).integrityIssues).toEqual([]);
  });

  it("counts a postponed past Game as Remaining towards the 52", () => {
    const games = fullSeason(10);
    games[10] = scheduled(1, 2, "2026-09-25T19:45:00+02:00");
    expect(project(games, asOf, splitFormRate).integrityIssues).toEqual([]);
  });

  it("reports each team whose Played + Remaining Games do not add up to 52", () => {
    const games = [...fullSeason(10).slice(1), scheduled(3, 2, later)];
    expect(project(games, asOf, splitFormRate).integrityIssues).toEqual([
      { teamId: 1, playedGames: 9, remainingGames: 42 },
      { teamId: 3, playedGames: 0, remainingGames: 1 },
    ]);
  });

  it("says whether any Game has been played", () => {
    expect(project(fullSeason(1), asOf, splitFormRate).anyGamesPlayed).toBe(true);
    const beforeSeason = project(fullSeason(0), asOf, splitFormRate);
    expect(beforeSeason.anyGamesPlayed).toBe(false);
    expect(beforeSeason.integrityIssues).toEqual([]);
  });

  it("says no Game has been played when there are no Games at all", () => {
    expect(project([], asOf, splitFormRate)).toMatchObject({
      anyGamesPlayed: false,
      currentTable: [],
      projectedTable: [],
      integrityIssues: [],
    });
  });
});

describe("project: Next Round", () => {
  // 4 teams, so one full round (half the teams) is 2 Games.
  function nextRoundDates(games: Game[]) {
    return project(games, asOf, splitFormRate).nextRound.map((day) => day.date);
  }

  function nextRoundGameIds(games: Game[]) {
    return project(games, asOf, splitFormRate).nextRound.flatMap((day) => day.games.map((g) => g.game.id));
  }

  it("extends a match day with only some teams playing by the next match day in full", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(1, 2, "2026-10-05T19:45:00+02:00"), // day 1: only 2 of 4 teams
      scheduled(1, 3, "2026-10-06T18:00:00+02:00"), // day 2: full round, taken in full
      scheduled(2, 4, "2026-10-06T19:45:00+02:00"),
    ];
    expect(nextRoundDates(games)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(nextRoundGameIds(games)).toHaveLength(3);
  });

  it("shows a full-round match day on its own", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(1, 3, "2026-10-05T18:00:00+02:00"), // day 1: full round already
      scheduled(2, 4, "2026-10-05T19:45:00+02:00"),
      scheduled(1, 4, "2026-10-12T19:45:00+02:00"), // day 2: left out
      scheduled(2, 3, "2026-10-12T19:45:00+02:00"),
    ];
    expect(nextRoundDates(games)).toEqual(["2026-10-05"]);
    expect(nextRoundGameIds(games)).toHaveLength(2);
  });

  it("leaves out a past-dated Remaining Game, such as one postponed", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(1, 3, "2026-09-25T19:45:00+02:00"), // postponed: past-dated, no result
      scheduled(2, 4, "2026-10-05T19:45:00+02:00"),
    ];
    expect(nextRoundGameIds(games)).toEqual([games[3]!.id]);
  });

  it("leaves out a Game that started before the As-Of Date on the same Swiss day", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(1, 3, "2026-10-01T08:00:00+02:00"), // same Swiss day as As-Of, but already started
      scheduled(2, 4, "2026-10-01T19:45:00+02:00"), // same Swiss day, still ahead
    ];
    expect(nextRoundGameIds(games)).toEqual([games[3]!.id]);
  });

  it("includes a Game with a result that starts after the As-Of Date, still Remaining", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      played(1, 3, 5, 1, "regulation", "2026-10-05T19:45:00+02:00"), // after As-Of: Remaining despite its result
    ];
    expect(nextRoundGameIds(games)).toEqual([games[2]!.id]);
  });

  it("shows fewer than a full round when that's all that's left", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(1, 3, "2026-10-05T19:45:00+02:00"),
    ];
    expect(nextRoundGameIds(games)).toEqual([games[2]!.id]);
  });

  it("gives an empty Next Round when there are no Upcoming Games", () => {
    const games = [played(1, 2, 4, 2), played(3, 4, 1, 2)];
    expect(project(games, asOf, splitFormRate).nextRound).toEqual([]);
  });

  it("groups Games on the same Swiss day but different UTC dates together", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      // 23:30 UTC on the 5th is 01:30 on the 6th in Swiss summer time (UTC+2).
      scheduled(1, 3, "2026-10-05T23:30:00Z"),
      scheduled(2, 4, "2026-10-06T18:00:00+02:00"),
    ];
    expect(nextRoundDates(games)).toEqual(["2026-10-06"]);
    expect(nextRoundGameIds(games)).toHaveLength(2);
  });

  it("carries the model's own predictions for a Points-only model: expected Points, no Outcome Probabilities", () => {
    const games = [
      played(1, 2, 4, 2), // team 1's Home Form: 3
      played(3, 4, 1, 2), // team 3's Home Form: 0, no away Games played
      scheduled(1, 3, "2026-10-05T19:45:00+02:00"),
    ];
    const { nextRound } = project(games, asOf, splitFormRate);
    const upcoming = nextRound[0]!.games[0]!;
    expect(upcoming.prediction!.outcomes).toBeNull();
    // team 3's empty away Form Window falls back to its Home Form (0).
    expect(upcoming.prediction!.points).toEqual({ home: 3, away: 0 });
  });

  it("carries the model's own predictions for an outcome model: Outcome Probabilities", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(1, 3, "2026-10-05T19:45:00+02:00"),
    ];
    const { nextRound } = project(games, asOf, eloModel);
    const upcoming = nextRound[0]!.games[0]!;
    expect(upcoming.prediction!.outcomes).not.toBeNull();
    const sum = Object.values(upcoming.prediction!.outcomes!).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("orders Upcoming Games within a match day by start time", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(2, 4, "2026-10-05T19:45:00+02:00"),
      scheduled(1, 3, "2026-10-05T18:00:00+02:00"),
    ];
    const [earlier, later] = [games[3]!, games[2]!];
    expect(nextRoundGameIds(games)).toEqual([earlier.id, later.id]);
  });

  it("breaks a same-time tie within a match day by Game id", () => {
    const games = [
      played(1, 2, 4, 2),
      played(3, 4, 1, 2),
      scheduled(2, 4, "2026-10-05T19:45:00+02:00"),
      scheduled(1, 3, "2026-10-05T19:45:00+02:00"),
    ];
    const byId = [games[2]!, games[3]!].sort((a, b) => a.id.localeCompare(b.id));
    expect(nextRoundGameIds(games)).toEqual(byId.map((g) => g.id));
  });
});

describe("project: matchDay", () => {
  const matchDayAt = (games: Game[], at = asOf) => project(games, at, splitFormRate).matchDay;
  const playedAt = (startsAt: string) => played(1, 2, 3, 2, "regulation", startsAt);

  it("gives the Season-start token before any Game has been played", () => {
    expect(matchDayAt([])).toBe(SEASON_START);
    expect(matchDayAt([scheduled(1, 2, "2026-10-10T19:45:00+02:00")])).toBe(SEASON_START);
    expect(matchDayAt([playedAt("2026-10-01T19:45:00+02:00")])).toBe(SEASON_START);
  });

  it("gives the latest Swiss calendar day a Played Game started on", () => {
    const games = [playedAt("2026-09-25T19:45:00+02:00"), playedAt("2026-09-30T19:45:00+02:00"), playedAt("2026-09-27T15:00:00+02:00")];
    expect(matchDayAt(games)).toBe("2026-09-30");
  });

  it("counts a late-evening Game on its Swiss day, not its UTC day", () => {
    // 23:30 UTC on the 30th is 01:30 on 1 October in Swiss summer time.
    expect(matchDayAt([playedAt("2026-09-30T23:30:00Z")], new Date("2026-10-01T12:00:00Z"))).toBe("2026-10-01");
    // 21:59 UTC on the 30th is still the 30th in Switzerland.
    expect(matchDayAt([playedAt("2026-09-30T21:59:00Z")])).toBe("2026-09-30");
  });

  it("ignores a Remaining Game that has started or was postponed", () => {
    const games = [
      playedAt("2026-09-28T19:45:00+02:00"),
      scheduled(1, 2, "2026-09-30T19:45:00+02:00"), // started, awaiting a result
      scheduled(1, 2, "2026-09-29T19:45:00+02:00"), // postponed without a new date
    ];
    expect(matchDayAt(games)).toBe("2026-09-28");
  });

  it("ignores a Game with a result that starts after the As-Of Date", () => {
    expect(matchDayAt([playedAt("2026-09-28T19:45:00+02:00"), playedAt("2026-10-05T19:45:00+02:00")])).toBe("2026-09-28");
  });

  it("does not depend on Game order", () => {
    const games = [playedAt("2026-09-25T19:45:00+02:00"), playedAt("2026-09-30T19:45:00+02:00")];
    expect(matchDayAt([...games].reverse())).toBe(matchDayAt(games));
  });

  it.each([splitFormRate, seasonRate, matchupModel, eloModel])("is set under $name", (model) => {
    const games = [playedAt("2026-09-28T19:45:00+02:00")];
    expect(project(games, asOf, model).matchDay).toBe("2026-09-28");
    expect(project([], asOf, model).matchDay).toBe(SEASON_START);
  });
});

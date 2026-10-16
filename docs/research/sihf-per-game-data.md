# What the SIHF API exposes per Game beyond the score

Research for [#138](https://github.com/andyscanzio/nl-predict/issues/138) (wayfinder map [#137](https://github.com/andyscanzio/nl-predict/issues/137)). Probed 2026-10-16 against the live API: 17 requests in total, 1.5 s apart.

## Answer in brief

- **A second endpoint, `gameDetail`, returns a full box score per Game**: shots on goal by period, missed and post shots, blocked shots, faceoffs (by zone), penalty minutes and every penalty, power-play and penalty-kill numbers, goalie saves and time on ice, both lineups, per-player stats (TOI, +/-, shots, faceoffs), attendance, venue, referees and coaches, and a goal log with strength (PP/SH/EN) and time.
- **Coverage depends on the Season**:
  - Since **2017/18**, all of the above is present.
  - From **2009/10 to 2016/17**, the shot, blocked-shot, faceoff and TOI fields are `-` or missing. Lineups, penalties and PIM, power plays, attendance, referees and goal events are still there.
  - **Goalie shots-against and saves** are present in 2014/15 but not in 2009/10.
- **Cost:** one request per Game, on top of today's requests. The Season's match-day listings already give every Game's id, so no extra discovery requests are needed. That is about **+300 to +364 requests per Season** (300 Regular Season Games up to 2019/20, 364 in 2024/25), roughly 4× today's ~93. Each response is 22 to 33 KB, so about 10 MB of raw JSONP per Season. Finished Games don't change, so each one only needs fetching once.
- **Already free in today's listing:** the `results` rows also carry `scorePerPeriod` (period-by-period goals) and `broadcasts`. `readGames` ignores both today.

## Today's requests (baseline)

`scripts/snapshot.ts` calls `https://data.sihf.ch/Statistic/api/cms/cache300?alias=results&…&filterQuery=<endYear>[/all/<phase>[/<DD.MM.YYYY>]]` (JSONP). There is one request for the Season overview, one for the Regular Season's date list and one per match day. That comes to ~93 requests for a full Season ([ADR 0001](../adr/0001-build-time-data-snapshot.md)).

`src/snapshot/sihfResponse.ts` (`readGames`) reads only these columns: `homeTeam`, `awayTeam`, `score`, `decision`, `status` and `details`. The listing's full header is longer (from `src/snapshot/__fixtures__/day-2026-09-15.json`):

`day, date, time, homeTeam, awayTeam, score, scorePerPeriod, decision, status, details, broadcasts` (older Seasons also have `video`).

- `scorePerPeriod` is `{"homeTeam":["1","2","3"],"awayTeam":["1","2","0"],"type":"periods"}`. It is present back to 2009/10 (seen in the 2010, 2015, 2017, 2018 and 2019 overview rows).
- `details` is `{"gameId":"20271105000006","type":"linkToGameDetail"}`. It is the key for the endpoint below.

## The per-Game endpoint

```
GET https://data.sihf.ch/Statistic/api/cms/gameoverview
    ?alias=gameDetail&searchQuery=<gameId>&language=de&callback=externalStatisticsCallback
```

It returns JSONP in the same wrapper as `results`. There is no CORS, so the same build-time-snapshot constraint applies. A wrong id gives HTTP 404 with an empty body.

Top-level shape of a 2026/27 Regular Season Game (`20271105000006`, HC Lugano 6–3 Genève-Servette, 15.09.2026):

| Path | What it holds |
|---|---|
| `result.homeTeam/awayTeam`, `result.scores[]` | Final and per-period score; OT/SO appears as an extra period (`indicator: "OT1"`) |
| `result.sogs[]` | **Shots on goal per period** (OT included) |
| `summary.periods[].goals[]` | Every goal: time, team, scorer/assist licence numbers, on-ice players (`p1..p6`, `m1..m6`, often 0), `isEmptyNet`, `isPenaltyShot`, `isGameWinningGoal`, and strength in `text` (e.g. `**PP1**`) |
| `summary.periods[].fouls[]` | Every penalty: player, team, minutes, infraction name, start and end time |
| `summary.periods[].goalkeepers[]` | Goalie changes (IN/OUT with time, e.g. a pulled goalie) |
| `summary.periods[].timeouts[]`, `revokedGoals[]`, `scoringReviews[]`, `summary.shootout` | Timeouts, disallowed goals, video reviews, shootout attempts |
| `lineUps.{home,away}Team` | Goalkeepers, defenders left/right and forwards left/center/right (licence numbers), captain, top scorer, tagged players, coach name |
| `players[]` | Roster: licence id, name, jersey number, birth year (`ageGroup`), team |
| `details.venue` | Arena name and address, **`spectators`** (attendance) |
| `details.referees[]`, `details.linesmen[]` | Officials by id and name |
| `details.homeAbsentees[]`, `awayAbsentees[]` | Absent players (empty in every sample) |
| `stats[]` | Five tables, described next |
| `league`, `phase`, `qualification`, `season`, `status`, `startDateTime`, `endDateTime`, `broadcasts` | Context (phase name such as "NL Regular Season", status as in the listing) |

### The five `stats[]` tables

- **`gamePlayerStatsHome` / `gamePlayerStatsAway`** (one row per skater): G, A, A1, A2, PTS, PIM, +/-, SOG, shots missed, shots off the post, blocked shots, faceoffs won and lost, FO%, TOI, TOI PP and TOI PK.
- **`gameGoalieStatsHome` / `gameGoalieStatsAway`** (one row per goalie): GA, saves, shots against, SV%, minutes played, GAA and PIM.
- **`gameTeamStats`**, with one row per statistic and one column per team (49 rows; 58 with an OT period):
  - SOG, shots missed (SHM), shots off the post (SHP) and blocked shots (BkS), each as a total and per period.
  - Faceoffs: total, won and lost, FO% overall and per period, and FO% by zone (offensive, neutral, defensive), also per period.
  - PIM, as a total and per period.
  - Power play: PP time (PPT), PK time (PKT), PP opportunities, PPG, PP%, PP goals against, PK times shorthanded, PK goals against, SHG and PK%.

## Coverage by Season (sampled)

I took one Game per Season from the Season overview (`filterQuery=<endYear>` returns a few of the Season's last Games, mostly playoffs). For 2017/18 I also fetched the Regular Season opener by id.

| Season | Sample Game | SOG / shots / blocks / faceoffs / TOI | Goalie SA & saves | PIM, PP/PK, penalty log | Lineups, goals log | Attendance |
|---|---|---|---|---|---|---|
| 2009/10 | `20101105073007` (playoffs, 24.04.2010) | `-`; player rows have 11 columns (no SOG, no TOI) | SA `-`, saves 0 | yes (18-row team table) | yes | 7000 |
| 2014/15 | `20151105078367` (playoffs, 11.04.2015) | `-` | **yes** (19 saves, 21 SA) | yes | yes | 11200 |
| 2016/17 | `20171105078378` (playoffs, 17.04.2017) | `-` (team table has 49 rows, but shot rows are `-`; player rows have 13 columns) | yes | yes | yes | 7015 |
| 2017/18 | `20181105000001` (Regular Season opener, 08.09.2017) | **yes**, including OT period | yes | yes | yes | 4195 |
| 2017/18 | `20181105000379` (playoffs, 27.04.2018) | yes (player rows have 20 columns, with TOI) | yes | yes | yes | 7200 |
| 2018/19 | `20191105000377` (playoffs, 20.04.2019) | yes | yes | yes | yes | 17031 |
| 2019/20 | `20201105000295` (Regular Season, 29.02.2020) | yes | yes | yes | yes | **0** (closed-door round at the start of COVID) |
| 2024/25 | `20251105000417` (playoffs, 24.04.2025) | yes | yes | yes | yes | 9600 |
| 2026/27 | `20271105000006` (Regular Season, 15.09.2026) | yes | yes | yes | yes | 5434 |

The Season dropdown goes back to 2008/09 (`src/snapshot/__fixtures__/day-2026-09-15.json`). These are samples, not a census:
- The 2017/18 boundary rests on April 2017 having no shot data and September 2017 having it.
- The 2014/15 goalie boundary rests on one Game. I did not check 2010/11 to 2013/14.
- I did not check COVID-era 2020/21 attendance (expect 0 or capped values).

## Things to watch

- **Game ids are not predictable before 2017/18.** From 2017/18 on, Regular Season ids are `<endYear>1105` plus a running number (`20181105000001` is the 2017/18 opener; `20171105000001` returns 404). Older Seasons use another range (`…1105073007`, `…1105078367`). Read ids from the match-day listings, which the snapshot already fetches.
- **Data quirks:**
  - In the 2026/27 sample, `PIM Total` is 6/10 while `PIM 1P/2P/3P` are all 0, so per-period PIM is not reliable.
  - Missing values are the string `"-"`, not null, and player tables have fewer columns in older Seasons. A reader has to map columns by `header[].alias`, the way `readGames` already does.
  - All numbers are strings.
- **Attendance is a time-of-season and COVID artefact as much as a team signal.** `spectators` was `"0"` on 29.02.2020.
- **Leakage:** everything here is *post-Game* data. As features for predicting a Game, it can only be used aggregated over earlier Games (for example rolling shot share, PP% or a goalie's save %), never from the Game being predicted.

## Request cost, worked out

| Per Season | Requests today | Extra for box scores |
|---|---|---|
| Listings (overview + date list + match days) | ~93 | 0 (reused for gameIds) |
| `gameDetail`, one per Regular Season Game | — | 300 (≤2019/20) to 364 (2024/25) |
| Total | ~93 | ~390 to ~460 (≈4 to 5×) |

At the snapshot's current 400 ms delay, that is about 2.5 minutes extra per Season, once. Finished Games are settled, so a back-fill of 2017/18 to 2025/26 (9 Seasons) costs about 3,000 requests and about 90 MB raw (smaller once reduced to the needed fields). After that, only newly finished Games need fetching, around 3 to 7 per match day.

## Sources

- Live API responses for the gameIds listed above, fetched 2026-10-16 (`gameoverview?alias=gameDetail`, `cache300?alias=results&filterQuery=<endYear>`).
- `scripts/snapshot.ts` and `src/snapshot/sihfResponse.ts` (current endpoint and the columns read today).
- `src/snapshot/__fixtures__/day-2026-09-15.json` (full listing header, `scorePerPeriod`, `details.gameId`).
- `docs/adr/0001-build-time-data-snapshot.md` (~93 requests per Season, no CORS).

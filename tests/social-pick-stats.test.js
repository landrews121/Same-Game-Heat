const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDailyPickStats,
  summarizeRecentGames,
  summarizeVenueRecord,
  normalizePitcher
} = require("../social-pick-stats");

function responseJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

const teams = {
  angels: { id: 108, name: "Los Angeles Angels" },
  astros: { id: 117, name: "Houston Astros" }
};

function finalGame({ gamePk, date, homeTeam = teams.angels, awayTeam = teams.astros, homeScore, awayScore }) {
  return {
    gamePk,
    gameDate: `${date}T23:10:00Z`,
    status: { abstractGameState: "Final", detailedState: "Final" },
    teams: {
      home: { team: homeTeam, score: homeScore, leagueRecord: { wins: 53, losses: 48 } },
      away: { team: awayTeam, score: awayScore, leagueRecord: { wins: 49, losses: 51 } }
    }
  };
}

function scheduleResponse(games) {
  return { dates: [{ date: "2026-07-26", games }] };
}

function fakeFetchFactory(calls = []) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (path.endsWith("/schedule") && parsed.searchParams.get("gamePk") === "777001") {
      return responseJson(scheduleResponse([{
        gamePk: 777001,
        gameDate: "2026-07-27T23:10:00Z",
        status: { abstractGameState: "Preview", detailedState: "Scheduled" },
        teams: {
          home: {
            team: teams.angels,
            probablePitcher: { id: 7001, fullName: "Angels Starter" },
            leagueRecord: { wins: 53, losses: 48 }
          },
          away: {
            team: teams.astros,
            probablePitcher: { id: 7002, fullName: "Astros Starter" },
            leagueRecord: { wins: 49, losses: 51 }
          }
        }
      }]));
    }

    if (path.endsWith("/schedule") && parsed.searchParams.get("teamId")) {
      const teamId = parsed.searchParams.get("teamId");
      const selectedTeam = teamId === "108" ? teams.angels : teams.astros;
      const opponentTeam = teamId === "108" ? teams.astros : teams.angels;
      return responseJson(scheduleResponse([
        finalGame({ gamePk: 9001, date: "2026-07-26", homeTeam: selectedTeam, awayTeam: opponentTeam, homeScore: 6, awayScore: 3 }),
        finalGame({ gamePk: 9002, date: "2026-07-25", homeTeam: selectedTeam, awayTeam: opponentTeam, homeScore: 5, awayScore: 2 }),
        finalGame({ gamePk: 9003, date: "2026-07-24", homeTeam: selectedTeam, awayTeam: opponentTeam, homeScore: 1, awayScore: 4 }),
        finalGame({ gamePk: 9004, date: "2026-07-23", homeTeam: selectedTeam, awayTeam: opponentTeam, homeScore: 7, awayScore: 1 }),
        finalGame({ gamePk: 9005, date: "2026-07-22", homeTeam: selectedTeam, awayTeam: opponentTeam, homeScore: 3, awayScore: 4 }),
        finalGame({ gamePk: 9006, date: "2026-07-21", homeTeam: opponentTeam, awayTeam: selectedTeam, homeScore: 2, awayScore: 8 })
      ]));
    }

    if (path.endsWith("/teams/108/stats")) {
      return responseJson({ stats: [{ splits: [{ stat: { gamesPlayed: 101, runs: 515, homeRuns: 130, avg: ".252", obp: ".329", slg: ".431", ops: ".760" } }] }] });
    }
    if (path.endsWith("/teams/117/stats")) {
      return responseJson({ stats: [{ splits: [{ stat: { gamesPlayed: 100, runs: 474, homeRuns: 118, avg: ".247", obp: ".318", slg: ".407", ops: ".725" } }] }] });
    }

    if (path.endsWith("/people/7001")) {
      return responseJson({ people: [{ id: 7001, fullName: "Angels Starter", pitchHand: { code: "R" } }] });
    }
    if (path.endsWith("/people/7002")) {
      return responseJson({ people: [{ id: 7002, fullName: "Astros Starter", pitchHand: { code: "L" } }] });
    }
    if (path.endsWith("/people/7001/stats") && parsed.searchParams.get("stats") === "season") {
      return responseJson({ stats: [{ splits: [{ stat: { era: "3.42", whip: "1.18", strikeOuts: 112, baseOnBalls: 31, inningsPitched: "118.2", homeRuns: 15 } }] }] });
    }
    if (path.endsWith("/people/7002/stats") && parsed.searchParams.get("stats") === "season") {
      return responseJson({ stats: [{ splits: [{ stat: { era: "4.28", whip: "1.34", strikeOuts: 95, baseOnBalls: 42, inningsPitched: "103.0", homeRuns: 20 } }] }] });
    }
    if (path.endsWith("/people/7001/stats") && parsed.searchParams.get("stats") === "gameLog") {
      return responseJson({
        stats: [{ splits: [
          { date: "2026-07-24", stat: { gamesStarted: 1, inningsPitched: "6.0", earnedRuns: 2, runs: 2, strikeOuts: 7, baseOnBalls: 1 } },
          { date: "2026-07-18", stat: { gamesStarted: 1, inningsPitched: "5.1", earnedRuns: 3, runs: 4, strikeOuts: 5, baseOnBalls: 2 } },
          { date: "2026-07-12", stat: { gamesStarted: 1, inningsPitched: "7.0", earnedRuns: 1, runs: 1, strikeOuts: 8, baseOnBalls: 0 } },
          { date: "2026-07-29", stat: { gamesStarted: 1, inningsPitched: "9.0", earnedRuns: 9, runs: 9, strikeOuts: 0, baseOnBalls: 8 } }
        ] }]
      });
    }
    if (path.endsWith("/people/7002/stats") && parsed.searchParams.get("stats") === "gameLog") {
      return responseJson({
        stats: [{ splits: [
          { date: "2026-07-23", stat: { gamesStarted: 1, inningsPitched: "4.2", earnedRuns: 4, runs: 4, strikeOuts: 3, baseOnBalls: 3 } },
          { date: "2026-07-17", stat: { gamesStarted: 1, inningsPitched: "5.0", earnedRuns: 2, runs: 3, strikeOuts: 4, baseOnBalls: 2 } }
        ] }]
      });
    }

    return responseJson({ error: "not found" }, 404);
  };
}

test("summarizeRecentGames calculates last 5 and last 10 from final games", () => {
  const games = [
    finalGame({ gamePk: 1, date: "2026-07-26", homeScore: 6, awayScore: 3 }),
    finalGame({ gamePk: 2, date: "2026-07-25", homeScore: 2, awayScore: 3 }),
    finalGame({ gamePk: 3, date: "2026-07-24", homeScore: 5, awayScore: 1 })
  ];
  const summary = summarizeRecentGames(games, teams.angels.id);
  assert.deepEqual(summary.last5, {
    games: 3,
    wins: 2,
    losses: 1,
    runsScored: 13,
    runsAllowed: 7,
    averageRunsScored: 4.3,
    averageRunsAllowed: 2.3
  });
});

test("summarizeVenueRecord derives home and away records from schedule data", () => {
  const games = [
    finalGame({ gamePk: 1, date: "2026-07-26", homeScore: 6, awayScore: 3 }),
    finalGame({ gamePk: 2, date: "2026-07-25", homeScore: 2, awayScore: 3 }),
    finalGame({ gamePk: 3, date: "2026-07-24", homeTeam: teams.astros, awayTeam: teams.angels, homeScore: 1, awayScore: 4 })
  ];
  assert.deepEqual(summarizeVenueRecord(games, teams.angels.id, "home"), { wins: 1, losses: 1 });
  assert.deepEqual(summarizeVenueRecord(games, teams.angels.id, "away"), { wins: 1, losses: 0 });
});

test("normalizePitcher excludes starts after the slate date", () => {
  const pitcher = normalizePitcher({
    person: { people: [{ id: 1, fullName: "Slate Starter", pitchHand: { code: "R" } }] },
    stats: { stats: [{ splits: [{ stat: { era: "3.00", whip: "1.10" } }] }] },
    gameLog: {
      stats: [{ splits: [
        { date: "2026-07-29", stat: { gamesStarted: 1, inningsPitched: "9.0", earnedRuns: 9, strikeOuts: 0, baseOnBalls: 7 } },
        { date: "2026-07-20", stat: { gamesStarted: 1, inningsPitched: "6.0", earnedRuns: 2, strikeOuts: 6, baseOnBalls: 1 } }
      ] }]
    },
    slateDate: "2026-07-27"
  });
  assert.equal(pitcher.last3Starts.starts, 1);
  assert.equal(pitcher.last3Starts.era, 3);
});

test("buildDailyPickStats builds deterministic Daily 3 MLB context from public Stats API data", async () => {
  const calls = [];
  const stats = await buildDailyPickStats({
    contentId: "content_daily3",
    fetchImpl: fakeFetchFactory(calls),
    now: "2026-07-27T16:00:00Z",
    snapshots: [{
      id: "snapshot_1",
      gameId: "mlb-777001",
      slateDate: "2026-07-27",
      selectedTeam: "Los Angeles Angels",
      homeOrAway: "Home"
    }]
  });

  assert.equal(stats.contentId, "content_daily3");
  assert.equal(stats.source, "MLB Stats API");
  assert.equal(stats.picks.length, 1);
  const pick = stats.picks[0];
  assert.equal(pick.selectedTeam.name, "Los Angeles Angels");
  assert.equal(pick.selectedTeam.homeAway, "HOME");
  assert.deepEqual(pick.selectedTeam.relevantRecord, { wins: 3, losses: 2 });
  assert.equal(pick.selectedTeam.offense.ops, ".760");
  assert.equal(pick.selectedPitcher.name, "Angels Starter");
  assert.equal(pick.selectedPitcher.last3Starts.starts, 3);
  assert.match(pick.supportingStats.join(" "), /Los Angeles Angels/);
  assert.match(pick.riskStat, /Houston Astros/);
  assert.deepEqual(pick.unavailable, ["Bullpen data unavailable"]);
  assert.ok(calls.every((call) => !call.options.method || call.options.method === "GET"));
});

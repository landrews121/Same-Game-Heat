const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NFL_TEAM_SCORE_WEIGHTS,
  DYNAMIC_SEASON_WEIGHTS,
  americanOddsToProbability,
  noVigProbability,
  getSeasonWeighting,
  calculateTeamScore,
  calculatePropQualityScore,
  classifyPropVariance,
  correlationType,
  buildNflWinnerBoard,
  buildNflSundaySessions,
  buildNflPropBoard,
  buildNflSafe6,
  buildNflHeat6,
  calculateRollover,
  buildNflBoard,
  enrichNflPropCandidates
} = require("../nfl-engine");
const {
  espnNflScoreboardUrl,
  parseEspnNflScoreboard
} = require("../nfl-public-source");
const fs = require("node:fs");

function team(name, overrides = {}) {
  return {
    name,
    moneyline: name === "Home Team" ? -125 : 105,
    metrics: {
      previousSeasonEfficiency: 78,
      rosterTalent: 80,
      quarterback: 82,
      trenchEdge: 76,
      coachingContinuity: 78,
      passMatchup: 75,
      injuries: 88,
      homeTravelWeather: 80,
      ...overrides
    }
  };
}

function prop(index, overrides = {}) {
  return {
    id: `prop-${index}`,
    gameId: `game-${index}`,
    player: `Player ${index}`,
    market: "Receptions",
    line: 4.5,
    side: "over",
    hitProbability: 0.74,
    projectionEdge: 82,
    roleVolume: 88,
    matchup: 78,
    gameScript: 75,
    marketValue: 76,
    injuryConfidence: 90,
    ...overrides
  };
}

test("NFL constants preserve the requested Week 1 prior weights", () => {
  assert.equal(Object.values(NFL_TEAM_SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0), 1);
  assert.deepEqual(DYNAMIC_SEASON_WEIGHTS[1], { prior: 0.8, current: 0.2 });
  assert.deepEqual(DYNAMIC_SEASON_WEIGHTS[6], { prior: 0.2, current: 0.8 });
  assert.deepEqual(getSeasonWeighting(12), { prior: 0.2, current: 0.8 });
});

test("market probabilities and no-vig probabilities are calculated", () => {
  assert.equal(americanOddsToProbability(-200), 2 / 3);
  assert.equal(noVigProbability(-120, 100), 0.5217391304347826);
});

test("team scoring skips unavailable inputs instead of inventing certainty", () => {
  assert.equal(calculateTeamScore({}), null);
  assert.equal(calculateTeamScore({ quarterback: 80, injuries: 90 }), 82.27);
});

test("winner board compares both sides, ranks games, and does not force missing data", () => {
  const games = [
    { id: "game-1", commenceTime: "2026-09-10T00:00:00Z", homeTeam: "Home Team", awayTeam: "Away Team", home: { ...team("Home Team"), modelWinProbability: 0.64 }, away: team("Away Team", { quarterback: 65 }) },
    { id: "game-2", commenceTime: "2026-09-11T00:00:00Z", homeTeam: "Unknown Home", awayTeam: "Unknown Away", home: { name: "Unknown Home", moneyline: -140 }, away: { name: "Unknown Away", moneyline: 120 } }
  ];
  const board = buildNflWinnerBoard(games, { week: 1 });
  assert.equal(board.all.length, 4);
  assert.equal(board.picks.length, 1);
  assert.equal(board.picks[0].team, "Home Team");
  assert.equal(board.all.find((pick) => pick.team === "Unknown Home").qualified, false);
});

test("Week 1 sparse market data still selects one official winner with neutral optional fallbacks", () => {
  const board = buildNflWinnerBoard([
    {
      id: "sparse-game",
      commenceTime: "2026-09-10T00:00:00Z",
      homeTeam: "Sparse Home",
      awayTeam: "Sparse Away",
      home: { name: "Sparse Home", moneyline: -120 },
      away: { name: "Sparse Away", moneyline: 100 }
    }
  ], { mode: "standalone", week: 1 });
  const pick = board.picks[0];
  assert.equal(board.picks.length, 1);
  assert.equal(pick.team, "Sparse Home");
  assert.equal(pick.preseasonPriorMode, true);
  assert.equal(pick.metrics.rosterTalent, 50);
  assert.equal(pick.metrics.metricSources.rosterTalent, "NEUTRAL_FALLBACK");
  assert.equal(pick.marketBaselineSource, "MARKET_DERIVED");
  assert.equal(pick.criticalData.valid, true);
  assert.equal(pick.killCritic.hardVeto, false);
});

test("winner ranking uses one best side per game and fills up to three unique games", () => {
  const games = Array.from({ length: 4 }, (_, index) => ({
    id: `sunday-game-${index}`,
    window: "sunday_early",
    commenceTime: `2026-09-${13 + index}T17:00:00Z`,
    homeTeam: `Home ${index}`,
    awayTeam: `Away ${index}`,
    home: { name: `Home ${index}`, moneyline: -130 - index },
    away: { name: `Away ${index}`, moneyline: 110 + index }
  }));
  const board = buildNflWinnerBoard(games, { mode: "sunday_early", week: 1 });
  assert.equal(board.picks.length, 3);
  assert.equal(new Set(board.picks.map((pick) => pick.gameId)).size, 3);
  assert.equal(new Set(board.picks.map((pick) => pick.team)).size, 3);
});

test("Sunday late mode returns every available unique game up to the daily limit", () => {
  const games = [0, 1].map((index) => ({
    id: `late-game-${index}`,
    window: "sunday_late",
    commenceTime: `2026-09-${13 + index}T21:00:00Z`,
    homeTeam: `Late Home ${index}`,
    awayTeam: `Late Away ${index}`,
    home: { name: `Late Home ${index}`, moneyline: -115 },
    away: { name: `Late Away ${index}`, moneyline: 105 }
  }));
  const board = buildNflWinnerBoard(games, { mode: "sunday_late", week: 1 });
  assert.equal(board.picks.length, 2);
  assert.deepEqual(board.picks.map((pick) => pick.gameId).sort(), ["late-game-0", "late-game-1"]);
});

test("Sunday sessions build independent early and late cards with first team out", () => {
  const games = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `early-${index}`,
      window: "sunday_early",
      commenceTime: `2026-09-13T${17 + Math.floor(index / 2)}:${index % 2 ? "30" : "00"}:00Z`,
      homeTeam: `Early Home ${index}`,
      awayTeam: `Early Away ${index}`,
      home: { name: `Early Home ${index}`, moneyline: -120 - index },
      away: { name: `Early Away ${index}`, moneyline: 100 + index }
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `late-${index}`,
      window: "sunday_late",
      commenceTime: `2026-09-13T${20 + Math.floor(index / 2)}:${index % 2 ? "30" : "00"}:00Z`,
      homeTeam: `Late Home ${index}`,
      awayTeam: `Late Away ${index}`,
      home: { name: `Late Home ${index}`, moneyline: -115 - index },
      away: { name: `Late Away ${index}`, moneyline: 105 + index }
    }))
  ];
  const sessions = buildNflSundaySessions(games, [], { week: 1, lateStage: "PREVIEW" });
  assert.equal(sessions.early.winners.picks.length, 3);
  assert.equal(sessions.late.winners.picks.length, 3);
  assert.equal(new Set(sessions.early.winners.picks.map((pick) => pick.gameId)).size, 3);
  assert.equal(new Set(sessions.late.winners.picks.map((pick) => pick.gameId)).size, 3);
  assert.ok(sessions.early.winners.picks.every((pick) => pick.gameId.startsWith("early-")));
  assert.ok(sessions.late.winners.picks.every((pick) => pick.gameId.startsWith("late-")));
  assert.equal(sessions.early.winners.firstTeamOut.gameId.startsWith("early-"), true);
  assert.equal(sessions.late.winners.firstTeamOut.gameId.startsWith("late-"), true);
  assert.equal(sessions.late.stage, "PREVIEW");
});

test("Sunday winner cards return available teams without duplicating a game", () => {
  const board = buildNflWinnerBoard([
    {
      id: "only-early-1",
      window: "sunday_early",
      commenceTime: "2026-09-13T17:00:00Z",
      homeTeam: "Only Home 1",
      awayTeam: "Only Away 1",
      home: { name: "Only Home 1", moneyline: -130 },
      away: { name: "Only Away 1", moneyline: 110 }
    },
    {
      id: "only-early-2",
      window: "sunday_early",
      commenceTime: "2026-09-13T18:00:00Z",
      homeTeam: "Only Home 2",
      awayTeam: "Only Away 2",
      home: { name: "Only Home 2", moneyline: -125 },
      away: { name: "Only Away 2", moneyline: 105 }
    }
  ], { mode: "sunday_early", week: 1 });
  assert.equal(board.picks.length, 2);
  assert.equal(board.complete, true);
  assert.equal(board.firstTeamOut, null);
  assert.equal(board.cardGrade, "WEAK");
  assert.ok(Number.isFinite(board.approximateCombinedModelProbability));
});

test("spread-only markets produce a conservative market-derived baseline", () => {
  const board = buildNflWinnerBoard([{
    id: "spread-game",
    commenceTime: "2026-09-10T00:00:00Z",
    homeTeam: "Spread Home",
    awayTeam: "Spread Away",
    home: { name: "Spread Home", spread: -3.5 },
    away: { name: "Spread Away", spread: 3.5 }
  }], { mode: "standalone", week: 1 });
  assert.equal(board.picks[0].marketBaselineSource, "MARKET_DERIVED");
  assert.equal(board.picks[0].criticalData.market, "MARKET_DERIVED");
  assert.ok(Math.abs(board.picks[0].modelWinProbability - 0.5875) < 0.001);
});

test("critical data failures hard-veto recommendations but remain visible for inspection", () => {
  const board = buildNflWinnerBoard([{
    id: "missing-market-game",
    commenceTime: "2026-09-10T00:00:00Z",
    homeTeam: "Missing Home",
    awayTeam: "Missing Away",
    home: { name: "Missing Home" },
    away: { name: "Missing Away" }
  }], { mode: "standalone", week: 1 });
  assert.equal(board.picks.length, 0);
  assert.equal(board.all.length, 2);
  assert.equal(board.all.every((pick) => pick.killCritic.hardVeto), true);
  assert.equal(board.all[0].criticalData.market, "MISSING");
});

test("prop scoring classifies variance and Safe 6 uses a touchdown fallback only when needed", () => {
  assert.equal(classifyPropVariance("Rush Attempts"), "low");
  assert.equal(classifyPropVariance("Anytime Touchdown"), "high");
  assert.ok(calculatePropQualityScore(prop(1)) >= 80);
  const props = buildNflPropBoard([prop(1), prop(2, { market: "Anytime Touchdown" })]);
  const safe = buildNflSafe6(props);
  assert.equal(safe.legs.length, 2);
  assert.equal(safe.legs[0].player, "Player 1");
});

test("raw sportsbook props become modeled over and under candidates with side-specific odds", () => {
  const raw = [{ id: "raw-1", gameId: "game-1", player: "Quarterback One", market: "Passing Yards", marketKey: "player_pass_yds", line: 250.5, overOdds: -115, underOdds: -105 }];
  const enriched = enrichNflPropCandidates([{ id: "game-1", homeTeam: "Home Team", awayTeam: "Away Team" }], raw, { week: 1, priorSeason: 2025, playerContexts: { "Quarterback One": { position: "QB", priorStats: { passingYardsPerGame: 275, passAttemptsPerGame: 35, yardsPerAttempt: 7.8 } } } });
  assert.equal(enriched.length, 2);
  assert.deepEqual(enriched.map((candidate) => candidate.side).sort(), ["over", "under"]);
  assert.ok(enriched.every((candidate) => Number.isFinite(candidate.projection)));
  assert.ok(enriched.every((candidate) => Number.isFinite(candidate.hitProbability)));
  assert.equal(enriched.find((candidate) => candidate.side === "over").odds, -115);
  assert.equal(enriched.find((candidate) => candidate.side === "under").odds, -105);
  assert.equal(enriched[0].sourceMetadata.sourceType, "PRIOR");
  assert.equal(enriched[0].sourceMetadata.sourceSeason, 2025);
});

test("model board keeps only the stronger side of an opposite prop pair", () => {
  const raw = [{ id: "raw-2", gameId: "game-1", player: "Receiver One", market: "Receptions", marketKey: "player_receptions", line: 5.5, overOdds: -140, underOdds: 115 }];
  const board = buildNflBoard({ games: [{ id: "game-1", homeTeam: "Home Team", awayTeam: "Away Team" }], candidates: raw, week: 1 });
  assert.equal(board.props.length, 1);
  assert.ok(["over", "under"].includes(board.props[0].side));
  assert.equal(board.propModelStatus.rawPropMarkets, 1);
  assert.equal(board.propModelStatus.modeledCandidates, 2);
});

test("Safe 6 ranks lower-variance fallbacks and Heat 6 fills six modeled markets", () => {
  const raw = Array.from({ length: 6 }, (_, index) => ({ id: `raw-${index}`, gameId: `game-${index}`, player: `Player ${index}`, market: "Receptions", marketKey: "player_receptions", line: 4.5, overOdds: -110, underOdds: -110 }));
  const board = buildNflBoard({ games: raw.map((candidate) => ({ id: candidate.gameId, homeTeam: `Home ${candidate.gameId}`, awayTeam: `Away ${candidate.gameId}` })), candidates: raw, week: 1 });
  assert.equal(board.safe6.legs.length, 6);
  assert.equal(board.safe6.complete, true);
  assert.equal(board.heat6.legs.length, 6);
  assert.equal(board.heat6.complete, true);
});

test("Safe 6 and Heat 6 fill available modeled legs, while Heat 6 reports correlation", () => {
  const props = buildNflPropBoard([
    prop(1, { gameId: "same-game", market: "Passing Yards" }),
    prop(2, { gameId: "same-game", market: "Receiving Yards" }),
    prop(3, { gameId: "game-3" }),
    prop(4, { gameId: "game-4" }),
    prop(5, { gameId: "game-5" }),
    prop(6, { gameId: "game-6", market: "Anytime Touchdown" })
  ]);
  const safe = buildNflSafe6(props);
  const heat = buildNflHeat6(props);
  assert.equal(safe.complete, true);
  assert.equal(heat.complete, true);
  assert.equal(heat.correlated, true);
  assert.equal(correlationType({ ...props[0], gameId: "same-game", market: "Passing Yards" }, { ...props[1], gameId: "same-game", market: "Receiving Yards" }), "positive");
});

test("rollover protects only the selected share of early profit", () => {
  const rollover = calculateRollover({ startingBankroll: 100, earlyWager: 50, earlyReturn: 90, mode: "standard" });
  assert.equal(rollover.earlyProfit, 40);
  assert.equal(rollover.protectedProfit, 20);
  assert.equal(rollover.lateRolloverBankroll, 20);
});

test("combined NFL board exposes the four requested board components", () => {
  const board = buildNflBoard({
    games: [{ id: "game-1", commenceTime: "2026-09-10T00:00:00Z", homeTeam: "Home Team", awayTeam: "Away Team", home: team("Home Team"), away: team("Away Team") }],
    candidates: [prop(1)],
    mode: "standalone",
    week: 1,
    rollover: { startingBankroll: 100, earlyWager: 50, earlyReturn: 90 }
  });
  assert.equal(board.mode, "standalone");
  assert.ok(board.winners);
  assert.ok(board.safe6);
  assert.ok(board.heat6);
  assert.equal(board.rollover.lateRolloverBankroll, 20);
});

test("public ESPN fallback normalizes games without inventing missing moneylines", () => {
  const games = parseEspnNflScoreboard({
    events: [{
      id: "100",
      date: "2026-09-04T23:00:00Z",
      competitions: [{
        competitors: [
          { homeAway: "home", team: { displayName: "Home Team", abbreviation: "HOM" } },
          { homeAway: "away", team: { displayName: "Away Team", abbreviation: "AWY" } }
        ],
        odds: [{ details: "Home Team -3.5", overUnder: 44.5 }]
      }]
    }]
  });
  assert.equal(games.length, 1);
  assert.equal(games[0].source, "ESPN public scoreboard");
  assert.equal(games[0].homeTeam, "Home Team");
  assert.equal(games[0].total, 44.5);
  assert.equal(games[0].home.moneyline, null);
  assert.equal(games[0].home.spread, -3.5);
  assert.equal(games[0].away.spread, 3.5);
  assert.equal(Object.keys(games[0].moneylines).length, 0);
  assert.match(espnNflScoreboardUrl("2026-09-04"), /dates=20260904/);
});

test("public ESPN fallback preserves moneylines when exposed by the payload", () => {
  const games = parseEspnNflScoreboard({
    events: [{
      id: "101",
      competitions: [{
        competitors: [
          { homeAway: "home", team: { displayName: "Home Team" }, moneyline: -135 },
          { homeAway: "away", team: { displayName: "Away Team" }, moneyLine: 115 }
        ]
      }]
    }]
  });
  assert.equal(games[0].home.moneyline, -135);
  assert.equal(games[0].away.moneyline, 115);
});

test("NFL page uses the current asset cache version", () => {
  const html = fs.readFileSync(require.resolve("../nfl.html"), "utf8");
  assert.match(html, /styles\.css\?v=nfl-v4/);
  assert.match(html, /nfl\.js\?v=nfl-v4/);
});

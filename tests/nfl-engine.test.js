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
  buildNflPropBoard,
  buildNflSafe6,
  buildNflHeat6,
  calculateRollover,
  buildNflBoard
} = require("../nfl-engine");

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
    { id: "game-1", homeTeam: "Home Team", awayTeam: "Away Team", home: { ...team("Home Team"), modelWinProbability: 0.64 }, away: team("Away Team", { quarterback: 65 }) },
    { id: "game-2", homeTeam: "Unknown Home", awayTeam: "Unknown Away", home: { name: "Unknown Home", moneyline: -140 }, away: { name: "Unknown Away", moneyline: 120 } }
  ];
  const board = buildNflWinnerBoard(games, { week: 1 });
  assert.equal(board.all.length, 4);
  assert.equal(board.picks.length, 1);
  assert.equal(board.picks[0].team, "Home Team");
  assert.equal(board.all.find((pick) => pick.team === "Unknown Home").qualified, false);
});

test("prop scoring classifies variance and KILLCRITIC keeps touchdown legs out of Safe 6", () => {
  assert.equal(classifyPropVariance("Rush Attempts"), "low");
  assert.equal(classifyPropVariance("Anytime Touchdown"), "high");
  assert.ok(calculatePropQualityScore(prop(1)) >= 80);
  const props = buildNflPropBoard([prop(1), prop(2, { market: "Anytime Touchdown" })]);
  const safe = buildNflSafe6(props);
  assert.equal(safe.legs.length, 1);
  assert.equal(safe.legs[0].player, "Player 1");
});

test("Safe 6 and Heat 6 never manufacture legs, while Heat 6 reports correlation", () => {
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
  assert.equal(safe.complete, false);
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
    games: [{ id: "game-1", homeTeam: "Home Team", awayTeam: "Away Team", home: team("Home Team"), away: team("Away Team") }],
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

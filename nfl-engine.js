"use strict";

const NFL_MARKETS = [
  "h2h",
  "spreads",
  "totals",
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_attempts",
  "player_rush_yds",
  "player_rush_attempts",
  "player_reception_yds",
  "player_receptions",
  "player_anytime_td"
];

const NFL_BOARD_MODES = ["standalone", "sunday_early", "sunday_late", "rollover"];

const NFL_OPTIONAL_METRICS = [
  "previousSeasonEfficiency",
  "rosterTalent",
  "quarterback",
  "trenchEdge",
  "coachingContinuity",
  "passMatchup",
  "defensiveMatchup",
  "injuries",
  "homeTravelWeather"
];

const NFL_TEAM_SCORE_WEIGHTS = Object.freeze({
  previousSeasonEfficiency: 0.22,
  rosterTalent: 0.18,
  quarterback: 0.17,
  trenchEdge: 0.10,
  coachingContinuity: 0.10,
  passMatchup: 0.08,
  injuries: 0.05,
  marketProbability: 0.05,
  homeTravelWeather: 0.05
});

const NFL_WINNER_QUALITY_WEIGHTS = Object.freeze({
  trueWinProbability: 0.25,
  quarterback: 0.15,
  trenchEdge: 0.15,
  offensiveMatchup: 0.125,
  defensiveMatchup: 0.10,
  marketValue: 0.10,
  injuries: 0.05,
  coachingContinuity: 0.05,
  weatherSituational: 0.025
});

const NFL_PROP_SCORE_WEIGHTS = Object.freeze({
  projectionEdge: 0.30,
  roleVolume: 0.25,
  matchup: 0.15,
  gameScript: 0.10,
  marketValue: 0.10,
  injuryConfidence: 0.05,
  variance: 0.05
});

const DYNAMIC_SEASON_WEIGHTS = Object.freeze({
  1: { prior: 0.80, current: 0.20 },
  2: { prior: 0.70, current: 0.30 },
  3: { prior: 0.60, current: 0.40 },
  4: { prior: 0.50, current: 0.50 },
  5: { prior: 0.35, current: 0.65 },
  6: { prior: 0.20, current: 0.80 }
});

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value)));
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreValue(value) {
  const parsed = numeric(value);
  return parsed === null ? null : clamp(parsed);
}

function americanOddsToProbability(odds) {
  const value = numeric(odds);
  if (value === null || value === 0) return null;
  return value < 0 ? Math.abs(value) / (Math.abs(value) + 100) : 100 / (value + 100);
}

function probabilityToAmericanOdds(probability) {
  const value = clamp(Number(probability) * 100, 0.01, 99.99) / 100;
  if (value >= 0.5) return Math.round(-100 * value / (1 - value));
  return Math.round(100 * (1 - value) / value);
}

function noVigProbability(odds, opposingOdds) {
  const first = americanOddsToProbability(odds);
  const second = americanOddsToProbability(opposingOdds);
  if (first === null || second === null || first + second <= 0) return null;
  return first / (first + second);
}

function normalizeNflMode(mode) {
  return NFL_BOARD_MODES.includes(mode) ? mode : "standalone";
}

function getSeasonWeighting(week) {
  const numericWeek = Math.max(1, Math.floor(Number(week) || 1));
  if (numericWeek >= 6) return DYNAMIC_SEASON_WEIGHTS[6];
  return DYNAMIC_SEASON_WEIGHTS[numericWeek] || DYNAMIC_SEASON_WEIGHTS[1];
}

function nflWindowFilter(games, mode) {
  const selectedMode = normalizeNflMode(mode);
  if (selectedMode === "standalone" || selectedMode === "rollover") return [...games];
  return games.filter((game) => {
    if (game.window === selectedMode) return true;
    const kickoff = Date.parse(game.commenceTime || game.commence_time || "");
    if (!Number.isFinite(kickoff)) return false;
    const date = new Date(kickoff);
    if (date.getUTCDay() !== 0) return false;
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    if (selectedMode === "sunday_early") return hour >= 17 && hour < 20;
    return hour >= 20 && hour < 24;
  });
}

function sideForGame(game, side) {
  return game?.[side] || game?.teams?.[side] || {};
}

function sideName(game, side) {
  const data = sideForGame(game, side);
  return data.name || data.team || (side === "home" ? game?.homeTeam : game?.awayTeam) || "";
}

function sideOdds(game, side) {
  const name = sideName(game, side);
  return numeric(
    sideForGame(game, side).moneyline ??
    sideForGame(game, side).odds ??
    game?.moneylines?.[name] ??
    game?.moneyline?.[side]
  );
}

function pairedOdds(game, side) {
  const otherSide = side === "home" ? "away" : "home";
  return sideOdds(game, otherSide);
}

function spreadForSide(game, side) {
  const data = sideForGame(game, side);
  const direct = numeric(data.spread ?? data.pointSpread ?? data.line);
  if (direct !== null) return direct;
  const entries = Array.isArray(game?.spread) ? game.spread : Array.isArray(game?.spreads) ? game.spreads : [];
  const name = sideName(game, side);
  const entry = entries.find((item) => item?.name === name || item?.team === name || item?.description === name);
  const entryPoint = numeric(entry?.point ?? entry?.spread ?? entry?.line);
  if (entryPoint !== null) return entryPoint;
  const detail = typeof game?.spread === "string" ? game.spread : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = escapedName ? detail.match(new RegExp(`${escapedName}\\s+([+-]?\\d+(?:\\.\\d+)?)`, "i")) : null;
  return numeric(match?.[1]);
}

function spreadWinProbability(spread) {
  const value = numeric(spread);
  if (value === null) return null;
  // A conservative approximation used only when a moneyline is unavailable.
  return clamp(0.5 - value * 0.025, 0.15, 0.85);
}

function marketBaseline(game, side) {
  const odds = sideOdds(game, side);
  const opponentOdds = pairedOdds(game, side);
  const moneylineProbability = noVigProbability(odds, opponentOdds) ?? americanOddsToProbability(odds);
  if (moneylineProbability !== null) return { probability: moneylineProbability, source: "MARKET_DERIVED", market: "moneyline" };
  const spreadProbability = spreadWinProbability(spreadForSide(game, side));
  if (spreadProbability !== null) return { probability: spreadProbability, source: "MARKET_DERIVED", market: "spread" };
  return { probability: null, source: "MISSING", market: null };
}

function criticalDataStatus(game, side) {
  const home = sideName(game, "home");
  const away = sideName(game, "away");
  const status = String(game?.status || game?.gameStatus || "").toLowerCase();
  const market = marketBaseline(game, side);
  const valid = Boolean(home && away && (game?.commenceTime || game?.commence_time) && market.probability !== null && !/(cancel|postpon|suspend)/.test(status));
  return {
    valid,
    schedule: Boolean(home && away && (game?.commenceTime || game?.commence_time)) ? "VERIFIED" : "MISSING",
    market: market.probability === null ? "MISSING" : market.source,
    reason: valid ? "" : "Game identity, kickoff, or a usable moneyline/spread is missing."
  };
}

function metricValues(metrics = {}) {
  return {
    previousSeasonEfficiency: metrics.previousSeasonEfficiency ?? metrics.efficiency ?? metrics.epa,
    rosterTalent: metrics.rosterTalent ?? metrics.talent,
    quarterback: metrics.quarterback ?? metrics.qb,
    trenchEdge: metrics.trenchEdge ?? metrics.offensiveLine ?? metrics.oline,
    coachingContinuity: metrics.coachingContinuity ?? metrics.coaching,
    passMatchup: metrics.passMatchup ?? metrics.offensiveMatchup,
    injuries: metrics.injuries ?? metrics.health,
    marketProbability: metrics.marketProbability,
    homeTravelWeather: metrics.homeTravelWeather ?? metrics.situation,
    offensiveMatchup: metrics.offensiveMatchup ?? metrics.passMatchup,
    defensiveMatchup: metrics.defensiveMatchup ?? metrics.defense,
    weatherSituational: metrics.weatherSituational ?? metrics.situation
  };
}

function metricSource(metrics = {}, key) {
  const sources = metrics.metricSources || metrics.sources || {};
  return String(sources[key] || "").toUpperCase() || null;
}

function resolveTeamMetrics(data = {}, options = {}) {
  const raw = { ...(data.metrics || data) };
  const prior = data.priorMetrics || data.preseasonMetrics || {};
  const current = data.currentMetrics || {};
  const values = metricValues(raw);
  const resolved = {};
  const sources = {};

  NFL_OPTIONAL_METRICS.forEach((key) => {
    const direct = scoreValue(values[key]);
    const currentValue = scoreValue(metricValues(current)[key]);
    const priorValue = scoreValue(metricValues(prior)[key]);
    if (currentValue !== null) {
      resolved[key] = currentValue;
      sources[key] = metricSource(current, key) || "VERIFIED";
    } else if (direct !== null) {
      resolved[key] = direct;
      sources[key] = metricSource(raw, key) || (options.preseasonPriorMode ? "PRIOR" : "VERIFIED");
    } else if (priorValue !== null) {
      resolved[key] = priorValue;
      sources[key] = "PRIOR";
    } else {
      resolved[key] = 50;
      sources[key] = "NEUTRAL_FALLBACK";
    }
  });

  return { ...resolved, metricSources: sources };
}

function dataConfidence(metrics = {}, critical = {}) {
  const sources = metrics.metricSources || {};
  const verified = NFL_OPTIONAL_METRICS.filter((key) => ["VERIFIED", "MARKET_DERIVED"].includes(String(sources[key]).toUpperCase())).length;
  const prior = NFL_OPTIONAL_METRICS.filter((key) => String(sources[key]).toUpperCase() === "PRIOR").length;
  const optionalScore = (verified + prior * 0.7) / NFL_OPTIONAL_METRICS.length;
  const criticalScore = critical.valid ? 1 : 0;
  const score = Math.round((criticalScore * 0.35 + optionalScore * 0.65) * 100);
  return {
    score,
    level: score >= 75 ? "HIGH" : score >= 50 ? "MODERATE" : "LOW",
    verifiedMetrics: verified,
    priorMetrics: prior,
    neutralMetrics: NFL_OPTIONAL_METRICS.length - verified - prior
  };
}

function calculateTeamScore(metrics = {}, options = {}) {
  const values = metricValues(metrics);
  const weekWeighting = getSeasonWeighting(options.week);
  let weightedTotal = 0;
  let availableWeight = 0;

  Object.entries(NFL_TEAM_SCORE_WEIGHTS).forEach(([key, weight]) => {
    const value = scoreValue(values[key]);
    if (value === null) return;
    const effectiveWeight = key === "previousSeasonEfficiency"
      ? weight * weekWeighting.prior
      : weight;
    weightedTotal += value * effectiveWeight;
    availableWeight += effectiveWeight;
  });

  if (!availableWeight) return null;
  return Math.round((weightedTotal / availableWeight) * 100) / 100;
}

function dataCompleteness(metrics = {}) {
  const values = metricValues(metrics);
  const keys = Object.keys(NFL_TEAM_SCORE_WEIGHTS);
  return keys.filter((key) => scoreValue(values[key]) !== null).length / keys.length;
}

function modelProbability(teamScore, opponentScore, marketProbability) {
  if (marketProbability === null || marketProbability === undefined) return null;
  if (teamScore === null || opponentScore === null) return marketProbability;
  const footballAdjustment = (teamScore - opponentScore) * 0.002;
  return clamp(marketProbability + footballAdjustment, 0.05, 0.95);
}

function gradeScore(score) {
  if (score >= 88) return "A+";
  if (score >= 82) return "A";
  if (score >= 76) return "B+";
  if (score >= 70) return "B";
  if (score >= 64) return "B-";
  if (score >= 58) return "C+";
  return "C";
}

function winnerQualityScore({ probability, marketProbability, metrics = {} }) {
  const values = metricValues(metrics);
  const edgeScore = marketProbability === null || probability === null
    ? null
    : clamp(50 + (probability - marketProbability) * 2500);
  const qualityValues = {
    trueWinProbability: probability === null ? null : probability * 100,
    quarterback: values.quarterback,
    trenchEdge: values.trenchEdge,
    offensiveMatchup: values.offensiveMatchup,
    defensiveMatchup: values.defensiveMatchup,
    marketValue: edgeScore,
    injuries: values.injuries,
    coachingContinuity: values.coachingContinuity,
    weatherSituational: values.weatherSituational
  };
  let total = 0;
  let weight = 0;
  Object.entries(NFL_WINNER_QUALITY_WEIGHTS).forEach(([key, factor]) => {
    const value = scoreValue(qualityValues[key]);
    if (value === null) return;
    total += value * factor;
    weight += factor;
  });
  return weight ? Math.round((total / weight) * 100) / 100 : null;
}

function killCriticWinner(pick, opponent = {}) {
  const reasons = [];
  const metrics = metricValues(pick.metrics || {});
  if (pick.dataConfidence?.level === "LOW") reasons.push("Most football intelligence is unavailable; this is a low-data prior.");
  if (pick.dataConfidence?.neutralMetrics) reasons.push(`${pick.dataConfidence.neutralMetrics} optional metrics use neutral fallback values.`);
  if (scoreValue(metrics.quarterback) !== null && scoreValue(metricValues(opponent).quarterback) !== null && metrics.quarterback < metricValues(opponent).quarterback) {
    reasons.push("The opponent may have the quarterback edge.");
  }
  if (metrics.injuries !== null && metrics.injuries < 55) reasons.push("Injury or depth-chart risk lowers confidence.");
  if (pick.edge !== null && pick.edge < 0) reasons.push("The market price is stronger than the model edge.");
  return {
    hardVeto: pick.criticalData?.valid === false || pick.status === "cancelled" || pick.status === "postponed" || pick.status === "suspended" || pick.qbStatus === "confirmed_scratch",
    scorePenalty: reasons.length * 3,
    reasons
  };
}

function buildNflWinnerBoard(games = [], options = {}) {
  const week = options.week || 1;
  const selectedGames = nflWindowFilter(games, options.mode);
  const picks = [];

  selectedGames.forEach((game) => {
    const home = sideForGame(game, "home");
    const away = sideForGame(game, "away");
    const homeOdds = sideOdds(game, "home");
    const awayOdds = sideOdds(game, "away");
    const sides = [
      { side: "home", data: home, odds: homeOdds, opponent: away, opponentOdds: awayOdds },
      { side: "away", data: away, odds: awayOdds, opponent: home, opponentOdds: homeOdds }
    ];
    sides.forEach(({ side, data, odds, opponent, opponentOdds }) => {
      const market = marketBaseline(game, side);
      const opponentMarket = marketBaseline(game, side === "home" ? "away" : "home");
      const preseasonPriorMode = options.preseasonPriorMode ?? week <= 1;
      const metrics = { ...resolveTeamMetrics(data, { preseasonPriorMode }), marketProbability: market.probability };
      const opponentMetrics = { ...resolveTeamMetrics(opponent, { preseasonPriorMode }), marketProbability: opponentMarket.probability };
      const teamScore = calculateTeamScore(metrics, { week });
      const opponentScore = calculateTeamScore(opponentMetrics, { week });
      const marketProbability = market.probability;
      const probability = data.modelWinProbability ?? modelProbability(teamScore, opponentScore, marketProbability);
      const edge = probability === null || marketProbability === null ? null : probability - marketProbability;
      const footballAdjustment = probability === null || marketProbability === null ? null : probability - marketProbability;
      const quality = winnerQualityScore({ probability, marketProbability, metrics });
      const criticalData = criticalDataStatus(game, side);
      const completeness = dataCompleteness(data.metrics || data);
      const pick = {
        id: `${game.id || `${sideName(game, "away")}-${sideName(game, "home")}`}-${side}`,
        gameId: game.id || null,
        team: sideName(game, side),
        opponent: sideName(game, side === "home" ? "away" : "home"),
        homeOrAway: side === "home" ? "Home" : "Away",
        moneyline: odds,
        modelWinProbability: probability,
        noVigMarketProbability: marketProbability,
        modelEdge: edge,
        teamScore,
        betQualityScore: quality,
        grade: quality === null ? "C" : gradeScore(quality),
        dataCompleteness: completeness,
        metrics,
        marketBaselineProbability: marketProbability,
        footballAdjustment,
        marketBaselineSource: market.source,
        preseasonPriorMode,
        criticalData,
        reasons: data.reasons || [],
        riskFlags: data.riskFlags || [],
        commenceTime: game.commenceTime || game.commence_time || "",
        status: game.status || game.gameStatus || "scheduled",
        qbStatus: data.qbStatus || "uncertain"
      };
      pick.metrics.metricSources.marketProbability = market.source;
      pick.dataConfidence = dataConfidence(metrics, criticalData);
      const critic = killCriticWinner(pick, opponentMetrics);
      pick.killCritic = critic;
      pick.betQualityScore = quality === null ? null : Math.max(0, Math.round((quality - critic.scorePenalty) * 100) / 100);
      pick.grade = pick.betQualityScore === null ? "C" : gradeScore(pick.betQualityScore);
      pick.qualified = !critic.hardVeto && pick.betQualityScore !== null && pick.betQualityScore >= (options.minimumScore || 68) && probability !== null && probability >= (options.minimumProbability || 0.58) && completeness >= (options.minimumCompleteness || 0.45);
      picks.push(pick);
    });
  });

  const ranked = picks
    .sort((a, b) => (b.modelWinProbability || 0) - (a.modelWinProbability || 0) || (b.betQualityScore || 0) - (a.betQualityScore || 0));
  const eligible = ranked.filter((pick) => !pick.killCritic.hardVeto);
  const bestByGame = [];
  const gamesSeen = new Set();
  eligible.forEach((pick) => {
    if (gamesSeen.has(pick.gameId)) return;
    bestByGame.push(pick);
    gamesSeen.add(pick.gameId);
  });
  const qualified = eligible.filter((pick) => pick.qualified);
  const selectedLimit = normalizeNflMode(options.mode) === "standalone" ? 1 : Math.min(3, bestByGame.length);
  const selected = bestByGame.slice(0, selectedLimit);
  return {
    all: ranked,
    qualified,
    picks: selected,
    eligible: bestByGame,
    complete: selected.length >= Math.min(selectedLimit, selectedGames.length)
  };
}

function classifyPropVariance(market = "") {
  const key = String(market).toLowerCase();
  if (key.includes("attempt") || key.includes("reception") || key.includes("completion")) return "low";
  if (key.includes("yard")) return "medium";
  if (key.includes("td") || key.includes("touchdown") || key.includes("longest") || key.includes("interception")) return "high";
  return "medium";
}

function calculatePropQualityScore(prop = {}) {
  const varianceScore = prop.varianceScore ?? (classifyPropVariance(prop.market) === "low" ? 90 : classifyPropVariance(prop.market) === "medium" ? 72 : 45);
  const values = {
    projectionEdge: prop.projectionEdge ?? prop.edgeScore,
    roleVolume: prop.roleVolume ?? prop.opportunityScore,
    matchup: prop.matchup ?? prop.matchupScore,
    gameScript: prop.gameScript ?? prop.scriptScore,
    marketValue: prop.marketValue ?? prop.valueScore,
    injuryConfidence: prop.injuryConfidence ?? prop.healthScore,
    variance: varianceScore
  };
  let total = 0;
  let weight = 0;
  Object.entries(NFL_PROP_SCORE_WEIGHTS).forEach(([key, factor]) => {
    const value = scoreValue(values[key]);
    if (value === null) return;
    total += value * factor;
    weight += factor;
  });
  return weight ? Math.round((total / weight) * 100) / 100 : null;
}

function killCriticProp(prop = {}) {
  const reasons = [];
  if (prop.roleVolume !== undefined && Number(prop.roleVolume) < 55) reasons.push("Role or opportunity is not secure.");
  if (prop.injuryStatus === "questionable" || prop.injuryStatus === "limited") reasons.push("Player availability or workload is uncertain.");
  if (classifyPropVariance(prop.market) === "high") reasons.push("This is a high-variance market.");
  if (prop.projection === undefined || prop.projection === null) reasons.push("No model projection is available.");
  return { hardVeto: prop.status === "inactive" || prop.roleVolume === 0, scorePenalty: reasons.length * 3, reasons };
}

function correlationType(first, second) {
  if (!first || !second || first.gameId !== second.gameId) return "independent-ish";
  const firstMarket = String(first.market || "").toLowerCase();
  const secondMarket = String(second.market || "").toLowerCase();
  if (first.player === second.player) return "same-player";
  if (first.side === "over" && second.side === "over" && (firstMarket.includes("pass") || firstMarket.includes("receiv")) && (secondMarket.includes("pass") || secondMarket.includes("receiv"))) return "positive";
  if (firstMarket.includes("rush attempt") && secondMarket.includes("pass attempt")) return "negative";
  return "neutral";
}

function buildNflPropBoard(candidates = [], options = {}) {
  return candidates
    .map((candidate) => {
      const score = calculatePropQualityScore(candidate);
      const critic = killCriticProp(candidate);
      const hitProbability = numeric(candidate.hitProbability);
      const result = {
        ...candidate,
        variance: candidate.variance || classifyPropVariance(candidate.market),
        qualityScore: score === null ? null : Math.max(0, Math.round((score - critic.scorePenalty) * 100) / 100),
        grade: score === null ? "C" : gradeScore(Math.max(0, score - critic.scorePenalty)),
        killCritic: critic,
        qualified: !critic.hardVeto && hitProbability !== null && hitProbability >= (options.minimumProbability || 0.60) && score !== null
      };
      return result;
    })
    .sort((a, b) => (b.hitProbability || 0) - (a.hitProbability || 0) || (b.qualityScore || 0) - (a.qualityScore || 0));
}

function chooseDiversified(candidates, count) {
  const selected = [];
  const usedGames = new Set();
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (!usedGames.has(candidate.gameId)) {
      selected.push(candidate);
      usedGames.add(candidate.gameId);
    }
  }
  candidates.forEach((candidate) => {
    if (selected.length < count && !selected.some((item) => item.id === candidate.id)) selected.push(candidate);
  });
  return selected;
}

function buildNflSafe6(candidates = []) {
  const qualified = candidates.filter((candidate) => candidate.qualified && ["low", "medium"].includes(candidate.variance) && (candidate.hitProbability || 0) >= 0.68);
  const legs = chooseDiversified(qualified, 6);
  return { legs, qualified, complete: legs.length === 6, reason: legs.length === 6 ? "Six low-to-medium variance legs cleared the Safe 6 threshold." : "Fewer than six low-to-medium variance legs cleared the 68% threshold; no legs were forced." };
}

function buildNflHeat6(candidates = []) {
  const qualified = candidates.filter((candidate) => candidate.qualified && (candidate.hitProbability || 0) >= 0.60);
  const legs = chooseDiversified(qualified, 6);
  const correlated = legs.some((leg, index) => legs.slice(index + 1).some((other) => correlationType(leg, other) === "positive"));
  return { legs, qualified, complete: legs.length === 6, correlated, reason: legs.length === 6 ? "Six edge-focused legs cleared the Heat 6 threshold." : "Fewer than six props cleared the 60% threshold; no legs were forced." };
}

function calculateRollover({ startingBankroll = 0, earlyWager = 0, earlyReturn = 0, mode = "standard" } = {}) {
  const rates = { conservative: 0.25, standard: 0.50, aggressive: 0.75 };
  const earlyProfit = Number(earlyReturn) - Number(earlyWager);
  const protectedProfit = Math.max(0, earlyProfit * (rates[mode] ?? rates.standard));
  return {
    startingBankroll: Number(startingBankroll),
    earlyWager: Number(earlyWager),
    earlyReturn: Number(earlyReturn),
    earlyProfit,
    protectedProfit,
    lateRolloverBankroll: protectedProfit,
    mode: rates[mode] ? mode : "standard"
  };
}

function buildNflBoard({ games = [], candidates = [], mode = "standalone", week = 1, rollover } = {}) {
  const winnerBoard = buildNflWinnerBoard(games, { mode, week });
  const props = buildNflPropBoard(candidates, { minimumProbability: 0.60 });
  return {
    mode: normalizeNflMode(mode),
    week,
    preseasonPriorMode: week <= 1,
    games: nflWindowFilter(games, mode),
    winners: winnerBoard,
    props,
    safe6: buildNflSafe6(props),
    heat6: buildNflHeat6(props),
    rollover: rollover ? calculateRollover(rollover) : null,
    generatedAt: new Date().toISOString()
  };
}

function summarizeNflPerformance(records = []) {
  const completed = records.filter((record) => record && (record.status === "hit" || record.status === "miss"));
  const hits = completed.filter((record) => record.status === "hit").length;
  return {
    completed: completed.length,
    hits,
    misses: completed.length - hits,
    hitRate: completed.length ? hits / completed.length : null,
    boardHitRate: records.length ? records.filter((record) => record.boardHit).length / records.length : null
  };
}

module.exports = {
  NFL_MARKETS,
  NFL_BOARD_MODES,
  NFL_TEAM_SCORE_WEIGHTS,
  NFL_WINNER_QUALITY_WEIGHTS,
  NFL_PROP_SCORE_WEIGHTS,
  DYNAMIC_SEASON_WEIGHTS,
  americanOddsToProbability,
  probabilityToAmericanOdds,
  noVigProbability,
  normalizeNflMode,
  nflWindowFilter,
  getSeasonWeighting,
  calculateTeamScore,
  dataCompleteness,
  gradeScore,
  calculatePropQualityScore,
  classifyPropVariance,
  correlationType,
  killCriticWinner,
  killCriticProp,
  buildNflWinnerBoard,
  buildNflPropBoard,
  buildNflSafe6,
  buildNflHeat6,
  calculateRollover,
  buildNflBoard,
  summarizeNflPerformance
};

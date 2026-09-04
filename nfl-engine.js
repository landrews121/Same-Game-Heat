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

const NFL_PROP_MARKET_SPECS = Object.freeze({
  player_pass_yds: { kind: "passingYards", variance: "medium", standardDeviation: 36 },
  player_pass_attempts: { kind: "passAttempts", variance: "low", standardDeviation: 5 },
  player_pass_tds: { kind: "passingTouchdowns", variance: "high", standardDeviation: 0.75 },
  player_rush_yds: { kind: "rushingYards", variance: "medium", standardDeviation: 22 },
  player_rush_attempts: { kind: "rushAttempts", variance: "low", standardDeviation: 5 },
  player_reception_yds: { kind: "receivingYards", variance: "medium", standardDeviation: 18 },
  player_receptions: { kind: "receptions", variance: "low", standardDeviation: 2.5 },
  player_anytime_td: { kind: "anytimeTouchdown", variance: "high", standardDeviation: null }
});

function firstNumeric(source, keys = []) {
  for (const key of keys) {
    const value = numeric(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizePlayerName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function playerContextFor(candidate, options = {}) {
  const configured = options.playerContexts || options.playerStats || options.contextByPlayer || {};
  const name = normalizePlayerName(candidate.player);
  let found = {};
  if (Array.isArray(configured)) {
    found = configured.find((item) => normalizePlayerName(item?.player || item?.name || item?.fullName) === name) || {};
  } else if (configured && typeof configured === "object") {
    found = configured[candidate.player] || configured[name] || {};
    if (!Object.keys(found).length) {
      const matchingKey = Object.keys(configured).find((key) => normalizePlayerName(key) === name);
      found = matchingKey ? configured[matchingKey] || {} : {};
    }
  }
  return { ...(candidate.playerContext || {}), ...found };
}

function propMarketSpec(candidate = {}) {
  const marketKey = String(candidate.marketKey || "").toLowerCase();
  if (NFL_PROP_MARKET_SPECS[marketKey]) return { marketKey, ...NFL_PROP_MARKET_SPECS[marketKey] };
  const market = String(candidate.market || "").toLowerCase();
  if (market.includes("pass") && market.includes("yard")) return { marketKey, kind: "passingYards", variance: "medium", standardDeviation: 36 };
  if (market.includes("pass") && market.includes("attempt")) return { marketKey, kind: "passAttempts", variance: "low", standardDeviation: 5 };
  if (market.includes("pass") && (market.includes("td") || market.includes("touchdown"))) return { marketKey, kind: "passingTouchdowns", variance: "high", standardDeviation: 0.75 };
  if (market.includes("rush") && market.includes("yard")) return { marketKey, kind: "rushingYards", variance: "medium", standardDeviation: 22 };
  if (market.includes("rush") && market.includes("attempt")) return { marketKey, kind: "rushAttempts", variance: "low", standardDeviation: 5 };
  if ((market.includes("receiv") || market.includes("catch")) && market.includes("yard")) return { marketKey, kind: "receivingYards", variance: "medium", standardDeviation: 18 };
  if (market.includes("reception")) return { marketKey, kind: "receptions", variance: "low", standardDeviation: 2.5 };
  if (market.includes("td") || market.includes("touchdown")) return { marketKey, kind: "anytimeTouchdown", variance: "high", standardDeviation: null };
  return { marketKey, kind: "generic", variance: classifyPropVariance(candidate.market), standardDeviation: 20 };
}

function normalCdf(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 0.5;
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absolute * absolute);
  return 0.5 * (1 + sign * polynomial);
}

function propLineOdds(candidate, side) {
  if (side === "over") return numeric(candidate.overOdds ?? candidate.overPrice ?? (candidate.side === "over" ? candidate.odds : null));
  return numeric(candidate.underOdds ?? candidate.underPrice ?? (candidate.side === "under" ? candidate.odds : null));
}

function propGameContext(candidate, game) {
  const team = candidate.team || candidate.playerTeam || candidate.teamName || "";
  const homeTeam = sideName(game, "home");
  const awayTeam = sideName(game, "away");
  const opponent = candidate.opponent || (team && team === homeTeam ? awayTeam : team && team === awayTeam ? homeTeam : "");
  const teamSide = team && team === homeTeam ? "home" : team && team === awayTeam ? "away" : null;
  const spread = teamSide ? spreadForSide(game, teamSide) : null;
  return { team, opponent, teamSide, spread };
}

function priorStatsFor(context = {}) {
  return context.previousSeasonStats || context.priorSeasonStats || context.priorStats || context.previousSeason || context.stats || context;
}

function projectionForProp(candidate, game, context, spec) {
  const stats = priorStatsFor(context);
  const direct = firstNumeric(candidate, ["projection", "projectedValue"]);
  if (direct !== null) return { value: direct, sourceType: "VERIFIED", sourceSeason: null, assumptions: [] };
  const contextProjection = firstNumeric(context, ["projection", "projectedValue"]);
  if (contextProjection !== null) return { value: contextProjection, sourceType: "PRIOR", sourceSeason: context.sourceSeason || null, assumptions: [] };
  if (spec.kind === "anytimeTouchdown") {
    const probability = firstNumeric(stats, ["anytimeTdProbability", "touchdownProbability", "tdProbability", "redZoneScoreProbability"]);
    if (probability !== null) return { value: clamp(probability, 0, 1), sourceType: "PRIOR", sourceSeason: context.sourceSeason || null, assumptions: ["Used prior touchdown probability."] };
    return { value: 0.5, sourceType: "NEUTRAL_FALLBACK", sourceSeason: null, assumptions: ["No prior touchdown probability was supplied; binary projection is neutral."] };
  }

  const attempts = firstNumeric(stats, ["passAttemptsPerGame", "passingAttemptsPerGame", "attemptsPerGame", "projectedPassAttempts"]);
  const ypa = firstNumeric(stats, ["yardsPerAttempt", "passingYardsPerAttempt", "ypa"]);
  const passYards = firstNumeric(stats, ["passingYardsPerGame", "passYardsPerGame", "passYards"]);
  const passTds = firstNumeric(stats, ["passingTouchdownsPerGame", "passTouchdownsPerGame", "passTdsPerGame"]);
  const carries = firstNumeric(stats, ["rushAttemptsPerGame", "rushingAttemptsPerGame", "carriesPerGame", "projectedRushAttempts"]);
  const ypc = firstNumeric(stats, ["yardsPerCarry", "rushingYardsPerCarry", "ypc"]);
  const rushYards = firstNumeric(stats, ["rushingYardsPerGame", "rushYardsPerGame", "rushYards"]);
  const targets = firstNumeric(stats, ["targetsPerGame", "targetPerGame", "projectedTargets"]);
  const ypt = firstNumeric(stats, ["yardsPerTarget", "receivingYardsPerTarget", "ypt"]);
  const receptions = firstNumeric(stats, ["receptionsPerGame", "catchesPerGame", "receptions"]);
  const catchRate = firstNumeric(stats, ["catchRate", "receptionRate"]);
  let value = null;
  switch (spec.kind) {
    case "passingYards": value = passYards ?? (attempts !== null && ypa !== null ? attempts * ypa : null); break;
    case "passAttempts": value = attempts; break;
    case "passingTouchdowns": value = passTds ?? (attempts !== null && firstNumeric(stats, ["passingTdRate", "passTdRate"]) !== null ? attempts * firstNumeric(stats, ["passingTdRate", "passTdRate"]) : null); break;
    case "rushingYards": value = rushYards ?? (carries !== null && ypc !== null ? carries * ypc : null); break;
    case "rushAttempts": value = carries; break;
    case "receivingYards": value = firstNumeric(stats, ["receivingYardsPerGame", "receivingYards", "recYardsPerGame"]) ?? (targets !== null && ypt !== null ? targets * ypt : null); break;
    case "receptions": value = receptions ?? (targets !== null && catchRate !== null ? targets * catchRate : null); break;
    default: value = null;
  }
  if (value !== null) {
    return {
      value,
      sourceType: context.sourceType || "PRIOR",
      sourceSeason: context.sourceSeason || null,
      assumptions: ["Projection uses supplied player prior/depth-chart context."]
    };
  }

  const line = numeric(candidate.line);
  return {
    value: line,
    sourceType: "NEUTRAL_FALLBACK",
    sourceSeason: null,
    assumptions: ["Player prior and depth-chart detail were unavailable; projection is centered on the posted line."]
  };
}

function roleScores(candidate, context, spec) {
  const supplied = firstNumeric(context, ["roleVolume", "opportunityScore"]);
  if (supplied !== null) return { roleVolume: clamp(supplied), roleConfidence: clamp(firstNumeric(context, ["roleConfidence", "roleSecurity"]) ?? supplied) };
  const role = String(context.position || context.role || "").toLowerCase();
  const starterAdjustment = context.starter === false || context.isStarter === false ? -18 : context.starter || context.isStarter ? 5 : 0;
  const defaults = {
    passingYards: 88,
    passAttempts: 92,
    passingTouchdowns: 82,
    rushingYards: 76,
    rushAttempts: 82,
    receivingYards: 70,
    receptions: 74,
    anytimeTouchdown: 62,
    generic: 55
  };
  let score = defaults[spec.kind] ?? defaults.generic;
  if (role.includes("quarterback") || role === "qb") score += spec.kind.startsWith("pass") ? 5 : 0;
  if (role.includes("workhorse") || role.includes("wr1") || role.includes("rb1")) score += 5;
  score += starterAdjustment;
  return { roleVolume: clamp(score), roleConfidence: clamp(score - (role ? 0 : 12)) };
}

function gameScriptScore(game, spec, gameContext, context = {}) {
  const supplied = firstNumeric(context, ["gameScript", "scriptScore"]);
  if (supplied !== null) return clamp(supplied);
  if (gameContext.spread === null) return 50;
  const favorite = gameContext.spread < 0;
  if (spec.kind === "rushAttempts" || spec.kind === "rushingYards") return favorite ? 58 : 44;
  if (spec.kind === "passAttempts" || spec.kind === "passingYards") return favorite ? 46 : 57;
  return 50;
}

function propDataConfidence(projection, context, candidate) {
  const sourceType = String(projection.sourceType || context.sourceType || "LIMITED_DATA").toUpperCase();
  const score = sourceType === "VERIFIED" ? 78 : sourceType === "PRIOR" ? 66 : sourceType === "MARKET_DERIVED" ? 55 : 42;
  return {
    score,
    level: score >= 75 ? "HIGH" : score >= 50 ? "MODERATE" : "LOW",
    sourceType,
    sourceSeason: projection.sourceSeason || context.sourceSeason || null,
    playerContext: Boolean(Object.keys(context).length),
    marketContext: Boolean(candidate.overOdds ?? candidate.underOdds ?? candidate.odds)
  };
}

function propHitProbability(projection, line, side, standardDeviation, odds, opposingOdds, spec) {
  if (spec.kind === "anytimeTouchdown") {
    const marketProbability = noVigProbability(odds, opposingOdds) ?? americanOddsToProbability(odds);
    return marketProbability === null ? clamp(side === "over" ? projection : 1 - projection, 0.5, 0.82) : clamp(marketProbability, 0.5, 0.82);
  }
  if (line === null || projection === null || standardDeviation === null || standardDeviation <= 0) return null;
  const modeled = normalCdf((side === "over" ? projection - line : line - projection) / standardDeviation);
  const marketProbability = noVigProbability(odds, opposingOdds) ?? americanOddsToProbability(odds);
  const combined = marketProbability === null ? modeled : modeled * 0.7 + marketProbability * 0.3;
  return clamp(combined, 0.5, 0.82);
}

function propProjectionEdge(projection, line, side, standardDeviation) {
  if (line === null || projection === null || !standardDeviation) return 50;
  const raw = side === "over" ? projection - line : line - projection;
  return clamp(50 + (raw / standardDeviation) * 15);
}

function propMarketValue(hitProbability, odds) {
  const implied = americanOddsToProbability(odds);
  return implied === null || hitProbability === null ? 50 : clamp(50 + (hitProbability - implied) * 200);
}

function enrichNflPropCandidates(games = [], candidates = [], options = {}) {
  const gameById = new Map(games.map((game) => [String(game.id), game]));
  const week = Math.max(1, Math.floor(Number(options.week) || 1));
  const priorSeason = options.priorSeason || (new Date().getUTCFullYear() - 1);
  const enriched = [];
  candidates.forEach((candidate) => {
    if (candidate.projection !== undefined && candidate.hitProbability !== undefined && candidate.side) {
      enriched.push(candidate);
      return;
    }
    const game = gameById.get(String(candidate.gameId)) || {};
    const context = playerContextFor(candidate, options);
    const spec = propMarketSpec(candidate);
    const gameContext = propGameContext({ ...candidate, ...context }, game);
    const projection = projectionForProp(candidate, game, context, spec);
    const line = numeric(candidate.line);
    const sides = ["over", "under"].filter((side) => propLineOdds(candidate, side) !== null);
    if (!sides.length && candidate.side && numeric(candidate.odds) !== null) sides.push(String(candidate.side).toLowerCase());
    sides.forEach((side) => {
      const odds = propLineOdds(candidate, side) ?? numeric(candidate.odds);
      const opposingOdds = propLineOdds(candidate, side === "over" ? "under" : "over");
      const probability = propHitProbability(projection.value, line, side, spec.standardDeviation, odds, opposingOdds, spec);
      if (probability === null) return;
      const roles = roleScores(candidate, context, spec);
      const injuryStatus = String(candidate.injuryStatus || context.injuryStatus || "").toLowerCase();
      const injuryConfidence = clamp(firstNumeric(context, ["injuryConfidence", "healthScore"]) ?? (injuryStatus === "inactive" ? 0 : injuryStatus === "questionable" ? 45 : injuryStatus === "limited" ? 55 : 75));
      const team = gameContext.team;
      const opponent = gameContext.opponent;
      const sourceType = projection.sourceType === "PRIOR" && week <= 1 ? "PRIOR" : projection.sourceType;
      enriched.push({
        ...candidate,
        id: `${candidate.id || `${candidate.gameId}-${candidate.player}-${candidate.market}-${line}`}-${side}`.replace(/[^a-z0-9-]/gi, "-"),
        team,
        opponent,
        marketKey: candidate.marketKey || spec.marketKey || candidate.market,
        side,
        line,
        odds,
        projection: projection.value,
        hitProbability: probability,
        projectionEdge: propProjectionEdge(projection.value, line, side, spec.standardDeviation),
        roleVolume: roles.roleVolume,
        matchup: clamp(firstNumeric(context, ["matchup", "matchupScore"]) ?? 50),
        gameScript: gameScriptScore(game, spec, gameContext, context),
        marketValue: propMarketValue(probability, odds),
        injuryConfidence,
        roleConfidence: roles.roleConfidence,
        dataConfidence: propDataConfidence(projection, context, candidate),
        variance: candidate.variance || spec.variance || classifyPropVariance(candidate.market),
        injuryStatus: injuryStatus || candidate.injuryStatus,
        sourceMetadata: {
          ...(candidate.sourceMetadata || {}),
          sourceType,
          sourceSeason: sourceType === "PRIOR" ? (projection.sourceSeason || priorSeason) : null,
          fields: {
            projection: sourceType,
            hitProbability: opposingOdds === null ? "MARKET_DERIVED" : "MARKET_DERIVED_AND_MODELED",
            roleVolume: context.roleVolume !== undefined ? "PRIOR" : "LIMITED_DATA",
            matchup: context.matchup !== undefined ? "PRIOR" : "NEUTRAL_FALLBACK",
            gameScript: gameContext.spread === null ? "NEUTRAL_FALLBACK" : "MARKET_DERIVED",
            marketValue: "MARKET_DERIVED",
            injuryConfidence: context.injuryConfidence !== undefined ? "VERIFIED" : "LIMITED_DATA"
          },
          assumptions: projection.assumptions
        }
      });
    });
  });
  return enriched;
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
  const mapped = candidates
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
  const strongestSide = new Map();
  mapped.forEach((candidate) => {
    const key = [candidate.gameId, normalizePlayerName(candidate.player), candidate.marketKey || candidate.market, candidate.line ?? ""].join("|");
    const current = strongestSide.get(key);
    if (!current || (candidate.hitProbability || 0) > (current.hitProbability || 0) || ((candidate.hitProbability || 0) === (current.hitProbability || 0) && (candidate.qualityScore || 0) > (current.qualityScore || 0))) strongestSide.set(key, candidate);
  });
  return Array.from(strongestSide.values())
    .sort((a, b) => (b.hitProbability || 0) - (a.hitProbability || 0) || (b.qualityScore || 0) - (a.qualityScore || 0));
}

function chooseDiversified(candidates, count) {
  const selected = [];
  const usedGames = new Set();
  const playerCounts = new Map();
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    const player = normalizePlayerName(candidate.player);
    if (!usedGames.has(candidate.gameId) && (playerCounts.get(player) || 0) < 2) {
      selected.push(candidate);
      usedGames.add(candidate.gameId);
      playerCounts.set(player, (playerCounts.get(player) || 0) + 1);
    }
  }
  candidates.forEach((candidate) => {
    const player = normalizePlayerName(candidate.player);
    if (selected.length < count && !selected.some((item) => item.id === candidate.id) && (playerCounts.get(player) || 0) < 2) {
      selected.push(candidate);
      playerCounts.set(player, (playerCounts.get(player) || 0) + 1);
    }
  });
  return selected;
}

function propBoardSummary(legs) {
  const probabilities = legs.map((leg) => Number(leg.hitProbability)).filter(Number.isFinite);
  const average = probabilities.length ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length : null;
  return {
    averageLegProbability: average,
    lowestLegProbability: probabilities.length ? Math.min(...probabilities) : null,
    highestLegProbability: probabilities.length ? Math.max(...probabilities) : null,
    estimatedCombinedProbability: probabilities.length ? probabilities.reduce((product, value) => product * value, 1) : null,
    strength: average === null ? "WEAK" : average >= 0.65 ? "STRONG" : average >= 0.58 ? "AVERAGE" : "WEAK"
  };
}

function buildNflSafe6(candidates = []) {
  const lowerVariance = candidates.filter((candidate) => !candidate.killCritic?.hardVeto && ["low", "medium"].includes(candidate.variance));
  const strong = lowerVariance.filter((candidate) => (candidate.hitProbability || 0) >= 0.62);
  const fallback = lowerVariance.filter((candidate) => !strong.includes(candidate));
  const usable = lowerVariance.length >= 6 ? [...strong, ...fallback] : strong;
  const expanded = usable.length >= 6 ? usable : [...usable, ...candidates.filter((candidate) => !candidate.killCritic?.hardVeto && candidate.variance === "high")];
  const legs = chooseDiversified(expanded, 6);
  const summary = propBoardSummary(legs);
  return {
    legs,
    qualified: strong,
    complete: legs.length === 6,
    ...summary,
    reason: legs.length === 6
      ? (strong.length >= 6 ? "Six lower-variance legs cleared the preferred 62% Safe 6 threshold." : "Safe 6 is complete with the strongest available lower-variance legs; fallback legs are labeled by their individual probability.")
      : "Fewer than six usable modeled prop markets were returned for Safe 6."
  };
}

function buildNflHeat6(candidates = []) {
  const qualified = candidates.filter((candidate) => !candidate.killCritic?.hardVeto && (candidate.hitProbability || 0) >= 0.56);
  const usable = candidates.filter((candidate) => !candidate.killCritic?.hardVeto && candidate.projection !== null && candidate.projection !== undefined);
  const legs = chooseDiversified([...qualified, ...usable.filter((candidate) => !qualified.includes(candidate))], 6);
  const correlated = legs.some((leg, index) => legs.slice(index + 1).some((other) => correlationType(leg, other) === "positive"));
  return { legs, qualified, complete: legs.length === 6, correlated, ...propBoardSummary(legs), reason: legs.length === 6 ? (qualified.length >= 6 ? "Six edge-focused legs cleared the preferred 56% Heat 6 threshold." : "Heat 6 is complete with the strongest available modeled legs; lower-confidence fallbacks remain visible.") : "Fewer than six modeled prop markets were returned for Heat 6." };
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

function buildNflBoard({ games = [], candidates = [], rawCandidates = null, mode = "standalone", week = 1, rollover } = {}) {
  const winnerBoard = buildNflWinnerBoard(games, { mode, week });
  const rawProps = rawCandidates || candidates;
  const enrichedCandidates = enrichNflPropCandidates(games, candidates, { week });
  const props = buildNflPropBoard(enrichedCandidates, { minimumProbability: 0.60 });
  const propModelStatus = {
    rawPropMarkets: rawProps.length,
    playersResolved: enrichedCandidates.filter((candidate) => Boolean(candidate.player)).length,
    propsProjected: enrichedCandidates.filter((candidate) => candidate.projection !== null && candidate.projection !== undefined).length,
    propsWithHitProbability: enrichedCandidates.filter((candidate) => candidate.hitProbability !== null && candidate.hitProbability !== undefined).length,
    safeEligibleProps: buildNflSafe6(props).qualified.length,
    heatEligibleProps: buildNflHeat6(props).qualified.length,
    modeledCandidates: enrichedCandidates.length
  };
  return {
    mode: normalizeNflMode(mode),
    week,
    preseasonPriorMode: week <= 1,
    games: nflWindowFilter(games, mode),
    winners: winnerBoard,
    rawProps,
    props,
    propModelStatus,
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
  enrichNflPropCandidates,
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

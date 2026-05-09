function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localDateString();

function shiftDateString(dateValue, days) {
  if (!dateValue) return "";
  const date = new Date(`${dateValue}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

const nbaMarkets = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists",
  "player_points_assists",
  "player_points_rebounds",
  "player_rebounds_assists"
];

const mlbMarkets = [
  "batter_total_bases",
  "batter_hits",
  "batter_runs",
  "batter_rbis",
  "batter_home_runs",
  "pitcher_strikeouts"
];

const marketLabels = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3PM",
  player_points_rebounds_assists: "Pts + Reb + Ast",
  player_points_assists: "Pts + Ast",
  player_points_rebounds: "Pts + Reb",
  player_rebounds_assists: "Reb + Ast",
  player_double_double: "Double Double",
  batter_total_bases: "Total Bases",
  batter_hits: "Hits",
  batter_runs: "Runs",
  batter_rbis: "RBIs",
  batter_home_runs: "Home Runs",
  pitcher_strikeouts: "Pitcher Strikeouts",
  player_shots_on_goal: "Shots On Goal",
  player_goals: "Goals",
  player_pass_yds: "Pass Yards",
  player_reception_yds: "Receiving Yards",
  player_rush_yds: "Rush Yards"
};

const sportConfigs = {
  basketball_nba: {
    label: "NBA",
    markets: nbaMarkets,
    liveContext: true,
    seriesLogs: true,
    comingSoon: ""
  },
  basketball_wnba: {
    label: "WNBA",
    markets: nbaMarkets,
    liveContext: false,
    seriesLogs: false,
    comingSoon: "WNBA boards can use sportsbook lines now; deeper player logs can be added later."
  },
  baseball_mlb: {
    label: "MLB",
    markets: mlbMarkets,
    liveContext: false,
    seriesLogs: false,
    comingSoon: "MLB foundation is active. For now it uses sportsbook lines and saved-board learning; paid baseball game logs can plug in later."
  },
  icehockey_nhl: {
    label: "NHL",
    markets: ["player_shots_on_goal", "player_goals"],
    liveContext: false,
    seriesLogs: false,
    comingSoon: "NHL is scaffolded for lines-first testing."
  },
  americanfootball_nfl: {
    label: "NFL",
    markets: ["player_pass_yds", "player_reception_yds", "player_rush_yds"],
    liveContext: false,
    seriesLogs: false,
    comingSoon: "NFL is scaffolded for lines-first testing."
  }
};

function sportConfig() {
  return sportConfigs[elements?.sportKey?.value] || sportConfigs.basketball_nba;
}

const sampleSlate = [
  {
    id: "sample-nyk-bos",
    homeTeam: "Boston Celtics",
    awayTeam: "New York Knicks",
    commenceTime: `${today}T23:30:00Z`,
    source: "Sample",
    candidates: [
      candidate("Jalen Brunson", "player_points", 27.5, -112, 30.8, 0.71, 31.3, 3, 4, 30.5, 5, 7, 0.8, "Teammate usage bump"),
      candidate("Josh Hart", "player_points", 11.5, -106, 10.8, 0.48, 11.0, 2, 4, 12.1, 4, 7, 0.0, "Opponent points trend is mixed"),
      candidate("Josh Hart", "player_rebounds", 8.5, -105, 9.6, 0.67, 10.1, 4, 4, 9.8, 6, 7, 0.2, "Stable minutes; hit rebounds in every series meeting"),
      candidate("Jaylen Brown", "player_points_rebounds_assists", 34.5, -110, 32.9, 0.42, 31.4, 1, 4, 33.0, 2, 7, -0.3, "Tough matchup"),
      candidate("Derrick White", "player_assists", 4.5, 100, 5.7, 0.64, 6.0, 3, 4, 5.4, 4, 7, 0.4, "Ball-handler injury watch"),
      candidate("Kristaps Porzingis", "player_threes", 1.5, 115, 2.2, 0.62, 2.0, 2, 3, 1.8, 3, 6, -0.6, "Questionable tag")
    ]
  },
  {
    id: "sample-lal-den",
    homeTeam: "Denver Nuggets",
    awayTeam: "Los Angeles Lakers",
    commenceTime: `${today}T02:00:00Z`,
    source: "Sample",
    candidates: [
      candidate("Nikola Jokic", "player_assists", 8.5, -108, 10.2, 0.73, 9.8, 3, 4, 9.5, 5, 7, 0.1, "Primary creator"),
      candidate("Jamal Murray", "player_points", 22.5, -115, 24.7, 0.65, 25.4, 3, 4, 24.2, 5, 7, 0.4, "High usage"),
      candidate("LeBron James", "player_points_rebounds_assists", 41.5, -105, 43.6, 0.58, 45.2, 2, 4, 43.1, 4, 7, 0.0, "No restriction"),
      candidate("Austin Reaves", "player_assists", 5.5, 110, 4.8, 0.38, 4.5, 1, 4, 5.1, 2, 7, 0.3, "Role steady"),
      candidate("Aaron Gordon", "player_rebounds", 6.5, -102, 7.7, 0.62, 8.1, 3, 4, 7.8, 5, 7, 0.2, "Frontcourt matchup")
    ]
  }
];

let slate = [];
let selectedGameId = null;
let selectedPropId = null;
let enrichmentTimer = null;
let activeEnrichmentKey = "";
let lastEventPayloads = [];
let lastInjuries = [];
let selectedLogMarket = "";
let selectedLogOpponent = "all";
const collapsedSections = {
  gameNews: false,
  playerLogs: false
};
const gameNewsCache = new Map();
const gameNewsRefreshing = new Set();
const finalStatsCache = new Map();
const finalStatsLoading = new Set();
let savedBoards = loadSavedBoards();
const bdlCache = {
  players: new Map(),
  stats: new Map(),
  teams: null
};

const elements = {
  appShell: document.querySelector("#appShell"),
  sportKey: document.querySelector("#sportKey"),
  slateDate: document.querySelector("#slateDate"),
  region: document.querySelector("#region"),
  bookFilter: document.querySelector("#bookFilter"),
  sportReadiness: document.querySelector("#sportReadiness"),
  status: document.querySelector("#status"),
  gameList: document.querySelector("#gameList"),
  gameCount: document.querySelector("#gameCount"),
  savedBoardDate: document.querySelector("#savedBoardDate"),
  boardSuccess: document.querySelector("#boardSuccess"),
  savedBoards: document.querySelector("#savedBoards"),
  selectedGameTitle: document.querySelector("#selectedGameTitle"),
  parlayScore: document.querySelector("#parlayScore"),
  gameNewsLabel: document.querySelector("#gameNewsLabel"),
  gameNews: document.querySelector("#gameNews"),
  riskLabel: document.querySelector("#riskLabel"),
  parlayTabs: document.querySelector("#parlayTabs"),
  parlays: document.querySelector("#parlays"),
  gloryLabel: document.querySelector("#gloryLabel"),
  gloryParlay: document.querySelector("#gloryParlay"),
  toggleGameNews: document.querySelector("#toggleGameNews"),
  togglePlayerLogs: document.querySelector("#togglePlayerLogs"),
  playerLogsBody: document.querySelector("#playerLogsBody"),
  playerSearch: document.querySelector("#playerSearch"),
  searchPlayer: document.querySelector("#searchPlayer"),
  playerOptions: document.querySelector("#playerOptions"),
  playerContext: document.querySelector("#playerContext"),
  candidateGuide: document.querySelector("#candidateGuide")
};
const allowedParlayViews = ["single", "safe", "two", "three", "glory"];
document.querySelectorAll("[data-parlay-view]").forEach((button) => {
  if (!allowedParlayViews.includes(button.dataset.parlayView)) button.remove();
});
const tabButtons = Array.from(document.querySelectorAll(".mobile-tabs button"));
const parlayTabButtons = Array.from(document.querySelectorAll("[data-parlay-view]"));
const leagueTabButtons = Array.from(document.querySelectorAll("[data-sport-target]"));
const boardBuildVersion = "v48-us-sports-day-slate";
const shotBuildVersion = "v4-quality-first";
const minimumLegProbability = 0.6;
const singleLegProbability = 0.62;
const threeLegProbability = 0.63;
const backgroundLogPlayerLimit = 48;
const backgroundLogBatchSize = 4;
const backgroundLogTimeoutMs = 5500;
const manualLogTimeoutMs = 14000;
let slateLoadToken = 0;
let backgroundEnrichmentRunning = false;
let boardEnrichmentPending = false;
let activeParlayView = "single";
let lockedParlayBuilds = loadLockedParlayBuilds();
let playerLogProfiles = new Map();
let savedBoardDateTouched = false;
let savedLegCacheVersion = 0;
let savedLegCache = { version: -1, legs: [] };

elements.slateDate.value = today;
elements.savedBoardDate.value = today;
updateSportShell();
loadServerConfig();
loadServerSavedBoards();

function setMobileTab(tab) {
  const nextTab = ["games", "news", "logs", "saved"].includes(tab) ? tab : "games";
  elements.appShell.dataset.mobileTab = nextTab;
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === nextTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function setParlayView(view) {
  activeParlayView = allowedParlayViews.includes(view) ? view : "single";
  updateParlayTabs();
  const game = slate.find((item) => item.id === selectedGameId);
  if (game) renderParlay(game);
}

function updateParlayTabs() {
  parlayTabButtons.forEach((button) => {
    const active = button.dataset.parlayView === activeParlayView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function updateSportShell() {
  const config = sportConfig();
  leagueTabButtons.forEach((button) => {
    const active = button.dataset.sportTarget === elements.sportKey.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (elements.sportReadiness) {
    elements.sportReadiness.textContent = config.comingSoon || `${config.label} mode is live with full board evaluation.`;
    elements.sportReadiness.dataset.sport = elements.sportKey.value;
  }
  elements.appShell.dataset.sport = elements.sportKey.value;
}

function setCollapsibleSection(section, collapsed) {
  collapsedSections[section] = Boolean(collapsed);
  const isGameNews = section === "gameNews";
  const button = isGameNews ? elements.toggleGameNews : elements.togglePlayerLogs;
  const body = isGameNews ? elements.gameNews : elements.playerLogsBody;
  if (!button || !body) return;
  body.hidden = collapsedSections[section];
  body.classList.toggle("is-collapsed", collapsedSections[section]);
  button.textContent = collapsedSections[section] ? "Show" : "Hide";
  button.setAttribute("aria-expanded", collapsedSections[section] ? "false" : "true");
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function candidate(player, market, line, odds, recentAvg, recentHitRate, seriesAvg, seriesHits, seriesGames, seasonH2HAvg, seasonH2HHits, seasonH2HGames, roleAdjustment, injuryNote) {
  return {
    id: `${player}-${market}-${line}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    player,
    market,
    line,
    odds,
    recentAvg,
    recentHitRate,
    seriesAvg,
    seriesHits,
    seriesGames,
    seasonH2HAvg,
    seasonH2HHits,
    seasonH2HGames,
    roleAdjustment,
    injuryNote,
    manualInjury: "none",
    playerTier: "rotation",
    teamSituation: null,
    excluded: false,
    seriesSource: "Manual",
    seriesLogs: []
  };
}

function setStatus(message, tone = "neutral") {
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatOdds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Odds TBD";
  return number > 0 ? `+${number}` : `${number}`;
}

function americanToDecimalOdds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 1.91;
  return number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number);
}

function decimalToAmericanOdds(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return 100;
  const value = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
  return value;
}

function formatSigned(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatHitRate(value) {
  return `${Math.round(value * 100)}%`;
}

function impliedProbability(odds) {
  const number = Number(odds);
  if (!Number.isFinite(number) || number === 0) return 0.52;
  return number < 0 ? Math.abs(number) / (Math.abs(number) + 100) : 100 / (number + 100);
}

function injuryImpact(level) {
  const impacts = {
    none: 0,
    teammate_out: 5,
    teammate_questionable: 2,
    player_questionable: -8,
    player_out: -60,
    minutes_limit: -12
  };

  return impacts[level] ?? 0;
}

function injuryPriority(level) {
  const priorities = {
    none: 0,
    teammate_questionable: 1,
    teammate_out: 2,
    player_questionable: 3,
    minutes_limit: 4,
    player_out: 5
  };

  return priorities[level] ?? 0;
}

function setInjuryLevel(prop, level) {
  if (injuryPriority(level) > injuryPriority(prop.manualInjury)) {
    prop.manualInjury = level;
  }
}

function marketRoleBump(market, outCount, questionableCount) {
  const weight = outCount + questionableCount * 0.45;
  const bumps = {
    player_points: 0.9,
    player_rebounds: 0.45,
    player_assists: 0.55,
    player_threes: 0.35,
    player_points_rebounds_assists: 1.5,
    batter_total_bases: 0.35,
    batter_hits: 0.25,
    batter_runs: 0.2,
    batter_rbis: 0.25,
    batter_home_runs: 0.1,
    pitcher_strikeouts: 0.3
  };

  return Number(((bumps[market] || 0.5) * weight).toFixed(1));
}

function inferPlayerTier(prop) {
  const logs = prop.seriesLogs || [];
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const averageMinutes = minutes.length ? average(minutes) : 0;
  const pra = logs
    .map((log) => Number(log.pts) + Number(log.reb) + Number(log.ast))
    .filter((value) => Number.isFinite(value));
  const averagePra = pra.length ? average(pra) : 0;
  const scoringLine = prop.market === "player_points" ? Number(prop.line) : 0;
  const praLine = prop.market === "player_points_rebounds_assists" ? Number(prop.line) : 0;
  const assistsLine = prop.market === "player_assists" ? Number(prop.line) : 0;
  const reboundsLine = prop.market === "player_rebounds" ? Number(prop.line) : 0;
  const comboLine = isComboMarket(prop.market) ? Number(prop.line) : 0;
  const mlbPowerLine = prop.market === "batter_total_bases" || prop.market === "pitcher_strikeouts" ? Number(prop.line) : 0;

  if (prop.market?.startsWith("batter_") && ["batter_total_bases", "batter_hits", "batter_rbis", "batter_runs"].includes(prop.market)) return "starter";
  if (prop.market === "pitcher_strikeouts" && mlbPowerLine >= 4.5) return "starter";
  if (averageMinutes >= 34 || averagePra >= 30 || scoringLine >= 21.5 || assistsLine >= 6.5 || reboundsLine >= 10.5 || praLine >= 34.5 || comboLine >= 31.5) return "star";
  if (averageMinutes >= 28 || averagePra >= 20 || scoringLine >= 15.5 || assistsLine >= 4.5 || reboundsLine >= 7.5 || praLine >= 24.5 || comboLine >= 22.5) return "starter";
  return "rotation";
}

function eliminationContext(prop, direction) {
  const situation = prop.teamSituation;
  if (!situation?.facingElimination) return { boost: 0, probabilityBoost: 0, notes: [] };
  const isHome = situation.isHome;
  const isStar = prop.playerTier === "star";
  const isStarter = prop.playerTier === "starter";
  const notes = [];
  let boost = 0;
  let probabilityBoost = 0;

  if (direction === "Over" && isHome && isStar && ["player_points", "player_points_rebounds_assists", "player_assists"].includes(prop.market)) {
    boost += 10;
    probabilityBoost += 0.05;
    notes.push("Home elimination spot boosts star workload");
  } else if (direction === "Over" && isHome && isStarter && ["player_points", "player_points_rebounds_assists"].includes(prop.market)) {
    boost += 4;
    probabilityBoost += 0.02;
    notes.push("Home elimination spot can lift starter usage");
  }

  if (direction === "Under" && isHome && (isStar || isStarter)) {
    boost -= 5;
    probabilityBoost -= 0.03;
    notes.push("Avoiding under against elevated elimination usage");
  }

  return { boost, probabilityBoost, notes };
}

function numericLogMinutes(log) {
  const value = Number(String(log?.min || "").split(":")[0]);
  return Number.isFinite(value) ? value : null;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function sameTeamName(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function propTeamName(prop, game) {
  if (prop.playerTeam?.displayName) return prop.playerTeam.displayName;
  if (prop.playerTeam?.abbreviation) return prop.playerTeam.abbreviation;
  const source = `${prop.injuryNote || ""} ${prop.seriesSource || ""}`;
  if (game && normalizeName(source).includes(normalizeName(game.homeTeam))) return game.homeTeam;
  if (game && normalizeName(source).includes(normalizeName(game.awayTeam))) return game.awayTeam;
  return "";
}

function seriesContext(prop, direction, game) {
  const logs = prop.seriesLogs || [];
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  const latestValue = values[0];
  const priorValues = values.slice(1);
  const priorAverage = priorValues.length ? average(priorValues) : null;
  const latestMinutes = minutes[0];
  const priorMinutes = minutes.slice(1);
  const priorMinuteAverage = priorMinutes.length ? average(priorMinutes) : null;
  const averageMinutes = minutes.length ? average(minutes) : 0;
  const minuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : 0;
  const minuteDeviation = standardDeviation(minutes);
  const line = Number(prop.line);
  const notes = [];
  let penalty = 0;
  let probabilityPenalty = 0;

  const isOver = direction === "Over";
  const isRolePlayerProfile = averageMinutes > 0 && averageMinutes < 28;
  const isLowLineScoring = prop.market === "player_points" && line <= 10.5;
  const isPraRoleLine = prop.market === "player_points_rebounds_assists" && line <= 20.5;
  const isPlayoffPressure = prop.seriesGames >= 4;
  const teamName = propTeamName(prop, game);
  const isHome = teamName && game ? sameTeamName(teamName, game.homeTeam) : false;
  const thinSeriesEdge = Math.abs(prop.seriesAvg - line) < (prop.market === "player_assists" ? 1 : 1.5);

  if (isOver && isRolePlayerProfile && (isLowLineScoring || isPraRoleLine)) {
    penalty += 13;
    probabilityPenalty += 0.07;
    notes.push("Role-player over with fragile minutes");
  }

  if (isOver && isPlayoffPressure && (isLowLineScoring || isPraRoleLine || isRolePlayerProfile)) {
    penalty += 8;
    probabilityPenalty += 0.04;
    notes.push("Playoff closeout/do-or-die context can tighten rotations");
  }

  if (isOver && isHome && isPlayoffPressure && isRolePlayerProfile) {
    penalty += 5;
    probabilityPenalty += 0.02;
    notes.push("Home closeout spot favors starter control over bench overs");
  }

  if (prop.market === "player_assists" && line >= 4.5 && thinSeriesEdge) {
    penalty += 9;
    probabilityPenalty += 0.04;
    notes.push("Assist line has thin series buffer");
  }

  if (isOver && prop.market === "player_assists" && line >= 6.5 && isPlayoffPressure) {
    penalty += 10;
    probabilityPenalty += 0.05;
    notes.push("High assist over in playoff pressure spot");
  }

  if (isOver && prop.market === "player_threes") {
    const threesHitRate = prop.seriesGames ? prop.seriesHits / prop.seriesGames : 0;
    const threesEdge = prop.seriesGames ? prop.seriesAvg - line : 0;
    const weakThreeSample = prop.seriesGames < 3 || threesHitRate < 0.75 || threesEdge < 0.6;
    if (weakThreeSample) {
      penalty += 18;
      probabilityPenalty += 0.11;
      notes.push("3PM overs need a stronger series shooting sample");
    }
  }

  if (isOver && prop.teamInjuryContext?.outCount && isRolePlayerProfile && line >= prop.seriesAvg + 1) {
    penalty += 6;
    probabilityPenalty += 0.03;
    notes.push("Teammate injury bump is priced above series role");
  }

  const outCount = prop.teamSituation?.lineupKeyOut?.length || 0;
  const isConfirmedStarter = Boolean(prop.teamSituation?.confirmedStarter);
  if (outCount && prop.seriesGames >= 3) {
    const lineupPenalty = outCount >= 2 ? 8 : 5;
    penalty += lineupPenalty;
    probabilityPenalty += outCount >= 2 ? 0.035 : 0.02;
    notes.push(`Lineup differs from full series sample: ${prop.teamSituation.lineupKeyOut.slice(0, 2).join(", ")} out`);
  }

  if (!isOver && outCount >= 2 && isConfirmedStarter) {
    penalty += 14;
    probabilityPenalty += 0.07;
    notes.push("Avoid under on confirmed starter in injury-thinned lineup");
  }

  if (isOver && outCount >= 2 && !isConfirmedStarter && isRolePlayerProfile) {
    penalty += 8;
    probabilityPenalty += 0.04;
    notes.push("Bench/role over needs confirmed minutes with multiple teammates out");
  }

  if (!isOver && prop.market === "player_assists" && line <= 4.5 && prop.seriesGames >= 3) {
    penalty += 7;
    probabilityPenalty += 0.03;
    notes.push("Low assist unders are vulnerable to matchup-driven passing spikes");
  }

  if (minuteSwing >= 8 || minuteDeviation >= 4.5) {
    penalty += 7;
    probabilityPenalty += 0.03;
    notes.push("Minutes have been volatile in the series");
  }

  if (Number.isFinite(latestValue) && priorAverage !== null) {
    const latestDelta = latestValue - priorAverage;
    if (isOver && latestValue <= line && latestDelta <= -2) {
      penalty += 10;
      probabilityPenalty += 0.05;
      notes.push("Latest series game moved against the over");
    }
    if (!isOver && latestValue >= line && latestDelta >= 2) {
      penalty += 10;
      probabilityPenalty += 0.05;
      notes.push("Latest series game moved against the under");
    }
  }

  if (isOver && Number.isFinite(latestMinutes) && priorMinuteAverage !== null && latestMinutes <= priorMinuteAverage - 5) {
    penalty += 8;
    probabilityPenalty += 0.04;
    notes.push("Latest game minutes dipped from prior series role");
  }

  return {
    penalty,
    probabilityPenalty,
    notes,
    averageMinutes,
    minuteSwing
  };
}

function statValueFromFinal(stat, market) {
  if (market === "player_points") return Number(stat.pts);
  if (market === "player_rebounds") return Number(stat.reb);
  if (market === "player_assists") return Number(stat.ast);
  if (market === "player_threes") return Number(stat.threes);
  if (market === "player_points_rebounds_assists") return Number(stat.pts || 0) + Number(stat.reb || 0) + Number(stat.ast || 0);
  if (market === "player_points_assists") return Number(stat.pts || 0) + Number(stat.ast || 0);
  if (market === "player_points_rebounds") return Number(stat.pts || 0) + Number(stat.reb || 0);
  if (market === "player_rebounds_assists") return Number(stat.reb || 0) + Number(stat.ast || 0);
  if (market === "player_double_double") return Number(stat.pts) >= 10 && Number(stat.reb) >= 10 ? 1 : 0;
  return null;
}

function gameLabelMatches(left = "", right = "") {
  const leftTeams = String(left).split("@").map((team) => team.trim()).filter(Boolean);
  const rightTeams = String(right).split("@").map((team) => team.trim()).filter(Boolean);
  if (leftTeams.length !== 2 || rightTeams.length !== 2) return normalizeName(left) === normalizeName(right);
  return leftTeams.every((team) => rightTeams.some((otherTeam) => sameTeamName(team, otherTeam)));
}

function finalStatForLeg(leg, board) {
  const stats = finalStatsCache.get(board?.date || "")?.stats || [];
  return stats.find((stat) =>
    normalizeName(stat.player) === normalizeName(leg.player) &&
    gameLabelMatches(stat.gameLabel, leg.gameLabel || board?.games?.[0] || "")
  );
}

function gradeLegFromFinal(leg, board) {
  const stat = finalStatForLeg(leg, board);
  if (!stat) return null;
  const actual = statValueFromFinal(stat, leg.market);
  if (!Number.isFinite(actual)) return null;
  const hit = leg.direction === "Over" ? actual > Number(leg.line) : actual < Number(leg.line);
  return {
    status: hit ? "hit" : "miss",
    actual,
    resultDate: stat.date || board?.date || "",
    resultSource: "Final box score"
  };
}

function postgameLegReview(leg) {
  if (leg.status !== "miss") return { notes: [], tags: [] };
  const logs = leg.seriesLogs || [];
  const actual = Number(leg.actual);
  if (!logs.length || !Number.isFinite(actual)) return { notes: leg.reviewNotes || [], tags: leg.reviewTags || [] };

  const values = logs.map((log) => logValueForMarket(log, leg.market)).filter((value) => Number.isFinite(value));
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  if (!values.length) return { notes: leg.reviewNotes || [], tags: leg.reviewTags || [] };

  const notes = [];
  const tags = new Set(leg.reviewTags || []);
  const line = Number(leg.line);
  const priorHitsForLeg = values.filter((value) => leg.direction === "Over" ? value > line : value < line).length;
  const priorRate = priorHitsForLeg / values.length;
  const priorAverage = average(values);
  const actualDelta = actual - priorAverage;
  const minuteAverage = minutes.length ? average(minutes) : null;
  const latestPregameMinutes = minutes[0];
  const minuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : 0;
  const negativeAgentSignals = (leg.agentSignals || []).filter((signal) => Number(signal.delta) < 0);
  const injuryNames = [...(leg.teamInjuryContext?.names || []), ...(leg.teamSituation?.lineupKeyOut || [])].filter(Boolean);

  if (priorRate >= 0.75) {
    notes.push(`Postgame Evaluation Agent: trend broke after ${priorHitsForLeg}/${values.length} pregame logs supported this side`);
    tags.add("trend_reversal");
  } else if (priorRate <= 0.25) {
    notes.push(`Postgame Evaluation Agent: pregame logs only supported this side ${priorHitsForLeg}/${values.length}`);
    tags.add("weak_trend_selected");
  }

  if (leg.direction === "Under" && actualDelta >= 2) {
    notes.push(`Usage/role spike: final value was ${formatSigned(actualDelta)} above the saved-log average`);
    tags.add("usage_spike");
  }

  if (leg.direction === "Over" && actualDelta <= -2) {
    notes.push(`Usage/role drop: final value was ${formatSigned(actualDelta)} below the saved-log average`);
    tags.add("usage_drop");
  }

  if (minuteAverage !== null && Number.isFinite(latestPregameMinutes)) {
    if (minuteSwing >= 8) {
      notes.push(`Role volatility warning: saved logs had a ${minuteSwing.toFixed(1)} minute range`);
      tags.add("volatile_minutes");
    }
    if (leg.direction === "Under" && latestPregameMinutes >= minuteAverage + 4) {
      notes.push("Latest pregame minutes were already rising against the under");
      tags.add("minutes_rising_against_under");
    }
    if (leg.direction === "Over" && latestPregameMinutes <= minuteAverage - 4) {
      notes.push("Latest pregame minutes were already dipping against the over");
      tags.add("minutes_dipping_against_over");
    }
  }

  if (injuryNames.length) {
    notes.push(`Lineup context risk: ${injuryNames.slice(0, 3).join(", ")} created role-change uncertainty`);
    tags.add("lineup_role_change");
  }

  if (negativeAgentSignals.length) {
    notes.push(`Pregame agent warning was present: ${negativeAgentSignals[0].note}`);
    tags.add("agent_warning_ignored");
  }

  if (Math.abs(actual - line) <= 1) {
    notes.push("Missed by one stat or less; keep as variance, not a full logic failure");
    tags.add("close_miss");
  }

  return {
    notes: [...new Set(notes)].slice(0, 5),
    tags: Array.from(tags).slice(0, 8)
  };
}

function effectiveSavedLeg(leg, board) {
  const finalGrade = gradeLegFromFinal(leg, board);
  const resolved = finalGrade ? { ...leg, ...finalGrade } : leg;
  const review = postgameLegReview(resolved);
  return {
    ...resolved,
    reviewNotes: review.notes.length ? review.notes : (resolved.reviewNotes || []),
    reviewTags: review.tags.length ? review.tags : (resolved.reviewTags || [])
  };
}

function invalidateSavedLegCache() {
  savedLegCacheVersion += 1;
}

function savedBoardLegs(boards = savedBoards) {
  if (boards === savedBoards && savedLegCache.version === savedLegCacheVersion) {
    return savedLegCache.legs;
  }
  return boards.flatMap((board) => {
    const legs = board.parlays?.length ? board.parlays.flatMap((parlay) => parlay.legs || []) : board.legs || [];
    return legs.map((leg) => effectiveSavedLeg(leg, board));
  });
}

function gradedSavedBoardLegs() {
  if (savedLegCache.version !== savedLegCacheVersion) {
    savedLegCache = {
      version: savedLegCacheVersion,
      legs: savedBoardLegs(savedBoards)
    };
  }
  return savedLegCache.legs.filter((leg) => leg.status === "hit" || leg.status === "miss");
}

function hitRateFor(legs) {
  const graded = legs.filter((leg) => leg.status === "hit" || leg.status === "miss");
  const hits = graded.filter((leg) => leg.status === "hit").length;
  return {
    total: graded.length,
    hits,
    rate: graded.length ? hits / graded.length : 0.5
  };
}

function marketResistanceContext(prop, direction) {
  const logs = prop.seriesLogs || [];
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const line = Number(prop.line);
  const averageMinutes = minutes.length ? average(minutes) : 0;
  const minuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : 0;
  const recentValues = values.slice(0, 3);
  const recentAverage = recentValues.length ? average(recentValues) : null;
  const isPrimary = prop.playerTier === "star" || prop.playerTier === "starter";
  const stableRole = averageMinutes >= 28 && minuteSwing <= 8;
  const notes = [];
  let penalty = 0;
  let probabilityPenalty = 0;

  if (!Number.isFinite(line) || recentValues.length < 3 || !isPrimary || !stableRole) {
    return { penalty, probabilityPenalty, notes };
  }

  const recentUnders = recentValues.filter((value) => value < line).length;
  const recentOvers = recentValues.filter((value) => value > line).length;
  const slumpDistance = recentAverage !== null ? line - recentAverage : 0;
  const hotDistance = recentAverage !== null ? recentAverage - line : 0;
  const starterMarket = ["player_points", "player_rebounds", "player_assists", "player_points_rebounds_assists", "player_points_assists", "player_points_rebounds", "player_rebounds_assists"].includes(prop.market);

  if (direction === "Under" && starterMarket && recentUnders >= 2 && slumpDistance >= 1) {
    const severity = prop.playerTier === "star" ? 1.25 : 1;
    penalty += Math.round((recentUnders === 3 ? 13 : 8) * severity);
    probabilityPenalty += (recentUnders === 3 ? 0.065 : 0.04) * severity;
    notes.push("Market resisted the slump; under carries bounce-back risk");
  }

  if (direction === "Over" && starterMarket && recentOvers >= 2 && hotDistance >= 1.5) {
    penalty += recentOvers === 3 ? 10 : 6;
    probabilityPenalty += recentOvers === 3 ? 0.05 : 0.03;
    notes.push("Line may be taxing a hot streak");
  }

  return { penalty, probabilityPenalty, notes };
}

function noSeriesContext(prop, direction) {
  if (prop.seriesGames) return { penalty: 0, probabilityPenalty: 0, notes: [], scoreCap: 96 };

  const notes = ["No current-series sample; using recent form and opponent history"];
  const starterMarkets = ["player_points", "player_rebounds", "player_assists", "player_points_rebounds_assists", "player_points_assists", "player_points_rebounds", "player_rebounds_assists", "batter_total_bases", "batter_hits", "batter_runs", "batter_rbis", "pitcher_strikeouts"];
  const outCount = prop.teamSituation?.lineupKeyOut?.length || 0;
  const confirmedStarter = Boolean(prop.teamSituation?.confirmedStarter);
  const isPrimary = prop.playerTier === "star" || prop.playerTier === "starter";
  const recentSupport = direction === "Over" ? Number(prop.recentHitRate || 0) : 1 - Number(prop.recentHitRate || 0);
  const recentEdge = direction === "Over" ? Number(prop.recentAvg || 0) - Number(prop.line || 0) : Number(prop.line || 0) - Number(prop.recentAvg || 0);
  const opponentSupport = prop.seasonH2HGames ? direction === "Over"
    ? Number(prop.seasonH2HHits || 0) / Number(prop.seasonH2HGames || 1)
    : 1 - Number(prop.seasonH2HHits || 0) / Number(prop.seasonH2HGames || 1) : 0.5;
  const opponentEdge = direction === "Over" ? Number(prop.seasonH2HAvg || 0) - Number(prop.line || 0) : Number(prop.line || 0) - Number(prop.seasonH2HAvg || 0);
  const recentFormBacksRead = recentSupport >= 0.67 && recentEdge >= 0;
  const opponentHistoryBacksRead = prop.seasonH2HGames >= 2 && opponentSupport >= 0.6 && opponentEdge >= 0;
  let penalty = 14;
  let probabilityPenalty = 0.08;
  let scoreCap = 84;

  if (recentFormBacksRead) {
    penalty -= isPrimary ? 9 : 6;
    probabilityPenalty -= isPrimary ? 0.05 : 0.035;
    scoreCap = Math.max(scoreCap, isPrimary ? 92 : 86);
    notes.push("Recent 3-game form supports this side");
  }

  if (opponentHistoryBacksRead) {
    penalty -= isPrimary ? 7 : 5;
    probabilityPenalty -= isPrimary ? 0.04 : 0.025;
    scoreCap = Math.max(scoreCap, isPrimary ? 92 : 86);
    notes.push("History against this opponent supports this side");
  }

  if (recentFormBacksRead && opponentHistoryBacksRead) {
    penalty -= 3;
    probabilityPenalty -= 0.015;
    scoreCap = Math.max(scoreCap, 94);
    notes.push("Recent form and opponent history both line up");
  }

  if (prop.playerTier === "rotation") {
    penalty += 10;
    probabilityPenalty += 0.05;
    scoreCap = 72;
    notes.push("Rotation-player trend is capped until this series shows minutes");
  }

  if (direction === "Over" && prop.market === "player_threes") {
    penalty += 10;
    probabilityPenalty += 0.06;
    scoreCap = Math.min(scoreCap, 70);
    notes.push("3PM over blocked from strong builds without series shooting proof");
  }

  if (isComboMarket(prop.market) && !isPrimary) {
    penalty += 6;
    probabilityPenalty += 0.03;
    scoreCap = Math.min(scoreCap, 74);
    notes.push("Combo over/under needs a stable series role");
  }

  if (elements.sportKey.value === "baseball_mlb") {
    penalty = Math.max(6, penalty - 6);
    probabilityPenalty = Math.max(0.035, probabilityPenalty - 0.03);
    scoreCap = Math.max(scoreCap, 80);
    notes.push("MLB pre-log mode: relying on line quality until baseball logs are connected");
  }

  if (direction === "Over" && confirmedStarter && outCount >= 2 && starterMarkets.includes(prop.market)) {
    penalty -= 7;
    probabilityPenalty -= 0.035;
    scoreCap = 89;
    notes.push("Confirmed injury-driven starter role offsets some no-series risk");
  }

  if (direction === "Under" && confirmedStarter && outCount >= 1 && starterMarkets.includes(prop.market)) {
    penalty += 6;
    probabilityPenalty += 0.03;
    scoreCap = Math.min(scoreCap, 76);
    notes.push("Under reduced because injury-thinned lineup can raise usage");
  }

  return {
    penalty: Math.max(0, penalty),
    probabilityPenalty: Math.max(0, probabilityPenalty),
    notes,
    scoreCap
  };
}

function agentAdjustment(agent, delta, probabilityDelta, note) {
  return { agent, delta, probabilityDelta, note };
}

function playerRoleAgent(prop, direction) {
  const logs = prop.seriesLogs || [];
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  const notes = [];
  let delta = 0;
  let probabilityDelta = 0;

  if (!minutes.length || !values.length) {
    return [agentAdjustment("Player Role Agent", -4, -0.02, "No current role sample; reduced trust in trend")];
  }

  const averageMinutes = average(minutes);
  const minuteSwing = Math.max(...minutes) - Math.min(...minutes);
  const latestMinutes = minutes[0];
  const priorMinutes = minutes.slice(1);
  const priorMinuteAverage = priorMinutes.length ? average(priorMinutes) : null;
  const stableStarterRole = averageMinutes >= 30 && minuteSwing <= 6;
  const volatileRole = minuteSwing >= 9 || standardDeviation(minutes) >= 4.5;

  if (stableStarterRole && prop.playerTier !== "rotation") {
    delta += 5;
    probabilityDelta += 0.025;
    notes.push("Stable starter minutes support the read");
  }

  if (volatileRole) {
    delta -= 9;
    probabilityDelta -= 0.045;
    notes.push("Minutes volatility makes trend less reliable");
  }

  if (priorMinuteAverage !== null && Number.isFinite(latestMinutes)) {
    const minuteDelta = latestMinutes - priorMinuteAverage;
    if (direction === "Over" && minuteDelta <= -5) {
      delta -= 8;
      probabilityDelta -= 0.04;
      notes.push("Latest minutes dipped against the over");
    }
    if (direction === "Under" && minuteDelta >= 5) {
      delta -= 8;
      probabilityDelta -= 0.04;
      notes.push("Latest minutes rose against the under");
    }
  }

  return notes.map((note) => agentAdjustment("Player Role Agent", delta / notes.length, probabilityDelta / notes.length, note));
}

function returnToFormAgent(prop, direction) {
  const logs = prop.seriesLogs || [];
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  if (minutes.length < 2 || prop.manualInjury === "minutes_limit" || prop.manualInjury === "player_out") return [];

  const latestMinutes = minutes[0];
  const priorAverage = average(minutes.slice(1));
  const recentTwoRising = minutes.length >= 3 && minutes[0] >= minutes[1] && minutes[1] >= minutes[2];
  const roleReturning = latestMinutes >= priorAverage + 4 || recentTwoRising;
  const corePlayer = prop.playerTier === "star" || prop.playerTier === "starter" || latestMinutes >= 30;
  const starterMarkets = ["player_points", "player_rebounds", "player_assists", "player_points_rebounds_assists", "player_points_assists", "player_points_rebounds", "player_rebounds_assists"];

  if (!roleReturning || !corePlayer || !starterMarkets.includes(prop.market)) return [];

  if (direction === "Over") {
    return [agentAdjustment("Return-To-Form Agent", 7, 0.035, "Return-to-form read: minutes are rising back toward a core role")];
  }

  return [agentAdjustment("Return-To-Form Agent", -6, -0.03, "Return-to-form read makes the under riskier because minutes are rising")];
}

function newsInjuryAgent(prop, direction) {
  const outCount = prop.teamSituation?.lineupKeyOut?.length || prop.teamInjuryContext?.outCount || 0;
  const questionableCount = prop.teamInjuryContext?.questionableCount || 0;
  const confirmedStarter = Boolean(prop.teamSituation?.confirmedStarter);
  const starterMarkets = ["player_points", "player_rebounds", "player_assists", "player_points_rebounds_assists", "player_points_assists", "player_points_rebounds", "player_rebounds_assists"];
  const notes = [];
  let delta = 0;
  let probabilityDelta = 0;

  if (prop.manualInjury === "minutes_limit") {
    return [agentAdjustment("Minute Restriction Agent", -30, -0.16, `Minute Restriction Agent: ${prop.player} may have a workload cap`)];
  }

  if (prop.manualInjury === "player_questionable") {
    const status = prop.injuryWatch?.status || "day-to-day";
    delta -= direction === "Over" ? 20 : 14;
    probabilityDelta -= direction === "Over" ? 0.1 : 0.07;
    notes.push(`Injury Watch Agent: ${prop.player} is ${status}, so availability and minutes are unstable`);
  }

  if (direction === "Over" && confirmedStarter && outCount >= 1 && starterMarkets.includes(prop.market)) {
    delta += Math.min(10, 4 + outCount * 2);
    probabilityDelta += Math.min(0.05, 0.02 + outCount * 0.01);
    notes.push("Injury report points to added starter responsibility");
  }

  if (direction === "Under" && confirmedStarter && outCount >= 1 && starterMarkets.includes(prop.market)) {
    delta -= Math.min(12, 5 + outCount * 2);
    probabilityDelta -= Math.min(0.06, 0.025 + outCount * 0.012);
    notes.push("Under is risky with teammate absences raising usage");
  }

  if (direction === "Over" && prop.playerTier === "rotation" && (outCount || questionableCount) && !confirmedStarter) {
    delta -= 7;
    probabilityDelta -= 0.035;
    notes.push("Role-player injury bump needs confirmed minutes");
  }

  return notes.map((note) => agentAdjustment("News/Injury Agent", delta / notes.length, probabilityDelta / notes.length, note));
}

function gameContextAgent(prop, direction, game) {
  const notes = [];
  let delta = 0;
  let probabilityDelta = 0;
  const isOver = direction === "Over";
  const line = Number(prop.line);
  const lowUsageOver = isOver && (
    (prop.market === "player_points" && line <= 10.5) ||
    (prop.market === "player_points_rebounds_assists" && line <= 20.5) ||
    prop.playerTier === "rotation"
  );

  if (!prop.seriesGames) {
    delta -= 5;
    probabilityDelta -= 0.025;
    notes.push("New-series board needs stronger non-trend proof");
  }

  if (lowUsageOver && gameHasStarted(game) === false) {
    delta -= 5;
    probabilityDelta -= 0.025;
    notes.push("Role-player overs are fragile before rotation is confirmed");
  }

  if (prop.teamSituation?.facingElimination && prop.teamSituation?.isHome && prop.playerTier === "star" && isOver) {
    delta += 6;
    probabilityDelta += 0.03;
    notes.push("Home elimination spot supports star workload");
  }

  return notes.map((note) => agentAdjustment("Game Context Agent", delta / notes.length, probabilityDelta / notes.length, note));
}

function internalAgentSignals(prop, direction, game) {
  return [
    ...newsInjuryAgent(prop, direction),
    ...gameContextAgent(prop, direction, game),
    ...playerRoleAgent(prop, direction),
    ...returnToFormAgent(prop, direction)
  ].filter((signal) => signal.note);
}

function scoreCandidate(prop, game, forcedDirection = "") {
  prop.playerTier = inferPlayerTier(prop);
  const edge = prop.recentAvg - prop.line + prop.roleAdjustment;
  const seriesEdge = prop.seriesAvg - prop.line;
  const seasonH2HEdge = prop.seasonH2HAvg - prop.line;
  const injuryScore = injuryImpact(prop.manualInjury);
  const seriesWeight = clamp(prop.seriesGames / 4, 0, 1);
  const seasonH2HWeight = clamp(prop.seasonH2HGames / 8, 0, 0.7);
  const seriesHitRate = prop.seriesGames ? clamp(prop.seriesHits / prop.seriesGames, 0, 1) : 0.5;
  const seasonH2HHitRate = prop.seasonH2HGames ? clamp(prop.seasonH2HHits / prop.seasonH2HGames, 0, 1) : 0.5;
  const blendedEdge = edge * 0.42 + seriesEdge * 0.4 * seriesWeight + seasonH2HEdge * 0.18 * seasonH2HWeight;
  const seriesDirection = prop.seriesGames >= 3 && Math.abs(seriesHitRate - 0.5) >= 0.24 ? (seriesHitRate > 0.5 ? "Over" : "Under") : null;
  const direction = ["Over", "Under"].includes(forcedDirection) ? forcedDirection : seriesDirection || (blendedEdge >= 0 ? "Over" : "Under");
  const directionalRecentHitRate = direction === "Over" ? prop.recentHitRate : 1 - prop.recentHitRate;
  const directionalSeriesHitRate = direction === "Over" ? seriesHitRate : 1 - seriesHitRate;
  const directionalSeasonH2HHitRate = direction === "Over" ? seasonH2HHitRate : 1 - seasonH2HHitRate;
  const directionalEdge = direction === "Over" ? edge : -edge;
  const directionalSeriesEdge = direction === "Over" ? seriesEdge : -seriesEdge;
  const directionalSeasonH2HEdge = direction === "Over" ? seasonH2HEdge : -seasonH2HEdge;
  const directionalBlendedEdge = direction === "Over" ? blendedEdge : -blendedEdge;
  const directionalOdds = direction === "Over" ? prop.overOdds ?? prop.odds : prop.underOdds ?? prop.odds;
  const oddsPenalty = Math.abs(impliedProbability(directionalOdds) - 0.52) * 24;
  const seriesConviction = seriesDirection
    ? direction === seriesDirection
      ? 12 + Math.abs(seriesHitRate - 0.5) * 28
      : -8 - Math.abs(seriesHitRate - 0.5) * 18
    : 0;
  const context = seriesContext(prop, direction, game);
  const elimination = eliminationContext(prop, direction);
  const marketResistance = marketResistanceContext(prop, direction);
  const noSeries = noSeriesContext(prop, direction);
  const agentSignals = internalAgentSignals(prop, direction, game);
  const agentScoreAdjustment = agentSignals.reduce((sum, signal) => sum + Number(signal.delta || 0), 0);
  const agentProbabilityAdjustment = agentSignals.reduce((sum, signal) => sum + Number(signal.probabilityDelta || 0), 0);
  const outCount = prop.teamSituation?.lineupKeyOut?.length || 0;
  const confirmedStarter = Boolean(prop.teamSituation?.confirmedStarter);
  const injuryStarterMarkets = ["player_points", "player_rebounds", "player_assists", "player_points_rebounds_assists"];
  const confirmedStarterBoost = direction === "Over" && confirmedStarter && outCount >= 2 && injuryStarterMarkets.includes(prop.market)
    ? Math.min(12, 4 + outCount * 2)
    : 0;
  const confirmedStarterProbabilityBoost = confirmedStarterBoost ? Math.min(0.06, 0.02 + outCount * 0.01) : 0;
  const missingSeriesLogs = !prop.seriesGames;
  const edgeScore = Math.max(0, directionalEdge) * 2.6 + Math.min(0, directionalEdge) * 1.2;
  const seriesEdgeScore = (Math.max(0, directionalSeriesEdge) * 3.8 + Math.min(0, directionalSeriesEdge) * 1.6) * seriesWeight;
  const seasonH2HEdgeScore = (Math.max(0, directionalSeasonH2HEdge) * 1.2 + Math.min(0, directionalSeasonH2HEdge) * 0.6) * seasonH2HWeight;
  const rawScore = 46 + edgeScore + seriesEdgeScore + seasonH2HEdgeScore + (directionalRecentHitRate - 0.5) * 18 + (directionalSeriesHitRate - 0.5) * 64 * seriesWeight + (directionalSeasonH2HHitRate - 0.5) * 14 * seasonH2HWeight + seriesConviction + injuryScore + elimination.boost + confirmedStarterBoost + agentScoreAdjustment - oddsPenalty - context.penalty - marketResistance.penalty - noSeries.penalty;
  const scoreCap = missingSeriesLogs ? noSeries.scoreCap : 96;
  const edgeProbability = clamp(directionalBlendedEdge * 0.01, -0.05, 0.07);
  const probability = clamp(directionalRecentHitRate * 0.42 + directionalSeriesHitRate * 0.34 * seriesWeight + directionalSeasonH2HHitRate * 0.14 * seasonH2HWeight + 0.08 + edgeProbability + injuryScore / 290 + elimination.probabilityBoost + confirmedStarterProbabilityBoost + agentProbabilityAdjustment - context.probabilityPenalty - marketResistance.probabilityPenalty - noSeries.probabilityPenalty, 0.26, 0.76);

  return {
    ...prop,
    direction,
    odds: directionalOdds,
    edge,
    seriesEdge,
    seasonH2HEdge,
    seriesHitRate,
    directionalRecentHitRate,
    directionalSeriesHitRate,
    directionalSeasonH2HHitRate,
    seasonH2HHitRate,
    blendedEdge,
    seriesDirection,
    contextNotes: [
      ...elimination.notes,
      ...(confirmedStarterBoost ? ["Confirmed starter boost with multiple teammates out"] : []),
      ...(forcedDirection && seriesDirection && direction !== seriesDirection ? ["Two-sided scan: series trend opposes this side"] : []),
      ...context.notes,
      ...marketResistance.notes,
      ...noSeries.notes,
      ...agentSignals.map((signal) => signal.note)
    ],
    agentSignals,
    missingSeriesLogs,
    averageMinutes: context.averageMinutes,
    minuteSwing: context.minuteSwing,
    score: Math.round(clamp(rawScore, 12, scoreCap)),
    probability
  };
}

function scorePropSides(prop, game) {
  return ["Over", "Under"].map((direction) => scoreCandidate(prop, game, direction));
}

function selectUniqueLegs(legs, count = Infinity, options = {}) {
  const usedPlayers = new Set();
  const usedMarkets = new Map();
  const selected = [];

  for (const leg of legs) {
    if (usedPlayers.has(leg.player)) continue;
    if (!options.allowMultipleAssists && leg.market === "player_assists" && usedMarkets.get("player_assists")) continue;
    if (!options.allowMultipleThreeOvers && leg.market === "player_threes" && leg.direction === "Over" && usedMarkets.get("player_threes_over")) continue;
    if (options.avoidUsageCorrelation && selected.some((item) => correlatedUsageLegs(item, leg, options.game))) continue;
    selected.push(leg);
    usedPlayers.add(leg.player);
    usedMarkets.set(leg.market, (usedMarkets.get(leg.market) || 0) + 1);
    if (leg.market === "player_threes" && leg.direction === "Over") {
      usedMarkets.set("player_threes_over", (usedMarkets.get("player_threes_over") || 0) + 1);
    }
    if (selected.length >= count) break;
  }

  return selected;
}

function correlatedUsageLegs(left, right, game) {
  if (!game) return false;
  const leftTeam = legTeamKey(left, game);
  const rightTeam = legTeamKey(right, game);
  if (!leftTeam || leftTeam !== rightTeam) return false;
  const usageMarkets = ["player_points", "player_threes", "player_points_rebounds_assists", "player_points_assists", "player_points_rebounds"];
  return left.direction === "Over" && right.direction === "Over" && usageMarkets.includes(left.market) && usageMarkets.includes(right.market);
}

function agentConflictRisk(leg) {
  const notes = (leg.contextNotes || []).join(" ").toLowerCase();
  const negativeSignals = (leg.agentSignals || []).filter((signal) => Number(signal.delta) < 0);
  const negativeDelta = Math.abs(negativeSignals.reduce((sum, signal) => sum + Number(signal.delta || 0), 0));
  const probabilityDrag = Math.abs(negativeSignals.reduce((sum, signal) => sum + Number(signal.probabilityDelta || 0), 0));
  const volatileMinutes = notes.includes("minutes volatility");
  const minutesAgainst = notes.includes("latest minutes dipped against the over") || notes.includes("latest minutes rose against the under");
  const fragileRoleOver = leg.direction === "Over" && leg.playerTier === "rotation" && (
    volatileMinutes ||
    notes.includes("role-player overs are fragile") ||
    notes.includes("role-player injury bump needs confirmed minutes")
  );
  const worseLine = notes.includes("worse than market average");
  const severe = fragileRoleOver || minutesAgainst || negativeDelta >= 18 || probabilityDrag >= 0.09 || (volatileMinutes && worseLine);

  return {
    any: severe || negativeDelta >= 12 || probabilityDrag >= 0.06,
    severe,
    fragileRoleOver,
    negativeDelta,
    probabilityDrag
  };
}

function agentConflictGate(leg, tier = "standard") {
  const risk = agentConflictRisk(leg);
  if (!risk.any) return true;

  const buffer = risk.fragileRoleOver
    ? { probability: 0.63, score: 72 }
    : tier === "shot"
      ? { probability: 0.58, score: 64 }
      : { probability: 0.6, score: 66 };

  if (risk.severe) {
    return leg.probability >= buffer.probability && leg.score >= buffer.score;
  }

  return true;
}

function qualityGate(leg, tier = "standard") {
  const noSeries = Boolean(leg.missingSeriesLogs);
  const noSeriesProbabilityTax = noSeries ? 0.01 : 0;
  const noSeriesScoreTax = noSeries ? 3 : 0;
  const thresholds = {
    single: { probability: singleLegProbability + noSeriesProbabilityTax, score: 70 + noSeriesScoreTax },
    standard: { probability: minimumLegProbability + noSeriesProbabilityTax, score: 64 + noSeriesScoreTax },
    sameTeam: { probability: 0.58 + noSeriesProbabilityTax, score: 62 + noSeriesScoreTax },
    three: { probability: 0.6 + noSeriesProbabilityTax, score: 68 + noSeriesScoreTax },
    shot: { probability: 0.56 + noSeriesProbabilityTax, score: 62 + noSeriesScoreTax }
  };
  const gate = thresholds[tier] || thresholds.standard;

  if (leg.probability < gate.probability || leg.score < gate.score) return false;
  if (!agentConflictGate(leg, tier)) return false;
  if (noSeries && leg.playerTier === "rotation") return false;
  if (noSeries && leg.market === "player_threes" && leg.direction === "Over") return false;
  if (tier !== "shot" && leg.market === "player_threes" && leg.direction === "Over" && leg.probability < 0.66) return false;
  return true;
}

function reserveQualityGate(leg, tier = "standard") {
  if (qualityGate(leg, tier)) return true;
  if (!agentConflictGate(leg, tier)) return false;
  if (leg.market === "player_threes" && leg.direction === "Over") return false;

  const thresholds = {
    standard: { probability: 0.52, score: 56 },
    sameTeam: { probability: 0.52, score: 55 },
    three: { probability: 0.53, score: 57 },
    shot: { probability: 0.52, score: 54 }
  };
  const gate = thresholds[tier] || thresholds.standard;
  if (leg.missingSeriesLogs && leg.playerTier === "rotation") {
    return leg.probability >= 0.58 && leg.score >= 62;
  }
  return leg.probability >= gate.probability && leg.score >= gate.score;
}

function multiLegFillGate(leg) {
  if (leg.excluded) return false;
  if (leg.market === "player_threes" && leg.direction === "Over") return false;
  const risk = agentConflictRisk(leg);
  if (risk.fragileRoleOver) return false;
  if (risk.severe && leg.probability < 0.5) return false;
  return leg.probability >= 0.4 && leg.score >= 42;
}

function consistencyGate(leg, tier = "standard") {
  if (leg.excluded) return false;
  if (leg.manualInjury === "player_out" || leg.manualInjury === "minutes_limit") return false;
  if (leg.market === "player_threes" && leg.direction === "Over") return false;

  const risk = agentConflictRisk(leg);
  if (risk.fragileRoleOver) return false;

  const seriesGames = Number(leg.seriesGames || 0);
  const seasonGames = Number(leg.seasonH2HGames || 0);
  const directionalSeriesHitRate = Number.isFinite(leg.directionalSeriesHitRate)
    ? leg.directionalSeriesHitRate
    : leg.direction === "Over"
      ? Number(leg.seriesHitRate || 0)
      : 1 - Number(leg.seriesHitRate || 0);
  const directionalSeasonHitRate = Number.isFinite(leg.directionalSeasonH2HHitRate)
    ? leg.directionalSeasonH2HHitRate
    : leg.direction === "Over"
      ? Number(leg.seasonH2HHitRate || 0)
      : 1 - Number(leg.seasonH2HHitRate || 0);
  const directionalSeriesEdge = leg.direction === "Over" ? Number(leg.seriesEdge || 0) : -Number(leg.seriesEdge || 0);
  const directionalSeasonEdge = leg.direction === "Over" ? Number(leg.seasonH2HEdge || 0) : -Number(leg.seasonH2HEdge || 0);
  const directionalRecentSupport = Number.isFinite(leg.directionalRecentHitRate)
    ? leg.directionalRecentHitRate
    : leg.direction === "Over"
      ? Number(leg.recentHitRate || 0)
      : 1 - Number(leg.recentHitRate || 0);
  const directionalRecentEdge = leg.direction === "Over" ? Number(leg.edge || 0) : -Number(leg.edge || 0);
  const logs = (leg.seriesLogs || []).filter((log) => Number.isFinite(logValueForMarket(log, leg.market)));
  const latestThree = logs.slice(0, 3);
  const latestThreeHits = latestThree.filter((log) => {
    const value = logValueForMarket(log, leg.market);
    return leg.direction === "Over" ? value > Number(leg.line) : value < Number(leg.line);
  }).length;

  if (seriesGames >= 4 && directionalSeriesHitRate >= 0.75) return true;
  if (seriesGames >= 3 && directionalSeriesHitRate >= 0.67 && directionalSeriesEdge >= 0) return true;
  if (latestThree.length === 3 && latestThreeHits >= 2 && directionalSeriesEdge >= 0.2) return true;
  if (directionalRecentSupport >= 0.67 && directionalRecentEdge >= 0.2) return true;
  if (seasonGames >= 3 && directionalSeasonHitRate >= 0.67 && directionalSeasonEdge >= 0.2) return true;
  return false;
}

function primaryOptionGate(leg, tier = "standard") {
  if (leg.excluded) return false;
  if (leg.manualInjury === "player_out" || leg.manualInjury === "minutes_limit") return false;
  if (leg.market === "player_threes" && leg.direction === "Over") return false;
  if (!["star", "starter"].includes(leg.playerTier)) return false;

  const risk = agentConflictRisk(leg);
  if (risk.fragileRoleOver) return false;

  const recentSupport = Number.isFinite(leg.directionalRecentHitRate)
    ? leg.directionalRecentHitRate
    : leg.direction === "Over"
      ? Number(leg.recentHitRate || 0)
      : 1 - Number(leg.recentHitRate || 0);
  const recentEdge = leg.direction === "Over" ? Number(leg.edge || 0) : -Number(leg.edge || 0);
  const opponentSupport = Number.isFinite(leg.directionalSeasonH2HHitRate)
    ? leg.directionalSeasonH2HHitRate
    : leg.direction === "Over"
      ? Number(leg.seasonH2HHitRate || 0)
      : 1 - Number(leg.seasonH2HHitRate || 0);
  const opponentEdge = leg.direction === "Over" ? Number(leg.seasonH2HEdge || 0) : -Number(leg.seasonH2HEdge || 0);
  const recentBacksRead = recentSupport >= 0.6 && recentEdge >= 0;
  const opponentBacksRead = Number(leg.seasonH2HGames || 0) >= 2 && opponentSupport >= 0.58 && opponentEdge >= 0;
  const floor = tier === "three" ? { probability: 0.52, score: 50 } : { probability: 0.52, score: 50 };

  return (recentBacksRead || opponentBacksRead) && leg.probability >= floor.probability && leg.score >= floor.score;
}

function scoredLegPool(game) {
  return game.candidates
    .filter((prop) => !prop.excluded)
    .filter((prop) => playerBelongsToGame(prop, game))
    .flatMap((prop) => scorePropSides(prop, game))
    .sort((a, b) => b.score - a.score);
}

function playableLegFloor(leg, minimumProbability = 0.5) {
  if (!Number.isFinite(leg.probability) || leg.probability < minimumProbability) return false;
  if (leg.score < 45) return false;
  return true;
}

function strictLegPool(game, tier = "standard") {
  return scoredLegPool(game)
    .filter((leg) => qualityGate(leg, tier))
    .sort((a, b) => b.score - a.score || b.probability - a.probability);
}

function reserveLegPool(game, tier = "standard") {
  return scoredLegPool(game)
    .filter((leg) => reserveQualityGate(leg, tier) || primaryOptionGate(leg, tier))
    .filter((leg) => playableLegFloor(leg, tier === "shot" ? 0.48 : 0.5))
    .map((leg) => ({
      ...leg,
      contextNotes: [
        ...(leg.contextNotes || []),
        ...(qualityGate(leg, tier) ? [] : [primaryOptionGate(leg, tier) ? "Primary option gate: recent/opponent form supports this side" : "Reserve gate: loosened but still playable"])
      ]
    }))
    .sort((a, b) => b.score - a.score || b.probability - a.probability);
}

function consistencyLegPool(game, tier = "standard", usedLegs = []) {
  const usedKeys = new Set(usedLegs.map(shotLegKey));
  return scoredLegPool(game)
    .filter((leg) => !usedKeys.has(shotLegKey(leg)))
    .filter((leg) => consistencyGate(leg, tier))
    .filter((leg) => playableLegFloor(leg, tier === "shot" ? 0.48 : 0.5))
    .map((leg) => ({
      ...leg,
      contextNotes: [
        ...(leg.contextNotes || []),
        "Consistency read: logs support this side"
      ]
    }))
    .sort((a, b) => b.score - a.score || b.probability - a.probability);
}

function buildParlay(game, count) {
  if (playoffEngineActive() && count === 2) {
    return buildPlayoffLowRiskParlay(game).slice(0, 2);
  }
  const tier = count >= 3 ? "three" : "standard";
  const consistency = consistencyLegPool(game, tier);
  const reserve = reserveLegPool(game, tier);
  let legs = selectUniqueLegs(reserve, count, {
    avoidUsageCorrelation: count < 3,
    game,
    allowMultipleAssists: count >= 3
  });
  if (legs.length < count) {
    legs = selectUniqueLegs([...legs, ...consistency], count, {
      avoidUsageCorrelation: count < 3,
      game,
      allowMultipleAssists: true,
      allowMultipleThreeOvers: false
    });
  }
  return legs.length >= count ? legs.slice(0, count) : [];
}

function buildBestSingleLeg(game) {
  if (playoffEngineActive()) {
    return playoffFullLineAnchorPool(game).slice(0, 1).map((leg) => ({
      ...leg,
      contextNotes: [...(leg.contextNotes || []), "Bet of the Day: highest-probability full sportsbook line in this game"]
    }));
  }
  const strict = selectUniqueLegs(strictLegPool(game, "single"), 1, { avoidUsageCorrelation: false, game });
  const consistent = strict.length ? strict : selectUniqueLegs(consistencyLegPool(game, "single"), 1, { avoidUsageCorrelation: false, game });
  const fallback = consistent.length ? consistent : selectUniqueLegs(reserveLegPool(game, "standard"), 1, { avoidUsageCorrelation: false, game });
  return fallback.slice(0, 1).map((leg) => ({
    ...leg,
    contextNotes: [...(leg.contextNotes || []), strict.length ? "Bet of the Day: strongest quality-gated full-line read" : "Bet of the Day: strongest full-line read available"]
  }));
}

function legTeamKey(leg, game) {
  const team = propTeamName(leg, game);
  if (sameTeamName(team, game.homeTeam)) return normalizeName(game.homeTeam);
  if (sameTeamName(team, game.awayTeam)) return normalizeName(game.awayTeam);
  return normalizeName(team || "");
}

function playerBelongsToGame(prop, game) {
  const team = propTeamName(prop, game);
  if (!team) return true;
  return sameTeamName(team, game.homeTeam) || sameTeamName(team, game.awayTeam);
}

function buildSameTeamParlay(game, excludedLegs = []) {
  if (playoffEngineActive()) {
    const excludedPlayers = new Set(excludedLegs.map((leg) => normalizeName(leg.player)));
    const alternate = playoffAnchorPool(game)
      .filter((leg) => !excludedPlayers.has(normalizeName(leg.player)));
    const selected = selectUniqueLegs(alternate, 2, {
      allowMultipleAssists: true,
      game,
      avoidUsageCorrelation: false
    });
    return selected.length >= 2 ? selected.slice(0, 2).map((leg) => ({
      ...leg,
      contextNotes: [...(leg.contextNotes || []), "Low-risk alternate: different players from the anchor pair"]
    })) : [];
  }
  const excludedPlayers = new Set(excludedLegs.map((leg) => normalizeName(leg.player)));
  const reserve = reserveLegPool(game, "sameTeam");
  const legs = [...reserve, ...consistencyLegPool(game, "sameTeam", reserve)]
    .filter((leg) => !excludedPlayers.has(normalizeName(leg.player)));
  const byTeam = new Map();

  legs.forEach((leg) => {
    const teamKey = legTeamKey(leg, game);
    if (!teamKey) return;
    const teamLegs = byTeam.get(teamKey) || [];
    teamLegs.push(leg);
    byTeam.set(teamKey, teamLegs);
  });

  const pairs = Array.from(byTeam.values())
    .map((teamLegs) => selectUniqueLegs(teamLegs, 2))
    .filter((pair) => pair.length === 2)
    .sort((a, b) => b.reduce((sum, leg) => sum + leg.score, 0) - a.reduce((sum, leg) => sum + leg.score, 0));

  if (pairs.length) {
    return pairs[0].map((leg) => ({
      ...leg,
      contextNotes: [...(leg.contextNotes || []), "Same-team 2-leg build"]
    }));
  }

  const fallback = selectUniqueLegs(legs, 2, { allowMultipleAssists: true, game }).slice(0, 2);
  return fallback.length === 2
    ? fallback.map((leg) => ({
      ...leg,
      contextNotes: [...(leg.contextNotes || []), "Alternate 2-leg build with distinct players"]
    }))
    : [];
}

function buildMixedTeamParlay(game) {
  if (playoffEngineActive()) {
    return buildPlayoffValueParlay(game);
  }
  const reserve = reserveLegPool(game, "three");
  const pool = [...reserve, ...consistencyLegPool(game, "three", reserve)];
  const homeKey = normalizeName(game.homeTeam);
  const awayKey = normalizeName(game.awayTeam);
  const homeLegs = pool.filter((leg) => legTeamKey(leg, game) === homeKey);
  const awayLegs = pool.filter((leg) => legTeamKey(leg, game) === awayKey);

  if (!homeLegs.length || !awayLegs.length) {
    const fallback = selectUniqueLegs(pool, 3, { allowMultipleAssists: true, game }).slice(0, 3);
    return fallback.length === 3
      ? fallback.map((leg) => ({
        ...leg,
        contextNotes: [...(leg.contextNotes || []), "Mixed-team fallback: team mapping was incomplete"]
      }))
      : [];
  }

  const selected = [];
  const firstHome = homeLegs[0];
  const firstAway = awayLegs[0];
  [firstHome, firstAway].sort((a, b) => b.score - a.score).forEach((leg) => {
    if (!selected.some((item) => item.player === leg.player)) selected.push(leg);
  });

  for (const leg of pool) {
    if (selected.length >= 3) break;
    if (selected.some((item) => item.player === leg.player)) continue;
    if (leg.market === "player_assists" && selected.some((item) => item.market === "player_assists")) continue;
    selected.push(leg);
  }

  if (selected.length < 3) {
    for (const leg of pool) {
      if (selected.length >= 3) break;
      if (selected.some((item) => shotLegKey(item) === shotLegKey(leg))) continue;
      if (selected.some((item) => item.player === leg.player)) continue;
      selected.push(leg);
    }
  }

  if (selected.length < 3) return [];

  return selected.slice(0, 3).map((leg) => ({
    ...leg,
    contextNotes: [...(leg.contextNotes || []), "Mixed-team 3-leg build"]
  }));
}

function floorMilestoneForProp(prop) {
  const line = Number(prop.line);
  if (!Number.isFinite(line)) return null;

  if (prop.market === "player_points") {
    if (line >= 27.5) return { target: 20, label: "20+", marketLabel: "Points" };
    if (line >= 22.5) return { target: 18, label: "18+", marketLabel: "Points" };
    if (line >= 18.5) return { target: 15, label: "15+", marketLabel: "Points" };
    if (line >= 13.5) return { target: 10, label: "10+", marketLabel: "Points" };
  }

  if (prop.market === "player_points_rebounds") {
    const target = Math.max(12, Math.floor(line - 5.5));
    if (line - target >= 4.5) return { target, label: `${target}+`, marketLabel: "Points + Rebounds" };
  }

  if (prop.market === "player_points_rebounds_assists") {
    const target = Math.max(18, Math.floor(line - 7.5));
    if (line - target >= 6.5) return { target, label: `${target}+`, marketLabel: "Points + Rebounds + Assists" };
  }

  if (prop.market === "player_rebounds") {
    const target = Math.max(6, Math.floor(line - 2.5));
    if (line - target >= 1.5) return { target, label: `${target}+`, marketLabel: "Rebounds" };
  }

  if (prop.market === "player_assists" && (prop.playerTier === "star" || prop.playerTier === "starter")) {
    const target = Math.max(3, Math.floor(line - 2));
    if (line - target >= 1.5) return { target, label: `${target}+`, marketLabel: "Assists" };
  }

  return null;
}

function floorOddsForProp(prop, cushion) {
  const base = Number(prop.overOdds ?? prop.odds);
  const floorPrice = cushion >= 7 ? -360 : cushion >= 5 ? -300 : cushion >= 3 ? -240 : -200;
  if (!Number.isFinite(base)) return floorPrice;
  return Math.min(base, floorPrice);
}

function safeFloorCandidate(prop, game) {
  prop.playerTier = inferPlayerTier(prop);
  if (prop.excluded || !playerBelongsToGame(prop, game)) return null;
  if (prop.manualInjury === "player_out" || prop.manualInjury === "player_questionable" || prop.manualInjury === "minutes_limit") return null;
  if (prop.market === "player_threes") return null;

  const floor = floorMilestoneForProp(prop);
  if (!floor) return null;

  const logs = prop.seriesLogs || [];
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const averageMinutes = minutes.length ? average(minutes) : 0;
  const minuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : 0;
  const isCoreRole = prop.playerTier === "star" || prop.playerTier === "starter" || averageMinutes >= 27;
  if (!isCoreRole) return null;

  const hits = values.filter((value) => value >= floor.target).length;
  const hitRate = values.length ? hits / values.length : 0.58;
  if (values.length >= 3 && hitRate < 0.7) return null;
  if (minuteSwing >= 12 && prop.playerTier !== "star") return null;

  const scored = scoreCandidate(prop, game, "Over");
  const risk = agentConflictRisk(scored);
  if (risk.fragileRoleOver || risk.severe) return null;

  const cushion = Number(prop.line) - floor.target;
  const roleBoost = prop.playerTier === "star" ? 10 : prop.playerTier === "starter" ? 6 : 0;
  const logBoost = values.length ? (hitRate - 0.5) * 34 : 0;
  const minutesBoost = averageMinutes >= 32 ? 8 : averageMinutes >= 28 ? 5 : 0;
  const volatilityPenalty = Math.max(0, minuteSwing - 6) * 1.2;
  const eliteFloor = values.length >= 2
    && hitRate >= 1
    && cushion >= 4
    && minuteSwing <= 8;
  const score = Math.round(clamp(scored.score + roleBoost + logBoost + minutesBoost + cushion * 2.4 - volatilityPenalty, 58, 97));
  const probabilityCeiling = eliteFloor ? 0.92 : 0.86;
  const probability = clamp((values.length ? hitRate : scored.probability + 0.08) + cushion * 0.012 + roleBoost / 300 - volatilityPenalty / 500, 0.58, probabilityCeiling);

  return {
    ...scored,
    direction: "Over",
    line: floor.target - 0.5,
    sourceLine: prop.line,
    floorLabel: floor.label,
    floorMarketLabel: floor.marketLabel,
    modeledFloor: true,
    odds: floorOddsForProp(prop, cushion),
    score,
    probability,
    eliteFloor,
    seriesHits: hits,
    seriesGames: values.length,
    contextNotes: [
      ...(scored.contextNotes || []),
      `Safe Ladder: lowered from sportsbook line ${prop.line} to ${floor.label} ${floor.marketLabel}`,
      eliteFloor ? "Elite floor candidate: perfect recent hit rate with cushion and stable role" : null,
      values.length ? `Floor hit ${hits}/${values.length} recent logs` : "Modeled from role and sportsbook line until logs fill in"
    ].filter(Boolean)
  };
}

function safeDoubleDoubleCandidate(prop, game) {
  prop.playerTier = inferPlayerTier(prop);
  if (prop.excluded || !playerBelongsToGame(prop, game)) return null;
  if (!["player_rebounds", "player_points_rebounds", "player_points_rebounds_assists"].includes(prop.market)) return null;
  if (prop.manualInjury === "player_out" || prop.manualInjury === "player_questionable" || prop.manualInjury === "minutes_limit") return null;

  const logs = prop.seriesLogs || [];
  const doubles = logs.filter((log) => Number(log.pts) >= 10 && Number(log.reb) >= 10).length;
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const reboundValues = logs.map((log) => Number(log.reb)).filter((value) => Number.isFinite(value));
  const pointValues = logs.map((log) => Number(log.pts)).filter((value) => Number.isFinite(value));
  const averageMinutes = minutes.length ? average(minutes) : 0;
  const averageRebounds = reboundValues.length ? average(reboundValues) : 0;
  const averagePoints = pointValues.length ? average(pointValues) : 0;
  const hitRate = logs.length ? doubles / logs.length : 0;

  if (logs.length < 3 || hitRate < 0.6 || averageMinutes < 28 || averageRebounds < 8.5 || averagePoints < 10) return null;

  const scored = scoreCandidate(prop, game, "Over");
  const risk = agentConflictRisk(scored);
  if (risk.fragileRoleOver || risk.severe) return null;

  const eliteFloor = hitRate >= 0.9 && averageMinutes >= 32;

  return {
    ...scored,
    id: `${prop.id || prop.player}-double-double`,
    market: "player_double_double",
    direction: "Over",
    line: 0.5,
    floorLabel: "Double Double",
    floorMarketLabel: "To Record a Double Double",
    modeledFloor: true,
    odds: -280,
    score: Math.round(clamp(scored.score + hitRate * 24 + 8, 62, 97)),
    probability: clamp(hitRate + 0.06, 0.6, eliteFloor ? 0.9 : 0.84),
    eliteFloor,
    seriesHits: doubles,
    seriesGames: logs.length,
    contextNotes: [
      ...(scored.contextNotes || []),
      `Safe Ladder: double-double profile hit ${doubles}/${logs.length} recent logs`,
      eliteFloor ? "Elite floor candidate: double-double profile has held with starter minutes" : null,
      "Stable rebound role creates a safer milestone profile"
    ].filter(Boolean)
  };
}

function buildSafeLadder(game) {
  const floorLegs = game.candidates
    .filter((prop) => !prop.excluded)
    .filter((prop) => playerBelongsToGame(prop, game))
    .flatMap((prop) => [safeDoubleDoubleCandidate(prop, game), safeFloorCandidate(prop, game)])
    .filter(Boolean)
    .sort((a, b) => b.probability - a.probability || b.score - a.score);

  const selected = [];
  for (const leg of floorLegs) {
    if (selected.length >= 4) break;
    if (selected.some((item) => normalizeName(item.player) === normalizeName(leg.player))) continue;
    if (selected.some((item) => shotLegKey(item) === shotLegKey(leg))) continue;
    selected.push(leg);
  }

  return selected.map((leg) => ({
    ...leg,
    contextNotes: [...(leg.contextNotes || []), "Safe Ladder board: floor target, stable role, and recent-log cushion"]
  }));
}

function playoffEngineActive() {
  return elements.sportKey.value.includes("nba");
}

function playoffSurvivability(leg, game) {
  const logs = leg.seriesLogs || [];
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const values = logs.map((log) => logValueForMarket(log, leg.market)).filter((value) => Number.isFinite(value));
  const averageMinutes = minutes.length ? average(minutes) : Number(leg.averageMinutes || 0);
  const minuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : Number(leg.minuteSwing || 0);
  const minuteDeviation = standardDeviation(minutes);
  const hitRate = Number.isFinite(leg.directionalSeriesHitRate)
    ? leg.directionalSeriesHitRate
    : values.length
      ? values.filter((value) => leg.direction === "Over" ? value > Number(leg.line) : value < Number(leg.line)).length / values.length
      : Number.isFinite(leg.directionalRecentHitRate)
        ? leg.directionalRecentHitRate
        : 0.5;
  const directionalSeriesEdge = leg.direction === "Over" ? Number(leg.seriesEdge || 0) : -Number(leg.seriesEdge || 0);
  const directionalH2HEdge = leg.direction === "Over" ? Number(leg.seasonH2HEdge || 0) : -Number(leg.seasonH2HEdge || 0);
  const isPrimary = leg.playerTier === "star" || leg.playerTier === "starter";
  const isRolePlayer = !isPrimary;
  const isLowVarianceMarket = ["player_rebounds", "player_assists", "player_points_rebounds_assists", "player_points_assists", "player_points_rebounds", "player_rebounds_assists", "player_double_double"].includes(leg.market);
  const isHighVarianceMarket = leg.market === "player_threes" || (leg.market === "player_points" && isRolePlayer);
  const outCount = leg.teamSituation?.lineupKeyOut?.length || 0;

  let score = 0;
  const notes = [];

  if (averageMinutes >= 36 && (minuteDeviation <= 3 || minuteSwing <= 6)) {
    score += 30;
    notes.push("Playoff Engine: elite minute stability");
  } else if (averageMinutes >= 32 && minuteSwing <= 8) {
    score += 24;
    notes.push("Playoff Engine: stable playoff minutes");
  } else if (averageMinutes >= 28 || leg.playerTier === "star") {
    score += 16;
    notes.push("Playoff Engine: playable role/minute base");
  } else {
    score += 4;
    notes.push("Playoff Engine: minutes below preferred playoff floor");
  }

  score += clamp(Math.max(directionalSeriesEdge, directionalH2HEdge, 0) * 5 + Math.max(hitRate - 0.5, 0) * 28, 0, 20);
  if (directionalSeriesEdge > 0 || directionalH2HEdge > 0 || hitRate >= 0.67) notes.push("Playoff Engine: matchup/series data supports this side");

  if (leg.playerTier === "star") score += 15;
  else if (leg.playerTier === "starter") score += 11;
  else score += 2;
  if (outCount && isPrimary && leg.direction === "Over") {
    score += Math.min(8, outCount * 2);
    notes.push("Playoff Engine: teammate absences can stabilize primary usage");
  }

  if (leg.seriesGames >= 3 && hitRate >= 0.67) score += 15;
  else if (Number.isFinite(leg.directionalRecentHitRate) && leg.directionalRecentHitRate >= 0.62) score += 9;

  if (isLowVarianceMarket || leg.modeledFloor) {
    score += 10;
    notes.push("Playoff Engine: lower-variance stat type");
  }
  if (isHighVarianceMarket) {
    score -= 18;
    notes.push("Playoff Engine: high-variance playoff prop");
  }
  if (minuteSwing >= 10 || minuteDeviation >= 5) {
    score -= 12;
    notes.push("Playoff Engine: minute volatility hurts survivability");
  }
  if (isRolePlayer && leg.direction === "Over") {
    score -= 12;
    notes.push("Playoff Engine: role-player overs are fragile in tighter rotations");
  }

  if (leg.teamSituation?.isHome === false && isRolePlayer && leg.direction === "Over") {
    score -= 6;
    notes.push("Playoff Engine: road role-player over downgraded");
  }

  if (leg.modeledFloor) score += 12;

  return {
    score: Math.round(clamp(score, 0, 100)),
    notes
  };
}

function playoffLeg(leg, game, label = "Playoff Engine") {
  const survival = playoffSurvivability(leg, game);
  const survivalProbability = 0.42 + survival.score / 250;
  return {
    ...leg,
    survivabilityScore: survival.score,
    probability: clamp(Math.max(Number(leg.probability) || 0, survivalProbability), 0.3, leg.modeledFloor ? (leg.eliteFloor ? 0.92 : 0.88) : 0.74),
    score: Math.round(clamp(Math.max(Number(leg.score) || 0, 42) * 0.55 + survival.score * 0.45, 10, 98)),
    contextNotes: [
      ...(leg.contextNotes || []),
      `${label}: survivability ${survival.score}/100`,
      ...survival.notes
    ]
  };
}

function playoffFullLineCandidatePool(game, label = "Playoff Engine") {
  return scoredLegPool(game)
    .filter((leg) => {
      if (leg.excluded) return false;
      if (leg.manualInjury === "player_out" || leg.manualInjury === "minutes_limit") return false;
      if (leg.market === "player_threes" && leg.direction === "Over") return false;
      if (leg.playerTier === "rotation" && leg.direction === "Over" && leg.market === "player_points") return false;
      const risk = agentConflictRisk(leg);
      if (risk.fragileRoleOver) return false;
      return true;
    })
    .map((leg) => playoffLeg(leg, game, label))
    .filter((leg, index, legs) => legs.findIndex((item) => shotLegKey(item) === shotLegKey(leg)) === index)
    .sort((a, b) => b.survivabilityScore - a.survivabilityScore || b.probability - a.probability || b.score - a.score);
}

function candidateGuidePool(game) {
  if (!game) return [];
  const fullLineLegs = playoffEngineActive()
    ? playoffFullLineCandidatePool(game, "Candidate Guide")
    : reserveLegPool(game, "standard");
  const floorLegs = playoffEngineActive()
    ? buildSafeLadder(game).map((leg) => playoffLeg(leg, game, "Candidate Guide"))
    : [];
  return [...floorLegs, ...fullLineLegs]
    .filter((leg, index, legs) => legs.findIndex((item) => shotLegKey(item) === shotLegKey(leg)) === index)
    .filter((leg) => Number(leg.probability || 0) >= 0.6)
    .sort((a, b) => {
      const aRank = candidateGuideRank(a);
      const bRank = candidateGuideRank(b);
      return bRank - aRank || b.probability - a.probability || b.score - a.score;
    })
    .slice(0, 20);
}

function candidateGuideRank(leg) {
  const survival = Number(leg.survivabilityScore || 0);
  const probability = Number(leg.probability || 0);
  const floorBonus = leg.modeledFloor ? 8 : 0;
  return survival + probability * 40 + floorBonus;
}

function candidateGuideStatus(leg, selectedKeys) {
  if (selectedKeys.anchor.has(shotLegKey(leg))) return { label: "Anchor", className: "strong" };
  if (selectedKeys.lowRisk.has(shotLegKey(leg))) return { label: "Low Risk", className: "strong" };
  if (selectedKeys.value.has(shotLegKey(leg))) return { label: "Value", className: "playable" };
  if (leg.modeledFloor && leg.probability >= 0.7) return { label: "Ladder", className: "strong" };
  if (Number(leg.survivabilityScore || 0) >= 58 && Number(leg.probability || 0) >= 0.56) return { label: "Playable", className: "playable" };
  if (Number(leg.survivabilityScore || 0) >= 48 && Number(leg.probability || 0) >= 0.5) return { label: "Watch", className: "thin" };
  return { label: "Pass", className: "pass" };
}

function candidateBasketballCount(leg) {
  const hitPercent = Math.round(Number(leg.probability || 0) * 100);
  if (hitPercent >= 89) return 4;
  if (hitPercent >= 76) return 3;
  if (hitPercent >= 60) return 2;
  return 0;
}

function candidateBasketballRating(leg) {
  const count = candidateBasketballCount(leg);
  return "🏀".repeat(count);
}

function playoffAnchorPool(game) {
  if (!playoffEngineActive()) return reserveLegPool(game, "standard");
  const fullLineLegs = playoffFullLineCandidatePool(game, "Anchor Leg Engine")
    .filter((leg) => leg.survivabilityScore >= 54 && leg.probability >= 0.52);
  const floorLegs = buildSafeLadder(game);
  return [...floorLegs, ...fullLineLegs]
    .map((leg) => leg.survivabilityScore ? leg : playoffLeg(leg, game, "Anchor Leg Engine"))
    .filter((leg) => leg.survivabilityScore >= 58 && leg.probability >= 0.58)
    .sort((a, b) => b.probability - a.probability || b.survivabilityScore - a.survivabilityScore || b.score - a.score);
}

function playoffFullLineAnchorPool(game) {
  if (!playoffEngineActive()) return reserveLegPool(game, "standard").filter((leg) => !leg.modeledFloor);
  const allFullLineReads = scoredLegPool(game)
    .filter((leg) => !leg.modeledFloor)
    .filter((leg) => leg.selectedBookAvailable !== false)
    .filter((leg) => leg.manualInjury !== "player_out" && leg.manualInjury !== "minutes_limit")
    .map((leg) => playoffLeg(leg, game, "Bet of the Day Engine"))
    .sort((a, b) => b.probability - a.probability || b.survivabilityScore - a.survivabilityScore || b.score - a.score);
  if (allFullLineReads.length) return allFullLineReads;
  return scoredLegPool(game)
    .filter((leg) => !leg.modeledFloor)
    .filter((leg) => leg.manualInjury !== "player_out" && leg.manualInjury !== "minutes_limit")
    .map((leg) => playoffLeg(leg, game, "Bet of the Day Engine"))
    .sort((a, b) => b.probability - a.probability || b.survivabilityScore - a.survivabilityScore || b.score - a.score);
}

function buildPlayoffLowRiskParlay(game) {
  const pool = playoffAnchorPool(game)
    .filter((leg) => leg.survivabilityScore >= 62 && leg.probability >= 0.58)
    .sort((a, b) => b.survivabilityScore - a.survivabilityScore || b.probability - a.probability);
  const selected = selectUniqueLegs(pool, 3, {
    allowMultipleAssists: true,
    game,
    avoidUsageCorrelation: false
  });
  return selected.length >= 2 ? selected.slice(0, Math.min(3, selected.length)).map((leg) => ({
    ...leg,
    contextNotes: [...(leg.contextNotes || []), "Low-risk playoff build: stable role and survivability first"]
  })) : [];
}

function buildPlayoffValueParlay(game) {
  const pool = playoffFullLineCandidatePool(game, "Value Playoff Engine")
    .filter((leg) => leg.survivabilityScore >= 50 && leg.probability >= 0.5 && !leg.modeledFloor)
    .sort((a, b) => b.score - a.score || b.survivabilityScore - a.survivabilityScore);
  const selected = selectUniqueLegs(pool, 3, {
    allowMultipleAssists: true,
    game,
    avoidUsageCorrelation: false
  });
  return selected.length >= 2 ? selected.slice(0, Math.min(3, selected.length)).map((leg) => ({
    ...leg,
    contextNotes: [...(leg.contextNotes || []), "Value playoff build: full-line read with acceptable survivability"]
  })) : [];
}

function bestLegForEachPlayer(legs) {
  const byPlayer = new Map();
  legs.forEach((leg) => {
    const key = normalizeName(leg.player);
    const current = byPlayer.get(key);
    if (!current || leg.score > current.score || (leg.score === current.score && leg.probability > current.probability)) {
      byPlayer.set(key, leg);
    }
  });
  return Array.from(byPlayer.values()).sort((a, b) => b.score - a.score || b.probability - a.probability);
}

function buildStarValueParlay(game) {
  const pool = (playoffEngineActive() ? playoffFullLineCandidatePool(game, "Star Value Engine") : reserveLegPool(game, "three"))
    .filter((leg) => !leg.modeledFloor)
    .filter((leg) => leg.selectedBookAvailable !== false)
    .filter((leg) => leg.manualInjury !== "player_out" && leg.manualInjury !== "minutes_limit")
    .filter((leg) => leg.playerTier === "star" || leg.playerTier === "starter")
    .filter((leg) => leg.score >= 50 && leg.probability >= 0.5)
    .sort((a, b) => b.score - a.score || b.probability - a.probability);
  const bestByPlayer = bestLegForEachPlayer(pool);
  const homeKey = normalizeName(game.homeTeam);
  const awayKey = normalizeName(game.awayTeam);
  const homeLegs = selectUniqueLegs(bestByPlayer.filter((leg) => legTeamKey(leg, game) === homeKey), 2, {
    allowMultipleAssists: true,
    game,
    avoidUsageCorrelation: false
  });
  const awayLegs = selectUniqueLegs(bestByPlayer.filter((leg) => legTeamKey(leg, game) === awayKey), 2, {
    allowMultipleAssists: true,
    game,
    avoidUsageCorrelation: false
  });
  const selected = [...awayLegs, ...homeLegs].slice(0, 4);
  const fallback = selected.length >= 4 ? selected : selectUniqueLegs(bestByPlayer, 4, {
    allowMultipleAssists: true,
    game,
    avoidUsageCorrelation: false
  });
  return fallback.length >= 2 ? fallback.slice(0, 4).map((leg) => ({
    ...leg,
    contextNotes: [...(leg.contextNotes || []), "Star value board: player's highest-graded full line, over or under"]
  })) : [];
}

function gameHasStarted(game) {
  const start = Date.parse(game?.commenceTime || "");
  return Number.isFinite(start) && Date.now() >= start;
}

function gameLockKey(game) {
  return `${elements.slateDate.value || today}|${elements.sportKey.value}|${elements.bookFilter.value}|${game.id}|${boardBuildVersion}`;
}

function shotLockKey() {
  return `${elements.slateDate.value || today}|${elements.sportKey.value}|${elements.bookFilter.value}|shot-for-glory|${boardBuildVersion}|${shotBuildVersion}`;
}

function liveGameBuild(game) {
  const singleLegs = buildBestSingleLeg(game);
  const saferLegs = buildParlay(game, 2);
  return {
    singleLegs,
    safeLadderLegs: buildSafeLadder(game),
    saferLegs,
    sameTeamLegs: buildSameTeamParlay(game, saferLegs),
    threeLegs: buildMixedTeamParlay(game),
    valueStarLegs: buildStarValueParlay(game),
    locked: false,
    lockedAt: ""
  };
}

function savedBuildForGame(game) {
  const date = elements.slateDate.value || today;
  const sport = elements.sportKey.value;
  const bookKey = elements.bookFilter.value;
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
  const board = savedBoards.find((item) =>
    item.date === date &&
    item.sport === sport &&
    item.buildVersion === boardBuildVersion &&
    (!item.bookKey || item.bookKey === bookKey) &&
    (item.games || []).some((label) => gameLabelMatches(label, gameLabel))
  );
  if (!board?.parlays?.length) return null;
  const single = board.parlays.find((parlay) => /best.single/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel));
  const safer = board.parlays.find((parlay) => /safer|independent/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel)) ||
    board.parlays.find((parlay) => /2-leg/i.test(parlay.title || "") && !/same.team/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel));
  const sameTeam = board.parlays.find((parlay) => /alternate|same.team/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel));
  const three = board.parlays.find((parlay) => /3-leg/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel));
  const valueStar = board.parlays.find((parlay) => /star.value|core/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel));
  const safeLadder = board.parlays.find((parlay) => /safe.ladder/i.test(parlay.title || "") && gameLabelMatches(parlay.gameLabel, gameLabel));
  if (!single?.legs?.length && !safeLadder?.legs?.length && !safer?.legs?.length && !sameTeam?.legs?.length && !three?.legs?.length && !valueStar?.legs?.length) return null;
  const hydrateLeg = (leg) => ({
    ...leg,
    probability: Number.isFinite(leg.probability) ? leg.probability : clamp((Number(leg.score) || 60) / 175, 0.32, 0.58)
  });
  return {
    singleLegs: (single?.legs || []).map(hydrateLeg),
    safeLadderLegs: (safeLadder?.legs || []).map(hydrateLeg),
    saferLegs: (safer?.legs || []).map(hydrateLeg),
    sameTeamLegs: (sameTeam?.legs || []).map(hydrateLeg),
    threeLegs: (three?.legs || []).map(hydrateLeg),
    valueStarLegs: (valueStar?.legs || []).map(hydrateLeg),
    locked: true,
    lockedAt: board.savedAt || "",
    gameLabel
  };
}

function shotLegKey(leg) {
  return `${leg.player}|${leg.market}|${leg.line}|${leg.direction}`;
}

function shotPlayerMarketKey(leg) {
  return `${normalizeName(leg.player)}|${leg.market}|${leg.direction}`;
}

function shotGameLabel(game) {
  return `${game.awayTeam} @ ${game.homeTeam}`;
}

function isComboMarket(market) {
  return ["player_points_rebounds_assists", "player_points_assists", "player_points_rebounds", "player_rebounds_assists"].includes(market);
}

function samePlayerMarketsCorrelate(leftMarket, rightMarket) {
  if (leftMarket === rightMarket) return true;
  if (isComboMarket(leftMarket) || isComboMarket(rightMarket)) return true;
  return false;
}

function boostedShotLeg(leg, game) {
  const playerTier = leg.playerTier || inferPlayerTier(leg);
  const starMarkets = ["player_points", "player_rebounds", "player_assists", "player_points_rebounds_assists"];
  const isStar = playerTier === "star";
  const boost = isStar && starMarkets.includes(leg.market) ? 24 : 0;
  const probabilityBoost = isStar && starMarkets.includes(leg.market) ? 0.09 : 0;

  return {
    ...leg,
    playerTier,
    score: Math.round(clamp(leg.score + boost, 12, 96)),
    probability: clamp(leg.probability + probabilityBoost, 0.26, 0.78),
    contextNotes: [
      ...(leg.contextNotes || []),
      ...(boost ? ["Shot of Glory star boost"] : [])
    ],
    gameLabel: shotGameLabel(game)
  };
}

function shotCandidatesForGame(game) {
  const baseBuild = gameParlayBuild(game);
  const excluded = new Set([...(baseBuild.singleLegs || []), ...(baseBuild.safeLadderLegs || []), ...(baseBuild.saferLegs || []), ...(baseBuild.sameTeamLegs || []), ...(baseBuild.threeLegs || []), ...(baseBuild.valueStarLegs || [])].map(shotLegKey));
  return game.candidates
    .filter((prop) => !prop.excluded)
    .filter((prop) => playerBelongsToGame(prop, game))
    .flatMap((prop) => scorePropSides(prop, game).map((leg) => boostedShotLeg(leg, game)))
    .filter((leg) => qualityGate(leg, "shot") || consistencyGate(leg, "shot"))
    .filter((leg) => !(leg.market === "player_threes" && leg.direction === "Over" && leg.probability < minimumLegProbability))
    .map((leg) => ({
      ...leg,
      gameId: game.id,
      gameLabel: shotGameLabel(game),
      shotOverlapsBase: excluded.has(shotLegKey(leg))
    }))
    .sort((a, b) => b.score - a.score);
}

function shotSelectionState(selected) {
  const legKeys = new Set(selected.map(shotLegKey));
  const playerMarkets = new Set(selected.map(shotPlayerMarketKey));
  const playerCounts = new Map();
  const gameCounts = new Map();

  selected.forEach((leg) => {
    const player = normalizeName(leg.player);
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1);
    gameCounts.set(leg.gameId, (gameCounts.get(leg.gameId) || 0) + 1);
  });

  return { legKeys, playerMarkets, playerCounts, gameCounts };
}

function canAddShotLeg(leg, selected, options = {}) {
  const state = shotSelectionState(selected);
  const player = normalizeName(leg.player);
  if (state.legKeys.has(shotLegKey(leg))) return false;
  if (state.playerMarkets.has(shotPlayerMarketKey(leg))) return false;
  if (!options.allowOverlap && leg.shotOverlapsBase) return false;
  if ((state.playerCounts.get(player) || 0) >= (options.maxPerPlayer || 3)) return false;
  if ((state.gameCounts.get(leg.gameId) || 0) >= (options.maxPerGame || 4)) return false;
  if (!options.allowSamePlayerCombo) {
    const samePlayerLegs = selected.filter((item) => normalizeName(item.player) === player);
    if (samePlayerLegs.some((item) => samePlayerMarketsCorrelate(item.market, leg.market))) return false;
  }
  return true;
}

function addShotLegsFromPool(selected, pool, target, options = {}) {
  for (const leg of pool) {
    if (selected.length >= target) break;
    if (!canAddShotLeg(leg, selected, options)) continue;
    selected.push({
      ...leg,
      contextNotes: [
        ...(leg.contextNotes || []),
        ...(leg.shotOverlapsBase ? ["Shot fill: overlaps regular board because slate was thin"] : []),
        ...(options.fillNote ? [options.fillNote] : [])
      ]
    });
  }
  return selected;
}

function gameParlayBuild(game) {
  if (!game) return { singleLegs: [], safeLadderLegs: [], saferLegs: [], sameTeamLegs: [], threeLegs: [], valueStarLegs: [], locked: false, lockedAt: "" };
  const key = gameLockKey(game);
  if (!gameHasStarted(game) || boardEnrichmentPending || backgroundEnrichmentRunning) return liveGameBuild(game);
  if (!lockedParlayBuilds[key]) {
    lockedParlayBuilds[key] = savedBuildForGame(game) || {
      ...liveGameBuild(game),
      locked: true,
      lockedAt: new Date().toISOString(),
      gameLabel: `${game.awayTeam} @ ${game.homeTeam}`
    };
    saveLockedParlayBuilds();
  }
  return lockedParlayBuilds[key];
}

function clearLiveBuildsForSlate() {
  const prefix = `${elements.slateDate.value || today}|${elements.sportKey.value}|${elements.bookFilter.value}|`;
  let changed = false;
  Object.entries(lockedParlayBuilds).forEach(([key, build]) => {
    if (key.startsWith(prefix) && !build.locked) {
      delete lockedParlayBuilds[key];
      changed = true;
    }
  });
  if (changed) saveLockedParlayBuilds();
}

function liveShotBuild() {
  const targetLegs = 6;
  const maxPerGame = slate.length <= 1 ? targetLegs : slate.length === 2 ? 4 : 3;
  const gameBuilds = slate.map((game) => ({
    game,
    candidates: shotCandidatesForGame(game),
    legs: []
  }));
  const selected = [];

  gameBuilds.forEach((build) => {
    const primaryPool = build.candidates.filter((leg) => !leg.shotOverlapsBase);
    addShotLegsFromPool(selected, primaryPool, Math.min(targetLegs, selected.length + 2), {
      maxPerGame,
      maxPerPlayer: 3,
      fillNote: "Shot balance: first two from each game"
    });
  });

  const cleanSlatePool = gameBuilds
    .flatMap((build) => build.candidates)
    .filter((leg) => !leg.shotOverlapsBase)
    .sort((a, b) => b.score - a.score);
  addShotLegsFromPool(selected, cleanSlatePool, targetLegs, {
    maxPerGame,
    maxPerPlayer: 3,
    fillNote: "Shot consistency add: best unused leg"
  });

  const overlapPool = gameBuilds
    .flatMap((build) => build.candidates)
    .sort((a, b) => b.score - a.score);
  addShotLegsFromPool(selected, overlapPool, targetLegs, {
    allowOverlap: true,
    maxPerGame,
    maxPerPlayer: 3,
    fillNote: "Shot consistency add: controlled overlap"
  });

  if (selected.length < targetLegs) {
    addShotLegsFromPool(selected, overlapPool, targetLegs, {
      allowOverlap: true,
      allowSamePlayerCombo: true,
      maxPerGame: targetLegs,
      maxPerPlayer: 3,
      fillNote: "Shot consistency add: thin slate"
    });
  }

  const legs = selected.slice(0, targetLegs);
  gameBuilds.forEach((build) => {
    build.legs = legs.filter((leg) => leg.gameId === build.game.id);
  });

  return {
    gameBuilds,
    legs,
    targetLegs,
    locked: false,
    lockedAt: ""
  };
}

function shotForGloryBuild() {
  const key = shotLockKey();
  const slateStarted = slate.some((game) => gameHasStarted(game));
  if (!slateStarted || boardEnrichmentPending || backgroundEnrichmentRunning) return liveShotBuild();
  if (!lockedParlayBuilds[key]) {
    lockedParlayBuilds[key] = {
      ...liveShotBuild(),
      locked: true,
      lockedAt: new Date().toISOString()
    };
    saveLockedParlayBuilds();
  }
  return lockedParlayBuilds[key];
}

function parlayGrade(legs) {
  if (!legs.length) return 0;
  const averageLeg = average(legs.map((leg) => leg.score));
  const correlationPenalty = new Set(legs.map((leg) => leg.market)).size < 3 ? 4 : 0;
  const legCountPenalty = Math.max(0, legs.length - 2) * 5;
  return Math.round(clamp(averageLeg - correlationPenalty - legCountPenalty, 10, 96));
}

function parlayProbability(legs) {
  if (!legs.length) return 0;
  return legs.reduce((probability, leg) => {
    const legProbability = Number.isFinite(leg.probability) ? leg.probability : clamp((Number(leg.score) || 60) / 175, 0.32, 0.58);
    return probability * legProbability;
  }, 1);
}

function conservativeParlayOdds(legs) {
  if (!legs.length) return 100;
  const decimalProduct = legs.reduce((product, leg) => product * americanToDecimalOdds(leg.odds), 1);
  const rawProfit = Math.max(0, decimalProduct - 1);
  const sameGameHaircut = legs.length <= 2 ? 0.82 : legs.length <= 3 ? 0.72 : 0.58;
  const marketOverlapHaircut = new Set(legs.map((leg) => leg.market)).size < legs.length ? 0.9 : 1;
  const conservativeDecimal = 1 + rawProfit * sameGameHaircut * marketOverlapHaircut;
  return decimalToAmericanOdds(conservativeDecimal);
}

function averageLegProbability(legs) {
  if (!legs.length) return 0;
  return average(legs.map((leg) => Number.isFinite(leg.probability) ? leg.probability : clamp((Number(leg.score) || 60) / 175, 0.32, 0.58)));
}

function formatProbability(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function boardStatus(grade, legs = []) {
  const probability = averageLegProbability(legs);
  const hasFill = legs.some((leg) => (leg.contextNotes || []).some((note) => /fill|reserve|emergency/i.test(note)));
  if (!legs.length) return { label: "Pass", detail: "No qualifying legs", className: "pass" };
  if (probability < 0.5) return { label: "Pass lean", detail: "Below 50% avg leg read", className: "pass" };
  if (hasFill || probability < 0.56 || grade < 62) return { label: "Thin fill", detail: "Filled after strict gates", className: "thin" };
  if (probability >= 0.6 && grade >= 74) return { label: "Strong", detail: "Cleared strict gates", className: "strong" };
  return { label: "Playable", detail: "Moderate board", className: "playable" };
}

function parlayTone(grade, legs = []) {
  if (legs.length) return boardStatus(grade, legs).label;
  if (grade >= 74) return "Strong grade";
  if (grade >= 57) return "Playable grade";
  return "Thin grade";
}

function loadSavedBoards() {
  try {
    return JSON.parse(localStorage.getItem("propLensSavedBoards") || "[]");
  } catch {
    return [];
  }
}

function saveSavedBoards() {
  localStorage.setItem("propLensSavedBoards", JSON.stringify(savedBoards.slice(0, 14)));
}

function loadLockedParlayBuilds() {
  try {
    return JSON.parse(localStorage.getItem("propLensLockedParlayBuilds") || "{}");
  } catch {
    return {};
  }
}

function saveLockedParlayBuilds() {
  localStorage.setItem("propLensLockedParlayBuilds", JSON.stringify(lockedParlayBuilds));
}

function mergeSavedBoards(boards) {
  const byKey = new Map();
  [...boards, ...savedBoards].forEach((board) => {
    if (board?.key && !byKey.has(board.key)) byKey.set(board.key, board);
  });
  savedBoards = Array.from(byKey.values())
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);
  invalidateSavedLegCache();
  saveSavedBoards();
}

async function pushSavedBoard(board) {
  if (!board || window.location.protocol === "file:") return;
  try {
    await fetch("/api/saved-boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board })
    });
  } catch {
    // Local storage remains the fallback.
  }
}

async function loadServerSavedBoards() {
  if (window.location.protocol === "file:") return;
  const before = elements.slateDate.value || today;
  try {
    const url = new URL("/api/saved-boards", window.location.origin);
    url.searchParams.set("before", before);
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load saved boards");
    if (payload.boards?.length) {
      mergeSavedBoards(payload.boards);
      renderSavedBoards();
    }
  } catch {
    renderSavedBoards();
  }
}

function gradeLegFromLogs(leg) {
  const latestLog = leg.seriesLogs?.[0];
  if (!latestLog) return { status: "pending", actual: null };
  const actual = logValueForMarket(latestLog, leg.market);
  if (!Number.isFinite(actual)) return { status: "pending", actual: null };

  const hit = leg.direction === "Over" ? actual > Number(leg.line) : actual < Number(leg.line);
  return {
    status: hit ? "hit" : "miss",
    actual,
    resultDate: latestLog.date || ""
  };
}

function reviewLegFromLogs(leg) {
  const logs = leg.seriesLogs || [];
  if (!logs.length || leg.status !== "miss") return [];
  const values = logs.map((log) => logValueForMarket(log, leg.market)).filter((value) => Number.isFinite(value));
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const latestValue = values[0];
  const priorValues = values.slice(1);
  const latestMinutes = minutes[0];
  const priorMinutes = minutes.slice(1);
  const notes = [];

  if (!Number.isFinite(latestValue) || !priorValues.length) return notes;

  const priorHitsForLeg = priorValues.filter((value) => leg.direction === "Over" ? value > Number(leg.line) : value < Number(leg.line)).length;
  const priorRate = priorHitsForLeg / priorValues.length;
  const priorAverage = average(priorValues);
  const latestDelta = latestValue - priorAverage;
  const priorMinuteAverage = priorMinutes.length ? average(priorMinutes) : null;
  const minuteDelta = Number.isFinite(latestMinutes) && priorMinuteAverage !== null ? latestMinutes - priorMinuteAverage : null;

  if (priorRate >= 0.75) {
    notes.push(`Trend reversal: prior ${priorHitsForLeg}/${priorValues.length} hit, latest value ${latestValue}`);
  }

  if (leg.direction === "Under" && latestDelta >= 2) {
    notes.push(`Usage spike: latest value was ${formatSigned(latestDelta)} above prior series average`);
  }

  if (leg.direction === "Over" && latestDelta <= -2) {
    notes.push(`Usage drop: latest value was ${formatSigned(latestDelta)} below prior series average`);
  }

  if (minuteDelta !== null && minuteDelta >= 4) {
    notes.push(`Minutes increased ${formatSigned(minuteDelta)} from prior series average`);
  }

  if (minuteDelta !== null && minuteDelta <= -4) {
    notes.push(`Minutes decreased ${formatSigned(minuteDelta)} from prior series average`);
  }

  if (leg.teamInjuryContext?.names?.length || leg.teamSituation?.lineupKeyOut?.length) {
    const names = [...(leg.teamInjuryContext?.names || []), ...(leg.teamSituation?.lineupKeyOut || [])].filter(Boolean);
    notes.push(`Lineup context changed with ${names.slice(0, 3).join(", ")} out`);
  }

  return notes.slice(0, 3);
}

function savedLeg(leg, gameLabel, group) {
  const grade = gradeLegFromLogs(leg);
  const payload = {
    key: `${gameLabel}|${group}|${leg.player}|${leg.market}|${leg.line}|${leg.direction}`,
    group,
    gameLabel,
    player: leg.player,
    market: leg.market,
    marketLabel: marketLabels[leg.market] || leg.market,
    direction: leg.direction,
    line: leg.line,
    sourceLine: leg.sourceLine,
    floorLabel: leg.floorLabel || "",
    floorMarketLabel: leg.floorMarketLabel || "",
    modeledFloor: Boolean(leg.modeledFloor),
    odds: leg.odds,
    score: leg.score,
    probability: leg.probability,
    playerTier: leg.playerTier,
    contextNotes: leg.contextNotes || [],
    seriesGames: leg.seriesGames,
    seriesHits: leg.seriesHits,
    seriesEdge: leg.seriesEdge,
    averageMinutes: leg.averageMinutes,
    seriesLogs: leg.seriesLogs || [],
    teamInjuryContext: leg.teamInjuryContext || null,
    teamSituation: leg.teamSituation || null,
    agentSignals: leg.agentSignals || [],
    actual: grade.actual,
    status: grade.status,
    resultDate: grade.resultDate || "",
    reviewTags: []
  };
  payload.reviewNotes = reviewLegFromLogs(payload);
  return payload;
}

function savedParlay(title, gameLabel, group, legs) {
  const savedLegs = legs.map((leg) => savedLeg(leg, gameLabel, group));
  const graded = savedLegs.filter((leg) => leg.status !== "pending");
  return {
    title,
    gameLabel,
    group,
    grade: parlayGrade(legs),
    probability: parlayProbability(legs),
    legs: savedLegs,
    hits: graded.filter((leg) => leg.status === "hit").length,
    graded: graded.length
  };
}

function currentBoardSnapshot() {
  if (!slate.length || slate.every((game) => game.source === "Sample")) return null;
  const date = elements.slateDate.value || today;
  const sport = elements.sportKey.value;
  const parlays = [];

  slate.forEach((game) => {
    const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
    const build = gameParlayBuild(game);
    const singleLegs = build.singleLegs || [];
    const safeLadderLegs = build.safeLadderLegs || [];
    const saferLegs = build.saferLegs || [];
    const sameTeamLegs = build.sameTeamLegs || [];
    const threeLegs = build.threeLegs || [];
    const valueStarLegs = build.valueStarLegs || [];
    if (singleLegs.length) parlays.push(savedParlay("Bet of the Day", gameLabel, "Bet of the Day", singleLegs));
    if (safeLadderLegs.length) parlays.push(savedParlay("Safe Ladder", gameLabel, "Safe Ladder", safeLadderLegs));
    if (saferLegs.length) parlays.push(savedParlay("2-Leg Safer Parlay", gameLabel, "2-Leg Safer", saferLegs));
    if (sameTeamLegs.length) parlays.push(savedParlay("2-Leg Alternate Parlay", gameLabel, "2-Leg Alternate", sameTeamLegs));
    if (threeLegs.length) parlays.push(savedParlay("3-Leg Mixed-Team Parlay", gameLabel, "3-Leg Mixed", threeLegs));
    if (valueStarLegs.length) parlays.push(savedParlay("Star Value Board", gameLabel, "Star Value", valueStarLegs));
  });

  const shotBuild = shotForGloryBuild();
  const shotLegs = (shotBuild.legs || []).map((leg) => ({
    leg,
    gameLabel: leg.gameLabel
  }));
  if (shotLegs.length) {
    const savedLegs = shotLegs.map((item) => savedLeg(item.leg, item.gameLabel, "Shot"));
    const gradedShot = savedLegs.filter((leg) => leg.status !== "pending");
    parlays.push({
      title: "Shot of Glory",
      gameLabel: "Slate parlay",
      group: "Shot",
      grade: parlayGrade(shotLegs.map((item) => item.leg)),
      probability: parlayProbability(shotLegs.map((item) => item.leg)),
      legs: savedLegs,
      hits: gradedShot.filter((leg) => leg.status === "hit").length,
      graded: gradedShot.length
    });
  }

  const legs = parlays.flatMap((parlay) => parlay.legs);
  const graded = legs.filter((leg) => leg.status !== "pending");
  return {
    key: `${date}-${sport}-${elements.bookFilter.value}`,
    date,
    sport,
    buildVersion: boardBuildVersion,
    bookKey: elements.bookFilter.value,
    bookTitle: elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || elements.bookFilter.value,
    savedAt: new Date().toISOString(),
    games: slate.map((game) => `${game.awayTeam} @ ${game.homeTeam}`),
    parlays,
    legs,
    hits: graded.filter((leg) => leg.status === "hit").length,
    graded: graded.length
  };
}

function snapshotLegCount(board) {
  if (!board) return 0;
  if (board.parlays?.length) return board.parlays.reduce((total, parlay) => total + (parlay.legs?.length || 0), 0);
  return board.legs?.length || 0;
}

function snapshotGameCount(board) {
  if (!board) return 0;
  return new Set([
    ...(board.games || []),
    ...(board.parlays || []).map((parlay) => parlay.gameLabel).filter(Boolean)
  ]).size;
}

function shouldReplaceSavedBoard(existing, snapshot) {
  if (!existing) return true;
  if (snapshot.buildVersion !== existing.buildVersion) return true;
  const existingGames = snapshotGameCount(existing);
  const snapshotGames = snapshotGameCount(snapshot);
  if (snapshotGames > existingGames) return true;
  if (snapshotGames < existingGames) return false;
  return snapshotLegCount(snapshot) >= snapshotLegCount(existing);
}

function upsertCurrentBoard() {
  const snapshot = currentBoardSnapshot();
  if (!snapshot?.legs.length) return;
  const existing = savedBoards.find((board) => board.key === snapshot.key);
  const boardToSave = shouldReplaceSavedBoard(existing, snapshot) ? snapshot : existing;
  savedBoards = [
    boardToSave,
    ...savedBoards.filter((board) => board.key !== boardToSave.key)
  ].slice(0, 14);
  invalidateSavedLegCache();
  saveSavedBoards();
  pushSavedBoard(boardToSave);
}

function resultIcon(status) {
  if (status === "hit") return "✓";
  if (status === "miss") return "X";
  return "–";
}

function bettorMissTagLabel(tag = "") {
  const labels = {
    trend_reversal: "trends flipped",
    weak_trend_selected: "weak trends were selected",
    usage_spike: "usage jumped",
    usage_drop: "usage dropped",
    volatile_minutes: "minutes were unstable",
    minutes_rising_against_under: "minutes rose against unders",
    minutes_dipping_against_over: "minutes dipped against overs",
    lineup_role_change: "lineups changed roles",
    line_moved_against_side: "line moved against us",
    line_moved_with_side: "line movement mattered",
    agent_warning_ignored: "warning signs were ignored",
    close_miss: "close misses"
  };
  return labels[tag] || tag.replaceAll("_", " ");
}

function bettorMissReviewText(leg) {
  const tags = new Set(leg.reviewTags || []);
  if (tags.has("close_miss")) return "Missed by one stat or less. Treat this more like variance than a bad read.";
  if (tags.has("usage_spike")) return "His role or touches jumped compared with the saved logs, so the under got burned.";
  if (tags.has("usage_drop")) return "His production fell well below the saved-log average, so the over did not have enough cushion.";
  if (tags.has("lineup_role_change")) return "Lineup changes likely shifted responsibilities, making the old trend less reliable.";
  if (tags.has("volatile_minutes")) return "His minutes have been unstable, which makes trend-based legs harder to trust.";
  if (tags.has("line_moved_against_side")) return "The line moved in a way that made our side tougher before the game.";
  if (tags.has("agent_warning_ignored")) return "The app had a warning sign before tip; similar spots should be downgraded next time.";
  if (tags.has("trend_reversal")) return "The pregame trend looked good, but it flipped in this game.";
  if (tags.has("weak_trend_selected")) return "The saved logs did not strongly support this side before the game.";
  return leg.reviewNotes?.length ? bettorSignalText({ note: leg.reviewNotes[0], delta: -1 }) : "Missed without a clear saved-log reason.";
}

function evaluationSummary(boards = savedBoards) {
  const graded = savedBoardLegs(boards).filter((leg) => leg.status === "hit" || leg.status === "miss");
  if (!graded.length) return "";
  const hits = graded.filter((leg) => leg.status === "hit").length;
  const reviewedMisses = graded.filter((leg) => leg.status === "miss" && leg.reviewNotes?.length);
  const byPattern = new Map();
  const byMissTag = new Map();

  graded.forEach((leg) => {
    const key = `${marketLabels[leg.market] || leg.market} ${leg.direction}`;
    const item = byPattern.get(key) || { key, hits: 0, total: 0 };
    item.total += 1;
    if (leg.status === "hit") item.hits += 1;
    byPattern.set(key, item);

    if (leg.status === "miss") {
      (leg.reviewTags || []).forEach((tag) => {
        byMissTag.set(tag, (byMissTag.get(tag) || 0) + 1);
      });
    }
  });

  const coldPatterns = Array.from(byPattern.values())
    .filter((item) => item.total >= 2 && item.hits / item.total < 0.5)
    .slice(0, 3);
  const missDrivers = Array.from(byMissTag.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, count]) => `${bettorMissTagLabel(tag)} (${count})`);

  return `
    <div class="evaluation-summary">
      <strong>Internal eval: ${hits}/${graded.length} legs hit</strong>
      ${coldPatterns.length ? `<span>We are downgrading these weak spots next time: ${coldPatterns.map((item) => `${item.key} hit ${item.hits}/${item.total}`).join(", ")}</span>` : "<span>No repeated weak pattern yet.</span>"}
      ${missDrivers.length ? `<span>Main reasons legs missed: ${missDrivers.join(" · ")}</span>` : ""}
      ${reviewedMisses.length ? `<span>What went wrong: ${reviewedMisses.slice(0, 3).map((leg) => `${leg.player}: ${bettorMissReviewText(leg)}`).join(" · ")}</span>` : ""}
    </div>
  `;
}

async function ensureFinalStatsForBoards(boards) {
  if (window.location.protocol === "file:") return;
  const dates = [...new Set(boards.map((board) => board.date).filter(Boolean))];
  const currentDate = elements.slateDate.value || today;

  dates.forEach(async (date) => {
    const cached = finalStatsCache.get(date);
    const relatedBoards = boards.filter((board) => board.date === date);
    const cacheAge = cached?.__fetchedAt ? Date.now() - cached.__fetchedAt : Infinity;
    const currentDateNeedsRefresh = date === currentDate && cached && cacheAge > 30_000 && !relatedBoards.some((board) => boardGamesFinal(board) || boardHasFinalResults(board));
    if ((cached && !currentDateNeedsRefresh) || finalStatsLoading.has(date)) return;
    finalStatsLoading.add(date);
    try {
      const response = await fetch(`/api/final-stats?date=${encodeURIComponent(date)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load final stats");
      payload.__fetchedAt = Date.now();
      finalStatsCache.set(date, payload);
      invalidateSavedLegCache();
      renderSavedBoards();
    } catch {
      finalStatsCache.set(date, { stats: [], games: [], __fetchedAt: Date.now() });
      invalidateSavedLegCache();
    } finally {
      finalStatsLoading.delete(date);
    }
  });
}

function boardGamesFinal(board) {
  const finalStats = finalStatsCache.get(board?.date || "");
  if (!finalStats?.games?.length) return false;
  const boardGames = board.games?.length ? board.games : board.parlays?.map((parlay) => parlay.gameLabel).filter(Boolean) || [];
  if (!boardGames.length) return false;
  return boardGames.every((label) =>
    finalStats.games.some((game) => gameLabelMatches(game.gameLabel, label) && /final/i.test(game.status || ""))
  );
}

function boardHasFinalResults(board) {
  const legs = board?.parlays?.length ? board.parlays.flatMap((parlay) => parlay.legs || []) : board?.legs || [];
  return legs.some((leg) => gradeLegFromFinal(leg, board));
}

const successBoardTypes = [
  { key: "single", label: "Single", match: /best.single/i },
  { key: "safe", label: "Safe Ladder", match: /safe.ladder/i },
  { key: "two", label: "2 Leg", match: /2-leg|2 leg/i },
  { key: "three", label: "3 Leg", match: /3-leg|3 leg/i },
  { key: "shot", label: "Shot of Glory", match: /shot/i }
];

function successTypeForParlay(parlay) {
  const text = `${parlay.title || ""} ${parlay.group || ""}`;
  return successBoardTypes.find((type) => type.match.test(text)) || null;
}

function boardSuccessStats(boards = savedBoards) {
  const stats = new Map(successBoardTypes.map((type) => [type.key, {
    ...type,
    gradedParlays: 0,
    cashedParlays: 0,
    gradedLegs: 0,
    hitLegs: 0
  }]));

  boards.forEach((board) => {
    (board.parlays || []).forEach((parlay) => {
      const type = successTypeForParlay(parlay);
      if (!type) return;
      const item = stats.get(type.key);
      const legs = (parlay.legs || []).map((leg) => effectiveSavedLeg(leg, board));
      const gradedLegs = legs.filter((leg) => leg.status === "hit" || leg.status === "miss");
      if (!gradedLegs.length) return;
      item.gradedLegs += gradedLegs.length;
      item.hitLegs += gradedLegs.filter((leg) => leg.status === "hit").length;
      if (gradedLegs.length === legs.length) {
        item.gradedParlays += 1;
        if (gradedLegs.every((leg) => leg.status === "hit")) item.cashedParlays += 1;
      }
    });
  });

  return Array.from(stats.values());
}

function renderBoardSuccess(boards = savedBoards) {
  if (!elements.boardSuccess) return;
  const rows = boardSuccessStats(boards);
  const hasResults = rows.some((row) => row.gradedParlays || row.gradedLegs);

  if (!hasResults) {
    elements.boardSuccess.textContent = "Board success will appear after saved results are graded.";
    return;
  }

  elements.boardSuccess.innerHTML = `
    <div class="board-success-heading">
      <strong>Board Success</strong>
      <span>completed parlays</span>
    </div>
    <div class="board-success-chart">
      ${rows.map((row) => {
        const parlayRate = row.gradedParlays ? row.cashedParlays / row.gradedParlays : 0;
        const legRate = row.gradedLegs ? row.hitLegs / row.gradedLegs : 0;
        return `
          <div class="success-row">
            <div class="success-label">
              <strong>${row.label}</strong>
              <span>${row.gradedParlays ? `${row.cashedParlays}/${row.gradedParlays} cashed` : "No completed boards"}</span>
            </div>
            <div class="success-bars" aria-label="${row.label} success">
              <div class="success-track">
                <span style="width:${Math.round(parlayRate * 100)}%"></span>
              </div>
              <small>${Math.round(parlayRate * 100)}% board · ${Math.round(legRate * 100)}% legs</small>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function preferredSavedBoardDate(boards) {
  const dates = [...new Set(boards.map((board) => board.date).filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a)));
  if (!dates.length) return elements.slateDate.value || today;
  return dates.find((date) => date < today) || dates[0];
}

function renderSavedBoards() {
  if (!elements.savedBoards) return;
  const savedWithLegs = savedBoards.filter((board) =>
    board.parlays?.length || board.legs?.length
  );

  if (!savedBoardDateTouched && savedWithLegs.length) {
    elements.savedBoardDate.value = preferredSavedBoardDate(savedWithLegs);
  }

  const selectedSavedDate = elements.savedBoardDate.value || preferredSavedBoardDate(savedWithLegs);
  ensureFinalStatsForBoards(savedWithLegs);
  renderBoardSuccess(savedWithLegs);
  const selectedDateBoards = savedWithLegs.filter((board) => board.date === selectedSavedDate);
  const boards = selectedDateBoards.filter((board) => selectedSavedDate < today || boardGamesFinal(board) || boardHasFinalResults(board));

  if (!boards.length) {
    elements.savedBoards.textContent = `No saved board results for ${selectedSavedDate} yet.`;
    return;
  }

  elements.savedBoards.innerHTML = `
    ${evaluationSummary(boards)}
    ${boards.map((board) => {
    const parlays = board.parlays?.length ? board.parlays : [{
      title: "Generated Legs",
      gameLabel: board.games?.[0] || "Saved board",
      group: "Saved",
      legs: board.legs || [],
      hits: board.hits || 0,
      graded: board.graded || 0
    }];
    const boardLegs = (board.parlays?.length ? board.parlays.flatMap((parlay) => parlay.legs || []) : board.legs || []).map((leg) => effectiveSavedLeg(leg, board));
    const boardGraded = boardLegs.filter((leg) => leg.status === "hit" || leg.status === "miss");
    const complete = boardGraded.length ? `${boardGraded.filter((leg) => leg.status === "hit").length}/${boardGraded.length}` : "Pending";
    return `
      <article class="saved-board-card">
        <div class="saved-board-title">
          <strong>${board.date}</strong>
          <span>${complete}</span>
        </div>
        <div class="saved-parlay-list">
          ${parlays.map((parlay) => `
            <div class="saved-parlay">
              <div class="saved-parlay-heading">
                <strong>${parlay.title}</strong>
                ${(() => {
                  const displayLegs = (parlay.legs || []).map((leg) => effectiveSavedLeg(leg, board));
                  const graded = displayLegs.filter((leg) => leg.status === "hit" || leg.status === "miss");
                  return `<span>${parlay.gameLabel}${graded.length ? ` · ${graded.filter((leg) => leg.status === "hit").length}/${graded.length}` : ""}</span>`;
                })()}
              </div>
              <div class="saved-leg-list">
                ${(parlay.legs || []).map((rawLeg) => {
                  const leg = effectiveSavedLeg(rawLeg, board);
                  return `
                  <div class="saved-leg ${leg.status}">
                    <span class="result-mark">${resultIcon(leg.status)}</span>
                    <span>${leg.player} ${leg.direction} ${leg.line} ${leg.marketLabel}</span>
                    <small>${leg.actual === null || leg.actual === undefined ? "--" : leg.actual}</small>
                    ${leg.reviewNotes?.length ? `<em>${bettorMissReviewText(leg)}</em>` : ""}
                  </div>
                `;
                }).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }).join("")}
  `;
}

function propKey(gameId, propId) {
  return `${gameId}::${propId}`;
}

function slateProps() {
  return slate.flatMap((game) =>
    game.candidates.map((prop) => ({
      ...prop,
      gameId: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      gameLabel: `${game.awayTeam} @ ${game.homeTeam}`
    }))
  );
}

function lookupProps() {
  return [
    ...slateProps(),
    ...Array.from(playerLogProfiles.values()).flat()
  ];
}

function formatBooks(prop) {
  if (prop.selectedBookAvailable === false) return `${elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "Selected book"} unavailable`;
  if (prop.bookTitle) return prop.bookTitle;
  if (!prop.books?.length) return "Sportsbook line";
  return prop.books.slice(0, 3).join(", ");
}

function lineSplitLabel(prop) {
  if (!prop.lineAlternates?.length) return "";
  const allLines = [Number(prop.line), ...prop.lineAlternates.map((item) => Number(item.line))].filter(Number.isFinite);
  const lowLine = Math.min(...allLines);
  const highLine = Math.max(...allLines);

  if (prop.direction === "Over" && Number(prop.line) === lowLine) return "Soft over line";
  if (prop.direction === "Under" && Number(prop.line) === highLine) return "Soft under line";
  return "Line split";
}

function lineSplitText(prop) {
  if (!prop.lineAlternates?.length) return "";
  const alternates = prop.lineAlternates
    .map((item) => `${item.line} at ${item.books.slice(0, 2).join(", ")}`)
    .join("; ");
  return `${lineSplitLabel(prop)}: current ${prop.line}; other books ${alternates}`;
}

function fallbackSeriesLogs(prop) {
  return [];
}

const logMarketOptions = [
  ["player_points", "PTS"],
  ["player_rebounds", "REB"],
  ["player_threes", "3PT"],
  ["player_assists", "AST"],
  ["player_points_rebounds_assists", "PRA"],
  ["player_points_assists", "PA"],
  ["player_points_rebounds", "PR"],
  ["player_rebounds_assists", "RA"]
];

const mlbLogMarketOptions = [
  ["batter_total_bases", "TB"],
  ["batter_hits", "H"],
  ["batter_runs", "R"],
  ["batter_rbis", "RBI"],
  ["batter_home_runs", "HR"],
  ["pitcher_strikeouts", "K"]
];

function logMarketOptionsForSport() {
  return elements.sportKey.value === "baseball_mlb" ? mlbLogMarketOptions : logMarketOptions;
}

function logMarketIncludes(selectedMarket, baseMarket) {
  const included = {
    player_points: ["player_points"],
    player_rebounds: ["player_rebounds"],
    player_assists: ["player_assists"],
    player_threes: ["player_threes"],
    player_points_rebounds_assists: ["player_points", "player_rebounds", "player_assists"],
    player_points_assists: ["player_points", "player_assists"],
    player_points_rebounds: ["player_points", "player_rebounds"],
    player_rebounds_assists: ["player_rebounds", "player_assists"],
    batter_total_bases: ["batter_total_bases"],
    batter_hits: ["batter_hits"],
    batter_runs: ["batter_runs"],
    batter_rbis: ["batter_rbis"],
    batter_home_runs: ["batter_home_runs"],
    pitcher_strikeouts: ["pitcher_strikeouts"]
  };
  return (included[selectedMarket] || [selectedMarket]).includes(baseMarket);
}

function selectedMarketClass(prop, market) {
  return logMarketIncludes(prop.market, market) ? " class=\"selected-log-value\"" : "";
}

function opponentKey(value) {
  return normalizeName(value || "unknown");
}

function logsForOpponent(logs, opponent = "all") {
  if (!opponent || opponent === "all") return logs;
  const target = opponentKey(opponent);
  return logs.filter((log) => opponentKey(log.opponent) === target);
}

function opponentOptions(logs, selectedOpponent) {
  const opponents = [...new Set(logs.map((log) => String(log.opponent || "Opponent").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const normalizedOpponents = new Set(opponents.map(opponentKey));
  const safeSelected = selectedOpponent !== "all" && normalizedOpponents.has(opponentKey(selectedOpponent)) ? selectedOpponent : "all";
  selectedLogOpponent = safeSelected;
  return [
    `<option value="all"${safeSelected === "all" ? " selected" : ""}>All teams</option>`,
    ...opponents.map((opponent) => `<option value="${opponent}"${opponentKey(opponent) === opponentKey(safeSelected) ? " selected" : ""}>${opponent}</option>`)
  ].join("");
}

function seriesLogSummary(prop, logs) {
  const line = Number(prop.line);
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  if (!values.length) return "No matching logs for this filter.";
  const averageValue = average(values);
  const hasLine = Number.isFinite(line);
  const hits = hasLine ? values.filter((value) => value > line).length : 0;
  return `${values.length} game${values.length === 1 ? "" : "s"} · avg ${averageValue.toFixed(1)}${hasLine ? ` · over line ${hits}/${values.length}` : ""}`;
}

function seriesLogRows(prop, opponent = "all") {
  const sourceLogs = prop.seriesLogs?.length ? prop.seriesLogs : fallbackSeriesLogs(prop);
  const logs = logsForOpponent(sourceLogs, opponent);
  const line = Number(prop.line);
  const hasLine = Number.isFinite(line);

  if (!logs.length) {
    return `<tr><td colspan="10">No matching logs for this team filter. Choose All teams or click Web Search to refresh logs.</td></tr>`;
  }

  return logs
    .map((log) => {
      const value = logValueForMarket(log, prop.market);
      const hasValue = Number.isFinite(value);
      return `
      <tr>
        <td>${log.date}</td>
        <td>${log.opponent}</td>
        <td>${log.min}</td>
        <td${selectedMarketClass(prop, "player_points")}>${log.pts}</td>
        <td${selectedMarketClass(prop, "player_rebounds")}>${log.reb}</td>
        <td${selectedMarketClass(prop, "player_assists")}>${log.ast}</td>
        <td${selectedMarketClass(prop, "player_threes")}>${log.threes}</td>
        <td class="selected-log-value">${hasValue ? value : "--"}</td>
        <td class="selected-log-value">${hasLine ? prop.line : "--"}</td>
        <td class="selected-log-value">${hasValue && hasLine ? value > line ? "Over" : "Under" : "--"}</td>
      </tr>
    `;
    })
    .join("");
}

function playerAgentLogSummary(prop, direction, logs) {
  const line = Number(prop.line);
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  if (!values.length) return "No matching log sample for this opponent filter.";

  const averageValue = average(values);
  const hitCount = Number.isFinite(line)
    ? values.filter((value) => direction === "Over" ? value > line : value < line).length
    : 0;
  const resultText = Number.isFinite(line) ? `${direction.toLowerCase()} hit ${hitCount}/${values.length}` : "line unavailable";
  return `${values.length} game${values.length === 1 ? "" : "s"} · avg ${averageValue.toFixed(1)} · ${resultText}`;
}

function bettorAgentName(agent = "") {
  if (/role/i.test(agent)) return "Role Check";
  if (/line|movement/i.test(agent)) return "Line Check";
  if (/injury|news/i.test(agent)) return "Injury/Lineup Check";
  if (/context/i.test(agent)) return "Game Situation";
  if (/postgame|evaluation/i.test(agent)) return "What We Learned";
  return "Bet Check";
}

function bettorSignalText(signal = {}) {
  const note = String(signal.note || "");
  const direction = signal.direction || "";
  const isNegative = Number(signal.delta || 0) < 0 || Number(signal.probabilityDelta || 0) < 0;

  if (/No current role sample|No current-series sample/i.test(note)) {
    return "Not enough recent matchup data yet, so this read is more of a lean than a strong play.";
  }
  if (/Stable starter minutes/i.test(note)) {
    return "His minutes have been steady, which makes the stat trend more trustworthy.";
  }
  if (/Minutes volatility/i.test(note)) {
    return "His minutes have been up and down, so the trend is less dependable.";
  }
  if (/Latest minutes dipped against the over/i.test(note)) {
    return "His minutes dropped in the last sample, which makes the over riskier.";
  }
  if (/Latest minutes rose against the under/i.test(note)) {
    return "His minutes rose in the last sample, which makes the under riskier.";
  }
  if (/Return-to-form read: minutes are rising back/i.test(note)) {
    return "His minutes are climbing back toward a real core role, so the app gives his overs more respect.";
  }
  if (/Return-to-form read makes the under riskier/i.test(note)) {
    return "His minutes are coming back up, so fading him is riskier than the injury tag alone suggests.";
  }
  if (/Minute Restriction Agent/i.test(note)) {
    return "A source mentioned limited minutes or a workload cap, so the app should stay away until the restriction clears.";
  }
  if (/Selected book line is ([\\d.]+) better than market average/i.test(note)) {
    const amount = note.match(/([\\d.]+) better/)?.[1];
    return `This sportsbook is giving a better number than most books${amount ? ` by about ${amount}` : ""}, so the price is helping this leg.`;
  }
  if (/Selected book line is ([\\d.]+) worse than market average/i.test(note)) {
    const amount = note.match(/([\\d.]+) worse/)?.[1];
    return `This sportsbook is giving a tougher number than most books${amount ? ` by about ${amount}` : ""}, so the price is working against us.`;
  }
  if (/Books disagree/i.test(note)) {
    return "Sportsbooks are not lined up on this number, so getting the best line matters a lot here.";
  }
  if (/Book disagreement creates/i.test(note)) {
    return "This book is hanging a softer line than the market, which creates a possible value spot.";
  }
  if (/line moved/i.test(note) || /Fade candidate/i.test(note)) {
    return "The line has moved since it opened, so this play is based partly on whether that move went too far or not far enough.";
  }
  if (/Player injury tag/i.test(note)) {
    return "The player has an injury tag, so minutes or availability could be shaky.";
  }
  if (/Injury Watch Agent/i.test(note)) {
    const player = note.match(/Agent: (.*?) is /i)?.[1] || "This player";
    return `${player} is on the injury watch list. If he is ruled out or limited, the board should move away from his legs and re-score the teammates.`;
  }
  if (/added starter responsibility|Confirmed starter boost/i.test(note)) {
    return "With lineup changes, this player may have to do more than usual.";
  }
  if (/Under is risky with teammate absences/i.test(note)) {
    return "A teammate being out can push more usage to this player, so the under is dangerous.";
  }
  if (/Role-player injury bump needs confirmed minutes/i.test(note)) {
    return "The opportunity could be there, but it is risky until we know his minutes are real.";
  }
  if (/New-series board/i.test(note)) {
    return "This is a new matchup/series, so we need stronger proof than just recent trend.";
  }
  if (/Role-player overs are fragile/i.test(note)) {
    return "Role-player overs can fall apart if the rotation changes or the game script shifts.";
  }
  if (/Home elimination spot/i.test(note)) {
    return "Home elimination games can push stars into heavier minutes and usage.";
  }
  if (/Saved-board history says/i.test(note)) {
    return "Our past boards have not done well with this player/stat, so the app is treating it carefully.";
  }
  if (/Saved-board history is cold/i.test(note)) {
    return "This type of play has been missing too often in our saved results.";
  }
  if (/unders breaking when role or usage rose|unders breaking on usage/i.test(note)) {
    return "We have been losing unders when a player’s role or usage jumps, so this under gets downgraded.";
  }
  if (/overs failing when role|role\/minutes dip/i.test(note)) {
    return "We have been losing overs when minutes or role drop, so this over gets downgraded.";
  }
  if (/agent warning/i.test(note)) {
    return "A similar warning showed up before a previous miss, so this leg needs extra caution.";
  }
  if (/Market resisted the slump/i.test(note)) {
    return "The book did not lower the line much even though the player has been cold, which can signal bounce-back risk.";
  }
  if (/Line may be taxing a hot streak/i.test(note)) {
    return "The line may already be adjusted for the hot streak, so there may be less value left.";
  }
  if (/MLB pre-log mode/i.test(note)) {
    return "For MLB, this is still mostly a line-value read until we connect deeper baseball game logs.";
  }

  return isNegative
    ? `Risk note: ${note}`
    : direction ? `Support note: ${note}` : note;
}

function playerAgentMarketReads(playerProps, selectedOpponent, selectedMarket = "") {
  const scopedProps = selectedMarket
    ? playerProps.filter((prop) => prop.market === selectedMarket)
    : playerProps;
  const scored = scopedProps
    .map((prop) => {
      if (prop.logOnly || !Number.isFinite(Number(prop.line))) return null;
      const propGame = slate.find((item) => item.id === prop.gameId);
      if (!propGame) return null;
      const candidate = propGame.candidates.find((item) => item.id === prop.id);
      if (!candidate) return null;
      const read = scorePropSides({ ...candidate, gameId: propGame.id, gameLabel: prop.gameLabel }, propGame)
        .sort((a, b) => b.score - a.score || b.probability - a.probability)[0];
      const sourceLogs = prop.opponentLogs?.length ? prop.opponentLogs : prop.seriesLogs || [];
      const filteredLogs = logsForOpponent(sourceLogs, selectedOpponent);
      return {
        ...read,
        gameLabel: prop.gameLabel,
        bookTitle: prop.bookTitle,
        lineAlternates: prop.lineAlternates,
        logSummary: playerAgentLogSummary(read, read.direction, filteredLogs)
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aAvailable = a.selectedBookAvailable === false ? 0 : 1;
      const bAvailable = b.selectedBookAvailable === false ? 0 : 1;
      if (aAvailable !== bAvailable) return bAvailable - aAvailable;
      return b.score - a.score || b.probability - a.probability;
    });

  const uniqueMarkets = [];
  const seenMarkets = new Set();
  scored.forEach((read) => {
    if (seenMarkets.has(read.market)) return;
    seenMarkets.add(read.market);
    uniqueMarkets.push(read);
  });
  return uniqueMarkets;
}

function renderPlayerAgentRead(playerProps, selectedOpponent, selectedMarket = "") {
  const reads = playerAgentMarketReads(playerProps, selectedOpponent, selectedMarket);
  const selectedMarketLabel = marketLabels[selectedMarket] || "selected category";
  if (!reads.length) {
    return `
      <div class="player-agent-read">
        <div class="agent-read-header">
          <h3>Player Agent Read</h3>
          <span>${selectedMarket ? selectedMarketLabel : "No active props found"}</span>
        </div>
        <p class="agent-pass">${selectedMarket ? `No active sportsbook line found for ${selectedMarketLabel}.` : "Search a player with active sportsbook lines to get a live read."}</p>
      </div>
    `;
  }

  const best = reads[0];
  const playable = best.selectedBookAvailable !== false && best.score >= 60 && best.probability >= 0.54;
  const movementNote = lineSplitText(best);
  const signalNotes = best.agentSignals?.length
    ? best.agentSignals.slice(0, 5).map((signal) => `
        <li>
          <strong>${bettorAgentName(signal.agent)}</strong>
          <span>${bettorSignalText({ ...signal, direction: best.direction })}</span>
        </li>
      `).join("")
    : `<li><strong>Bet Check</strong><span>No major injury, role, line movement, or past-results warning showed up for this angle.</span></li>`;

  const marketRows = reads.slice(0, 5).map((read) => `
    <div class="agent-market-row${read.id === best.id ? " is-top" : ""}">
      <div>
        <strong>${marketLabels[read.market] || read.market}</strong>
        <span>${read.direction} ${read.line} · ${formatBooks(read)}</span>
      </div>
      <div>
        <strong>${read.score}/100</strong>
        <span>${formatProbability(read.probability)}</span>
      </div>
    </div>
  `).join("");

  return `
    <div class="player-agent-read">
      <div class="agent-read-header">
        <h3>Player Agent Read</h3>
        <span>${selectedMarketLabel} · ${playable ? "Playable angle" : "Pass lean"}</span>
      </div>
      <div class="agent-best-card${playable ? "" : " is-pass"}">
        <div>
          <span class="agent-label">${playable ? "Best angle" : "Best read is still thin"}</span>
          <strong>${playable ? `${best.player} ${best.direction} ${best.line} ${marketLabels[best.market] || best.market}` : "Pass for now"}</strong>
          <p>${best.selectedBookAvailable === false ? "Selected sportsbook does not currently carry the strongest read." : best.logSummary}</p>
          ${movementNote ? `<p>${movementNote}</p>` : ""}
        </div>
        <div class="agent-score">
          <strong>${best.score}/100</strong>
          <span>${formatProbability(best.probability)}</span>
        </div>
      </div>
      <ul class="agent-signal-list">${signalNotes}</ul>
      <div class="agent-market-grid">${marketRows}</div>
    </div>
  `;
}

function agentReadRows(game) {
  if (!game?.candidates?.length) return "<li>No agent reads yet.</li>";
  const watchRows = injuryWatchRows(game);
  const build = gameParlayBuild(game);
  const boardLegs = [
    ...(build.singleLegs || []),
    ...(build.safeLadderLegs || []),
    ...(build.saferLegs || []),
    ...(build.sameTeamLegs || []),
    ...(build.threeLegs || []),
    ...(build.valueStarLegs || [])
  ];
  const signals = boardLegs.flatMap((leg) =>
    (leg.agentSignals || []).map((signal) => ({
      ...signal,
      player: leg.player,
      market: marketLabels[leg.market] || leg.market,
      direction: leg.direction,
      line: leg.line
    }))
  );

  if (!signals.length && !watchRows) return "<li>No major betting warnings showed up on the current board.</li>";

  const seen = new Set();
  const signalRows = signals
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
    .filter((signal) => {
      const key = `${signal.agent}|${signal.player}|${signal.market}|${signal.note}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map((signal) => `
      <li>
        <strong>${bettorAgentName(signal.agent)}</strong>
        ${signal.player} ${signal.direction} ${signal.line} ${signal.market}
        <span>${bettorSignalText(signal)}</span>
      </li>
    `)
    .join("");

  return `${watchRows}${signalRows}`;
}

function injuryWatchRows(game) {
  const watched = [];
  const seen = new Set();
  (game.candidates || []).forEach((prop) => {
    if (prop.manualInjury !== "player_questionable" && prop.manualInjury !== "minutes_limit") return;
    const key = normalizeName(prop.player);
    if (!key || seen.has(key)) return;
    seen.add(key);
    watched.push({
      player: prop.player,
      status: prop.injuryWatch?.status || "Day-To-Day",
      note: prop.injuryWatch?.note || prop.injuryNote || "Player has an active injury tag"
    });
  });

  return watched.slice(0, 5).map((item) => `
    <li>
      <strong>Injury Watch</strong>
      ${escapeHtml(item.player)} · ${escapeHtml(item.status)}
      <span>${escapeHtml(item.note)}. If he is ruled out or limited, the board will re-score his teammates and remove his legs.</span>
    </li>
  `).join("");
}

function gameNewsRows(news, game) {
  if (!news) return `<div class="news-empty">Loading game news...</div>`;

  const injuries = news.injuries?.length
    ? news.injuries.map((item) => `<li><strong>${item.player}</strong> ${item.status || "injury update"} ${item.team ? `<span>${item.team}</span>` : ""}</li>`).join("")
    : "<li>No ESPN injury updates returned for this game.</li>";
  const starters = news.starters?.length
    ? news.starters.map((item) => `<li><strong>${item.team}</strong> ${item.starters.join(", ")}</li>`).join("")
    : "<li>No starting lineup data returned yet.</li>";
  const headlines = news.news?.length
    ? news.news.map((item) => `<li><strong>${item.headline}</strong>${item.description ? `<span>${item.description}</span>` : ""}</li>`).join("")
    : "<li>No game headlines returned yet.</li>";

  return `
    <div class="game-news-grid">
      <section class="game-news-row">
        <h4>Injuries</h4>
        <ul>${injuries}</ul>
      </section>
      <section class="game-news-row">
        <h4>Starting Lineups</h4>
        <ul>${starters}</ul>
      </section>
      <section class="game-news-row">
        <h4>Updates</h4>
        <ul>${headlines}</ul>
      </section>
      <section class="game-news-row">
        <h4>Agent Reads</h4>
        <ul>${agentReadRows(game)}</ul>
      </section>
    </div>
  `;
}

function shouldRefreshGameNews(news) {
  if (!news) return true;
  if (!news.__fetchedAt) return true;
  const age = Date.now() - news.__fetchedAt;
  const status = normalizeName(news.event?.status || "");
  const lineupMissing = !news.starters?.length;
  const gameActive = !status || /scheduled|pre|progress|halftime|quarter/.test(status);
  return gameActive && (lineupMissing || age > 90_000);
}

async function fetchGameNews(game, options = {}) {
  if (!sportConfig().liveContext) return;
  if (!game || window.location.protocol === "file:") return;
  if (!options.force && gameNewsCache.has(game.id) && !shouldRefreshGameNews(gameNewsCache.get(game.id))) return;
  if (gameNewsRefreshing.has(game.id)) return;

  gameNewsRefreshing.add(game.id);
  const url = new URL("/api/game-news", window.location.origin);
  url.searchParams.set("home", game.homeTeam);
  url.searchParams.set("away", game.awayTeam);
  url.searchParams.set("date", elements.slateDate.value || today);

  try {
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not fetch game news");
    payload.__fetchedAt = Date.now();
    gameNewsCache.set(game.id, payload);
    applyGameContext(game, payload);
    if (selectedGameId === game.id) render();
  } catch (error) {
    gameNewsCache.set(game.id, { news: [], injuries: [], starters: [], error: error.message, __fetchedAt: Date.now() });
    if (selectedGameId === game.id) renderGameNews(game);
  } finally {
    gameNewsRefreshing.delete(game.id);
  }
}

function applyGameContext(game, news) {
  if (!game) return;

  const gameInjuries = (news.injuries || [])
    .map((injury) => ({
      team: injury.team || "",
      name: injury.player || injury.name || "",
      status: injury.status || injury.detail || injury.description || "",
      out: /out|inactive|doubtful|will not play/i.test(injury.status || ""),
      questionable: /questionable|probable|day.to.day|day-to-day|game.?time|injury management/i.test(injury.status || ""),
      minutesLimit: minuteRestrictionSourceText([injury.status, injury.detail, injury.description].filter(Boolean).join(" "))
    }))
    .filter((injury) => injury.name);
  const minuteRestrictionNews = (news.news || [])
    .map((item) => ({
      headline: item.headline || "",
      description: item.description || "",
      text: [item.headline, item.description].filter(Boolean).join(" ")
    }))
    .filter((item) => minuteRestrictionSourceText(item.text));
  const starterGroups = (news.starters || []).map((group) => ({
    team: group.team || "",
    starters: (group.starters || []).map((name) => normalizeName(name))
  }));

  game.candidates.forEach((prop) => {
    const teamName = propTeamName(prop, game);
    const team = (news.teams || []).find((item) =>
      sameTeamName(item.name, teamName) ||
      sameTeamName(item.abbreviation, teamName) ||
      sameTeamName(item.name, game.homeTeam) && sameTeamName(teamName, game.homeTeam) ||
      sameTeamName(item.name, game.awayTeam) && sameTeamName(teamName, game.awayTeam)
    );
    const teamInjuries = gameInjuries.filter((injury) =>
      sameTeamName(injury.team, teamName) ||
      sameTeamName(injury.team, game.homeTeam) && sameTeamName(teamName, game.homeTeam) ||
      sameTeamName(injury.team, game.awayTeam) && sameTeamName(teamName, game.awayTeam)
    );
    const selfInjury = gameInjuries.find((injury) => normalizeName(injury.name) === normalizeName(prop.player));
    const outNames = teamInjuries.filter((injury) => injury.out).map((injury) => injury.name);
    const starterGroup = starterGroups.find((group) =>
      sameTeamName(group.team, teamName) ||
      sameTeamName(group.team, game.homeTeam) && sameTeamName(teamName, game.homeTeam) ||
      sameTeamName(group.team, game.awayTeam) && sameTeamName(teamName, game.awayTeam)
    );
    const confirmedStarter = Boolean(starterGroup?.starters.includes(normalizeName(prop.player)));
    const playerRestrictionNews = minuteRestrictionNews.find((item) =>
      normalizeName(item.text).includes(normalizeName(prop.player))
    );

    if (selfInjury || playerRestrictionNews) {
      const hasMinutesLimit = Boolean(selfInjury?.minutesLimit || playerRestrictionNews);
      setInjuryLevel(prop, selfInjury?.out ? "player_out" : hasMinutesLimit ? "minutes_limit" : "player_questionable");
      prop.excluded = Boolean(selfInjury?.out);
      prop.injuryWatch = {
        status: selfInjury?.status || (selfInjury?.out ? "Out" : hasMinutesLimit ? "Minutes Limit" : "Day-To-Day"),
        note: selfInjury?.out
          ? "Player is listed out in game news"
          : hasMinutesLimit
            ? "Minute Restriction Agent found a possible workload limit in game news"
          : "Injury Watch Agent is monitoring this player before board lock"
      };
      prop.injuryNote = selfInjury?.out
        ? "Player listed out in game news"
        : hasMinutesLimit
          ? "Player may be on a minutes restriction"
        : `Player listed ${prop.injuryWatch.status || "day-to-day"} in game news`;
    }

    if (team || outNames.length || starterGroup) {
      const existingOut = prop.teamSituation?.lineupKeyOut || [];
      prop.teamSituation = {
        ...(prop.teamSituation || {}),
        isHome: team ? team.isHome : prop.teamSituation?.isHome,
        facingElimination: team ? team.facingElimination : prop.teamSituation?.facingElimination,
        seriesSummary: team ? team.seriesSummary : prop.teamSituation?.seriesSummary,
        lineupKeyOut: [...new Set([...existingOut, ...outNames])],
        confirmedStarter,
        confirmedStarterList: starterGroup?.starters || prop.teamSituation?.confirmedStarterList || []
      };

      if (confirmedStarter && outNames.length >= 2) {
        const bump = marketRoleBump(prop.market, outNames.length, 0) * 0.65;
        prop.roleAdjustment = Number((prop.roleAdjustment + bump).toFixed(1));
        setInjuryLevel(prop, "teammate_out");
        prop.injuryNote = prop.injuryNote.includes("Confirmed starter with multiple teammates out")
          ? prop.injuryNote
          : `${prop.injuryNote}; Confirmed starter with multiple teammates out`;
      }
    }
  });
}

async function enrichSlateWithGameContext(games) {
  if (!games.length || window.location.protocol === "file:" || !elements.sportKey.value.includes("nba")) {
    return { loaded: 0, total: 0 };
  }

  let loaded = 0;

  for (const game of games) {
    if (!gameNewsCache.has(game.id)) {
      const url = new URL("/api/game-news", window.location.origin);
      url.searchParams.set("home", game.homeTeam);
      url.searchParams.set("away", game.awayTeam);
      url.searchParams.set("date", elements.slateDate.value || today);

      try {
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not fetch game news");
        payload.__fetchedAt = Date.now();
        gameNewsCache.set(game.id, payload);
      } catch (error) {
        gameNewsCache.set(game.id, { news: [], injuries: [], starters: [], teams: [], error: error.message, __fetchedAt: Date.now() });
      }
    }

    const news = gameNewsCache.get(game.id);
    if (!news?.error) {
      applyGameContext(game, news);
      loaded += 1;
    }
  }

  return { loaded, total: games.length };
}

function renderGameNews(game) {
  if (!game) {
    elements.gameNewsLabel.textContent = "Selected game";
    elements.gameNews.className = "news-empty";
    elements.gameNews.textContent = "Select a game to view relevant injuries, starting lineups, and updates.";
    return;
  }

  elements.gameNewsLabel.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  if (!sportConfig().liveContext) {
    elements.gameNews.className = "news-empty";
    elements.gameNews.textContent = `${sportConfig().label} game news is scaffolded. Live injuries, confirmed lineups, and player game logs can plug in when the baseball data account is connected.`;
    return;
  }

  const news = gameNewsCache.get(game.id);
  elements.gameNews.className = news ? "" : "news-empty";

  if (!news) {
    elements.gameNews.textContent = "Loading relevant game news...";
    fetchGameNews(game);
    return;
  }

  if (shouldRefreshGameNews(news)) {
    fetchGameNews(game, { force: true });
  }

  if (news.error) {
    elements.gameNews.className = "news-empty";
    elements.gameNews.textContent = `Could not load game news: ${news.error}`;
    return;
  }

  elements.gameNews.innerHTML = gameNewsRows(news, game);
}

async function fetchWebSeriesLogs(playerName, scope = "series", options = {}) {
  const url = new URL("/api/series-logs", window.location.origin);
  url.searchParams.set("player", playerName);
  url.searchParams.set("date", elements.slateDate.value || today);
  url.searchParams.set("scope", scope);
  const timeoutMs = options.timeoutMs || manualLogTimeoutMs;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload;

  try {
    response = await fetch(url, { signal: controller.signal });
    payload = await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Timed out while fetching web logs");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(payload.error || "Could not fetch web logs");
  }

  return payload;
}

async function cacheSlateWithServer(games) {
  if (window.location.protocol === "file:") return;

  try {
    await fetch("/api/cache-slate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slateDate: elements.slateDate.value || today,
        sportKey: elements.sportKey.value,
        games
      })
    });
  } catch {
    // Cache is optional; never block the slate UI.
  }
}

function renderGames() {
  elements.gameCount.textContent = `${slate.length} game${slate.length === 1 ? "" : "s"}`;
  elements.gameList.innerHTML = slate
    .map((game) => {
      const active = game.id === selectedGameId ? " active" : "";
      return `
        <button class="game-card${active}" type="button" data-game-id="${game.id}">
          <strong>${game.awayTeam} @ ${game.homeTeam}</strong>
          <span>${formatDateTime(game.commenceTime)} · ${game.candidates.length} props · ${game.source}</span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("[data-game-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedGameId = button.dataset.gameId;
      selectedPropId = null;
      selectedLogOpponent = "all";
      elements.playerSearch.value = "";
      if (isMobileLayout()) setMobileTab("games");
      render();
    });
  });
}

function renderParlay(game) {
  const build = gameParlayBuild(game);
  const singleLegs = build.singleLegs || [];
  const safeLadderLegs = build.safeLadderLegs || [];
  const saferLegs = build.saferLegs || [];
  const sameTeamLegs = build.sameTeamLegs || [];
  const threeLegs = build.threeLegs || [];
  const valueStarLegs = build.valueStarLegs || [];
  const twoLegBoards = [saferLegs, sameTeamLegs].filter((legs) => legs.length);
  const valueBoards = [threeLegs, valueStarLegs].filter((legs) => legs.length);
  const viewLegs = {
    single: singleLegs,
    safe: safeLadderLegs,
    two: twoLegBoards.flat(),
    three: valueBoards.flat()
  };
  const activeLegs = activeParlayView === "single" ? singleLegs : activeParlayView === "safe" ? safeLadderLegs : activeParlayView === "three" ? valueBoards.flat() : twoLegBoards.flat();
  const score = (activeParlayView === "two" && twoLegBoards.length) || (activeParlayView === "three" && valueBoards.length)
    ? Math.round(average((activeParlayView === "two" ? twoLegBoards : valueBoards).map((legs) => parlayGrade(legs))))
    : parlayGrade(activeLegs);
  elements.selectedGameTitle.textContent = `${game.awayTeam} @ ${game.homeTeam}`;
  elements.parlayScore.textContent = score || "--";
  elements.riskLabel.textContent = build.locked ? "Locked at start" : parlayTone(score, activeLegs);
  updateParlayTabs();
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;

  if (activeParlayView === "single") {
    elements.parlays.classList.remove("two-card-grid");
    elements.parlays.innerHTML = renderParlayGroup("Bet of the Day", singleLegs, build.locked ? "Locked once this game started." : "Highest-probability full sportsbook line in this game, scanning both over and under.", gameLabel);
    return;
  }

  if (activeParlayView === "safe") {
    elements.parlays.classList.remove("two-card-grid");
    elements.parlays.innerHTML = renderParlayGroup("Safe Ladder", safeLadderLegs, build.locked ? "Locked once this game started." : "Floor-style milestones built from stable roles, lowered targets, and recent-log cushion.", gameLabel);
    return;
  }

  if (activeParlayView === "two") {
    elements.parlays.classList.add("two-card-grid");
    elements.parlays.innerHTML = [
      renderParlayGroup("Low-Risk Parlay", saferLegs, build.locked ? "Locked once this game started." : "Playoff Engine: minute certainty, stable role, and survivability first.", gameLabel),
      renderParlayGroup("Low-Risk Alternate", sameTeamLegs, build.locked ? "Locked once this game started." : "Alternate stable legs with different players from the first board.", gameLabel)
    ].join("");
    return;
  }

  if (activeParlayView === "three") {
    elements.parlays.classList.add("two-card-grid");
    elements.parlays.innerHTML = [
      renderParlayGroup("Value Parlay", threeLegs, build.locked ? "Locked once this game started." : "Full-line playoff reads with acceptable survivability. Not a forced board.", gameLabel),
      renderParlayGroup("Star Value Board", valueStarLegs, build.locked ? "Locked once this game started." : "Star/core board: each player gets their highest-graded full line, over or under.", gameLabel)
    ].join("");
    return;
  }

  elements.parlays.classList.remove("two-card-grid");

  if (activeParlayView === "glory") {
    elements.parlays.classList.remove("two-card-grid");
    renderShotForGlory();
    return;
  }
}

function renderParlayGroup(title, legs, description, gameLabel = "") {
  if (!legs.length) {
    return `
      <article class="parlay-group">
        <div class="parlay-group-header">
          <div>
            <h3>${title}</h3>
            <p>No legs cleared the quality gate for this build. The app is holding back instead of forcing a thin board.</p>
          </div>
        </div>
      </article>
    `;
  }

  const grade = parlayGrade(legs);
  const probability = averageLegProbability(legs);
  const status = boardStatus(grade, legs);
  const bookTitle = elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "Sportsbook";
  const displayOdds = conservativeParlayOdds(legs);

  return `
    <article class="parlay-group">
      <div class="slip-brand">
        <span class="slip-mark">SGH</span>
        <strong>${bookTitle}</strong>
        <span>Sportsbook</span>
      </div>
      <div class="parlay-group-header">
        <div>
          <h3>${legs.length} Leg SGP</h3>
          <p>${title}</p>
        </div>
        <div class="parlay-stats">
          <strong>${formatOdds(displayOdds)}</strong>
          <span>Grade ${grade}/100</span>
        </div>
      </div>
      <div class="slip-subline">
        <span>${description}</span>
        <strong>${status.label}: ${formatProbability(probability)} avg leg hit</strong>
      </div>
      <div class="board-status ${status.className}">${status.detail}</div>
      <div class="leg-list">
        ${legs.map((leg) => renderLeg(leg, gameLabel)).join("")}
      </div>
      <div class="slip-footer">
        <span>Must be 21+. Gambling problem? Call 1-800-GAMBLER</span>
      </div>
    </article>
  `;
}

function renderLeg(leg, gameLabel = "") {
  const hitProbability = Number.isFinite(leg.probability) ? formatProbability(leg.probability) : "--";
  const title = leg.floorLabel || `${leg.direction} ${leg.line}`;
  const marketLabel = leg.floorMarketLabel || `${marketLabels[leg.market] || leg.market} OU`;
  const floorText = leg.sourceLine ? ` · standard line ${leg.sourceLine}` : "";
  const survivabilityText = Number.isFinite(leg.survivabilityScore) ? ` · survive ${leg.survivabilityScore}/100` : "";
  return `
    <article class="leg-card">
      <div>
        <div class="leg-title">${title}</div>
        <div class="leg-meta">${leg.player} - ${marketLabel}</div>
        <div class="leg-game">${gameLabel || leg.gameLabel || ""}</div>
        <div class="leg-read">Grade ${leg.score}/100 · est. hit ${hitProbability}${survivabilityText}${floorText}</div>
      </div>
    </article>
  `;
}

function renderLegSeriesStats(leg) {
  const logs = (leg.seriesLogs || []).filter((log) => Number.isFinite(logValueForMarket(log, leg.market)));
  if (!logs.length) {
    return `<div class="leg-series-line fallback"><strong>Series stats unavailable</strong><span>Generated from sportsbook line, injuries, game context, and saved-board evaluation.</span></div>`;
  }

  const chronologicalLogs = logs.slice().reverse();
  const hits = logs.filter((log) => {
    const value = logValueForMarket(log, leg.market);
    return leg.direction === "Over" ? value > Number(leg.line) : value < Number(leg.line);
  }).length;

  return `
    <div class="leg-series-line">
      <strong>${leg.floorMarketLabel || marketLabels[leg.market] || leg.market} vs ${leg.floorLabel || leg.line}: ${hits}/${logs.length}</strong>
      <div class="series-chip-row">
        ${chronologicalLogs.map((log, index) => {
          const value = logValueForMarket(log, leg.market);
          const hit = leg.direction === "Over" ? value > Number(leg.line) : value < Number(leg.line);
          return `<span class="${hit ? "hit" : "miss"}">G${index + 1}: ${value}</span>`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderShotForGlory() {
  if (activeParlayView !== "glory") return;
  const build = shotForGloryBuild();
  const gameBuilds = build.gameBuilds || [];
  const legs = build.legs || [];

  if (!legs.length) {
    elements.riskLabel.textContent = "Need props";
    elements.parlays.textContent = "No Shot of Glory legs cleared the quality or consistency checks for this slate.";
    return;
  }

  const grade = parlayGrade(legs);
  const gamesWithLegs = gameBuilds.filter((item) => item.legs.length).length;
  const targetLegs = build.targetLegs || 6;
  elements.parlayScore.textContent = grade || "--";
  elements.riskLabel.textContent = build.locked ? "Locked at slate start" : `${boardStatus(grade, legs).label} · ${legs.length}/${targetLegs} legs`;
  elements.parlays.innerHTML = renderParlayGroup(
    "Shot of Glory",
    legs,
    `${build.locked ? "Locked once the slate started." : "Six-leg target, but only quality or consistency reads are allowed."} ${legs.length} legs from ${gamesWithLegs} game${gamesWithLegs === 1 ? "" : "s"}. This is intentionally aggressive.`
  );
}

function renderCandidateGuide(game) {
  if (!elements.candidateGuide) return;
  if (!game) {
    elements.candidateGuide.innerHTML = `
      <section class="candidate-guide-card">
        <div class="candidate-guide-heading">
          <div>
            <h3>Playoff Candidate</h3>
            <p>Select a game to see 60%+ candidate legs graded with basketball ratings.</p>
          </div>
        </div>
      </section>
    `;
    return;
  }

  const build = gameParlayBuild(game);
  const selectedKeys = {
    anchor: new Set((build.singleLegs || []).map(shotLegKey)),
    lowRisk: new Set([...(build.saferLegs || []), ...(build.sameTeamLegs || [])].map(shotLegKey)),
    value: new Set([...(build.threeLegs || []), ...(build.valueStarLegs || [])].map(shotLegKey))
  };
  const guideLegs = candidateGuidePool(game);
  const rows = guideLegs.map((leg) => {
    const status = candidateGuideStatus(leg, selectedKeys);
    const title = leg.floorLabel || `${leg.direction} ${leg.line}`;
    const market = leg.floorMarketLabel || marketLabels[leg.market] || leg.market;
    const balls = candidateBasketballRating(leg);
    const ballCount = candidateBasketballCount(leg);
    const notes = (leg.contextNotes || [])
      .filter((note) => /Playoff Engine|Anchor|Candidate Guide|stable|survivability|series|matchup|role|minute|floor|opponent|primary/i.test(note))
      .slice(0, 2);
    return `
      <article class="candidate-guide-row ${status.className}">
        <div class="candidate-candidate-line">
          <strong>${escapeHtml(leg.player)}</strong>
          <span>${escapeHtml(title)} ${escapeHtml(market)}</span>
          <span class="candidate-balls" aria-label="${ballCount} basketball rating">${balls}</span>
        </div>
        <div class="candidate-mini">
          <span class="${status.className}">${escapeHtml(status.label)}</span>
          <span>Hit ${formatProbability(Number(leg.probability || 0))}</span>
          <span>Grade ${Math.round(Number(leg.score || 0))}</span>
          <span>Survive ${Number.isFinite(leg.survivabilityScore) ? `${leg.survivabilityScore}/100` : "--"}</span>
        </div>
        <p>${notes.length ? notes.map(escapeHtml).join(" · ") : "Considered by the Playoff Engine, but no stronger guide note was available."}</p>
      </article>
    `;
  }).join("");

  elements.candidateGuide.innerHTML = `
    <section class="candidate-guide-card">
      <div class="candidate-guide-heading">
        <div>
          <h3>Playoff Candidate</h3>
          <p>${escapeHtml(game.awayTeam)} @ ${escapeHtml(game.homeTeam)} · ${guideLegs.length} candidates at 60%+</p>
        </div>
        <span class="candidate-guide-key">🏀🏀🏀🏀 89-100 · 🏀🏀🏀 76-88 · 🏀🏀 60-75</span>
      </div>
      <div class="candidate-guide-list">
        ${rows || `<div class="adjustments-empty">No candidate pool is available for this game yet.</div>`}
      </div>
    </section>
  `;
}

function logValueForMarket(log, market) {
  const pts = Number(log.pts);
  const reb = Number(log.reb);
  const ast = Number(log.ast);
  const threes = Number(log.threes);
  const totalBases = Number(log.totalBases ?? log.tb);
  const hits = Number(log.hits ?? log.h);
  const runs = Number(log.runs ?? log.r);
  const rbis = Number(log.rbis ?? log.rbi);
  const homeRuns = Number(log.homeRuns ?? log.hr);
  const strikeouts = Number(log.strikeouts ?? log.so ?? log.k);

  if (market === "player_points") return pts;
  if (market === "player_rebounds") return reb;
  if (market === "player_assists") return ast;
  if (market === "player_threes") return threes;
  if (market === "player_points_rebounds_assists") return pts + reb + ast;
  if (market === "player_points_assists") return pts + ast;
  if (market === "player_points_rebounds") return pts + reb;
  if (market === "player_rebounds_assists") return reb + ast;
  if (market === "player_double_double") return pts >= 10 && reb >= 10 ? 1 : 0;
  if (market === "batter_total_bases") return totalBases;
  if (market === "batter_hits") return hits;
  if (market === "batter_runs") return runs;
  if (market === "batter_rbis") return rbis;
  if (market === "batter_home_runs") return homeRuns;
  if (market === "pitcher_strikeouts") return strikeouts;
  return NaN;
}

function updateSeriesFromLogs(prop, logs) {
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  if (!values.length) return;
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);

  prop.seriesAvg = Number(average(values).toFixed(1));
  prop.seriesGames = values.length;
  prop.seriesHits = values.filter((value) => value > Number(prop.line)).length;
  prop.seriesMinuteAvg = minutes.length ? Number(average(minutes).toFixed(1)) : 0;
  prop.seriesMinuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : 0;
  prop.playerTier = inferPlayerTier(prop);
}

function generatedLegKeys() {
  const keys = new Set();
  slate.forEach((game) => {
    const build = gameParlayBuild(game);
    [...(build.singleLegs || []), ...(build.safeLadderLegs || []), ...(build.saferLegs || []), ...(build.sameTeamLegs || []), ...(build.threeLegs || []), ...(build.valueStarLegs || [])].forEach((leg) => {
      keys.add(propKey(game.id, leg.id));
    });
  });
  return keys;
}

function preferredPlayerMatch(matches, selectedGame) {
  const generated = generatedLegKeys();
  return (
    matches.find((prop) => prop.gameId === selectedGame?.id && generated.has(propKey(prop.gameId, prop.id))) ||
    matches.find((prop) => generated.has(propKey(prop.gameId, prop.id))) ||
    matches.find((prop) => prop.gameId === selectedGame?.id) ||
    matches[0]
  );
}

function sortPlayerMatches(matches, selectedGame) {
  const generated = generatedLegKeys();
  return [...matches].sort((a, b) => {
    const aGenerated = generated.has(propKey(a.gameId, a.id)) ? 1 : 0;
    const bGenerated = generated.has(propKey(b.gameId, b.id)) ? 1 : 0;
    if (aGenerated !== bGenerated) return bGenerated - aGenerated;

    const aSelectedGame = a.gameId === selectedGame?.id ? 1 : 0;
    const bSelectedGame = b.gameId === selectedGame?.id ? 1 : 0;
    if (aSelectedGame !== bSelectedGame) return bSelectedGame - aSelectedGame;

    const aMarket = a.market === "player_threes" ? 1 : 0;
    const bMarket = b.market === "player_threes" ? 1 : 0;
    if (aMarket !== bMarket) return bMarket - aMarket;

    return Number(a.line) - Number(b.line);
  });
}

function renderAdjustments(game) {
  const allProps = lookupProps();
  const players = [...new Set(allProps.map((prop) => prop.player))].sort();
  const query = elements.playerSearch.value.trim().toLowerCase();
  const matches = query ? sortPlayerMatches(allProps.filter((prop) => prop.player.toLowerCase().includes(query)), game) : [];

  if (matches.length && (!selectedPropId || !matches.some((prop) => propKey(prop.gameId, prop.id) === selectedPropId))) {
    const preferredMatch = preferredPlayerMatch(matches, game);
    selectedPropId = propKey(preferredMatch.gameId, preferredMatch.id);
  }

  elements.playerOptions.innerHTML = players.map((player) => `<option value="${player}"></option>`).join("");
  const selectedMatch = allProps.find((prop) => propKey(prop.gameId, prop.id) === selectedPropId) || matches[0];
  const selectedGame = slate.find((item) => item.id === selectedMatch?.gameId) || game;
  const prop = selectedMatch?.logOnly
    ? selectedMatch
    : selectedGame?.candidates.find((candidateProp) => candidateProp.id === selectedMatch?.id);

  if (!query) {
    elements.playerContext.textContent = "Type a player name to display their prop context.";
    return;
  }

  if (!prop) {
    elements.playerContext.textContent = "No matching sportsbook props were found yet. Click Web Search to pull this player's logs.";
    return;
  }

  const selectedPlayerProps = matches.filter((match) => match.player === prop.player);
  const playerLogs = selectedPlayerProps.find((match) => match.opponentLogs?.length)?.opponentLogs ||
    prop.opponentLogs ||
    selectedPlayerProps.find((match) => match.seriesLogs?.length)?.seriesLogs ||
    prop.seriesLogs ||
    [];
  const activeLogOptions = logMarketOptionsForSport();
  const logMarketValues = new Set(activeLogOptions.map(([value]) => value));
  const activeLogMarket = selectedLogMarket && logMarketValues.has(selectedLogMarket) ? selectedLogMarket : prop.market;
  selectedLogMarket = activeLogMarket;
  const lineProp = selectedPlayerProps.find((match) => match.market === activeLogMarket);
  const logSource = selectedPlayerProps.find((match) => match.opponentLogs?.length)?.opponentLogSource || prop.opponentLogSource || prop.seriesSource;
  const sourceLogs = playerLogs.length ? playerLogs : fallbackSeriesLogs({ ...prop, seriesLogs: playerLogs });
  const opponentSelectOptions = opponentOptions(sourceLogs, selectedLogOpponent);
  const filteredLogs = logsForOpponent(sourceLogs, selectedLogOpponent);
  const displayProp = {
    ...prop,
    ...(lineProp || {}),
    market: activeLogMarket,
    line: lineProp ? lineProp.line : NaN,
    odds: lineProp ? lineProp.odds : null,
    seriesLogs: playerLogs
  };
  prop.seriesLogs = playerLogs;
  elements.playerContext.innerHTML = `
    <article class="player-context-card">
      <div class="context-summary">
        <div>
          <strong>${prop.player}</strong>
          <span>${selectedMatch.gameLabel}</span>
        </div>
        <div class="mini-grade">
          <span>${selectedPlayerProps.some((match) => !match.logOnly) ? "Book Lines" : "Log Profile"}</span>
          <strong>${selectedPlayerProps.length}</strong>
          <small>${selectedPlayerProps.some((match) => !match.logOnly) ? "markets found" : "categories found"}</small>
        </div>
      </div>
      ${renderPlayerAgentRead(selectedPlayerProps, selectedLogOpponent, activeLogMarket)}
      <div class="research-section">
        <h3>Series Game Logs</h3>
        <div class="series-toolbar">
          <p>${logSource} · ${marketLabels[displayProp.market] || displayProp.market} line ${Number.isFinite(Number(displayProp.line)) ? displayProp.line : "--"} at ${lineProp ? formatBooks(lineProp) : formatBooks(prop)} · ${seriesLogSummary(displayProp, filteredLogs)}</p>
          <div class="series-actions">
            <label class="series-market-select">
              Category
              <select id="seriesMarket">
                ${activeLogOptions.map(([value, label]) => `<option value="${value}"${value === activeLogMarket ? " selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
            <label class="series-market-select">
              Opponent
              <select id="seriesOpponent">
                ${opponentSelectOptions}
              </select>
            </label>
            <button class="secondary-button web-series" type="button" data-player-name="${prop.player}">Web Search</button>
          </div>
        </div>
        <div class="research-table-wrap">
          <table class="research-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Opp</th>
                <th>MIN</th>
                <th>PTS</th>
                <th>REB</th>
                <th>AST</th>
                <th>3PM</th>
                <th>Val</th>
                <th>Line</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>${seriesLogRows(displayProp, selectedLogOpponent)}</tbody>
          </table>
        </div>
      </div>
    </article>
  `;

  const seriesMarket = elements.playerContext.querySelector("#seriesMarket");
  seriesMarket?.addEventListener("change", () => {
    selectedLogMarket = seriesMarket.value;
    renderAdjustments(selectedGame);
  });

  const seriesOpponent = elements.playerContext.querySelector("#seriesOpponent");
  seriesOpponent?.addEventListener("change", () => {
    selectedLogOpponent = seriesOpponent.value || "all";
    renderAdjustments(selectedGame);
  });

  elements.playerContext.querySelectorAll("[data-player-name].web-series").forEach((button) => {
    button.addEventListener("click", async () => {
      const playerName = button.dataset.playerName;
      button.disabled = true;
      await loadWebLogsForPlayer(playerName, selectedGame);
      button.disabled = false;
    });
  });
}

function runPlayerSearch() {
  selectedPropId = null;
  selectedLogMarket = "";
  selectedLogOpponent = "all";
  const game = slate.find((item) => item.id === selectedGameId) || slate[0];
  if (!game) {
    elements.playerContext.textContent = "Load a slate before searching for a player.";
    return;
  }

  if (!elements.playerSearch.value.trim()) {
    elements.playerContext.textContent = "Type a player name to display their prop context.";
    renderAdjustments(game);
    return;
  }

  renderAdjustments(game);
}

function makeLogOnlyPlayerProps(playerName, logs, source, team) {
  const game = slate.find((item) => item.id === selectedGameId) || slate[0] || {};
  const gameLabel = game.homeTeam && game.awayTeam ? `${game.awayTeam} @ ${game.homeTeam}` : "Player logs";

  return logMarketOptionsForSport().map(([market]) => {
    const values = logs.map((log) => logValueForMarket(log, market)).filter((value) => Number.isFinite(value));
    const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
    const profile = candidate(
      playerName,
      market,
      NaN,
      null,
      values.length ? Number(average(values).toFixed(1)) : 0,
      0.5,
      values.length ? Number(average(values).toFixed(1)) : 0,
      0,
      values.length,
      values.length ? Number(average(values).toFixed(1)) : 0,
      0,
      values.length,
      0,
      "Log-only profile loaded from web search"
    );
    profile.id = `${normalizeName(playerName)}-${market}-log-only`;
    profile.gameId = game.id || "log-only";
    profile.homeTeam = game.homeTeam || "";
    profile.awayTeam = game.awayTeam || "";
    profile.gameLabel = gameLabel;
    profile.logOnly = true;
    profile.selectedBookAvailable = false;
    profile.bookTitle = "No active sportsbook line";
    profile.playerTeam = team || "";
    profile.seriesLogs = logs;
    profile.opponentLogs = logs;
    profile.seriesSource = source || "Web";
    profile.opponentLogSource = source || "Web all opponents";
    profile.seriesMinuteAvg = minutes.length ? Number(average(minutes).toFixed(1)) : 0;
    profile.seriesMinuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : 0;
    profile.playerTier = inferPlayerTier(profile);
    return profile;
  });
}

function applyWebLogs(playerName, logs, source, team, scope = "series") {
  let matched = false;
  slate.forEach((gameItem) => {
    gameItem.candidates.forEach((candidateProp) => {
      if (normalizeName(candidateProp.player) === normalizeName(playerName)) {
        matched = true;
        if (scope === "all") {
          candidateProp.opponentLogs = logs;
          candidateProp.opponentLogSource = source || "Web all opponents";
        } else {
          candidateProp.seriesLogs = logs;
          candidateProp.seriesSource = source || "Web";
          updateSeriesFromLogs(candidateProp, logs);
        }
        if (team) candidateProp.playerTeam = team;
      }
    });
  });

  if (!matched || scope === "all") {
    const displayName = slateProps().find((prop) => normalizeName(prop.player) === normalizeName(playerName))?.player || playerName;
    playerLogProfiles.set(normalizeName(displayName), makeLogOnlyPlayerProps(displayName, logs, source, team));
  }
}

async function loadWebLogsForPlayer(playerName, game) {
  if (!playerName || !game) return;
  setStatus(`Fetching web series logs for ${playerName}...`);

  try {
    const payload = await fetchWebSeriesLogs(playerName, "all", { timeoutMs: manualLogTimeoutMs });
    const logs = payload.logs || [];

    if (!logs.length) {
      setStatus(`No ESPN game logs were returned for ${playerName}.`, "warn");
      return;
    }

    applyWebLogs(playerName, logs, payload.source, payload.team, "all");
    renderParlay(game);
    renderShotForGlory();
    renderAdjustments(game);
    setStatus(`Loaded ${logs.length} ESPN opponent log row${logs.length === 1 ? "" : "s"} for ${payload.player || playerName}.`, "success");
  } catch (error) {
    const serverHint = window.location.protocol === "file:" ? " Start the local server and open http://localhost:3999." : "";
    setStatus(`Could not fetch web logs: ${error.message}.${serverHint}`, "warn");
  }
}

function slatePlayerNames(games) {
  const counts = new Map();
  const selectedGame = games.find((game) => game.id === selectedGameId) || games[0];

  games.forEach((game) => {
    game.candidates.forEach((prop) => {
      counts.set(prop.player, (counts.get(prop.player) || 0) + 1);
    });
  });

  const selectedPlayers = (selectedGame?.candidates || [])
    .map((prop) => prop.player)
    .filter((player, index, players) => players.indexOf(player) === index);
  const rankedPlayers = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([player]) => player);

  return [...selectedPlayers, ...rankedPlayers.filter((player) => !selectedPlayers.includes(player))];
}

async function enrichSlateWithWebLogs(games, token) {
  if (!games.length || window.location.protocol === "file:" || !elements.sportKey.value.includes("nba")) {
    return { loaded: 0, total: 0 };
  }

  const players = slatePlayerNames(games).slice(0, backgroundLogPlayerLimit);
  let loaded = 0;

  for (let index = 0; index < players.length; index += backgroundLogBatchSize) {
    if (token !== slateLoadToken) return { loaded, total: players.length };
    const batch = players.slice(index, index + backgroundLogBatchSize);
    setStatus(`Boards are ready. Updating player logs ${Math.min(index + batch.length, players.length)}/${players.length}...`);

    const results = await Promise.allSettled(
      batch.map(async (playerName) => {
        const payload = await fetchWebSeriesLogs(playerName, "series", { timeoutMs: backgroundLogTimeoutMs });
        const logs = payload.logs || [];
        if (!logs.length) return false;
        applyWebLogs(playerName, logs, payload.source, payload.team);
        return true;
      })
    );

    loaded += results.filter((result) => result.status === "fulfilled" && result.value).length;
    if (token !== slateLoadToken) return { loaded, total: players.length };
    clearLiveBuildsForSlate();
    render();
    upsertCurrentBoard();
  }

  return { loaded, total: players.length };
}

async function enrichSlateInBackground(token, reason = "load") {
  if (!slate.length || backgroundEnrichmentRunning) return;
  backgroundEnrichmentRunning = true;
  boardEnrichmentPending = true;
  const config = sportConfig();
  try {
    setStatus(`Fast board loaded. Improving ${config.label} reads in the background...`);
    const [webLogs, gameContext] = await Promise.all([
      enrichSlateWithWebLogs(slate, token),
      enrichSlateWithGameContext(slate)
    ]);
    if (token !== slateLoadToken) return;
    applyInjuries(slate, lastInjuries);
    boardEnrichmentPending = false;
    backgroundEnrichmentRunning = false;
    clearLiveBuildsForSlate();
    render();
    upsertCurrentBoard();
    setStatus(
      `Updated board quality${webLogs.total ? ` with ${webLogs.loaded}/${webLogs.total} player logs` : ""}${gameContext.total ? ` and ${gameContext.loaded}/${gameContext.total} game contexts` : ""}.`,
      "success"
    );
  } catch (error) {
    if (token === slateLoadToken) {
      boardEnrichmentPending = false;
      backgroundEnrichmentRunning = false;
      clearLiveBuildsForSlate();
      render();
      setStatus(`Fast board is loaded, but background reads were limited: ${error.message}`, "warn");
    }
  } finally {
    if (token === slateLoadToken) {
      backgroundEnrichmentRunning = false;
      boardEnrichmentPending = false;
    }
  }
}

function runTopWebSearch() {
  runPlayerSearch();
  const query = elements.playerSearch.value.trim();
  const game = slate.find((item) => item.id === selectedGameId) || slate[0];
  loadWebLogsForPlayer(query, game);
}

function render() {
  if (!selectedGameId && slate.length) selectedGameId = slate[0].id;
  const game = slate.find((item) => item.id === selectedGameId);

  renderGames();

  if (!game) {
    elements.selectedGameTitle.textContent = "No game selected";
    elements.parlayScore.textContent = "--";
    elements.riskLabel.textContent = "Awaiting slate";
    elements.parlays.textContent = "Fetch or load a slate to generate parlays.";
    elements.playerOptions.innerHTML = "";
    elements.playerContext.textContent = "Select a game, then type a player name to inspect context.";
    renderCandidateGuide(null);
    renderGameNews(null);
    renderSavedBoards();
    return;
  }

  renderGameNews(game);
  renderParlay(game);
  renderAdjustments(game);
  renderCandidateGuide(game);
  renderSavedBoards();
}

function getDateBounds(date) {
  const start = new Date(`${date}T08:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return {
    from: toOddsApiDateTime(start),
    to: toOddsApiDateTime(end)
  };
}

function toOddsApiDateTime(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseOddsCandidates(eventOdds, selectedBook) {
  const bookKey = String(selectedBook || "fanatics").trim().toLowerCase();
  const grouped = new Map();
  const lineGroups = new Map();

  eventOdds.bookmakers?.forEach((bookmaker) => {
    const bookmakerKey = String(bookmaker.key || "").toLowerCase();
    const bookmakerTitle = bookmaker.title || bookmaker.key;

    bookmaker.markets?.forEach((market) => {
      market.outcomes?.forEach((outcome) => {
        const player = outcome.description || outcome.name;
        const direction = outcome.name;
        if (!player || !["Over", "Under"].includes(direction) || outcome.point === undefined) return;

        const groupKey = `${normalizeName(player)}|${market.key}`;
        const lines = lineGroups.get(groupKey) || new Map();
        const lineKey = String(Number(outcome.point));
        const lineItem = lines.get(lineKey) || {
          line: Number(outcome.point),
          books: new Set(),
          selected: false,
          overOdds: null,
          underOdds: null,
          selectedOverOdds: null,
          selectedUnderOdds: null,
          selectedBookKey: "",
          selectedBookTitle: ""
        };
        lineItem.books.add(bookmakerTitle);
        if (direction === "Over") lineItem.overOdds = outcome.price;
        if (direction === "Under") lineItem.underOdds = outcome.price;
        if (bookmakerKey === bookKey) {
          lineItem.selected = true;
          lineItem.selectedBookKey = bookmaker.key;
          lineItem.selectedBookTitle = bookmakerTitle;
          if (direction === "Over") lineItem.selectedOverOdds = outcome.price;
          if (direction === "Under") lineItem.selectedUnderOdds = outcome.price;
        }
        lines.set(lineKey, lineItem);
        lineGroups.set(groupKey, lines);

        const existing = grouped.get(groupKey) || {
          player,
          market: market.key,
          entries: new Map()
        };
        existing.entries.set(lineKey, lineItem);
        grouped.set(groupKey, existing);
      });
    });
  });

  const props = Array.from(grouped.values()).map((prop) => {
    const entries = Array.from(prop.entries.values());
    const selectedEntries = entries.filter((entry) => entry.selected);
    const chosen = (selectedEntries.length ? selectedEntries : entries)
      .sort((a, b) => {
        if (a.selected !== b.selected) return a.selected ? -1 : 1;
        if (b.books.size !== a.books.size) return b.books.size - a.books.size;
        return Number(a.line) - Number(b.line);
      })[0];

    return {
      player: prop.player,
      market: prop.market,
      line: chosen.line,
      overOdds: chosen.selectedOverOdds ?? chosen.overOdds,
      underOdds: chosen.selectedUnderOdds ?? chosen.underOdds,
      books: chosen.books,
      bookKey: chosen.selectedBookKey || bookKey,
      bookTitle: chosen.selectedBookTitle || `${elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || selectedBook} line unavailable`,
      selectedBookAvailable: Boolean(chosen.selected),
      chosen
    };
  });

  const candidateProps = props.map((prop) => {
    const recentLean = deterministicNumber(`${prop.player}-${prop.market}`, -1.4, 1.8);
    const opponentLean = deterministicNumber(`${prop.player}-${prop.market}-opp`, -1.2, 1.5);
    const hitRate = clamp(0.52 + recentLean / 10, 0.34, 0.76);
    const odds = Math.abs(recentLean) >= Math.abs(opponentLean) ? prop.overOdds : prop.underOdds;
    const peerLines = Array.from((lineGroups.get(`${normalizeName(prop.player)}|${prop.market}`) || new Map()).values());

    const propCandidate = candidate(
      prop.player,
      prop.market,
      prop.line,
      odds ?? prop.overOdds ?? prop.underOdds,
      Number((prop.line + recentLean).toFixed(1)),
      hitRate,
      Number(prop.line),
      0,
      0,
      Number(prop.line),
      0,
      0,
      0,
      "API odds loaded; waiting on real series logs for confidence"
    );
    propCandidate.books = Array.from(prop.books);
    propCandidate.bookKey = prop.bookKey;
    propCandidate.bookTitle = prop.bookTitle;
    propCandidate.selectedBookAvailable = prop.selectedBookAvailable;
    propCandidate.overOdds = prop.overOdds;
    propCandidate.underOdds = prop.underOdds;
    propCandidate.injuryNote = `${prop.selectedBookAvailable ? prop.bookTitle : "Consensus"} line loaded; waiting on real series logs for confidence`;
    propCandidate.lineAlternates = peerLines
      .filter((item) => Number(item.line) !== Number(prop.line))
      .map((item) => ({
        line: item.line,
        books: Array.from(item.books)
      }))
      .sort((a, b) => Number(a.line) - Number(b.line));
    return propCandidate;
  });
  return candidateProps;
}

function deterministicNumber(seed, min, max) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }
  return min + (hash / 100000) * (max - min);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 140)}`);
  }

  return response.json();
}

async function loadServerConfig() {
  if (window.location.protocol === "file:") return;

  try {
    await fetchJson("/api/config");
  } catch {
    // Server config is a convenience; fetch calls will show actionable errors.
  }
}

function currentSeasonYear(dateValue = elements.slateDate.value || today) {
  const date = new Date(`${dateValue}T00:00:00`);
  return date.getMonth() >= 9 ? date.getFullYear() : date.getFullYear() - 1;
}

function statValueForMarket(stat, market) {
  if (market === "player_points") return Number(stat.pts || 0);
  if (market === "player_rebounds") return Number(stat.reb || 0);
  if (market === "player_assists") return Number(stat.ast || 0);
  if (market === "player_threes") return Number(stat.fg3m || 0);
  if (market === "player_points_rebounds_assists") return Number(stat.pts || 0) + Number(stat.reb || 0) + Number(stat.ast || 0);
  if (market === "player_points_assists") return Number(stat.pts || 0) + Number(stat.ast || 0);
  if (market === "player_points_rebounds") return Number(stat.pts || 0) + Number(stat.reb || 0);
  if (market === "player_rebounds_assists") return Number(stat.reb || 0) + Number(stat.ast || 0);
  return null;
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function playerFullName(player) {
  return `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
}

function bestPlayerMatch(players, playerName) {
  const target = normalizeName(playerName);
  return (
    players.find((player) => normalizeName(playerFullName(player)) === target) ||
    players.find((player) => normalizeName(playerFullName(player)).includes(target) || target.includes(normalizeName(playerFullName(player)))) ||
    players[0] ||
    null
  );
}

function teamMatchesName(team, name) {
  const target = normalizeName(name);
  return [team?.full_name, team?.name, `${team?.city || ""} ${team?.name || ""}`, team?.abbreviation]
    .map(normalizeName)
    .some((candidateName) => candidateName && (candidateName === target || target.includes(candidateName) || candidateName.includes(target)));
}

async function fetchBdlTeams(bdlKey) {
  if (bdlCache.teams) return bdlCache.teams;
  const result = await fetchJson("https://api.balldontlie.io/v1/teams", {
    headers: { Authorization: bdlKey }
  });
  bdlCache.teams = result.data || [];
  return bdlCache.teams;
}

async function fetchBdlPlayer(playerName, bdlKey) {
  const cacheKey = normalizeName(playerName);
  if (bdlCache.players.has(cacheKey)) return bdlCache.players.get(cacheKey);

  const nameParts = normalizeName(playerName).split(" ");
  const searchTerms = uniqueValues([playerName, nameParts.at(-1), nameParts[0]]);
  const endpoints = ["https://api.balldontlie.io/v1/players/active", "https://api.balldontlie.io/v1/players"];
  const players = [];

  for (const endpoint of endpoints) {
    for (const term of searchTerms) {
      const playerUrl = new URL(endpoint);
      playerUrl.searchParams.set("search", term);
      playerUrl.searchParams.set("per_page", "100");
      const result = await fetchJson(playerUrl, { headers: { Authorization: bdlKey } });
      players.push(...(result.data || []));
      const match = bestPlayerMatch(players, playerName);
      if (match) {
        bdlCache.players.set(cacheKey, match);
        return match;
      }
    }
  }

  const player = bestPlayerMatch(players, playerName);
  bdlCache.players.set(cacheKey, player);
  return player;
}

async function fetchBdlPostseasonStats(playerId, bdlKey) {
  const season = currentSeasonYear();
  const cacheKey = `${playerId}-${season}`;
  if (bdlCache.stats.has(cacheKey)) return bdlCache.stats.get(cacheKey);

  const fetchStats = async (postseason) => {
    const statsUrl = new URL("https://api.balldontlie.io/v1/stats");
    statsUrl.searchParams.append("player_ids[]", playerId);
    statsUrl.searchParams.append("seasons[]", season);
    statsUrl.searchParams.set("postseason", postseason ? "true" : "false");
    statsUrl.searchParams.set("per_page", "100");
    const result = await fetchJson(statsUrl, { headers: { Authorization: bdlKey } });
    return result.data || [];
  };

  let stats = await fetchStats(true);
  if (!stats.length) stats = await fetchStats(false);
  stats = stats.sort((a, b) => new Date(b.game?.date || 0) - new Date(a.game?.date || 0));
  bdlCache.stats.set(cacheKey, stats);
  return stats;
}

async function enrichSeriesStats(game, prop, options = {}) {
  const bdlKey = "";
  if (!bdlKey || !game || !prop || !elements.sportKey.value.includes("nba")) {
    if (options.force) setStatus("Series logs now use Web Search instead of Ball Don't Lie.", "warn");
    return;
  }

  const enrichmentKey = `${game.id}-${prop.id}-${prop.line}`;
  activeEnrichmentKey = enrichmentKey;
  setStatus(`Pulling series stats for ${prop.player}...`);

  try {
    const player = await fetchBdlPlayer(prop.player, bdlKey);
    if (!player) {
      setStatus(`Could not find ${prop.player} in Ball Don't Lie. Showing sportsbook line and manual context.`, "warn");
      return;
    }

    const teams = await fetchBdlTeams(bdlKey);
    const playerTeamId = player.team?.id || player.team_id;
    const playerTeamName = player.team?.full_name || "";
    const opponentName = teamMatchesName({ full_name: playerTeamName }, game.homeTeam) ? game.awayTeam : teamMatchesName({ full_name: playerTeamName }, game.awayTeam) ? game.homeTeam : game.homeTeam;
    const opponentTeam = teams.find((team) => teamMatchesName(team, opponentName));
    const stats = await fetchBdlPostseasonStats(player.id, bdlKey);
    const seriesStats = stats.filter((stat) => {
      const homeId = stat.game?.home_team_id;
      const awayId = stat.game?.visitor_team_id;
      const includesPlayerTeam = !playerTeamId || homeId === playerTeamId || awayId === playerTeamId;
      const includesOpponent = !opponentTeam || homeId === opponentTeam.id || awayId === opponentTeam.id;
      return includesPlayerTeam && includesOpponent;
    });
    const usableStats = seriesStats.length ? seriesStats : stats.slice(0, 7);
    const values = usableStats.map((stat) => statValueForMarket(stat, prop.market)).filter((value) => value !== null);

    if (!values.length) {
      setStatus(`No matching Ball Don't Lie stat values found for ${prop.player} ${marketLabels[prop.market] || prop.market}.`, "warn");
      return;
    }

    prop.seriesAvg = Number(average(values).toFixed(1));
    prop.seriesGames = values.length;
    prop.seriesHits = values.filter((value) => value > prop.line).length;
    prop.seriesSource = seriesStats.length ? "Ball Don't Lie series" : "Ball Don't Lie playoffs";
    prop.seriesLogs = usableStats.map((stat, index) => {
      const value = statValueForMarket(stat, prop.market);
      const opponentId = stat.game?.home_team_id === playerTeamId ? stat.game?.visitor_team_id : stat.game?.home_team_id;
      const opponent = teams.find((team) => team.id === opponentId);

      return {
        date: stat.game?.date ? new Date(stat.game.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : `Game ${index + 1}`,
        opponent: opponent?.abbreviation || opponent?.full_name || "Opponent",
        min: stat.min || "--",
        pts: stat.pts ?? "--",
        reb: stat.reb ?? "--",
        ast: stat.ast ?? "--",
        threes: stat.fg3m ?? "--",
        value: value ?? "--",
        source: prop.seriesSource
      };
    });
    prop.injuryNote = prop.injuryNote.includes("Series stats updated") ? prop.injuryNote : `${prop.injuryNote}; Series stats updated`;

    if (activeEnrichmentKey !== enrichmentKey) return;
    selectedGameId = game.id;
    selectedPropId = propKey(game.id, prop.id);
    renderGames();
    renderParlay(game);
    renderShotForGlory();
    renderAdjustments(game);
    setStatus(`Updated ${prop.player} ${marketLabels[prop.market] || prop.market} from ${values.length} postseason game${values.length === 1 ? "" : "s"} at sportsbook line ${prop.line}.`, "success");
  } catch (error) {
    setStatus(`Could not pull Ball Don't Lie series stats: ${error.message}`, "warn");
  }
}

function scheduleSeriesEnrichment(game, prop) {
  window.clearTimeout(enrichmentTimer);
  if (!game || !prop || prop.seriesSource !== "Manual") return;
  enrichmentTimer = window.setTimeout(() => {
    enrichSeriesStats(game, prop);
  }, 500);
}

async function fetchInjuries(bdlKey) {
  if (!elements.sportKey.value.includes("nba")) return [];
  if (window.location.protocol !== "file:") {
    try {
      const result = await fetchJson("/api/injuries");
      if (result.configured) return result.injuries || [];
    } catch (error) {
      setStatus(`Slate loaded, but server injury updates were unavailable: ${error.message}`, "warn");
    }
  }

  if (!bdlKey) return [];
  try {
    const result = await fetchJson("https://api.balldontlie.io/v1/player_injuries", {
      headers: { Authorization: bdlKey }
    });
    return result.data || [];
  } catch (error) {
    setStatus(`Slate loaded, but Ball Don't Lie injuries were unavailable: ${error.message}`, "warn");
    return [];
  }
}

function injuryPlayerName(item) {
  return `${item.player?.first_name || ""} ${item.player?.last_name || ""}`.trim();
}

function injuryTeamNames(item) {
  const team = item.player?.team || item.team || {};
  return [
    team.full_name,
    team.name,
    `${team.city || ""} ${team.name || ""}`.trim(),
    team.abbreviation
  ].filter(Boolean);
}

function teamInjuriesForGame(injuryItems, game, teamName) {
  return injuryItems.filter((injury) =>
    injury.teamNames.some((name) => sameTeamName(name, teamName)) ||
    injury.teamNames.some((name) => sameTeamName(name, game.homeTeam) && sameTeamName(teamName, game.homeTeam)) ||
    injury.teamNames.some((name) => sameTeamName(name, game.awayTeam) && sameTeamName(teamName, game.awayTeam))
  );
}

function applyGameSituations(games, injuryItems) {
  games.forEach((game) => {
    const homeInjuries = teamInjuriesForGame(injuryItems, game, game.homeTeam);
    const awayInjuries = teamInjuriesForGame(injuryItems, game, game.awayTeam);

    game.candidates.forEach((prop) => {
      const teamName = propTeamName(prop, game);
      const isHome = sameTeamName(teamName, game.homeTeam);
      const existing = prop.teamSituation || {};
      prop.teamSituation = {
        ...existing,
        isHome,
        lineupKeyOut: (isHome ? homeInjuries : awayInjuries).filter((injury) => injury.out).map((injury) => injury.name)
      };
    });
  });
}

function injuryStatus(item) {
  return normalizeName([item.status, item.designation, item.return_date, item.comment].filter(Boolean).join(" "));
}

function minuteRestrictionSourceText(value = "") {
  const text = normalizeName(value);
  return /minute restriction|minutes restriction|minutes limit|limited minutes|minute limit|minutes cap|minute cap|workload limit|restricted workload|on a limit|playing time limit|ramp up|ramping up|not full workload|managed minutes/.test(text);
}

function isOutInjury(item) {
  const status = injuryStatus(item);
  return /out|inactive|doubtful|sidelined|suspended|will not play/.test(status);
}

function isMinutesLimitInjury(item) {
  return minuteRestrictionSourceText([item.status, item.designation, item.return_date, item.comment].filter(Boolean).join(" "));
}

function isQuestionableInjury(item) {
  const status = injuryStatus(item);
  return /questionable|probable|day to day|game time|available|injury management/.test(status);
}

function applyInjuries(games, injuries) {
  const injuryItems = injuries
    .map((item) => ({
      item,
      name: injuryPlayerName(item),
      normalizedName: normalizeName(injuryPlayerName(item)),
      teamNames: injuryTeamNames(item),
      out: isOutInjury(item),
      minutesLimit: isMinutesLimitInjury(item),
      questionable: isQuestionableInjury(item)
    }))
    .filter((item) => item.normalizedName);

  applyGameSituations(games, injuryItems);

  games.forEach((game) => {
    game.candidates.forEach((prop) => {
      const playerName = normalizeName(prop.player);
      const selfInjury = injuryItems.find((injury) => injury.normalizedName === playerName);

      if (selfInjury) {
        setInjuryLevel(prop, selfInjury.out ? "player_out" : selfInjury.minutesLimit ? "minutes_limit" : "player_questionable");
        prop.excluded = selfInjury.out;
        prop.injuryWatch = {
          status: injuryStatus(selfInjury.item) || (selfInjury.out ? "Out" : selfInjury.minutesLimit ? "Minutes Limit" : "Day-To-Day"),
          note: selfInjury.out
            ? "Player is listed out on the injury report"
            : selfInjury.minutesLimit
              ? "Minute Restriction Agent found a possible workload limit in the injury report"
            : "Injury Watch Agent is monitoring this player before board lock"
        };
        prop.injuryNote = selfInjury.out ? "Player listed out on injury report" : selfInjury.minutesLimit ? "Player may be on a minutes restriction" : `Player listed ${prop.injuryWatch.status || "day-to-day"} on injury report`;
        return;
      }

      const teamName = propTeamName(prop, game);
      const teammateInjuries = injuryItems.filter((injury) =>
        injury.normalizedName !== playerName &&
        injury.teamNames.some((name) => sameTeamName(name, teamName))
      );
      const outTeammates = teammateInjuries.filter((injury) => injury.out);
      const questionableTeammates = teammateInjuries.filter((injury) => !injury.out && injury.questionable);

      if (outTeammates.length || questionableTeammates.length) {
        const bump = marketRoleBump(prop.market, outTeammates.length, questionableTeammates.length);
        prop.roleAdjustment = Number((prop.roleAdjustment + bump).toFixed(1));
        setInjuryLevel(prop, outTeammates.length ? "teammate_out" : "teammate_questionable");
        prop.teamInjuryContext = {
          outCount: outTeammates.length,
          questionableCount: questionableTeammates.length,
          names: [...outTeammates, ...questionableTeammates].map((injury) => injury.name).slice(0, 4)
        };
        const names = prop.teamInjuryContext.names.join(", ");
        const note = `${outTeammates.length ? `${outTeammates.length} teammate out` : ""}${outTeammates.length && questionableTeammates.length ? "; " : ""}${questionableTeammates.length ? `${questionableTeammates.length} teammate questionable` : ""}${names ? ` (${names})` : ""}`;
        prop.injuryNote = prop.injuryNote.includes(note) ? prop.injuryNote : `${prop.injuryNote}; ${note}`;
      }
    });
  });
}

async function fetchSlateViaServer({ sport, date, marketKeys }) {
  const slateUrl = new URL("/api/slate", window.location.origin);
  slateUrl.searchParams.set("sport", sport);
  slateUrl.searchParams.set("date", date);
  slateUrl.searchParams.set("region", elements.region.value);
  slateUrl.searchParams.set("markets", marketKeys.join(","));
  const payload = await fetchJson(slateUrl);
  return payload.events || [];
}

async function fetchSlateViaBrowser({ oddsKey, sport, date, marketKeys }) {
  const { from, to } = getDateBounds(date);
  const eventUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events`);
  eventUrl.searchParams.set("apiKey", oddsKey);
  eventUrl.searchParams.set("dateFormat", "iso");
  eventUrl.searchParams.set("commenceTimeFrom", from);
  eventUrl.searchParams.set("commenceTimeTo", to);

  const events = await fetchJson(eventUrl);
  const eventPayloads = [];

  for (const event of events.slice(0, 12)) {
    const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`);
    oddsUrl.searchParams.set("apiKey", oddsKey);
    oddsUrl.searchParams.set("regions", elements.region.value);
    oddsUrl.searchParams.set("markets", marketKeys.join(","));
    oddsUrl.searchParams.set("oddsFormat", "american");
    oddsUrl.searchParams.set("dateFormat", "iso");

    eventPayloads.push({
      event,
      odds: await fetchJson(oddsUrl)
    });
  }

  return eventPayloads;
}

function buildGamesFromPayloads(eventPayloads) {
  const games = [];

  for (const eventPayload of eventPayloads) {
    const event = eventPayload.event || eventPayload;
    const odds = eventPayload.odds || eventPayload;
    const candidates = parseOddsCandidates(odds, elements.bookFilter.value);
    if (!event?.id) continue;
    games.push({
      id: event.id,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
      source: "The Odds API",
      candidates,
      propMarketAvailable: candidates.length > 0,
      bookmakerCount: odds.bookmakers?.length || 0
    });
  }

  return games;
}

function slatePropCount(games = slate) {
  return games.reduce((total, game) => total + (game.candidates?.length || 0), 0);
}

function slatePropsUnavailableMessage(games, config) {
  if (!games.length) return `No ${config.label} games were returned for that date.`;
  const gameText = `${games.length} ${config.label} game${games.length === 1 ? "" : "s"}`;
  return `Loaded ${gameText}, but no player prop lines were returned yet. This usually means sportsbook prop markets are not posted, have closed after tipoff, or your Odds API plan is not returning player props right now.`;
}

async function rebuildSlateForSelectedBook() {
  if (!lastEventPayloads.length) return;
  const token = ++slateLoadToken;
  const priorSelectedGameId = selectedGameId;
  const config = sportConfig();
  setStatus(`Regenerating board with ${elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "selected sportsbook"} lines...`);

  const games = buildGamesFromPayloads(lastEventPayloads);
  applyInjuries(games, lastInjuries);
  slate = games;
  selectedGameId = slate.some((game) => game.id === priorSelectedGameId) ? priorSelectedGameId : slate[0]?.id || null;
  selectedPropId = null;
  elements.playerSearch.value = "";
  const propCount = slatePropCount(slate);
  boardEnrichmentPending = Boolean(propCount && config.liveContext && window.location.protocol !== "file:");
  setStatus(
    propCount
      ? `Regenerated ${slate.length} ${config.label} game slate with ${elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "selected sportsbook"} lines. Improving reads in the background...`
      : slatePropsUnavailableMessage(slate, config),
    propCount ? "success" : "warn"
  );
  clearLiveBuildsForSlate();
  render();
  upsertCurrentBoard();
  if (propCount) enrichSlateInBackground(token, "book");
  if (!propCount) boardEnrichmentPending = false;
}

async function fetchSlate() {
  const token = ++slateLoadToken;
  const sport = elements.sportKey.value;
  const date = elements.slateDate.value || today;
  const config = sportConfig();

  setStatus(`Fetching ${config.label} slate events and player prop markets...`);
  if (elements.fetchSlate) elements.fetchSlate.disabled = true;

  try {
    const marketKeys = config.markets;
    let eventPayloads = [];

    try {
      if (window.location.protocol === "file:") throw new Error("Server proxy is unavailable from file mode");
      eventPayloads = await fetchSlateViaServer({ sport, date, marketKeys });
    } catch (serverError) {
      throw new Error(`${serverError.message}. Add ODDS_API_KEY to .env and restart the server.`);
    }

    lastEventPayloads = eventPayloads;
    const games = buildGamesFromPayloads(eventPayloads);

    lastInjuries = [];
    slate = games;
    cacheSlateWithServer(games);
    selectedGameId = slate[0]?.id || null;
    selectedPropId = null;
    elements.playerSearch.value = "";
    if (isMobileLayout() && slate.length) setMobileTab("games");
    const propCount = slatePropCount(slate);
    boardEnrichmentPending = Boolean(propCount && config.liveContext && window.location.protocol !== "file:");
    setStatus(
      propCount
        ? `Loaded ${slate.length} ${config.label} game slate with ${propCount} prop line${propCount === 1 ? "" : "s"}. Improving reads in the background...`
        : slatePropsUnavailableMessage(slate, config),
      propCount ? "success" : "warn"
    );
    clearLiveBuildsForSlate();
    render();
    upsertCurrentBoard();
    loadServerSavedBoards();
    if (slate.length) {
      fetchInjuries().then((injuries) => {
        if (token !== slateLoadToken) return;
        lastInjuries = injuries;
        applyInjuries(slate, injuries);
        clearLiveBuildsForSlate();
        render();
        upsertCurrentBoard();
      }).catch(() => {});
      if (propCount) enrichSlateInBackground(token, "load");
      if (!propCount) boardEnrichmentPending = false;
    }
  } catch (error) {
    boardEnrichmentPending = false;
    setStatus(`Could not fetch slate: ${error.message}`, "error");
  } finally {
    if (elements.fetchSlate) elements.fetchSlate.disabled = false;
  }
}

elements.fetchSlate?.addEventListener("click", fetchSlate);

let slateDateReloadTimer = null;
function reloadSlateForDateChange() {
  slateLoadToken += 1;
  backgroundEnrichmentRunning = false;
  savedBoardDateTouched = false;
  elements.savedBoardDate.value = elements.slateDate.value || today;
  lastEventPayloads = [];
  slate = [];
  selectedGameId = null;
  selectedPropId = null;
  elements.playerSearch.value = "";
  render();
  fetchSlate();
}

elements.slateDate.addEventListener("change", reloadSlateForDateChange);
elements.slateDate.addEventListener("input", () => {
  clearTimeout(slateDateReloadTimer);
  slateDateReloadTimer = setTimeout(reloadSlateForDateChange, 250);
});

elements.sportKey.addEventListener("change", () => {
  slateLoadToken += 1;
  backgroundEnrichmentRunning = false;
  updateSportShell();
  lastEventPayloads = [];
  slate = [];
  selectedGameId = null;
  selectedPropId = null;
  elements.playerSearch.value = "";
  render();
  fetchSlate();
});

elements.region.addEventListener("change", () => {
  slateLoadToken += 1;
  backgroundEnrichmentRunning = false;
  lastEventPayloads = [];
  slate = [];
  selectedGameId = null;
  selectedPropId = null;
  elements.playerSearch.value = "";
  render();
  fetchSlate();
});

elements.savedBoardDate.addEventListener("change", () => {
  savedBoardDateTouched = true;
  renderSavedBoards();
});

elements.toggleGameNews?.addEventListener("click", () => {
  setCollapsibleSection("gameNews", !collapsedSections.gameNews);
});

elements.togglePlayerLogs?.addEventListener("click", () => {
  setCollapsibleSection("playerLogs", !collapsedSections.playerLogs);
});

elements.bookFilter.addEventListener("change", () => {
  rebuildSlateForSelectedBook();
});

elements.playerSearch.addEventListener("input", runPlayerSearch);
elements.playerSearch.addEventListener("change", runPlayerSearch);
elements.playerSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runPlayerSearch();
  }
});
elements.searchPlayer.addEventListener("click", runTopWebSearch);

tabButtons.forEach((button) => {
  button.addEventListener("click", () => setMobileTab(button.dataset.tab));
});

leagueTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (elements.sportKey.value === button.dataset.sportTarget) return;
    elements.sportKey.value = button.dataset.sportTarget;
    elements.sportKey.dispatchEvent(new Event("change"));
  });
});

parlayTabButtons.forEach((button) => {
  button.addEventListener("click", () => setParlayView(button.dataset.parlayView));
});

elements.loadSample?.addEventListener("click", () => {
  slate = structuredClone(sampleSlate);
  selectedGameId = slate[0].id;
  selectedPropId = null;
  elements.playerSearch.value = "";
  if (isMobileLayout()) setMobileTab("games");
  setStatus("Loaded sample slate. Adjust series form, season H2H, and injuries to see the parlays change.", "success");
  render();
});

render();
fetchSlate();

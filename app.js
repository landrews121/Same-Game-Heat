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

const mlbMarkets = [
  "h2h",
  "batter_total_bases",
  "batter_hits",
  "batter_runs",
  "batter_rbis",
  "batter_home_runs",
  "pitcher_strikeouts"
];

const marketLabels = {
  batter_total_bases: "Total Bases",
  batter_hits: "Hits",
  batter_runs: "Runs",
  batter_rbis: "RBIs",
  batter_home_runs: "Home Runs",
  pitcher_strikeouts: "Pitcher Strikeouts",
  h2h: "Moneyline",
  player_shots_on_goal: "Shots On Goal",
  player_goals: "Goals",
  player_pass_yds: "Pass Yards",
  player_reception_yds: "Receiving Yards",
  player_rush_yds: "Rush Yards"
};

const parkHRFactors = {
  COL: 1.35, CIN: 1.22, NYY: 1.18, LAA: 1.14, MIL: 1.10,
  PHI: 1.09, ATL: 1.08, CHC: 1.07, TEX: 1.06, BAL: 1.05,
  BOS: 1.04, AZ: 1.03, HOU: 1.02, LAD: 1.01, NYM: 1.00,
  STL: 0.99, MIN: 0.98, CLE: 0.97, DET: 0.97, SF: 0.96,
  SEA: 0.95, MIA: 0.95, SD: 0.94, PIT: 0.93, KC: 0.92,
  WSH: 0.91, TB: 0.90, OAK: 0.89, TOR: 0.88, CWS: 0.87
};

// ── Moneyline Confidence Engine ──────────────────────────────────
const TEAM_SCORE_WEIGHTS = {
  startingPitcher: 0.25,
  offenseRecentForm: 0.18,
  bullpenQuality: 0.15,
  lineupMatchup: 0.12,
  injuries: 0.10,
  homeRoadSplit: 0.07,
  bullpenRest: 0.05,
  marketProbability: 0.05,
  travelAndRest: 0.03
};

const MLB_MONEYLINE_RULES = {
  minimumTeamScore: 52,
  minimumWinProbability: 0.53,
  minimumMatchupEdge: 5
};

function calculateTeamScore(metrics = {}) {
  return Math.round(Object.entries(TEAM_SCORE_WEIGHTS).reduce((score, [metric, weight]) => {
    const value = metrics[metric];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return score;
    return score + clamp(Number(value), 0, 100) * weight;
  }, 0));
}

function mlbMoneylineTier(score, probability) {
  if (score >= 82 && probability >= 0.64) return { tier: 1, label: "High" };
  if (score >= 74 && probability >= 0.60) return { tier: 2, label: "Medium" };
  if (score >= 52 && probability >= 0.53) return { tier: 3, label: "Lean" };
  return { tier: 0, label: "No Play" };
}

const sportsbookAliases = {
  fanatics: ["fanatics", "fanaticssportsbook", "fanatics_sportsbook", "fanatics sportsbook"],
  draftkings: ["draftkings", "draftkings_us", "draftkings sportsbook"],
  fanduel: ["fanduel", "fanduel_us", "fanduel sportsbook"],
  betmgm: ["betmgm", "betmgm_us", "betmgm sportsbook"],
  caesars: ["caesars", "williamhill_us", "williamhill", "caesars sportsbook"]
};

function sportsbookMatches(bookmaker, selectedBook) {
  const selected = String(selectedBook || "").trim().toLowerCase();
  const aliases = sportsbookAliases[selected] || [selected];
  const bookmakerKey = normalizeName(bookmaker?.key || "");
  const bookmakerTitle = normalizeName(bookmaker?.title || "");
  return aliases.some((alias) => {
    const normalizedAlias = normalizeName(alias);
    return normalizedAlias && (
      bookmakerKey === normalizedAlias ||
      bookmakerTitle === normalizedAlias ||
      bookmakerKey.includes(normalizedAlias) ||
      bookmakerTitle.includes(normalizedAlias)
    );
  });
}

const sportConfigs = {
  baseball_mlb: {
    label: "MLB",
    markets: mlbMarkets,
    liveContext: false,
    seriesLogs: false,
    comingSoon: ""
  }
};

function sportConfig() {
  return sportConfigs.baseball_mlb;
}

const sampleSlate = [
  {
    id: "sample-nyy-bos",
    homeTeam: "Boston Red Sox",
    awayTeam: "New York Yankees",
    commenceTime: `${today}T23:05:00Z`,
    source: "Sample",
    candidates: [
      candidate("Aaron Judge", "batter_home_runs", 0.5, -140, 0.18, 0.62, 0.18, 2, 3, 0.17, 4, 7, 0, "Park factor: Fenway neutral for righties"),
      candidate("Rafael Devers", "batter_total_bases", 1.5, -118, 2.1, 0.58, 2.3, 3, 4, 2.0, 5, 7, 0.1, "Fenway lefty boost"),
      candidate("Gerrit Cole", "pitcher_strikeouts", 6.5, -115, 7.2, 0.61, 6.8, 3, 4, 7.0, 5, 7, 0.2, "High K rate vs BOS lineup")
    ],
    moneylines: [],
    propMarketAvailable: true,
    bookmakerCount: 4,
    restDays: null,
    gameTotal: 8.5
  }
];

let slate = [];
let selectedGameId = null;
let selectedPropId = null;
let enrichmentTimer = null;
let activeEnrichmentKey = "";
let lastEventPayloads = [];
let lastInjuries = [];
let bdlMlbSupplementError = "";
let mlbPublicHomerCandidates = [];
let mlbMatchupData = [];
let mlbMatchupDataDate = "";
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
const allowedParlayViews = ["single", "three", "glory"];
document.querySelectorAll("[data-parlay-view]").forEach((button) => {
  if (!allowedParlayViews.includes(button.dataset.parlayView)) button.remove();
});
const tabButtons = Array.from(document.querySelectorAll(".mobile-tabs button"));
const parlayTabButtons = Array.from(document.querySelectorAll("[data-parlay-view]"));
const leagueTabButtons = Array.from(document.querySelectorAll("[data-sport-target]"));
const appBuildVersion = "same-game-heat-web-v1";
const boardBuildVersion = "v67-value-combos-h2h";
const moneylineModelVersion = "mlb-moneyline-v1";
const shotBuildVersion = "v4-quality-first";
const minimumLegProbability = 0.6;
const singleLegProbability = 0.62;
const threeLegProbability = 0.63;
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

function setMobileTab(tab) {
  const nextTab = ["games", "news", "logs", "saved"].includes(tab) ? tab : "games";
  elements.appShell.dataset.mobileTab = nextTab;
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === nextTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (nextTab === "saved") loadServerSavedBoards();
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
    elements.sportReadiness.textContent = config.comingSoon || "MLB Intelligence Platform — Team Win Probability · Home Run Board · Pitcher Props";
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
  return window.matchMedia("(max-width: 900px)").matches;
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
  if (value === null || value === undefined || value === "") return "Odds TBD";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Odds TBD";
  return number > 0 ? `+${number}` : `${number}`;
}

function americanOddsToProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return null;
  return number < 0 ? Math.abs(number) / (Math.abs(number) + 100) : 100 / (number + 100);
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

function fairAmericanOddsFromProbability(probability) {
  const probabilityNumber = clamp(Number(probability), 0.01, 0.99);
  return probabilityNumber >= 0.5
    ? -Math.round((probabilityNumber / (1 - probabilityNumber)) * 100)
    : Math.round(((1 - probabilityNumber) / probabilityNumber) * 100);
}

function playableMoneylineFromProbability(probability) {
  const conservativeProbability = clamp(Number(probability) - 0.025, 0.01, 0.99);
  return fairAmericanOddsFromProbability(conservativeProbability);
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
    batter_home_runs: 0.35,
    pitcher_strikeouts: 0.3
  };

  return Number(((bumps[market] || 0.5) * weight).toFixed(1));
}

function inferPlayerTier(prop) {
  const mlbPowerLine = prop.market === "batter_total_bases" || prop.market === "pitcher_strikeouts" ? Number(prop.line) : 0;
  if (prop.market?.startsWith("batter_") && ["batter_total_bases", "batter_hits", "batter_rbis", "batter_runs", "batter_home_runs"].includes(prop.market)) return "starter";
  if (prop.market === "pitcher_strikeouts" && mlbPowerLine >= 4.5) return "starter";
  return "rotation";
}

function playerMinutesProfile(prop) {
  const logs = prop.seriesLogs || [];
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const averageMinutes = minutes.length ? average(minutes) : Number(prop.averageMinutes || 0);
  const last3 = minutes.slice(0, 3);
  const last3Average = last3.length ? average(last3) : averageMinutes;
  const latestMinutes = minutes.length ? minutes[0] : 0;
  const minuteSwing = minutes.length ? Math.max(...minutes) - Math.min(...minutes) : Number(prop.minuteSwing || 0);
  const minuteDeviation = standardDeviation(minutes);

  return { minutes, averageMinutes, last3Average, latestMinutes, minuteSwing, minuteDeviation };
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

const teamAliases = {
  ari: "arizonadiamondbacks",
  atl: "atlantabraves",
  bal: "baltimoreorioles",
  bos: "bostonredsox",
  chc: "chicagocubs",
  cws: "chicagowhitesox",
  cin: "cincinnatiredss",
  cle: "clevelandguardians",
  col: "coloradorockies",
  det: "detroittigers",
  hou: "houstonastros",
  kc:  "kansascityroyals",
  laa: "losangelesangels",
  lad: "losangelesdodgers",
  mia: "miamimarlinss",
  mil: "milwaukeebrewers",
  min: "minnesotatwins",
  nym: "newyorkmets",
  nyy: "newyorkyankees",
  oak: "oaklandathletics",
  phi: "philadelphiaphillies",
  pit: "pittsburghpirates",
  sd:  "sandiegopadres",
  sea: "seattlemariners",
  sf:  "sanfranciscogiants",
  stl: "stlouiscardinals",
  tb:  "tampabayrays",
  tex: "texasrangers",
  tor: "torontobluejays",
  was: "washingtonnationals"
};

function normalizedTeamName(value) {
  const key = normalizeName(value);
  return teamAliases[key] || key;
}

function sameTeamName(left, right) {
  const a = normalizedTeamName(left);
  const b = normalizedTeamName(right);
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
  if (board?.sport === "baseball_mlb") return null;
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
  if (board?.sport === "baseball_mlb") return leg;
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


function headToHeadFallbackContext(prop) {
  return {
    avg: Number(prop.seasonH2HAvg || 0),
    hits: Number(prop.seasonH2HHits || 0),
    games: Number(prop.seasonH2HGames || 0),
    source: "Opponent history"
  };
}


function selectedLineQualityContext(prop, direction) {
  if (!prop.lineAlternates?.length) return { penalty: 0, probabilityPenalty: 0, boost: 0, probabilityBoost: 0, notes: [] };

  const line = Number(prop.line);
  const peerLines = prop.lineAlternates.map((item) => Number(item.line)).filter(Number.isFinite);
  if (!Number.isFinite(line) || !peerLines.length) return { penalty: 0, probabilityPenalty: 0, boost: 0, probabilityBoost: 0, notes: [] };

  const marketAverage = average([line, ...peerLines]);
  const gap = direction === "Over" ? line - marketAverage : marketAverage - line;
  const softGap = direction === "Over" ? marketAverage - line : line - marketAverage;
  const notes = [];
  let penalty = 0;
  let probabilityPenalty = 0;
  let boost = 0;
  let probabilityBoost = 0;

  if (gap >= 1) {
    penalty += 9;
    probabilityPenalty += 0.045;
    notes.push("Miss risk: selected sportsbook line is tougher than the market");
  } else if (gap >= 0.5) {
    penalty += 5;
    probabilityPenalty += 0.025;
    notes.push("Miss risk: selected sportsbook line is slightly worse than the market");
  }

  if (softGap >= 1) {
    boost += 5;
    probabilityBoost += 0.025;
    notes.push("Line value: selected sportsbook is giving a softer number");
  } else if (softGap >= 0.5) {
    boost += 2;
    probabilityBoost += 0.01;
    notes.push("Line value: selected sportsbook is a little better than the market");
  }

  return { penalty, probabilityPenalty, boost, probabilityBoost, notes };
}

function missRiskContext(prop, direction, game) {
  if (prop.market === "batter_home_runs") return { penalty: 0, probabilityPenalty: 0, notes: [] };
  const logs = prop.seriesLogs || [];
  const values = logs.map((log) => logValueForMarket(log, prop.market)).filter((value) => Number.isFinite(value));
  const minutes = logs.map(numericLogMinutes).filter((value) => value !== null);
  const line = Number(prop.line);
  const isOver = direction === "Over";
  const isPrimary = prop.playerTier === "star" || prop.playerTier === "starter";
  const notes = [];
  let penalty = 0;
  let probabilityPenalty = 0;

  if (game?.source === "Sample") {
    penalty += 4;
    probabilityPenalty += 0.02;
    notes.push("Miss risk: sample slate is only for layout testing");
  }

  return { penalty, probabilityPenalty, notes };
}

function homeRunScoringContext(prop, game) {
  if (prop.market !== "batter_home_runs") return { scoreBoost: 0, probabilityBoost: 0, scoreCap: 96, noSeriesPenaltyOverride: null, notes: [] };

  const homeTeamAbbr = (game?.homeTeam || "").toUpperCase().replace(/\s+/g, "").slice(0, 3);
  const parkFactor = parkHRFactors[homeTeamAbbr] || 1.0;
  const parkBoostScore = Number(((parkFactor - 1.0) * 60).toFixed(1));
  const parkBoostProbability = Number(((parkFactor - 1.0) * 0.08).toFixed(4));

  const isStandardLine = Number(prop.line) === 0.5;
  const scoreCap = isStandardLine ? 70 : 78;

  const notes = [];
  if (parkFactor > 1.05) notes.push("Park factor boost: hitter-friendly environment raises HR probability");
  else if (parkFactor < 0.95) notes.push("Park factor penalty: pitcher-friendly park suppresses HR probability");
  else notes.push("Park factor: neutral environment");

  if (isStandardLine) notes.push("Standard anytime HR line (0.5): high variance prop, scoreCap adjusted accordingly");

  return {
    scoreBoost: parkBoostScore,
    probabilityBoost: parkBoostProbability,
    scoreCap,
    noSeriesPenaltyOverride: 2,
    notes
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

// MLB-only prop scorer. Uses recent form, opponent history, park factors, and injury agents.
function scoreCandidate(prop, game, forcedDirection = "") {
  prop.playerTier = inferPlayerTier(prop);
  const h2h = headToHeadFallbackContext(prop);
  const edge = prop.recentAvg - prop.line + prop.roleAdjustment;
  const seriesEdge = prop.seriesAvg - prop.line;
  const seasonH2HEdge = h2h.avg - prop.line;
  const injuryScore = injuryImpact(prop.manualInjury);
  const seriesWeight = clamp(prop.seriesGames / 4, 0, 1);
  const seasonH2HWeight = clamp(h2h.games / 3, 0, 0.7);
  const seriesHitRate = prop.seriesGames ? clamp(prop.seriesHits / prop.seriesGames, 0, 1) : 0.5;
  const seasonH2HHitRate = h2h.games ? clamp(h2h.hits / h2h.games, 0, 1) : 0.5;
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
  const lineQuality = selectedLineQualityContext(prop, direction);
  const samplePenalty = game?.source === "Sample" ? 4 : 0;
  const sampleProbabilityPenalty = game?.source === "Sample" ? 0.02 : 0;
  const agentSignals = internalAgentSignals(prop, direction, game);
  const agentScoreAdjustment = agentSignals.reduce((sum, signal) => sum + Number(signal.delta || 0), 0);
  const agentProbabilityAdjustment = agentSignals.reduce((sum, signal) => sum + Number(signal.probabilityDelta || 0), 0);
  const homeRunContext = prop.market === "batter_home_runs"
    ? homeRunScoringContext(prop, game)
    : { scoreBoost: 0, probabilityBoost: 0, scoreCap: 96, notes: [] };
  const missingSeriesLogs = !prop.seriesGames;
  const noSeriesPenalty = missingSeriesLogs ? (prop.market === "batter_home_runs" ? 2 : 4) : 0;
  const noSeriesProbabilityPenalty = missingSeriesLogs ? (prop.market === "batter_home_runs" ? 0.01 : 0.02) : 0;
  const edgeScore = Math.max(0, directionalEdge) * 2.6 + Math.min(0, directionalEdge) * 1.2;
  const seriesEdgeScore = (Math.max(0, directionalSeriesEdge) * 3.8 + Math.min(0, directionalSeriesEdge) * 1.6) * seriesWeight;
  const seasonH2HEdgeScore = (Math.max(0, directionalSeasonH2HEdge) * 1.2 + Math.min(0, directionalSeasonH2HEdge) * 0.6) * seasonH2HWeight;
  const rawScore = 46 + edgeScore + seriesEdgeScore + seasonH2HEdgeScore +
    (directionalRecentHitRate - 0.5) * 18 +
    (directionalSeriesHitRate - 0.5) * 64 * seriesWeight +
    (directionalSeasonH2HHitRate - 0.5) * 14 * seasonH2HWeight +
    seriesConviction + injuryScore + homeRunContext.scoreBoost + lineQuality.boost + agentScoreAdjustment -
    oddsPenalty - lineQuality.penalty - noSeriesPenalty - samplePenalty;
  const scoreCap = missingSeriesLogs ? Math.min(92, homeRunContext.scoreCap ?? 96) : homeRunContext.scoreCap ?? 96;
  const edgeProbability = clamp(directionalBlendedEdge * 0.01, -0.05, 0.07);
  const probability = clamp(
    directionalRecentHitRate * 0.42 +
    directionalSeriesHitRate * 0.34 * seriesWeight +
    directionalSeasonH2HHitRate * 0.14 * seasonH2HWeight +
    0.08 + edgeProbability + injuryScore / 290 +
    homeRunContext.probabilityBoost + lineQuality.probabilityBoost + agentProbabilityAdjustment -
    lineQuality.probabilityPenalty - noSeriesProbabilityPenalty - sampleProbabilityPenalty,
    0.26, 0.78
  );

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
      ...homeRunContext.notes,
      ...lineQuality.notes,
      ...agentSignals.map((signal) => signal.note),
      ...(missingSeriesLogs ? ["MLB pre-log mode: scoring from recent form and opponent history"] : []),
      ...(forcedDirection && seriesDirection && direction !== seriesDirection ? ["Two-sided scan: series trend opposes this side"] : []),
      ...(!prop.seriesGames && h2h.games ? [`No current series: using ${h2h.source.toLowerCase()}`] : [])
    ],
    agentSignals,
    missingSeriesLogs,
    missRiskPenalty: lineQuality.penalty,
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
    const isMlbMarket = leg.market?.startsWith("batter_") || leg.market?.startsWith("pitcher_");
    const dedupKey = isMlbMarket ? `${normalizeName(leg.player)}|${leg.market}` : normalizeName(leg.player);
    if (usedPlayers.has(dedupKey)) continue;
    if (!options.allowMultipleAssists && leg.market === "player_assists" && usedMarkets.get("player_assists")) continue;
    if (!options.allowMultipleThreeOvers && leg.market === "player_threes" && leg.direction === "Over" && usedMarkets.get("player_threes_over")) continue;
    if (options.avoidUsageCorrelation && selected.some((item) => correlatedUsageLegs(item, leg, options.game))) continue;
    selected.push(leg);
    usedPlayers.add(dedupKey);
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
  const isBaseballMarket = leg.market?.startsWith("batter_") || leg.market === "pitcher_strikeouts";
  const fragileRoleOver = !isBaseballMarket && leg.direction === "Over" && leg.playerTier === "rotation" && (
    volatileMinutes ||
    notes.includes("role-player overs are fragile") ||
    notes.includes("role-player injury bump needs confirmed minutes")
  );
  const worseLine = notes.includes("worse than market average");
  const missRiskPenalty = Number(leg.missRiskPenalty || 0);
  const severe = fragileRoleOver || minutesAgainst || negativeDelta >= 18 || probabilityDrag >= 0.09 || missRiskPenalty >= 16 || (volatileMinutes && worseLine);

  return {
    any: severe || negativeDelta >= 12 || probabilityDrag >= 0.06 || missRiskPenalty >= 10,
    severe,
    fragileRoleOver,
    negativeDelta,
    probabilityDrag
  };
}

function boardQualityGate(leg, tier = "standard") {
  if (leg.excluded) return false;
  if (leg.manualInjury === "player_out" || leg.manualInjury === "minutes_limit") return false;
  if (tier !== "shot" && leg.market === "player_threes" && leg.direction === "Over") return false;

  const missRiskPenalty = Number(leg.missRiskPenalty || 0);
  const risk = agentConflictRisk(leg);
  const survivability = Number(leg.survivabilityScore || 0);
  const isCore = leg.playerTier === "star" || leg.playerTier === "starter" || Number(leg.averageMinutes || 0) >= 28;

  if (tier === "single") {
    if (!isCore) return leg.probability >= 0.66 && leg.score >= 76 && missRiskPenalty <= 6;
    if (risk.severe || missRiskPenalty >= 12) return leg.probability >= 0.62 && leg.score >= 70 && survivability >= 45;
    return leg.probability >= 0.54 && leg.score >= 52 && survivability >= 25;
  }

  if (tier === "star") {
    if (!isCore) return false;
    if (risk.severe || missRiskPenalty >= 14) return leg.probability >= 0.63 && leg.score >= 72;
    return leg.probability >= 0.52 && leg.score >= 45;
  }

  if (tier === "shot") {
    if (leg.market === "player_threes" && leg.direction === "Over" && leg.probability < 0.64) return false;
    if (risk.fragileRoleOver) return false;
    if (missRiskPenalty >= 18 && leg.probability < 0.58) return false;
    return leg.probability >= 0.48 && leg.score >= 38;
  }

  if (risk.severe && leg.probability < 0.58) return false;
  return missRiskPenalty < 16 || (leg.probability >= 0.6 && leg.score >= 68);
}

function boardPlayableFallbackGate(leg, tier = "standard", options = {}) {
  if (leg.excluded) return false;
  if (leg.modeledFloor) return false;
  if (leg.manualInjury === "player_out" || leg.manualInjury === "minutes_limit") return false;
  if (leg.market === "player_threes" && leg.direction === "Over") return false;

  const risk = agentConflictRisk(leg);
  if (risk.fragileRoleOver) return false;

  const missRiskPenalty = Number(leg.missRiskPenalty || 0);
  const isCore = leg.playerTier === "star" || leg.playerTier === "starter" || Number(leg.averageMinutes || 0) >= 26;
  const probability = Number(leg.probability || 0);
  const score = Number(leg.score || 0);

  if (tier === "single") {
    if (!isCore) return probability >= 0.56 && score >= 56 && missRiskPenalty <= 10;
    if (risk.severe || missRiskPenalty >= 16) return probability >= 0.58 && score >= 62;
    return probability >= 0.5 && score >= 38;
  }

  if (tier === "star") {
    if (!isCore) return false;
    if (risk.severe || missRiskPenalty >= 18) return probability >= 0.57 && score >= 58;
    return probability >= 0.48 && score >= 38;
  }

  if (risk.severe && probability < 0.54) return false;
  if (missRiskPenalty >= 18 && probability < 0.56) return false;
  return probability >= 0.46 && score >= 34;
}

function relaxedFullLinePool(game, label = "Fallback Engine", tier = "standard", options = {}) {
  return scoredLegPool(game)
    .filter((leg) => !leg.modeledFloor)
    .filter((leg) => playerBelongsToGame(leg, game))
    .filter((leg) => leg.manualInjury !== "player_out" && leg.manualInjury !== "minutes_limit")
    .map((leg) => leg)
    .filter((leg) => boardPlayableFallbackGate(leg, tier, options))
    .filter((leg, index, legs) => legs.findIndex((item) => shotLegKey(item) === shotLegKey(leg)) === index)
    .sort((a, b) =>
      b.probability - a.probability ||
      b.survivabilityScore - a.survivabilityScore ||
      b.score - a.score
    );
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
  const noSeriesProbabilityTax = 0;
  const noSeriesScoreTax = 0;
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
  return leg.probability >= gate.probability && leg.score >= gate.score;
}

function multiLegFillGate(leg) {
  if (leg.excluded) return false;
  if (leg.market === "player_threes" && leg.direction === "Over") return false;
  const risk = agentConflictRisk(leg);
  if (risk.fragileRoleOver) return false;
  if (risk.severe && leg.probability < 0.5) return false;
  return leg.probability >= 0.38 && leg.score >= 38;
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

function buildHRProps(game, count = 2) {
  return game.candidates
    .filter((prop) => prop.market === "batter_home_runs" && !prop.excluded)
    .filter((prop) => playerBelongsToGame(prop, game))
    .flatMap((prop) => scorePropSides(prop, game))
    .filter((leg) => leg.direction === "Over")
    .filter((leg) => leg.manualInjury !== "player_out")
    .filter((leg, index, legs) => legs.findIndex((item) => normalizeName(item.player) === normalizeName(leg.player)) === index)
    .sort((a, b) => b.probability - a.probability || b.score - a.score)
    .slice(0, count)
    .map((leg) => ({
      ...leg,
      contextNotes: [...(leg.contextNotes || []), "HR Board: anytime home run ranked by park-adjusted probability"]
    }));
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

function oppositeBoardSideUsed(leg, usedLegs = []) {
  const player = normalizeName(leg.player);
  return (usedLegs || []).some((used) =>
    normalizeName(used.player) === player &&
    used.market === leg.market &&
    used.direction &&
    leg.direction &&
    used.direction !== leg.direction
  );
}

function excludeUsedLegs(legs, usedLegs = []) {
  if (!usedLegs?.length) return legs;
  return legs.filter((leg) => !oppositeBoardSideUsed(leg, usedLegs));
}

function reserveUsedLegs(usedLegs, newLegs) {
  newLegs.forEach((leg) => usedLegs.push(leg));
  return newLegs;
}


function candidateGuidePool(game) {
  if (!game) return [];
  const strictLegs = reserveLegPool(game, "standard");
  const pool = [...strictLegs]
    .filter((leg, index, legs) => legs.findIndex((item) => shotLegKey(item) === shotLegKey(leg)) === index)
    .sort((a, b) => {
      const aRank = candidateGuideRank(a);
      const bRank = candidateGuideRank(b);
      return bRank - aRank || b.probability - a.probability || b.score - a.score;
    });
  const sixtyPlus = pool.filter((leg) => Number(leg.probability || 0) >= 0.6);
  return (sixtyPlus.length ? sixtyPlus : pool.filter((leg) => Number(leg.probability || 0) >= 0.48))
    .slice(0, 20);
}

function candidateGuideRank(leg) {
  const survival = Number(leg.survivabilityScore || 0);
  const probability = Number(leg.probability || 0);
  const floorBonus = leg.modeledFloor ? 8 : 0;
  return survival + probability * 35 + floorBonus;
}

function candidateGuideStatus(leg, selectedKeys) {
  if (selectedKeys.anchor.has(shotLegKey(leg))) return { label: "Anchor", className: "strong" };
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
  return "⚾".repeat(count);
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


function shotLegKey(leg) {
  return `${leg.player}|${leg.market}|${leg.line}|${leg.direction}`;
}

function boardExposureKey(leg) {
  return `${normalizeName(leg.player)}|${leg.market}`;
}

function shotPlayerMarketKey(leg) {
  return boardExposureKey(leg);
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


function gameParlayBuild(game) {
  if (!game) return { singleLegs: [], saferLegs: [], sameTeamLegs: [], threeLegs: [], valueStarLegs: [], hrLegs: [], locked: false, lockedAt: "" };
  return { singleLegs: [], saferLegs: [], sameTeamLegs: [], threeLegs: [], valueStarLegs: [], hrLegs: buildHRProps(game, 2), locked: false, lockedAt: "" };
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
  return { legs: [], gameBuilds: [], targetLegs: 0, locked: false, lockedAt: "" };
}

function shotForGloryBuild() {
  return { legs: [], gameBuilds: [], targetLegs: 0, locked: false, lockedAt: "" };
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
  const hasModeledFloor = legs.some((leg) => leg.modeledFloor);
  const sameGameHaircut = hasModeledFloor ? 0.72 : legs.length <= 2 ? 0.82 : legs.length <= 3 ? 0.72 : 0.58;
  const marketOverlapHaircut = hasModeledFloor ? 1 : new Set(legs.map((leg) => leg.market)).size < legs.length ? 0.9 : 1;
  const conservativeDecimal = 1 + rawProfit * sameGameHaircut * marketOverlapHaircut;
  return decimalToAmericanOdds(conservativeDecimal);
}

const minimumPlayableBoardOdds = -130;

function oddsMeetMinimum(odds, minimum = minimumPlayableBoardOdds) {
  const number = Number(odds);
  return Number.isFinite(number) && number >= minimum;
}

function pricedFullLineLeg(leg) {
  return !leg.modeledFloor &&
    leg.manualInjury !== "player_out" &&
    leg.manualInjury !== "minutes_limit" &&
    Number.isFinite(Number(leg.odds));
}

function parlayMeetsPayoutGoal(legs) {
  return legs.length >= 2 && oddsMeetMinimum(conservativeParlayOdds(legs));
}

function uniqueLegsCanPair(left, right, game) {
  if (!left || !right) return false;
  if (normalizeName(left.player) === normalizeName(right.player)) return false;
  if (shotLegKey(left) === shotLegKey(right)) return false;
  if (left.market === "player_threes" && left.direction === "Over" && right.market === "player_threes" && right.direction === "Over") return false;
  if (correlatedUsageLegs(left, right, game)) return false;
  return true;
}

function bestPricedTwoLegParlay(pool, game, options = {}) {
  const sorted = pool
    .filter(pricedFullLineLeg)
    .filter((leg) => options.allowJuicedLegs || oddsMeetMinimum(leg.odds, -350))
    .sort((a, b) =>
      b.probability - a.probability ||
      b.survivabilityScore - a.survivabilityScore ||
      b.score - a.score
    )
    .slice(0, 24);
  let best = [];
  let bestScore = -Infinity;

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const pair = [sorted[i], sorted[j]];
      if (!uniqueLegsCanPair(pair[0], pair[1], game)) continue;
      if (!parlayMeetsPayoutGoal(pair)) continue;
      const pairScore = average(pair.map((leg) => leg.probability)) * 100 +
        average(pair.map((leg) => Number(leg.survivabilityScore || leg.score || 0))) +
        parlayGrade(pair) / 3;
      if (pairScore > bestScore) {
        best = pair;
        bestScore = pairScore;
      }
    }
  }

  return best;
}

function boardOddsLabel(legs) {
  const odds = formatOdds(conservativeParlayOdds(legs));
  return legs.some((leg) => leg.modeledFloor) ? `Est. ${odds}` : odds;
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
  if (legs.length) return `${legs.length} leg${legs.length === 1 ? "" : "s"}`;
  return "Awaiting legs";
}

function loadSavedBoards() {
  try {
    const parsed = JSON.parse(localStorage.getItem("propLensSavedBoards") || "[]");
    return Array.isArray(parsed)
      ? parsed.map((board) => normalizeSavedBoard(board, "local")).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeSavedBoard(board, source = "local") {
  if (!board || typeof board !== "object") return null;
  return {
    ...board,
    storageSource: board.storageSource || source
  };
}

function savedBoardSourceRank(board) {
  return board?.storageSource === "server" ? 1 : 0;
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
  const serverBoards = (boards || []).map((board) => normalizeSavedBoard(board, "server")).filter(Boolean);
  const localBoards = (savedBoards || []).map((board) => normalizeSavedBoard(board, board.storageSource || "local")).filter(Boolean);
  [...serverBoards, ...localBoards].forEach((board) => {
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
    mergeSavedBoards(payload.boards || []);
    renderSavedBoards();
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

function savedMlbLegFromTeamPick(pick) {
  return {
    key: `${pick.game.id}|team|${pick.team}`,
    group: "MLB Team",
    gameLabel: `${pick.game.awayTeam} @ ${pick.game.homeTeam}`,
    player: pick.team,
    market: "h2h",
    marketLabel: "Moneyline",
    direction: "Win",
    line: pick.moneyline?.odds ?? "",
    odds: pick.moneyline?.odds ?? null,
    score: pick.teamWinScore,
    probability: pick.modelWinProbability,
    displayLabel: `${pick.team} moneyline ${pick.moneyline ? formatOdds(pick.moneyline.odds) : ""}`.trim(),
    contextNotes: pick.reasons || [],
    riskFlags: pick.riskFlags || [],
    actual: null,
    status: "pending",
    resultDate: "",
    reviewNotes: []
  };
}

function savedMlbLegFromHomerPick(pick) {
  return {
    key: `${pick.game.id}|homer|${pick.player}|${pick.line}`,
    group: "MLB Homer",
    gameLabel: `${pick.game.awayTeam} @ ${pick.game.homeTeam}`,
    player: pick.player,
    market: "batter_home_runs",
    marketLabel: "Home Runs",
    direction: "To Homer",
    line: pick.line ?? 0.5,
    odds: pick.odds,
    score: pick.homeRunScore,
    probability: pick.homerProbability,
    displayLabel: `${pick.player} to homer ${formatOdds(pick.odds)}`,
    contextNotes: pick.reasons || [],
    riskFlags: pick.riskFlags || [],
    actual: null,
    status: "pending",
    resultDate: "",
    reviewNotes: []
  };
}

function savedMlbParlay(title, group, picks, mapper) {
  const legs = picks.map(mapper);
  return {
    title,
    gameLabel: "MLB daily board",
    group,
    grade: Math.round(average(legs.map((leg) => Number(leg.score || 0)).filter(Boolean))),
    probability: null,
    legs,
    hits: 0,
    graded: 0
  };
}

function currentMlbBoardSnapshot(date, sport) {
  const teamPicks = scoreMlbTeams();
  const homerPicks = scoreMlbHomeRunBats();
  const parlays = [];

  if (teamPicks.length) {
    parlays.push(savedMlbParlay("Team Win Probability", "MLB Team", teamPicks, savedMlbLegFromTeamPick));
  }
  if (homerPicks.length) {
    parlays.push(savedMlbParlay("Home Run Looks", "MLB Homer", homerPicks, savedMlbLegFromHomerPick));
  }

  const legs = parlays.flatMap((parlay) => parlay.legs);
  if (!legs.length) return null;

  return {
    key: `${date}-${sport}-${elements.bookFilter.value}`,
    date,
    sport,
    buildVersion: boardBuildVersion,
    storageSource: "local",
    receiptLocked: slate.some((game) => gameHasStarted(game)),
    bookKey: elements.bookFilter.value,
    bookTitle: elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || elements.bookFilter.value,
    savedAt: new Date().toISOString(),
    games: slate.map((game) => `${game.awayTeam} @ ${game.homeTeam}`),
    parlays,
    legs,
    hits: 0,
    graded: 0
  };
}

function currentBoardSnapshot() {
  if (!slate.length || slate.every((game) => game.source === "Sample")) return null;
  const date = elements.slateDate.value || today;
  const sport = elements.sportKey.value;
  return currentMlbBoardSnapshot(date, sport);
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

function savedBoardSlateHasStarted(board) {
  const labels = [
    ...(board?.games || []),
    ...(board?.parlays || []).map((parlay) => parlay.gameLabel).filter(Boolean)
  ];
  if (!labels.length) return false;
  return slate.some((game) =>
    labels.some((label) => gameLabelMatches(label, `${game.awayTeam} @ ${game.homeTeam}`)) &&
    gameHasStarted(game)
  );
}

function shouldReplaceSavedBoard(existing, snapshot) {
  if (!existing) return true;
  if (existing.receiptLocked) return false;
  if (snapshot.receiptLocked) return true;
  if (savedBoardSlateHasStarted(existing)) return false;
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
  if (!boardToSave) return;
  savedBoards = [
    boardToSave,
    ...savedBoards.filter((board) => board.key !== boardToSave.key)
  ].slice(0, 14);
  invalidateSavedLegCache();
  saveSavedBoards();
  if (boardToSave === snapshot) pushSavedBoard(boardToSave);
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
      // Final stats endpoint removed (was NBA/ESPN). MLB final stats TBD in Phase 2.
      finalStatsCache.set(date, { stats: [], games: [], __fetchedAt: Date.now() });
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
  { key: "single", label: "Bet of the Day", match: /best.single|bet.of.the.day/i },
  { key: "three", label: "3 Leg", match: /3-leg|3 leg/i },
  { key: "star", label: "Star Value", match: /star.value/i },
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
    elements.boardSuccess.textContent = "Board success will appear after saved results are final.";
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

function displaySavedBoardsForDate(boards) {
  if (!boards.length) return [];
  const completed = boards.filter((board) => boardGamesFinal(board) || boardHasFinalResults(board));
  const pool = completed.length ? completed : boards;
  const ranked = [...pool].sort((a, b) => {
    const aSource = savedBoardSourceRank(a);
    const bSource = savedBoardSourceRank(b);
    if (aSource !== bSource) return bSource - aSource;
    const aComplete = boardHasFinalResults(a) ? 1 : 0;
    const bComplete = boardHasFinalResults(b) ? 1 : 0;
    if (aComplete !== bComplete) return bComplete - aComplete;
    const aLegs = snapshotLegCount(a);
    const bLegs = snapshotLegCount(b);
    if (aLegs !== bLegs) return bLegs - aLegs;
    return String(b.savedAt || "").localeCompare(String(a.savedAt || ""));
  });
  return ranked[0] ? [ranked[0]] : [];
}

function renderSavedBoards() {
  if (!elements.savedBoards) return;
  const currentSport = elements.sportKey.value;
  const savedWithLegs = savedBoards.filter((board) =>
    (board.parlays?.length || board.legs?.length) &&
    (!board.sport || board.sport === currentSport)
  );

  if (!savedBoardDateTouched && savedWithLegs.length) {
    elements.savedBoardDate.value = preferredSavedBoardDate(savedWithLegs);
  }

  const selectedSavedDate = elements.savedBoardDate.value || preferredSavedBoardDate(savedWithLegs);
  ensureFinalStatsForBoards(savedWithLegs);
  renderBoardSuccess(savedWithLegs);
  const selectedDateBoards = savedWithLegs.filter((board) => board.date === selectedSavedDate);
  const eligibleBoards = selectedDateBoards.filter((board) => selectedSavedDate < today || boardGamesFinal(board) || boardHasFinalResults(board));
  const boards = displaySavedBoardsForDate(eligibleBoards);

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
                    <span>${escapeHtml(leg.displayLabel || `${leg.player} ${leg.direction} ${leg.line} ${leg.marketLabel}`)}</span>
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
  return mlbLogMarketOptions;
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
    : "<li>No injury updates returned for this game.</li>";
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
  // Game news via ESPN removed. MLB lineup/injury feed wired in Phase 2.
  if (!game) return;
  if (!options.force && gameNewsCache.has(game.id)) return;
  gameNewsCache.set(game.id, { news: [], injuries: [], starters: [], __fetchedAt: Date.now() });
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
        isPlayoffGame: team ? team.isPlayoffGame : prop.teamSituation?.isPlayoffGame,
        isEliminationGame: team ? team.isEliminationGame : prop.teamSituation?.isEliminationGame,
        isGame7: team ? team.isGame7 : prop.teamSituation?.isGame7,
        gameImportanceScore: team ? team.gameImportanceScore : prop.teamSituation?.gameImportanceScore,
        wins: team ? team.wins : prop.teamSituation?.wins,
        opponentWins: team ? team.opponentWins : prop.teamSituation?.opponentWins,
        winsNeeded: team ? team.winsNeeded : prop.teamSituation?.winsNeeded,
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

async function fetchWebSeriesLogs(playerName) {
  // Series-logs endpoint removed (was NBA/ESPN). MLB game log feed wired in Phase 2.
  throw new Error(`MLB game logs for ${playerName} not yet connected`);
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
  const isMlb = elements.sportKey.value === "baseball_mlb";
  elements.gameCount.textContent = `${slate.length} game${slate.length === 1 ? "" : "s"}`;
  elements.gameList.innerHTML = slate
    .map((game) => {
      const active = game.id === selectedGameId ? " active" : "";
      const moneylineCount = Object.keys(game.moneylines || {}).length;
      const marketText = isMlb
        ? `${moneylineCount ? `${moneylineCount} moneylines` : "moneyline pending"} · ${game.candidates.length} props`
        : `${game.candidates.length} props`;
      return `
        <button class="game-card${active}" type="button" data-game-id="${game.id}">
          <strong>${game.awayTeam} @ ${game.homeTeam}</strong>
          <span>${formatDateTime(game.commenceTime)} · ${marketText} · ${game.source}</span>
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

function moneylineForTeam(game, team) {
  return game?.moneylines?.[normalizeName(team)] || null;
}

function mlbGameDateKey(game) {
  return String(game?.commenceTime || "").slice(0, 10);
}

function mlbMatchupDateKey(game) {
  return [
    normalizeName(game?.awayTeam),
    normalizeName(game?.homeTeam),
    mlbGameDateKey(game)
  ].join("@");
}

function mlbGameNumberLabel(game, games = slate) {
  const matchupKey = mlbMatchupDateKey(game);
  const sameMatchup = games
    .filter((candidate) => mlbMatchupDateKey(candidate) === matchupKey)
    .sort((a, b) => Date.parse(a.commenceTime || "") - Date.parse(b.commenceTime || ""));
  if (sameMatchup.length <= 1) return formatDateTime(game?.commenceTime);
  const index = sameMatchup.findIndex((candidate) => candidate.id === game.id);
  return `Game ${index + 1} · ${formatDateTime(game?.commenceTime)}`;
}

function mlbContextForGame(game) {
  if (game?.mlbContext) return game.mlbContext;
  const away = normalizeName(game.awayTeam);
  const home = normalizeName(game.homeTeam);
  return mlbMatchupData.find((item) => {
    const contextAway = normalizeName(item.awayTeam?.name || "");
    const contextHome = normalizeName(item.homeTeam?.name || "");
    return (contextAway === away && contextHome === home) ||
      (contextAway.includes(away) && contextHome.includes(home)) ||
      (away.includes(contextAway) && home.includes(contextHome));
  }) || null;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function pitcherQualityScore(pitcher) {
  if (!pitcher?.seasonStats) return null;
  const stats = pitcher.seasonStats;
  const ip = Number(stats.ip || 0);
  if (ip < 8) return null;
  const eraScore = clamp(100 - Number(stats.era || 5) * 10, 35, 92);
  const whipScore = clamp(115 - Number(stats.whip || 1.35) * 35, 35, 92);
  const hrPerNine = safeRate(Number(stats.hr || 0) * 9, ip);
  const hrScore = clamp(95 - hrPerNine * 22, 35, 92);
  const walkRate = safeRate(Number(stats.bb || 0), Number(stats.bf || 0));
  const walkScore = clamp(95 - walkRate * 320, 35, 92);
  return Math.round(eraScore * 0.34 + whipScore * 0.30 + hrScore * 0.22 + walkScore * 0.14);
}

function opposingPitcherWeaknessScore(pitcher) {
  const quality = pitcherQualityScore(pitcher);
  if (quality === null) return 55;
  return clamp(112 - quality, 38, 86);
}

function hitterOpsValue(hitter, pitcherHand) {
  const split = pitcherHand === "L" ? hitter.vsLeft : hitter.vsRight;
  return Number(split?.ops || hitter.seasonStats?.ops || 0);
}

function hitterRecentSlugValue(hitter) {
  return Number(hitter.recentStats?.slg || hitter.seasonStats?.slg || 0);
}

function offenseScoreForHitters(hitters = [], opposingPitcher) {
  const usable = hitters
    .filter((hitter) => Number(hitter.seasonStats?.pa || hitter.seasonStats?.ab || 0) >= 25)
    .sort((a, b) => Number(b.seasonStats?.ops || 0) - Number(a.seasonStats?.ops || 0))
    .slice(0, 9);
  if (!usable.length) return null;
  const avgOps = average(usable.map((hitter) => Number(hitter.seasonStats?.ops || 0)).filter(Boolean));
  const recentSlug = average(usable.map(hitterRecentSlugValue).filter(Boolean));
  const pitcherHand = opposingPitcher?.throws || "R";
  const splitOps = average(usable.map((hitter) => hitterOpsValue(hitter, pitcherHand)).filter(Boolean));
  return {
    offenseRecentForm: Math.round(clamp(46 + (recentSlug - 0.36) * 110 + (avgOps - 0.68) * 36, 38, 92)),
    lineupMatchup: Math.round(clamp(48 + (splitOps - 0.68) * 70 + (opposingPitcherWeaknessScore(opposingPitcher) - 55) * 0.35, 38, 92)),
    projectedRegulars: usable.length
  };
}

function fallbackOffenseScore(opposingPitcher) {
  const pitcherWeakness = opposingPitcherWeaknessScore(opposingPitcher);
  return {
    offenseRecentForm: Math.round(clamp(52 + (pitcherWeakness - 55) * 0.35, 42, 76)),
    lineupMatchup: Math.round(clamp(50 + (pitcherWeakness - 55) * 0.55, 40, 78)),
    projectedRegulars: 0,
    publicFallback: true
  };
}

function marketProbabilityScore(impliedProbability) {
  if (impliedProbability === null) return null;
  return clamp(impliedProbability * 100, 35, 85);
}

function mlbTravelRestScore(game, side) {
  const start = new Date(game.commenceTime || "");
  const hour = Number.isFinite(start.getTime()) ? start.getUTCHours() : 20;
  const dayGameOnRoad = hour < 18 && !side.isHome;
  return side.isHome ? 68 : dayGameOnRoad ? 52 : 58;
}

function scoreMlbMoneylineSide(game, side, context) {
  const moneyline = moneylineForTeam(game, side.team);
  const impliedProbability = americanOddsToProbability(moneyline?.odds);
  const contextSide = side.isHome ? "home" : "away";
  const opponentSide = side.isHome ? "away" : "home";
  const starter = context?.[`${contextSide}ProbablePitcher`] || null;
  const opposingStarter = context?.[`${opponentSide}ProbablePitcher`] || null;
  const hitters = context?.[`${contextSide}Hitters`] || [];
  const offense = offenseScoreForHitters(hitters, opposingStarter) || fallbackOffenseScore(opposingStarter);
  const metrics = {
    startingPitcher: pitcherQualityScore(starter),
    offenseRecentForm: offense?.offenseRecentForm ?? null,
    bullpenQuality: 58,
    lineupMatchup: offense?.lineupMatchup ?? null,
    injuries: offense?.projectedRegulars >= 7 ? 72 : offense?.projectedRegulars >= 5 ? 61 : 48,
    homeRoadSplit: side.isHome ? 68 : 56,
    bullpenRest: 58,
    marketProbability: marketProbabilityScore(impliedProbability),
    travelAndRest: mlbTravelRestScore(game, side)
  };
  const finalScore = calculateTeamScore(metrics);
  const disqualifiers = [];
  const riskFlags = [];

  if (!starter) disqualifiers.push({ label: "Probable starter missing", penalty: 100 });
  if (!opposingStarter) disqualifiers.push({ label: "Opponent probable starter missing", penalty: 100 });
  if (!moneyline) riskFlags.push("No sportsbook moneyline returned; ranked from public MLB matchup data only.");
  if (moneyline && !moneyline.selectedBookAvailable) riskFlags.push("Selected book was unavailable, so consensus odds were used.");
  if (offense?.publicFallback) riskFlags.push("Projected lineup stats were unavailable, so offense is estimated from pitcher matchup.");
  if (offense?.projectedRegulars && offense.projectedRegulars < 7) riskFlags.push("Projected lineup depth is thin; confirm starters before betting.");
  riskFlags.push("Bullpen workload, injuries, travel, and weather are still limited public-data estimates.");

  const components = [
    { key: "startingPitcher", label: "Starter", score: metrics.startingPitcher },
    { key: "offenseRecentForm", label: "Offense", score: metrics.offenseRecentForm },
    { key: "bullpenQuality", label: "Bullpen", score: metrics.bullpenQuality },
    { key: "lineupMatchup", label: "Lineup", score: metrics.lineupMatchup },
    { key: "injuries", label: "Health", score: metrics.injuries },
    { key: "homeRoadSplit", label: side.isHome ? "Home" : "Road", score: metrics.homeRoadSplit },
    { key: "bullpenRest", label: "BP Rest", score: metrics.bullpenRest },
    { key: "marketProbability", label: "Market", score: metrics.marketProbability },
    { key: "travelAndRest", label: "Schedule", score: metrics.travelAndRest }
  ].map((component) => ({ ...component, score: Number.isFinite(Number(component.score)) ? Number(component.score) : 50 }));

  return {
    type: "team",
    game,
    team: side.team,
    opponent: side.opponent,
    isHome: side.isHome,
    moneyline,
    finalScore,
    baseScore: finalScore,
    modelWinProbability: 0.5,
    impliedProbability,
    edge: null,
    tier: mlbMoneylineTier(finalScore, 0.5),
    blowoutScore: Math.round(clamp((finalScore - 52) * 2.2, 10, 90)),
    components,
    vegasRespect: {
      moneyPctAgainst: impliedProbability === null ? "--" : Math.round((1 - impliedProbability) * 100),
      lineMove: "TBD",
      isAgainst: false
    },
    disqualifiers,
    reasons: [],
    riskFlags,
    starterName: starter?.pitcherName || "TBD",
    opposingStarterName: opposingStarter?.pitcherName || "TBD",
    dataComplete: Boolean(starter && opposingStarter)
  };
}

function finalizeMlbMatchupPick(teamPick, opponentPick) {
  const matchupEdge = teamPick.finalScore - opponentPick.finalScore;
  const pureModelProbability = clamp(0.5 + matchupEdge / 180 + (teamPick.isHome ? 0.015 : -0.005), 0.38, 0.72);
  const modelWinProbability = teamPick.impliedProbability === null
    ? pureModelProbability
    : clamp(teamPick.impliedProbability * 0.45 + pureModelProbability * 0.55, 0.40, 0.74);
  const edge = teamPick.impliedProbability === null ? null : modelWinProbability - teamPick.impliedProbability;
  const fairOdds = fairAmericanOddsFromProbability(modelWinProbability);
  const playableThrough = playableMoneylineFromProbability(modelWinProbability);
  const reasons = [...teamPick.components]
    .filter((component) => component.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((component) => {
      if (component.key === "startingPitcher") return `Starting-pitching edge with ${teamPick.starterName}`;
      if (component.key === "lineupMatchup") return `Better matchup against ${teamPick.opposingStarterName}`;
      if (component.key === "offenseRecentForm") return "Stronger recent offensive form";
      if (component.key === "homeRoadSplit") return teamPick.isHome ? "Home-field edge" : "Road profile held up";
      if (component.key === "marketProbability") return "Moneyline market supports this side";
      return `${component.label} advantage`;
    });

  return {
    ...teamPick,
    matchupEdge,
    modelWinProbability,
    edge,
    fairOdds,
    playableThrough,
    tier: mlbMoneylineTier(teamPick.finalScore, modelWinProbability),
    reasons
  };
}

function mlbMoneylinePassReasons(pick) {
  const reasons = [];
  if (!pick.dataComplete) reasons.push("probable starter data missing");
  if (pick.finalScore < MLB_MONEYLINE_RULES.minimumTeamScore) reasons.push("team score below threshold");
  if (pick.modelWinProbability < MLB_MONEYLINE_RULES.minimumWinProbability) reasons.push("win probability below official-card threshold");
  if (pick.matchupEdge < MLB_MONEYLINE_RULES.minimumMatchupEdge) reasons.push("matchup edge is thin");
  if (pick.moneyline?.odds && pick.playableThrough < 0 && Number(pick.moneyline.odds) < pick.playableThrough) {
    reasons.push("sportsbook price is worse than playable range");
  }
  return reasons;
}

function buildMlbMoneylineContenders(games = slate) {
  const allSides = [];

  games.forEach((game) => {
    const context = mlbContextForGame(game);
    const homePick = scoreMlbMoneylineSide(game, { team: game.homeTeam, opponent: game.awayTeam, isHome: true }, context);
    const awayPick = scoreMlbMoneylineSide(game, { team: game.awayTeam, opponent: game.homeTeam, isHome: false }, context);
    allSides.push(
      finalizeMlbMatchupPick(homePick, awayPick),
      finalizeMlbMatchupPick(awayPick, homePick)
    );
  });

  const sortMlbTeamPicks = (a, b) => {
    if (b.modelWinProbability !== a.modelWinProbability) return b.modelWinProbability - a.modelWinProbability;
    if (b.matchupEdge !== a.matchupEdge) return b.matchupEdge - a.matchupEdge;
    return b.finalScore - a.finalScore;
  };

  const contenders = allSides
    .map((pick) => {
      const passReasons = mlbMoneylinePassReasons(pick);
      const qualifies = pick.dataComplete &&
        pick.finalScore >= MLB_MONEYLINE_RULES.minimumTeamScore &&
        pick.modelWinProbability >= MLB_MONEYLINE_RULES.minimumWinProbability &&
        pick.matchupEdge >= MLB_MONEYLINE_RULES.minimumMatchupEdge &&
        pick.tier.tier > 0;
      const backfillEligible = pick.dataComplete &&
        pick.finalScore >= 48 &&
        pick.modelWinProbability >= 0.50 &&
        pick.matchupEdge > 0;
      return {
        ...pick,
        gameLabel: mlbGameNumberLabel(pick.game, games),
        passReasons,
        qualifies,
        backfillEligible
      };
    })
    .sort(sortMlbTeamPicks);

  const gameWinners = [];
  const usedGameWinners = new Set();
  contenders.forEach((pick) => {
    if (usedGameWinners.has(pick.game.id)) return;
    usedGameWinners.add(pick.game.id);
    gameWinners.push(pick);
  });

  return { contenders, gameWinners, sortMlbTeamPicks };
}

function scoreMlbMoneylineBoard(games = slate) {
  const { contenders, gameWinners, sortMlbTeamPicks } = buildMlbMoneylineContenders(games);
  const officialContenders = contenders.filter((pick) => pick.qualifies);
  const backfillContenders = contenders.filter((pick) => pick.backfillEligible);

  officialContenders.sort(sortMlbTeamPicks);
  backfillContenders.sort(sortMlbTeamPicks);

  const picks = [];
  const usedGames = new Set();
  const usedMatchups = new Set();
  const usedTeams = new Set();

  const addUniquePick = (pick, isBackfill = false) => {
    const teamKey = normalizeName(pick.team);
    const matchupKey = [
      normalizeName(pick.game.awayTeam),
      normalizeName(pick.game.homeTeam),
      String(pick.game.commenceTime || "").slice(0, 10)
    ].join("@");
    if (usedGames.has(pick.game.id) || usedMatchups.has(matchupKey) || usedTeams.has(teamKey)) return false;
    picks.push(isBackfill ? {
      ...pick,
      tier: pick.tier.tier > 0 ? pick.tier : { tier: 3, label: "Best Available" },
      isBackfill: true,
      riskFlags: [
        "Backfilled as the next-best unique team after duplicate teams were removed; treat as lower confidence.",
        ...(pick.riskFlags || [])
      ]
    } : pick);
    usedGames.add(pick.game.id);
    usedMatchups.add(matchupKey);
    usedTeams.add(teamKey);
    return true;
  };

  for (const pick of officialContenders) {
    addUniquePick(pick);
    if (picks.length >= 3) break;
  }

  if (picks.length < 3) {
    for (const pick of backfillContenders) {
      addUniquePick(pick, true);
      if (picks.length >= 3) break;
    }
  }

  const officialKeys = new Set(picks.map((pick) => `${normalizeName(pick.team)}:${pick.game.id}`));
  const leans = gameWinners
    .filter((pick) => !officialKeys.has(`${normalizeName(pick.team)}:${pick.game.id}`))
    .filter((pick) => pick.backfillEligible || pick.qualifies)
    .slice(0, 6);
  const passes = gameWinners
    .filter((pick) => !officialKeys.has(`${normalizeName(pick.team)}:${pick.game.id}`))
    .filter((pick) => !pick.backfillEligible && !pick.qualifies)
    .slice(0, 8);

  return { picks, leans, passes, gameWinners };
}

function scoreMlbTeams(games = slate) {
  return scoreMlbMoneylineBoard(games).picks;
}

// ── Home Run Board — public MLB data engine (v2) ─────────────────────────────

const HR_BASELINES = {
  hitterHrPerPa:           0.032,
  hitterIso:               0.155,
  hitterSlugging:          0.410,
  hitterOps:               0.725,
  extraBaseHitPerPa:       0.075,
  pitcherHrPerNine:        1.15,
  pitcherHrPerBf:          0.032,
  pitcherOppSlugging:      0.410,
  bullpenHrPerNine:        1.10,
  gameTotal:               8.5,
};

const HR_CONFIG = {
  minimumSeasonPa:         60,
  minimumPitcherInnings:   15,
  minimumScore:            53,
  boardSelections:         3,
  requireUniqueGames:      true,
};

function hrSafeRate(num, den) {
  return (Number.isFinite(num) && Number.isFinite(den) && den > 0) ? num / den : 0;
}

function hrRegressRate(observed, sample, leagueRate, stabilization) {
  const w = sample / (sample + stabilization);
  return observed * w + leagueRate * (1 - w);
}

function hrScoreAgainstBaseline(value, baseline, lo = 0.45, hi = 1.8) {
  const min = baseline * lo, max = baseline * hi;
  if (max === min) return 50;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function hrWeightedAvg(pairs) {
  const valid = pairs.filter(([v, w]) => Number.isFinite(v) && w > 0);
  const tw = valid.reduce((s, [, w]) => s + w, 0);
  if (!tw) return 50;
  return valid.reduce((s, [v, w]) => s + v * w, 0) / tw;
}

function hrLineupScore(pos) {
  return { 1: 94, 2: 100, 3: 100, 4: 99, 5: 91, 6: 78, 7: 64, 8: 51, 9: 42 }[pos] ?? 55;
}

function hrScoreToProb(score) {
  return clamp(0.055 + (score / 100) ** 1.70 * (0.34 - 0.055), 0.055, 0.34);
}

function hrValidRealPlayer(id, name) {
  if (!id || !name) return false;
  const n = name.trim();
  if (n.length < 4 || n.split(/\s+/).length < 2) return false;
  return !/\b(bat|batter|hitter|player)\s*\d+\b|\bunknown\b|\btbd\b/i.test(n);
}

// ── Public-data hitter scorer ─────────────────────────────────────────────────

function hrScoreHitter(h) {
  const { seasonStats: s, recentStats: r, split } = h;

  const seasonHrPerPa = hrSafeRate(s.hr, s.pa);
  const seasonIso     = Math.max(0, s.slg - s.avg);
  const seasonXbhRate = hrSafeRate((s.doubles || 0) + (s.triples || 0) + s.hr, s.pa);

  const recentHrRate  = hrRegressRate(hrSafeRate(r.hr, r.pa), r.pa, HR_BASELINES.hitterHrPerPa, 40);
  const recentIso     = Math.max(0, r.slg - hrSafeRate(r.hits, r.ab));

  const splitHrRate   = hrRegressRate(hrSafeRate(split.hr, split.pa), split.pa, HR_BASELINES.hitterHrPerPa, 80);
  const splitIso      = Math.max(0, split.slg - split.avg);

  const score = hrWeightedAvg([
    [hrScoreAgainstBaseline(seasonHrPerPa,  HR_BASELINES.hitterHrPerPa),                  24],
    [hrScoreAgainstBaseline(seasonIso,      HR_BASELINES.hitterIso),                       18],
    [hrScoreAgainstBaseline(s.slg,          HR_BASELINES.hitterSlugging, 0.65, 1.45),      10],
    [hrScoreAgainstBaseline(s.ops,          HR_BASELINES.hitterOps,      0.65, 1.45),       7],
    [hrScoreAgainstBaseline(seasonXbhRate,  HR_BASELINES.extraBaseHitPerPa),                8],
    [hrScoreAgainstBaseline(recentHrRate,   HR_BASELINES.hitterHrPerPa),                   10],
    [hrScoreAgainstBaseline(recentIso,      HR_BASELINES.hitterIso),                        6],
    [hrScoreAgainstBaseline(splitHrRate,    HR_BASELINES.hitterHrPerPa),                    7],
    [hrScoreAgainstBaseline(splitIso,       HR_BASELINES.hitterIso),                        6],
    [hrLineupScore(h.battingOrder),                                                          4],
  ]);

  const reasons = [];
  if (seasonHrPerPa >= 0.045) reasons.push(`${(seasonHrPerPa * 100).toFixed(1)}% HR/PA this season`);
  if (seasonIso >= 0.220)     reasons.push(`${seasonIso.toFixed(3)} isolated power`);
  if (s.slg >= 0.475)         reasons.push(`${s.slg.toFixed(3)} slugging pct`);
  if (recentHrRate >= 0.05)   reasons.push(`${r.hr} HR over last ${r.games || 15} games`);
  if (splitIso >= 0.210)      reasons.push(`Power edge vs ${h.pitcherHand}HP — ${split.pa}PA split`);
  if (h.battingOrder && h.battingOrder <= 5) reasons.push(`Batting ${h.battingOrder}`);

  return { score: clamp(score, 0, 100), reasons };
}

// ── Public-data pitcher scorer ────────────────────────────────────────────────

function hrScorePitcher(p) {
  const { seasonStats: s } = p;
  const hr9   = hrSafeRate(s.hr * 9, s.ip);
  const hrPbf = hrSafeRate(s.hr, s.bf);
  const oppSlg = s.oppSlg || HR_BASELINES.pitcherOppSlugging;

  const score = hrWeightedAvg([
    [hrScoreAgainstBaseline(hr9,    HR_BASELINES.pitcherHrPerNine),         30],
    [hrScoreAgainstBaseline(hrPbf,  HR_BASELINES.pitcherHrPerBf),           17],
    [hrScoreAgainstBaseline(oppSlg, HR_BASELINES.pitcherOppSlugging, 0.65, 1.45), 17],
    [clamp(((p.expectedInnings ?? 5.2) / 6.5) * 100, 25, 100),              5],
  ]);

  const reasons = [];
  if (hr9 >= 1.35)   reasons.push(`Pitcher allows ${hr9.toFixed(2)} HR/9`);
  if (oppSlg >= 0.44) reasons.push(`Opponents slug ${oppSlg.toFixed(3)}`);

  return { score: clamp(score, 0, 100), reasons };
}

// ── Environment scorer ────────────────────────────────────────────────────────

function hrScoreEnvironment(env, isHomeHitter) {
  const temp      = env.temperatureF  ?? 72;
  const wind      = env.windSpeedMph  ?? 0;
  const windOut   = env.windOutFactor ?? 0;
  const total     = env.gameTotal     ?? HR_BASELINES.gameTotal;
  const bullpen   = isHomeHitter ? env.awayBullpenHr9 : env.homeBullpenHr9;

  const parkScore  = clamp(50 + (env.parkFactor - 1) * 250, 10, 100);
  const tempScore  = clamp(50 + (temp - 72) * 1.6, 15, 100);
  const windScore  = windOut > 0 ? clamp(50 + wind * 3, 20, 100)
                   : windOut < 0 ? clamp(50 - wind * 3, 0, 65) : 50;
  const totalScore = clamp(50 + (total - HR_BASELINES.gameTotal) * 12, 10, 100);
  const bullScore  = bullpen != null
    ? hrScoreAgainstBaseline(bullpen, HR_BASELINES.bullpenHrPerNine, 0.55, 1.7) : 50;

  const score = parkScore * 0.35 + tempScore * 0.17 + windScore * 0.20 + totalScore * 0.13 + bullScore * 0.15;

  const reasons = [];
  if (env.parkFactor >= 1.08)        reasons.push("Hitter-friendly HR park");
  if (temp >= 80)                    reasons.push(`${Math.round(temp)}°F at first pitch`);
  if (windOut > 0 && wind >= 8)      reasons.push(`${Math.round(wind)} mph blowing out`);
  if (total >= 9.0)                  reasons.push(`${total.toFixed(1)}-run game total`);
  if (bullpen != null && bullpen >= 1.25) reasons.push("Opposing bullpen vulnerable to HR");

  return { score: clamp(score, 0, 100), reasons };
}

// ── Candidate builder ─────────────────────────────────────────────────────────

function buildHrCandidate(hitter, pitcher, env, bestOdds) {
  const h = hrScoreHitter(hitter);
  const p = hrScorePitcher(pitcher);
  const e = hrScoreEnvironment(env, hitter.teamId === env.homeTeamId);

  let score = h.score * 0.45 + p.score * 0.30 + e.score * 0.15;

  const warnings = [];
  if (!hitter.confirmedStarter)  { warnings.push("Lineup not confirmed"); score -= 6; }
  if (!pitcher.confirmed)        { warnings.push("Starter not confirmed"); score -= 10; }
  if (hitter.battingOrder != null && hitter.battingOrder >= 7) { warnings.push("Lower lineup spot"); score -= 3; }
  if (hitter.seasonStats.pa < HR_CONFIG.minimumSeasonPa) { warnings.push("Limited season sample"); score -= 4; }
  if (pitcher.seasonStats.ip < HR_CONFIG.minimumPitcherInnings) { warnings.push("Limited pitcher sample"); score -= 4; }

  // Sportsbook confirmation (5% weight boost / drag)
  const odds = bestOdds ?? null;
  const impliedProb = odds != null ? americanOddsToProbability(odds) : null;
  if (impliedProb != null) {
    const mktScore = clamp(impliedProb * 500, 0, 100);
    score = score * 0.95 + mktScore * 0.05;
  }

  score = clamp(score, 0, 100);
  const prob = hrScoreToProb(score);
  const edge = impliedProb != null ? prob - impliedProb : null;
  const confidence = score >= 74 && hitter.confirmedStarter && pitcher.confirmed ? "HIGH"
                   : score >= 62 ? "MEDIUM" : "LOW";

  return {
    gamePk:       hitter.gamePk,
    playerId:     hitter.playerId,
    playerName:   hitter.playerName,
    teamName:     hitter.teamName,
    opponentName: hitter.opponentName,
    pitcherName:  pitcher.pitcherName,
    pitcherHand:  pitcher.throws,
    battingOrder: hitter.battingOrder,
    seasonHr:     hitter.seasonStats.hr,
    score:        Number(score.toFixed(1)),
    probability:  Number(prob.toFixed(4)),
    confidence,
    odds,
    impliedProb,
    edge,
    reasons:      [...h.reasons, ...p.reasons, ...e.reasons].slice(0, 6),
    warnings,
  };
}

// ── Board generator ───────────────────────────────────────────────────────────

function generatePublicHrBoard(serverGames, oddsPayloads = []) {
  const candidates = [];

  // Index Odds API HR props by normalised player name for odds lookup
  const hrPriceMap = new Map();
  for (const payload of oddsPayloads) {
    for (const bm of (payload.bookmakers || [])) {
      for (const mkt of (bm.markets || [])) {
        if (mkt.key !== "batter_home_runs") continue;
        for (const out of (mkt.outcomes || [])) {
          const key = normalizeName(out.name || "");
          if (key && Number.isFinite(Number(out.price))) {
            const existing = hrPriceMap.get(key);
            if (!existing || Math.abs(Number(out.price)) < Math.abs(existing)) {
              hrPriceMap.set(key, Number(out.price));
            }
          }
        }
      }
    }
  }

  for (const game of serverGames) {
    const homePitcher = game.homeProbablePitcher;
    const awayPitcher = game.awayProbablePitcher;

    // Park factor from existing lookup
    const homeAbbr = (() => {
      const n = normalizeName(game.homeTeam?.name || "");
      for (const [abbr, alias] of Object.entries(teamAliases)) {
        if (alias === n) return abbr.toUpperCase();
      }
      return "";
    })();

    const env = {
      gamePk:         game.gamePk,
      homeTeamId:     game.homeTeam?.id,
      awayTeamId:     game.awayTeam?.id,
      parkFactor:     parkHRFactors[homeAbbr] || 1.0,
      gameTotal:      null,   // TODO: wire Odds API totals
      temperatureF:   null,
      windSpeedMph:   null,
      windOutFactor:  null,
      homeBullpenHr9: null,
      awayBullpenHr9: null,
    };

    const scoreOneSide = (hitters, facingPitcher, opponentTeam) => {
      if (!facingPitcher) return;
      for (const h of hitters) {
        if (!hrValidRealPlayer(h.playerId, h.playerName)) continue;

        const pitcherHand = facingPitcher.throws || "R";
        const split = (pitcherHand === "L" ? h.vsLeft : h.vsRight) || {};

        const profile = {
          ...h,
          gamePk:       game.gamePk,
          teamName:     (h.teamId === game.homeTeam?.id ? game.homeTeam : game.awayTeam)?.name || "",
          opponentName: opponentTeam?.name || "",
          pitcherHand,
          split: {
            pa:  split.pa  || 0,
            ab:  split.ab  || 0,
            hits:split.hits|| 0,
            doubles: split.doubles || 0,
            triples: split.triples || 0,
            hr:  split.hr  || 0,
            avg: split.avg || 0,
            slg: split.slg || 0,
            ops: split.ops || 0,
          },
        };

        const bestOdds = hrPriceMap.get(normalizeName(h.playerName)) ?? null;
        const candidate = buildHrCandidate(profile, facingPitcher, env, bestOdds);

        if (candidate.score >= HR_CONFIG.minimumScore) candidates.push(candidate);
      }
    };

    scoreOneSide(game.homeHitters || [], awayPitcher, game.awayTeam);
    scoreOneSide(game.awayHitters || [], homePitcher, game.homeTeam);
  }

  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.05) return b.score - a.score;
    if (Math.abs(b.probability - a.probability) > 0.0005) return b.probability - a.probability;
    return (b.edge ?? -1) - (a.edge ?? -1);
  });

  const selections = [];
  const usedGames  = new Set();
  const usedPlayers = new Set();

  for (const c of candidates) {
    if (HR_CONFIG.requireUniqueGames && usedGames.has(c.gamePk)) continue;
    if (usedPlayers.has(c.playerId)) continue;
    selections.push({ ...c, rank: selections.length + 1 });
    usedGames.add(c.gamePk);
    usedPlayers.add(c.playerId);
    if (selections.length >= HR_CONFIG.boardSelections) break;
  }

  const usedIds = new Set(selections.map((s) => s.playerId));
  const alternates = candidates
    .filter((c) => !usedIds.has(c.playerId))
    .slice(0, 5)
    .map((c, i) => ({ ...c, rank: selections.length + 1 + i }));

  const allLineupsConfirmed = selections.every((s) => !s.warnings.includes("Lineup not confirmed"));
  const hasLivePrices = selections.some((s) => s.odds != null);

  const status = selections.length < HR_CONFIG.boardSelections ? "INSUFFICIENT_MATCHUPS"
    : allLineupsConfirmed ? "FINAL" : "PROVISIONAL";

  return { status, selections, alternates, hasLivePrices };
}

// ── Async public-data fetcher + board builder ─────────────────────────────────

async function fetchMlbHrBoardData(date) {
  if (window.location.protocol === "file:") return { games: [] };
  const url = new URL("/api/mlb/hr-board-data", window.location.origin);
  url.searchParams.set("date", date);
  return fetchJson(url);
}

async function ensureMlbMatchupData(date) {
  if (elements.sportKey.value !== "baseball_mlb") return [];
  if (mlbMatchupDataDate === date && mlbMatchupData.length) return mlbMatchupData;
  try {
    const payload = await fetchMlbHrBoardData(date);
    mlbMatchupData = payload.games || [];
    mlbMatchupDataDate = date;
  } catch (error) {
    console.warn("MLB matchup context failed", error);
    mlbMatchupData = [];
    mlbMatchupDataDate = date;
  }
  return mlbMatchupData;
}

let _hrBoardPromise = null;
let _hrBoardDate    = null;

async function buildPublicHrBoard(date) {
  if (_hrBoardDate === date && _hrBoardPromise) return _hrBoardPromise;
  _hrBoardDate = date;
  _hrBoardPromise = fetchMlbHrBoardData(date).then((data) => {
    const oddsPayloads = (slate || []).flatMap((g) =>
      (g.candidates || []).length ? [{ bookmakers: g.candidates.map((c) => ({ markets: [{ key: c.market, outcomes: [{ name: c.player, price: c.overOdds ?? c.odds }] }] })) }] : []
    );
    return generatePublicHrBoard(data.games || [], oddsPayloads);
  });
  return _hrBoardPromise;
}

function scoreMlbHomeRunBats() { return []; }  // retired; board is now async

// ── No Run Inning Board v3 — inning projection engine ───────────────────────

const NO_RUN_RULES = {
  fullReliabilityStarts:   15,
  pitcherWeight:           0.65,
  offenseWeight:           0.35,
  // Ticket thresholds
  singleLegStrong:         0.70,
  singleLegPlayable:       0.65,
  singleLegLean:           0.60,
  pairQualifyThreshold:    0.42,   // combined 2-leg probability
  primaryQualifyThreshold: 0.29,   // combined 3-leg probability (1 per game)
  minInningProbability:    0.55,   // per-inning minimum to enter pair selection
};

// ── Normalize helpers ────────────────────────────────────────────────────────

function nriNormalizeInverse(value, strongValue, weakValue) {
  return clamp((weakValue - value) / (weakValue - strongValue), 0, 1);
}

function nriNormalizePositive(value, weakValue, strongValue) {
  return clamp((value - weakValue) / (strongValue - weakValue), 0, 1);
}

// ── Profile builders ─────────────────────────────────────────────────────────

function buildNriPitcherProfile(game, isAway) {
  const seed = `${game.id}-${isAway ? "away" : "home"}-pitcher`;
  return {
    name:               isAway ? game.awayTeam : game.homeTeam,
    throwingHand:       deterministicNumber(`${seed}-hand`, 0, 1) > 0.5 ? "R" : "L",
    strikeoutRate:      deterministicNumber(`${seed}-krt`,  0.18, 0.30),
    walkRate:           deterministicNumber(`${seed}-bbrt`, 0.05, 0.12),
    strikePercentage:   deterministicNumber(`${seed}-strk`, 0.60, 0.69),
    whip:               deterministicNumber(`${seed}-whip`, 1.00, 1.40),
    era:                deterministicNumber(`${seed}-era`,  3.00, 5.00),
    averageStartLength: deterministicNumber(`${seed}-asl`,  4.5,  6.5),
    confirmed:          true,
  };
}

function buildNriOffenseProfile(game, isAway) {
  const seed = `${game.id}-${isAway ? "away" : "home"}-offense`;
  return {
    teamName:          isAway ? game.awayTeam : game.homeTeam,
    onBasePercentage:  deterministicNumber(`${seed}-obp`,  0.290, 0.360),
    woba:              deterministicNumber(`${seed}-woba`, 0.295, 0.365),
    strikeoutRate:     deterministicNumber(`${seed}-krt`,  0.19,  0.28),
    isolatedPower:     deterministicNumber(`${seed}-iso`,  0.12,  0.20),
    runsPerFirstFive:  deterministicNumber(`${seed}-rp5`,  1.8,   3.1),
    wobaVsLeft:        deterministicNumber(`${seed}-wobl`, 0.290, 0.365),
    wobaVsRight:       deterministicNumber(`${seed}-wobr`, 0.290, 0.365),
    firstInningRunRate: deterministicNumber(`${seed}-fir`, 0.22,  0.40),
  };
}

function nriParkRunFactor(game) {
  const homeAbbr = (() => {
    const n = normalizeName(game.homeTeam || "");
    for (const [abbr, alias] of Object.entries(teamAliases)) {
      if (alias === n) return abbr.toUpperCase();
    }
    return "";
  })();
  return parkHRFactors[homeAbbr] || 1.0;  // HR park factor used directly
}

// ── Pitcher quality score (0–1) ───────────────────────────────────────────────

function nriPitcherQuality(pitcher) {
  if (!pitcher.confirmed) return 0.50;
  const kScore   = nriNormalizePositive(pitcher.strikeoutRate, 0.16, 0.32);
  const bbScore  = nriNormalizeInverse(pitcher.walkRate,       0.05, 0.13);
  const whipSc   = nriNormalizeInverse(pitcher.whip,          0.95, 1.45);
  const eraSc    = nriNormalizeInverse(pitcher.era,           3.00, 5.00);
  const strSc    = nriNormalizePositive(pitcher.strikePercentage, 0.60, 0.69);
  return clamp(kScore * 0.30 + bbScore * 0.15 + whipSc * 0.25 + eraSc * 0.20 + strSc * 0.10, 0, 1);
}

// ── Offense run risk (0–1, higher = more likely to score) ─────────────────────

function nriOffenseRunRisk(offense, pitcherHand) {
  const splitWoba = pitcherHand === "L" ? offense.wobaVsLeft : offense.wobaVsRight;
  const wobaSc    = nriNormalizePositive(splitWoba,          0.290, 0.380);
  const obpSc     = nriNormalizePositive(offense.onBasePercentage, 0.295, 0.365);
  const isoSc     = nriNormalizePositive(offense.isolatedPower, 0.115, 0.215);
  const kSc       = nriNormalizeInverse(offense.strikeoutRate, 0.18, 0.29);  // low K = more contact
  const runSc     = nriNormalizePositive(offense.runsPerFirstFive, 1.7, 3.2);
  return clamp(wobaSc * 0.30 + obpSc * 0.25 + isoSc * 0.15 + kSc * 0.15 + runSc * 0.15, 0, 1);
}

// ── Per-game inning projections ───────────────────────────────────────────────

function buildNriGameInputs(awayPitcher, homePitcher, awayOffense, homeOffense, parkFactor) {
  const spFirst  = (nriPitcherQuality(awayPitcher) + nriPitcherQuality(homePitcher)) / 2;
  // Second-time-through penalty: pitchers become more hittable
  const spSecond = clamp(spFirst - 0.08 - Math.max(0, 5.5 - ((awayPitcher.averageStartLength + homePitcher.averageStartLength) / 2)) * 0.04, 0.25, 0.95);

  const awayHand = awayPitcher.throwingHand;
  const homeHand = homePitcher.throwingHand;

  // Run risk per order position (averaged over both half-innings)
  const topRisk    = (nriOffenseRunRisk(awayOffense, homeHand) + nriOffenseRunRisk(homeOffense, awayHand)) / 2;
  const middleRisk = topRisk * 0.92;   // middle order slightly less dangerous than top
  const bottomRisk = topRisk * 0.80;   // bottom order weakest

  return {
    startingPitcherFirstTimeThroughScore:  spFirst,
    startingPitcherSecondTimeThroughScore: spSecond,
    topOfOrderRunRisk:    topRisk,
    middleOrderRunRisk:   middleRisk,
    bottomOrderRunRisk:   bottomRisk,
    homeTeamFirstInningRunRate: homeOffense.firstInningRunRate,
    awayTeamFirstInningRunRate: awayOffense.firstInningRunRate,
    bullpenRunPreventionScore:  0.65,   // placeholder until bullpen feed connected
    parkRunFactor: parkFactor,
    weatherRunFactor: 0,
  };
}

function buildInningProjections(inputs) {
  const envPenalty = (inputs.parkRunFactor - 1) * 0.08 + inputs.weatherRunFactor;

  return [1, 2, 3, 4, 5].map((inning) => {
    let runProb;
    const reasons = [];

    if (inning === 1) {
      runProb =
        inputs.topOfOrderRunRisk * 0.55 +
        inputs.homeTeamFirstInningRunRate * 0.225 +
        inputs.awayTeamFirstInningRunRate * 0.225;
      reasons.push("Top of both batting orders");
    } else if (inning === 2) {
      runProb =
        inputs.middleOrderRunRisk * 0.65 +
        (1 - inputs.startingPitcherFirstTimeThroughScore) * 0.35;
      reasons.push("Middle-order matchup");
    } else if (inning === 3) {
      runProb =
        inputs.bottomOrderRunRisk * 0.55 +
        inputs.topOfOrderRunRisk * 0.15 +
        (1 - inputs.startingPitcherFirstTimeThroughScore) * 0.30;
      reasons.push("Bottom order + lineup turnover");
    } else if (inning === 4) {
      runProb =
        inputs.middleOrderRunRisk * 0.45 +
        (1 - inputs.startingPitcherSecondTimeThroughScore) * 0.55;
      reasons.push("Second time through the order");
    } else {
      runProb =
        inputs.topOfOrderRunRisk * 0.45 +
        (1 - inputs.startingPitcherSecondTimeThroughScore) * 0.40 +
        (1 - inputs.bullpenRunPreventionScore) * 0.15;
      reasons.push("Late starter exposure + bullpen risk");
    }

    runProb = clamp(runProb + envPenalty, 0.18, 0.55);
    const noRunProb = 1 - runProb;
    return {
      inning,
      noRunProbability: noRunProb,
      confidenceScore:  Math.round(noRunProb * 100),
      reasons,
    };
  });
}

// ── Best 2-inning pair within a game ─────────────────────────────────────────

function selectSafestInningPair(projections) {
  const eligible = projections
    .filter((p) => p.inning >= 1 && p.inning <= 5 && p.noRunProbability >= NO_RUN_RULES.minInningProbability)
    .sort((a, b) => b.noRunProbability - a.noRunProbability);

  if (eligible.length < 2) return null;

  let best = null;
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i], b = eligible[j];
      const combinedProbability = a.noRunProbability * b.noRunProbability;
      const pairScore = a.confidenceScore * 0.5 + b.confidenceScore * 0.5;
      const candidate = {
        innings: [a.inning, b.inning],
        combinedProbability,
        pairScore,
        legs: [
          { inning: a.inning, noRunProbability: a.noRunProbability, score: a.confidenceScore },
          { inning: b.inning, noRunProbability: b.noRunProbability, score: b.confidenceScore },
        ],
        reasons: [...a.reasons, ...b.reasons].slice(0, 5),
      };
      if (!best || candidate.combinedProbability > best.combinedProbability) best = candidate;
    }
  }
  return best;
}

function probabilityToAmericanOdds(p) {
  const v = clamp(p, 0.0001, 0.9999);
  return v >= 0.5
    ? Math.round((-100 * v) / (1 - v))
    : Math.round((100 * (1 - v)) / v);
}

// ── Board generator ───────────────────────────────────────────────────────────

function generateNoRunBoard(games) {
  const scored = games.filter((g) => g.id).map((game) => {
    const awayPit = buildNriPitcherProfile(game, true);
    const homePit = buildNriPitcherProfile(game, false);
    const awayOff = buildNriOffenseProfile(game, true);
    const homeOff = buildNriOffenseProfile(game, false);
    const inputs  = buildNriGameInputs(awayPit, homePit, awayOff, homeOff, nriParkRunFactor(game));
    const projections = buildInningProjections(inputs);
    const sorted  = [...projections].sort((a, b) => b.noRunProbability - a.noRunProbability);
    const bestInning = sorted[0];
    const bestPair   = selectSafestInningPair(projections);
    return {
      gameId:   game.id,
      matchup:  `${game.awayTeam} @ ${game.homeTeam}`,
      projections,
      bestInning,
      bestPair,
    };
  }).filter((g) => g.bestInning).sort((a, b) => b.bestInning.noRunProbability - a.bestInning.noRunProbability);

  // ── 1. Best single leg ────────────────────────────────────────────────────
  const topGame = scored[0];
  const bestSingleLeg = topGame ? (() => {
    const p = topGame.bestInning.noRunProbability;
    return {
      matchup:          topGame.matchup,
      inning:           topGame.bestInning.inning,
      noRunProbability: p,
      score:            topGame.bestInning.confidenceScore,
      reasons:          topGame.bestInning.reasons,
      status: p >= NO_RUN_RULES.singleLegStrong   ? "STRONG"
            : p >= NO_RUN_RULES.singleLegPlayable ? "PLAYABLE"
            : p >= NO_RUN_RULES.singleLegLean     ? "LEAN" : "PASS",
    };
  })() : null;

  // ── 2. Safer 2-leg ticket (best pair from the single best qualifying game) ─
  const pairGame = scored.find((g) => g.bestPair !== null);
  const saferTicket = pairGame ? {
    matchup:             pairGame.matchup,
    innings:             pairGame.bestPair.innings,
    legs:                pairGame.bestPair.legs,
    combinedProbability: pairGame.bestPair.combinedProbability,
    pairScore:           Math.round(pairGame.bestPair.pairScore),
    reasons:             pairGame.bestPair.reasons,
    status: pairGame.bestPair.combinedProbability >= NO_RUN_RULES.pairQualifyThreshold ? "QUALIFIED" : "PASS",
  } : null;

  // ── 3. Primary 3-leg (one best inning per game, 3 games) ─────────────────
  const primaryLegs = scored.slice(0, 3).map((g) => ({
    matchup:          g.matchup,
    inning:           g.bestInning.inning,
    noRunProbability: g.bestInning.noRunProbability,
    score:            g.bestInning.confidenceScore,
  }));
  const primaryProb = primaryLegs.reduce((acc, l) => acc * l.noRunProbability, 1);
  const primaryTicket = primaryLegs.length >= 3 ? {
    legs:                primaryLegs,
    combinedProbability: primaryProb,
    status: primaryProb >= NO_RUN_RULES.primaryQualifyThreshold ? "QUALIFIED" : "PASS",
  } : null;

  return { bestSingleLeg, saferTicket, primaryTicket };
}

// ── Render helpers ────────────────────────────────────────────────────────────

function nriStatusClass(status) {
  return { STRONG: "nri-strong", PLAYABLE: "nri-playable", LEAN: "nri-lean", QUALIFIED: "nri-playable", PASS: "nri-pass" }[status] || "nri-pass";
}

function nriOddsStr(prob) {
  const o = probabilityToAmericanOdds(prob);
  return o > 0 ? `+${o}` : `${o}`;
}

function renderNriSingleLeg(leg) {
  if (!leg) return "";
  const sc = nriStatusClass(leg.status);
  const probCls = leg.noRunProbability >= 0.70 ? "high" : leg.noRunProbability >= 0.60 ? "mid" : "low";
  return `
    <div class="nri-ticket ${sc}">
      <div class="nri-header">
        <strong>Best Single Inning</strong>
        <span class="nri-rec ${sc}">${leg.status}</span>
      </div>
      <div class="nri-meta">
        <span>Hit rate <strong>${(leg.noRunProbability * 100).toFixed(0)}%</strong></span>
        <span>Fair odds <strong>${nriOddsStr(leg.noRunProbability)}</strong></span>
        <span><strong>1</strong> leg</span>
      </div>
      <div class="nri-legs">
        <div class="nri-leg">
          <span class="nri-badge">Inn. ${leg.inning}</span>
          <span class="nri-leg-match">${escapeHtml(leg.matchup)}</span>
          <span class="nri-leg-score">${leg.score}/100</span>
          <span class="nri-leg-prob ${probCls}">${(leg.noRunProbability * 100).toFixed(0)}%</span>
        </div>
        ${leg.reasons.map((r) => `<p class="nri-reasons">${escapeHtml(r)}</p>`).join("")}
      </div>
      <p class="nri-disclaimer">⚠ Starter + lineup feeds not yet connected — model estimates only.</p>
    </div>`;
}

function renderNriSaferTicket(ticket) {
  if (!ticket) return "";
  const sc = nriStatusClass(ticket.status);
  const legsHtml = ticket.legs.map((leg) => {
    const probCls = leg.noRunProbability >= 0.70 ? "high" : leg.noRunProbability >= 0.60 ? "mid" : "low";
    return `<div class="nri-leg">
      <span class="nri-badge">Inn. ${leg.inning}</span>
      <span class="nri-leg-match">${escapeHtml(ticket.matchup)}</span>
      <span class="nri-leg-score">${leg.score}/100</span>
      <span class="nri-leg-prob ${probCls}">${(leg.noRunProbability * 100).toFixed(0)}%</span>
    </div>`;
  }).join("");
  return `
    <div class="nri-ticket ${sc}">
      <div class="nri-header">
        <div>
          <strong>Safer 2-Leg Ticket</strong>
          <span class="nri-subtitle"> · Innings ${ticket.innings.join(" + ")}</span>
        </div>
        <span class="nri-rec ${sc}">${ticket.status}</span>
      </div>
      <div class="nri-meta">
        <span>Est. hit rate <strong>${(ticket.combinedProbability * 100).toFixed(1)}%</strong></span>
        <span>Fair odds <strong>${nriOddsStr(ticket.combinedProbability)}</strong></span>
        <span><strong>2</strong> legs</span>
      </div>
      <div class="nri-legs">${legsHtml}</div>
      <p class="nri-disclaimer">⚠ Starter + lineup feeds not yet connected — model estimates only.</p>
    </div>`;
}

function renderNriPrimaryTicket(ticket) {
  if (!ticket) return "";
  const sc = nriStatusClass(ticket.status);
  const legsHtml = ticket.legs.map((leg) => {
    const probCls = leg.noRunProbability >= 0.70 ? "high" : leg.noRunProbability >= 0.60 ? "mid" : "low";
    return `<div class="nri-leg">
      <span class="nri-badge">Inn. ${leg.inning}</span>
      <span class="nri-leg-match">${escapeHtml(leg.matchup)}</span>
      <span class="nri-leg-score">${leg.score}/100</span>
      <span class="nri-leg-prob ${probCls}">${(leg.noRunProbability * 100).toFixed(0)}%</span>
    </div>`;
  }).join("");
  return `
    <div class="nri-ticket ${sc}">
      <div class="nri-header">
        <div>
          <strong>3-Game Parlay</strong>
          <span class="nri-subtitle"> · Best inning each game</span>
        </div>
        <span class="nri-rec ${sc}">${ticket.status}</span>
      </div>
      <div class="nri-meta">
        <span>Est. hit rate <strong>${(ticket.combinedProbability * 100).toFixed(1)}%</strong></span>
        <span>Fair odds <strong>${nriOddsStr(ticket.combinedProbability)}</strong></span>
        <span><strong>3</strong> legs</span>
      </div>
      <div class="nri-legs">${legsHtml}</div>
      <p class="nri-disclaimer">⚠ Starter + lineup feeds not yet connected — model estimates only.</p>
    </div>`;
}

function renderNoRunBoard() {
  if (!slate.length) return renderMlbEmpty("Fetch a slate to generate the No Run Inning board.");
  const board = generateNoRunBoard(slate);
  return renderNriSingleLeg(board.bestSingleLeg) +
    renderNriSaferTicket(board.saferTicket) +
    renderNriPrimaryTicket(board.primaryTicket);
}

// ── MLB Board render ─────────────────────────────────────────────────────────

function renderMlbBoard() {
  const moneylineBoard = scoreMlbMoneylineBoard();
  const teamPicks = moneylineBoard.picks;
  cacheCurrentSocialMlbBoard(moneylineBoard);
  const topScore  = Math.max(...teamPicks.map((p) => p.finalScore), 0);
  elements.selectedGameTitle.textContent = "MLB Daily Board";
  if (elements.parlayScore) elements.parlayScore.textContent = topScore || "--";
  elements.riskLabel.textContent = teamPicks[0]?.tier?.label || "Awaiting slate";
  if (elements.parlayTabs) elements.parlayTabs.hidden = true;
  elements.parlays.classList.remove("two-card-grid");
  elements.parlays.classList.add("mlb-board-grid");
  elements.parlays.innerHTML = `
    <section class="mlb-board-section">
      <div class="mlb-section-header">
        <h3>Today's Top 3 Moneyline Teams</h3>
        <span>${teamPicks.length}/3 ranked</span>
      </div>
      ${teamPicks.length ? teamPicks.map((pick, i) => renderMlbTeamPick(pick, i)).join("") : renderMlbEmpty("No team cleared the moneyline confidence threshold with complete pitcher, odds, and matchup data.")}
      ${renderMlbSlateRead(moneylineBoard)}
    </section>
    <section class="mlb-board-section">
      <div class="mlb-section-header">
        <h3>No Run Inning Board</h3>
        <span>Primary + Safer</span>
      </div>
      ${renderNoRunBoard()}
    </section>
    <section class="mlb-board-section">
      <div class="mlb-section-header">
        <h3>Home Run Board</h3>
        <span id="hrBoardStatusPill">generating…</span>
      </div>
      ${renderHrBoardSection()}
    </section>
  `;

  // Kick off async real-data fetch; updateHrBoardDom fills in the section when ready
  const date = elements.slateDate?.value || today;
  _hrBoardDate = null; // invalidate cache so new render always re-fetches
  buildPublicHrBoard(date)
    .then(updateHrBoardDom)
    .catch((err) => {
      const pill = document.getElementById("hrBoardStatusPill");
      if (pill) pill.textContent = "fetch failed";
      const loading = document.getElementById("hrBoardLoading");
      if (loading) loading.textContent = `HR board: ${err.message}`;
    });
}

function cacheCurrentSocialMlbBoard(moneylineBoard) {
  try {
    if (!moneylineBoard?.picks?.length || !window.localStorage) return;
    const slateDate = elements.slateDate?.value || today;
    const bookTitle = elements.bookFilter?.options?.[elements.bookFilter.selectedIndex]?.text || elements.bookFilter?.value || "";
    const payload = {
      snapshotSource: "Same Game Heat official browser board",
      sourceBoardType: "MLB_DAILY_3",
      appBuildVersion,
      boardBuildVersion,
      moneylineModelVersion,
      generatedAt: new Date().toISOString(),
      slateDate,
      sport: elements.sportKey?.value || "baseball_mlb",
      sportsbook: bookTitle,
      officialPicks: moneylineBoard.picks.slice(0, 3).map((pick, index) => ({
        slateDate,
        sport: elements.sportKey?.value || "baseball_mlb",
        gameId: pick.game?.id || "",
        gameStartTime: pick.game?.commenceTime || "",
        gameLabel: pick.gameLabel || formatDateTime(pick.game?.commenceTime),
        gameNumber: index + 1,
        homeTeam: pick.game?.homeTeam || "",
        awayTeam: pick.game?.awayTeam || "",
        selectedTeam: pick.team,
        opponent: pick.opponent,
        homeOrAway: pick.game?.homeTeam === pick.team ? "Home" : "Away",
        market: "Moneyline",
        line: null,
        sportsbook: bookTitle,
        sportsbookOdds: pick.moneyline?.odds ?? null,
        modelWinProbability: pick.modelWinProbability,
        finalScore: pick.finalScore,
        confidenceTier: pick.tier?.tier ?? null,
        confidenceLabel: pick.tier?.label || "",
        matchupEdge: pick.matchupEdge,
        fairOdds: pick.fairOdds,
        playableThrough: pick.playableThrough,
        starterName: pick.starterName || "",
        dataComplete: Boolean(pick.dataComplete),
        isBackfill: Boolean(pick.isBackfill),
        reasons: pick.reasons || [],
        components: pick.components || [],
        riskFlags: pick.riskFlags || [],
        passReasons: pick.passReasons || [],
        sourceBoardType: "MLB_DAILY_3",
        originalPickRank: index + 1,
        appBuildVersion,
        boardBuildVersion,
        moneylineModelVersion,
        rawSnapshotPayload: pick
      }))
    };
    window.localStorage.setItem("sgh-social-current-board", JSON.stringify(payload));
    window.SGH_CURRENT_SOCIAL_BOARD = payload;
  } catch {
    // Social Studio export is optional and must never block board rendering.
  }
}

function renderMlbEmpty(message) {
  return `<p class="mlb-empty">${escapeHtml(message)}</p>`;
}

function renderMlbSlateRead(board) {
  const leanRows = board.leans.length
    ? board.leans.map((pick) => renderMlbSlateReadRow(pick, "Lean")).join("")
    : `<p class="mlb-empty compact">No additional leans cleared the reduced watchlist threshold.</p>`;
  const passRows = board.passes.length
    ? board.passes.map((pick) => renderMlbSlateReadRow(pick, "Pass")).join("")
    : `<p class="mlb-empty compact">No pass notes available yet.</p>`;

  return `
    <details class="mlb-slate-read">
      <summary>Full Slate Read: leans and passes</summary>
      <div class="mlb-slate-read-grid">
        <div>
          <h4>Next-Best Leans</h4>
          ${leanRows}
        </div>
        <div>
          <h4>Pass / Wait</h4>
          ${passRows}
        </div>
      </div>
    </details>`;
}

function renderMlbSlateReadRow(pick, label) {
  const reasons = label === "Pass"
    ? (pick.passReasons?.length ? pick.passReasons.slice(0, 2).join("; ") : "thin edge")
    : (pick.riskFlags?.[0] || "lower than official-card confidence");
  return `
    <div class="mlb-slate-read-row">
      <strong>${escapeHtml(pick.team)}</strong>
      <span>${escapeHtml(pick.gameLabel || formatDateTime(pick.game.commenceTime))} · ${formatProbability(pick.modelWinProbability)} · ${escapeHtml(label)}</span>
      <small>${escapeHtml(reasons)}</small>
    </div>`;
}

function renderMlbTeamPick(pick, index = 0) {
  const medals    = ["🥇", "🥈", "🥉"];
  const medal     = medals[index] || "⚾";
  const isBestBet = index === 0;
  const tierClass = `tier-${pick.tier.tier}`;
  const edge      = pick.edge === null
    ? "Edge TBD"
    : `${pick.edge >= 0 ? "+" : ""}${formatProbability(pick.edge)} Edge`;

  // Component bar chart (top 4 by weight)
  const barComponents = pick.components.filter((c) =>
    ["startingPitcher", "offenseRecentForm", "bullpenQuality", "lineupMatchup"].includes(c.key)
  );
  const componentHtml = barComponents.map((c) => {
    const pct       = Math.round(c.score);
    const fillClass = c.score >= 75 ? "high" : c.score < 55 ? "low" : "";
    return `
      <div class="mlb-component-row">
        <span>${escapeHtml(c.label)}</span>
        <div class="mlb-bar"><div class="mlb-bar-fill ${fillClass}" style="width:${pct}%"></div></div>
        <span>${pct}</span>
      </div>`;
  }).join("");

  // Disqualifiers
  const disqHtml = pick.disqualifiers.length
    ? `<ul class="mlb-disqualifiers">${pick.disqualifiers.map((d) =>
        `<li>${escapeHtml(d.label)} (−${d.penalty} pts)</li>`).join("")}</ul>`
    : "";

  // Vegas Respect row
  const vegasHtml = `
    <div class="mlb-vegas-row">
      Market implied: ${pick.impliedProbability === null ? "TBD" : formatProbability(pick.impliedProbability)}
      ${pick.edge === null ? "" : ` · Model edge: ${pick.edge >= 0 ? "+" : ""}${formatProbability(pick.edge)}`}
    </div>`;

  // Blowout predictor
  const blowoutLabel = pick.blowoutScore >= 72
    ? "Strong blowout candidate"
    : pick.blowoutScore >= 58 ? "Moderate win probability"
    : "One-run game profile";

  return `
    <article class="mlb-pick-card ${tierClass}">
      ${isBestBet ? `<div class="mlb-best-bet-banner">⭐ Best Bet of the Day</div>` : ""}
      <div class="mlb-pick-header">
        <span class="mlb-medal">${medal}</span>
        <div class="mlb-pick-header-info">
          <strong>${index + 1}. ${escapeHtml(pick.team)}</strong>
          <span class="mlb-tier-badge ${tierClass}">${escapeHtml(pick.tier.label)}</span>
        </div>
        <span class="mlb-pick-top-odds">${formatOdds(pick.moneyline?.odds)}</span>
      </div>
      <p>${escapeHtml(pick.gameLabel || formatDateTime(pick.game.commenceTime))} · Opponent: ${escapeHtml(pick.opponent)} · ${pick.game.awayTeam === pick.team ? "Away" : "Home"} · Starter: ${escapeHtml(pick.starterName)}</p>
      <div class="mlb-pill-row">
        <span>Confidence ${pick.tier.label}</span>
        <span>${edge}</span>
        <span>${formatProbability(pick.modelWinProbability)} projected win probability</span>
      </div>
      <ul class="mlb-reasons">
        ${pick.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
      <div class="mlb-components">${componentHtml}</div>
      ${disqHtml}
      ${vegasHtml}
      <div class="mlb-price-row">
        <span>Fair odds ${formatOdds(pick.fairOdds)}</span>
        <span>Playable through ${formatOdds(pick.playableThrough)}</span>
      </div>
      <p class="mlb-risk">Matchup edge: +${Math.round(pick.matchupEdge)} points vs ${escapeHtml(pick.opponent)}</p>
      <p class="mlb-risk">Risk: ${escapeHtml(pick.riskFlags[0] || "No major risk flag.")}</p>
    </article>
  `;
}

function renderHrBoardSection() {
  // Returns a loading shell immediately; async update fills it in.
  return `<p class="hr-loading" id="hrBoardLoading">Fetching real player data from MLB Stats API…</p>`;
}

function updateHrBoardDom(board) {
  const container = document.querySelector(".mlb-board-section .mlb-section-header + *");
  const pill      = document.getElementById("hrBoardStatusPill");
  const loading   = document.getElementById("hrBoardLoading");

  const statusLabel = board.status === "FINAL"
    ? `${board.selections.length}/${HR_CONFIG.boardSelections} confirmed`
    : board.status === "INSUFFICIENT_MATCHUPS"
    ? `${board.selections.length} qualified`
    : `${board.selections.length}/${HR_CONFIG.boardSelections} provisional`;
  if (pill) pill.textContent = statusLabel;

  if (!board.selections.length) {
    const msg = board.status === "INSUFFICIENT_MATCHUPS"
      ? "Not enough hitters qualified today — check back closer to game time."
      : "No home run candidates from MLB data yet.";
    if (loading) loading.textContent = msg;
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const selHtml = board.selections.map((s, i) => renderHrCandidate(s, medals[i] || "⚾", true)).join("");

  const benchHtml = board.alternates?.length
    ? `<details class="hr-bench-details">
        <summary>Alternates (${board.alternates.length})</summary>
        <div class="hr-bench-list">
          ${board.alternates.slice(0, 3).map((b, i) =>
            renderHrCandidate(b, `${board.selections.length + i + 1}.`, false)
          ).join("")}
        </div>
      </details>`
    : "";

  const provisionalBanner = board.status === "PROVISIONAL"
    ? `<p class="hr-provisional">⚠️ PROVISIONAL — confirm starting lineups before wagering.</p>` : "";

  const html = `${provisionalBanner}${selHtml}${benchHtml}`;

  // Replace the loading node with real content
  const section = document.querySelector(".mlb-board-section:last-child");
  if (section) {
    const existing = section.querySelector(".hr-loading, .mlb-pick-card, .hr-provisional, .hr-bench-details");
    if (existing) {
      existing.insertAdjacentHTML("beforebegin", html);
      // Remove all placeholders / old cards
      section.querySelectorAll(".hr-loading").forEach((el) => el.remove());
    } else {
      section.insertAdjacentHTML("beforeend", html);
    }
  }
}

function renderHrCandidate(c, medal, isMain) {
  const confClass = c.confidence === "High" ? "tier-1" : c.confidence === "Medium" ? "tier-2" : "tier-3";
  const edgeHtml  = c.edge != null
    ? `<span class="hr-edge ${c.edge >= 0 ? "edge-pos" : "edge-neg"}">${c.edge >= 0 ? "+" : ""}${formatProbability(c.edge)} edge</span>`
    : `<span class="hr-edge">edge TBD</span>`;
  const impliedHtml = c.impliedProb != null
    ? `<span>Mkt ${formatProbability(c.impliedProb)}</span>` : "";

  const warningsHtml = c.warnings.length
    ? `<p class="hr-warning">⚠ ${c.warnings.map(escapeHtml).join(" · ")}</p>` : "";

  return `
    <article class="mlb-pick-card homer${isMain ? "" : " hr-bench-card"}">
      <div class="mlb-pick-header">
        <span class="mlb-medal">${medal}</span>
        <div class="mlb-pick-header-info">
          <strong>${escapeHtml(c.playerName)}</strong>
          <span class="mlb-tier-badge ${confClass}">HR ${c.confidence} · ${c.score}/100</span>
        </div>
        <span class="mlb-pick-top-odds">${formatOdds(c.odds)}</span>
      </div>
      <p>${escapeHtml(c.opponent)} ${c.pitcherHand ? `(${c.pitcherHand}HP)` : ""} · Bats ${c.lineupPosition || "?"}</p>
      <div class="mlb-pill-row">
        ${edgeHtml}
        ${impliedHtml}
        <span>${formatProbability(c.probability)} HR model</span>
      </div>
      <ul class="mlb-reasons">
        ${c.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
      ${warningsHtml}
      <p class="mlb-risk">Statcast and starter feeds not connected — estimates only.</p>
    </article>
  `;
}

function renderMlbHomerPick(pick) {
  // Kept for backward compatibility; only called from legacy paths.
  return renderHrBoardSection();
}

async function fetchMlbPublicHomerCandidates(date) {
  if (window.location.protocol === "file:") return [];
  try {
    const url = new URL("/api/mlb/public-homer-candidates", window.location.origin);
    url.searchParams.set("date", date);
    const payload = await fetchJson(url);
    return payload.candidates || [];
  } catch (error) {
    console.warn("MLB public homer fallback failed", error);
    return [];
  }
}

function getBestHRLegs(game, count = 4) {
  const hrCandidates = (game?.candidates || []).filter((prop) => prop.market === "batter_home_runs" && !prop.excluded);
  const scored = hrCandidates.flatMap((prop) => scorePropSides(prop, game)).filter((leg) => leg.direction === "Over");
  const byPlayer = new Map();
  scored.sort((a, b) => b.probability - a.probability).forEach((leg) => {
    const key = normalizeName(leg.player);
    if (!byPlayer.has(key)) byPlayer.set(key, leg);
  });
  return Array.from(byPlayer.values()).slice(0, count);
}

function renderParlay() {
  renderMlbBoard();
}

function renderMobileParlayBoards({ build, singleLegs, threeLegs, valueStarLegs, gameLabel }) {
  if (elements.parlayTabs) elements.parlayTabs.hidden = true;
  elements.parlays.classList.remove("two-card-grid");
  const shotBuild = shotForGloryBuild();
  const shotLegs = shotBuild.legs || [];
  const groups = [
    renderParlayGroup("Bet of the Day", singleLegs[0] ? [singleLegs[0]] : [], build.locked ? "Locked once this game started." : "Highest-probability full sportsbook line in this game, scanning both over and under.", gameLabel),
    renderParlayGroup("Bet of the Day 2", singleLegs[1] ? [singleLegs[1]] : [], build.locked ? "Locked once this game started." : "Next-best candidate by hit probability after the top Bet of the Day.", gameLabel),
    renderParlayGroup("Star Value Board", valueStarLegs, build.locked ? "Locked once this game started." : "Star/core board: two best candidates from each team by hit probability, over or under.", gameLabel),
    renderParlayGroup("Value Parlay", threeLegs, build.locked ? "Locked once this game started." : "Full-line playoff reads with acceptable survivability. Not a forced board.", gameLabel),
    renderParlayGroup("Shot of Glory", shotLegs, `${shotBuild.locked ? "Locked once the slate started." : "Six-leg target, but only quality or consistency reads are allowed."} ${shotLegs.length || 0} leg${shotLegs.length === 1 ? "" : "s"} from ${(shotBuild.gameBuilds || []).filter((item) => item.legs.length).length} game${(shotBuild.gameBuilds || []).filter((item) => item.legs.length).length === 1 ? "" : "s"}. This is intentionally aggressive.`)
  ];
  const allLegs = [
    ...singleLegs.slice(0, 2),
    ...valueStarLegs,
    ...threeLegs,
    ...shotLegs
  ];
  const filledGroups = [singleLegs[0], singleLegs[1], valueStarLegs.length, threeLegs.length, shotLegs.length].filter(Boolean).length;
  const mobileScore = allLegs.length ? Math.round(average(allLegs.map((leg) => Number(leg.score || leg.grade || 0)).filter(Boolean))) : 0;
  if (elements.parlayScore) elements.parlayScore.textContent = mobileScore || "--";
  elements.riskLabel.textContent = build.locked ? "Locked at start" : `${filledGroups}/5 boards`;
  elements.parlays.innerHTML = groups.join("");
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

  const bookTitle = elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "Sportsbook";
  const usesModeledFloor = legs.some((leg) => leg.modeledFloor);

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
          <strong>${boardOddsLabel(legs)}</strong>
        </div>
      </div>
      <div class="slip-subline">
        <span>${description}${usesModeledFloor ? " Alt prices are estimated until confirmed in the sportsbook." : ""}</span>
      </div>
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
  const title = leg.floorLabel || `${leg.direction} ${leg.line}`;
  const marketLabel = leg.floorMarketLabel || `${marketLabels[leg.market] || leg.market} OU`;
  const floorText = leg.sourceLine ? ` · standard line ${leg.sourceLine}` : "";
  const oddsText = Number.isFinite(Number(leg.odds)) ? ` · ${leg.modeledFloor ? "est. " : ""}${formatOdds(leg.odds)}` : "";
  const readText = `${floorText}${oddsText}`.replace(/^ · /, "");
  return `
    <article class="leg-card">
      <div>
        <div class="leg-title">${title}</div>
        <div class="leg-meta">${leg.player} - ${marketLabel}</div>
        <div class="leg-game">${gameLabel || leg.gameLabel || ""}</div>
        ${readText ? `<div class="leg-read">${readText}</div>` : ""}
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
  if (elements.parlayScore) elements.parlayScore.textContent = grade || "--";
  elements.riskLabel.textContent = build.locked ? "Locked at slate start" : `${legs.length}/${targetLegs} legs`;
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
            <h3>MLB Candidate Guide</h3>
            <p>Select a game to see 60%+ candidate legs with MLB ratings.</p>
          </div>
        </div>
      </section>
    `;
    return;
  }

  const build = gameParlayBuild(game);
  const selectedKeys = {
    anchor: new Set((build.singleLegs || []).map(shotLegKey)),
    lowRisk: new Set(),
    value: new Set([...(build.threeLegs || []), ...(build.valueStarLegs || [])].map(shotLegKey))
  };
  const guideLegs = candidateGuidePool(game);
  const guideHasSixtyPlus = guideLegs.some((leg) => Number(leg.probability || 0) >= 0.6);
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
          <span class="candidate-balls" aria-label="${ballCount} MLB rating">${balls}</span>
        </div>
        <div class="candidate-mini">
          <span class="${status.className}">${escapeHtml(status.label)}</span>
          <span>Hit ${formatProbability(Number(leg.probability || 0))}</span>
        </div>
        <p>${notes.length ? notes.map(escapeHtml).join(" · ") : "Considered by the Playoff Engine, but no stronger guide note was available."}</p>
      </article>
    `;
  }).join("");

  elements.candidateGuide.innerHTML = `
    <section class="candidate-guide-card">
      <div class="candidate-guide-heading">
        <div>
          <h3>MLB Candidate Guide</h3>
          <p>${escapeHtml(game.awayTeam)} @ ${escapeHtml(game.homeTeam)} · ${guideLegs.length} ${guideHasSixtyPlus ? "candidates at 60%+" : "best playable watchlist candidates"}</p>
        </div>
        <span class="candidate-guide-key">⚾⚾⚾⚾ 89-100 · ⚾⚾⚾ 76-88 · ⚾⚾ 60-75</span>
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
  prop.seriesAvg = Number(average(values).toFixed(1));
  prop.seriesGames = values.length;
  prop.seriesHits = values.filter((value) => value > Number(prop.line)).length;
  prop.playerTier = inferPlayerTier(prop);
}

function generatedLegKeys() {
  const keys = new Set();
  slate.forEach((game) => {
    const build = gameParlayBuild(game);
    [...(build.singleLegs || []), ...(build.saferLegs || []), ...(build.sameTeamLegs || []), ...(build.threeLegs || []), ...(build.valueStarLegs || [])].forEach((leg) => {
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
      setStatus(`No game logs were returned for ${playerName}. MLB log feed coming in Phase 2.`, "warn");
      return;
    }

    applyWebLogs(playerName, logs, payload.source, payload.team, "all");
    renderParlay(game);
    renderShotForGlory();
    renderAdjustments(game);
    setStatus(`Loaded ${logs.length} log row${logs.length === 1 ? "" : "s"} for ${payload.player || playerName}.`, "success");
  } catch (error) {
    const serverHint = window.location.protocol === "file:" ? " Start the local server and open http://localhost:3999." : "";
    setStatus(`Could not fetch web logs: ${error.message}.${serverHint}`, "warn");
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
    if (isMobileLayout() && elements.parlayTabs) elements.parlayTabs.hidden = true;
    elements.selectedGameTitle.textContent = "No game selected";
    if (elements.parlayScore) elements.parlayScore.textContent = "--";
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

function extractGameTotal(eventOdds) {
  for (const bookmaker of eventOdds.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== "totals") continue;
      const over = market.outcomes?.find((o) => o.name === "Over");
      if (over?.point !== undefined) return Number(over.point);
    }
  }
  return null;
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
        if (market.key === "batter_home_runs") {
          const hrPlayer = outcome.description || outcome.name;
          const hrPoint = outcome.point ?? 0.5;
          if (!hrPlayer) return;
          const groupKey = `${normalizeName(hrPlayer)}|batter_home_runs`;
          const lineKey = String(Number(hrPoint));
          const lines = lineGroups.get(groupKey) || new Map();
          const lineItem = lines.get(lineKey) || {
            line: Number(hrPoint),
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
          lineItem.overOdds = outcome.price;
          if (bookmakerKey === bookKey || sportsbookMatches(bookmaker, bookKey)) {
            lineItem.selected = true;
            lineItem.selectedBookKey = bookmaker.key;
            lineItem.selectedBookTitle = bookmakerTitle;
            lineItem.selectedOverOdds = outcome.price;
          }
          lines.set(lineKey, lineItem);
          lineGroups.set(groupKey, lines);
          const existing = grouped.get(groupKey) || { player: hrPlayer, market: "batter_home_runs", entries: new Map() };
          existing.entries.set(lineKey, lineItem);
          grouped.set(groupKey, existing);
          return;
        }

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
        if (bookmakerKey === bookKey || sportsbookMatches(bookmaker, bookKey)) {
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
    if (propCandidate.market === "batter_home_runs" && (!Number.isFinite(propCandidate.line) || propCandidate.line === 0)) {
      propCandidate.line = 0.5;
    }
    return propCandidate;
  });
  return candidateProps;
}

function extractMoneylineOdds(eventOdds, selectedBook) {
  const bookKey = String(selectedBook || "fanatics").trim().toLowerCase();
  const moneylines = new Map();
  const consensus = new Map();

  eventOdds.bookmakers?.forEach((bookmaker) => {
    const bookmakerKey = String(bookmaker.key || "").toLowerCase();
    const bookmakerTitle = bookmaker.title || bookmaker.key || "Sportsbook";
    const isSelected = bookmakerKey === bookKey || sportsbookMatches(bookmaker, bookKey);

    bookmaker.markets?.forEach((market) => {
      if (market.key !== "h2h") return;

      market.outcomes?.forEach((outcome) => {
        if (!outcome?.name || !Number.isFinite(Number(outcome.price))) return;
        const teamKey = normalizeName(outcome.name);
        const item = {
          team: outcome.name,
          odds: Number(outcome.price),
          bookKey: bookmaker.key,
          bookTitle: bookmakerTitle,
          selectedBookAvailable: isSelected
        };

        if (!consensus.has(teamKey)) consensus.set(teamKey, item);
        if (isSelected) moneylines.set(teamKey, item);
      });
    });
  });

  consensus.forEach((item, teamKey) => {
    if (!moneylines.has(teamKey)) {
      moneylines.set(teamKey, {
        ...item,
        selectedBookAvailable: false,
        bookTitle: `${elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || selectedBook} moneyline unavailable`
      });
    }
  });

  return Object.fromEntries(moneylines.entries());
}

function oddsPayloadHasMarket(payload, marketKey) {
  return (payload.bookmakers || []).some((bookmaker) =>
    (bookmaker.markets || []).some((market) => market.key === marketKey)
  );
}

function mergeOddsMarkets(primary, extra) {
  const merged = {
    ...primary,
    bookmakers: [...(primary.bookmakers || [])]
  };
  const byBook = new Map(merged.bookmakers.map((bookmaker) => [bookmaker.key, bookmaker]));

  (extra.bookmakers || []).forEach((extraBook) => {
    const existingBook = byBook.get(extraBook.key);
    if (!existingBook) {
      const clone = { ...extraBook, markets: [...(extraBook.markets || [])] };
      merged.bookmakers.push(clone);
      byBook.set(clone.key, clone);
      return;
    }

    const existingMarketKeys = new Set((existingBook.markets || []).map((market) => market.key));
    (extraBook.markets || []).forEach((market) => {
      if (!existingMarketKeys.has(market.key)) {
        existingBook.markets = [...(existingBook.markets || []), market];
        existingMarketKeys.add(market.key);
      }
    });
  });

  return merged;
}

function mergeEventPayloadsById(primaryPayloads, extraPayloads) {
  const extrasById = new Map(extraPayloads.map((payload) => [(payload.event || payload)?.id, payload]));

  return primaryPayloads.map((payload) => {
    const event = payload.event || payload;
    const extra = extrasById.get(event?.id);
    if (!extra) return payload;

    return {
      ...payload,
      odds: mergeOddsMarkets(payload.odds || payload, extra.odds || extra)
    };
  });
}

async function ensureMlbMoneylinePayloads(eventPayloads, sport, date) {
  if (sport !== "baseball_mlb") return eventPayloads;
  const hasMoneylines = eventPayloads.some((payload) => oddsPayloadHasMarket(payload.odds || payload, "h2h"));
  if (hasMoneylines) return eventPayloads;

  const moneylinePayloads = await fetchSlateViaServer({ sport, date, marketKeys: ["h2h"] });
  return mergeEventPayloadsById(eventPayloads, moneylinePayloads);
}

function matchupKey(awayTeam, homeTeam) {
  return `${normalizeName(awayTeam)}@${normalizeName(homeTeam)}`;
}

function bdlVendorForSelectedBook() {
  const selected = elements.bookFilter.value;
  const vendorByBook = {
    fanatics: "fanatics",
    draftkings: "draftkings",
    fanduel: "fanduel",
    betmgm: "betmgm",
    caesars: "caesars"
  };
  return vendorByBook[selected] || selected || "";
}

function bdlMlbPropMarket(propType) {
  const markets = {
    home_runs: "batter_home_runs",
    batter_home_runs: "batter_home_runs"
  };
  return markets[propType] || propType || "batter_home_runs";
}

function bookmakerKeyFromVendor(vendor) {
  return normalizeName(vendor || "balldontlie").replace(/\s+/g, "_") || "balldontlie";
}

function bdlPropLine(prop) {
  const line = Number(prop.lineValue);
  if (Number.isFinite(line)) return line;
  if (prop.propType === "home_runs" || prop.propType === "batter_home_runs") return 0.5;
  return null;
}

function bdlPropPrice(prop) {
  const price = Number(prop.overOdds ?? prop.odds);
  return Number.isFinite(price) ? price : null;
}

async function fetchBdlMlbPlayerProps(date, propType = "home_runs") {
  if (window.location.protocol === "file:") return [];
  const url = new URL("/api/mlb/player-props", window.location.origin);
  url.searchParams.set("date", date);
  url.searchParams.set("propType", propType);
  const vendor = bdlVendorForSelectedBook();
  if (vendor) url.searchParams.set("vendor", vendor);

  const payload = await fetchJson(url);
  return payload.games || [];
}

function friendlyBdlMlbError(error) {
  const message = String(error?.message || "");
  if (message.includes("401")) {
    return "Ball Don't Lie rejected the MLB request. Confirm the key saved in .env/Render is the upgraded MLB-enabled key, then restart/redeploy.";
  }
  if (message.includes("404")) {
    return "Ball Don't Lie MLB prop endpoint was not found for this account/API version.";
  }
  return `Ball Don't Lie MLB props did not load: ${message}`;
}

function mergeBdlMlbPropsIntoPayloads(eventPayloads, bdlGames, propType = "home_runs") {
  if (!bdlGames?.length) return eventPayloads;
  const payloadsByMatchup = new Map();

  eventPayloads.forEach((payload) => {
    const event = payload.event || payload;
    payloadsByMatchup.set(matchupKey(event.away_team, event.home_team), payload);
  });

  bdlGames.forEach((bdlGame) => {
    const payload = payloadsByMatchup.get(matchupKey(bdlGame.awayTeam, bdlGame.homeTeam));
    if (!payload || !bdlGame.props?.length) return;
    const odds = payload.odds || payload;

    bdlGame.props.forEach((prop) => {
      const line = bdlPropLine(prop);
      const price = bdlPropPrice(prop);
      if (!prop.playerName || line === null || price === null) return;

      const bookKey = bookmakerKeyFromVendor(prop.vendor || bdlVendorForSelectedBook());
      let bookmaker = (odds.bookmakers || []).find((book) => book.key === bookKey);
      if (!bookmaker) {
        bookmaker = {
          key: bookKey,
          title: prop.vendor || elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "Ball Don't Lie",
          markets: []
        };
        odds.bookmakers = [...(odds.bookmakers || []), bookmaker];
      }

      const marketKey = bdlMlbPropMarket(prop.propType || propType);
      let market = (bookmaker.markets || []).find((item) => item.key === marketKey);
      if (!market) {
        market = { key: marketKey, outcomes: [] };
        bookmaker.markets = [...(bookmaker.markets || []), market];
      }

      const duplicate = market.outcomes.some((outcome) =>
        normalizeName(outcome.description || outcome.name) === normalizeName(prop.playerName) &&
        outcome.name === "Over" &&
        Number(outcome.point) === Number(line)
      );
      if (!duplicate) {
        market.outcomes.push({
          name: "Over",
          description: prop.playerName,
          point: line,
          price
        });
      }
    });
  });

  return eventPayloads;
}

function oddsPayloadHasValidHrOdds(payload) {
  return (payload.bookmakers || []).some((bookmaker) =>
    (bookmaker.markets || []).some((market) =>
      market.key === "batter_home_runs" &&
      (market.outcomes || []).some((outcome) => Number.isFinite(Number(outcome.price)))
    )
  );
}

async function supplementMlbPayloadsFromBdl(eventPayloads, sport, date) {
  if (sport !== "baseball_mlb") return eventPayloads;
  bdlMlbSupplementError = "";
  // Only skip BDL if Odds API returned HR props with at least one valid price.
  // A market key with all-null prices still needs the BDL supplement.
  const hasValidHrProps = eventPayloads.some((payload) => oddsPayloadHasValidHrOdds(payload.odds || payload));
  if (hasValidHrProps) return eventPayloads;

  try {
    const bdlGames = await fetchBdlMlbPlayerProps(date, "home_runs");
    return mergeBdlMlbPropsIntoPayloads(eventPayloads, bdlGames, "home_runs");
  } catch (error) {
    console.warn("Ball Don't Lie MLB prop supplement failed", error);
    bdlMlbSupplementError = friendlyBdlMlbError(error);
    return eventPayloads;
  }
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
    // Reverse proxy (nginx / Render / Fly) returns HTML on 502/503/504 — server is down
    if (text.trimStart().startsWith("<")) {
      throw new Error(
        `Server offline or unreachable (HTTP ${response.status}). ` +
        `Make sure node server.js is running and the port is accessible.`
      );
    }
    // Our own server returns { error: "..." } JSON
    try {
      const body = JSON.parse(text);
      if (body?.error) throw new Error(body.error);
    } catch (parseErr) {
      if (parseErr.message && parseErr.message !== "Unexpected token") throw parseErr;
    }
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 140)}`);
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

function currentUiState() {
  return {
    sportKey: elements.sportKey.value,
    slateDate: elements.slateDate.value || today,
    region: elements.region.value,
    bookFilter: elements.bookFilter.value
  };
}

function selectHasValue(select, value) {
  return Array.from(select.options || []).some((option) => option.value === value);
}

function applyUiState(state = {}) {
  if (state.sportKey && selectHasValue(elements.sportKey, state.sportKey)) {
    elements.sportKey.value = state.sportKey;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(state.slateDate || ""))) {
    elements.slateDate.value = state.slateDate;
    elements.savedBoardDate.value = state.slateDate;
  }
  if (state.region && selectHasValue(elements.region, state.region)) {
    elements.region.value = state.region;
  }
  if (state.bookFilter && selectHasValue(elements.bookFilter, state.bookFilter)) {
    elements.bookFilter.value = state.bookFilter;
  }
  updateSportShell();
}

async function loadSharedUiState() {
  if (window.location.protocol === "file:") return;
  try {
    const payload = await fetchJson("/api/ui-state");
    applyUiState(payload.state || {});
  } catch {
    // Default controls remain usable if shared state is unavailable.
  }
}

async function saveSharedUiState() {
  if (window.location.protocol === "file:") return;
  try {
    await fetch("/api/ui-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: currentUiState() })
    });
  } catch {
    // The current browser still has the selected controls.
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

async function fetchInjuries() {
  if (window.location.protocol !== "file:") {
    try {
      const result = await fetchJson("/api/injuries");
      if (result.configured) return result.injuries || [];
    } catch (error) {
      setStatus(`Slate loaded, but server injury updates were unavailable: ${error.message}`, "warn");
    }
  }
  return [];
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
    const moneylines = extractMoneylineOdds(odds, elements.bookFilter.value);
    if (!event?.id) continue;
    const commenceMs = Date.parse(event.commence_time || "");
    const lastGameMs = Date.parse(event.lastGameDate || "");
    const restDays = commenceMs && lastGameMs ? Math.round((commenceMs - lastGameMs) / 86400000) : null;
    const gameTotal = extractGameTotal(odds);
    games.push({
      id: event.id,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
      source: event.source || odds.source || "The Odds API",
      candidates,
      moneylines,
      mlbContext: eventPayload.mlbContext || event.mlbContext || odds.mlbContext || null,
      propMarketAvailable: candidates.length > 0,
      bookmakerCount: odds.bookmakers?.length || 0,
      restDays,
      gameTotal
    });
  }

  return games;
}

function slatePropCount(games = slate) {
  return games.reduce((total, game) => total + (game.candidates?.length || 0), 0);
}

function slateMoneylineCount(games = slate) {
  return games.reduce((total, game) => total + Object.keys(game.moneylines || {}).length, 0);
}

function slatePropsUnavailableMessage(games, config) {
  if (!games.length) return `No ${config.label} games were returned for that date.`;
  const gameText = `${games.length} ${config.label} game${games.length === 1 ? "" : "s"}`;
  if (config.label === "MLB" && slateMoneylineCount(games)) {
    if (bdlMlbSupplementError) {
      return `Loaded ${gameText} with moneylines, but no HR props were added. ${bdlMlbSupplementError}`;
    }
    return `Loaded ${gameText} with moneylines, but no player prop lines were returned yet. Team win picks can still generate; homer looks will wait for HR props.`;
  }
  return `Loaded ${gameText}, but no player prop lines were returned yet. This usually means sportsbook prop markets are not posted, have closed after tipoff, or your Odds API plan is not returning player props right now.`;
}

async function rebuildSlateForSelectedBook() {
  if (!lastEventPayloads.length) return;
  saveSharedUiState();
  const token = ++slateLoadToken;
  const priorSelectedGameId = selectedGameId;
  const config = sportConfig();
  const date = elements.slateDate.value || today;
  setStatus(`Regenerating board with ${elements.bookFilter.options[elements.bookFilter.selectedIndex]?.text || "selected sportsbook"} lines...`);

  if (elements.sportKey.value === "baseball_mlb") await ensureMlbMatchupData(date);
  const games = buildGamesFromPayloads(lastEventPayloads);
  applyInjuries(games, lastInjuries);
  slate = games;
  selectedGameId = slate.some((game) => game.id === priorSelectedGameId) ? priorSelectedGameId : slate[0]?.id || null;
  selectedPropId = null;
  elements.playerSearch.value = "";
  const propCount = slatePropCount(slate);
  const moneylineCount = slateMoneylineCount(slate);
  const hasBoardData = propCount || (config.label === "MLB" && moneylineCount);
  boardEnrichmentPending = false;
  setStatus(
    hasBoardData
      ? `Regenerated ${slate.length} MLB game slate with ${moneylineCount} moneyline price${moneylineCount === 1 ? "" : "s"} and ${propCount} player prop${propCount === 1 ? "" : "s"}.`
      : slatePropsUnavailableMessage(slate, config),
    hasBoardData ? "success" : "warn"
  );
  clearLiveBuildsForSlate();
  render();
  upsertCurrentBoard();
}

async function fetchSlate() {
  const token = ++slateLoadToken;
  const sport = elements.sportKey.value;
  const date = elements.slateDate.value || today;
  const config = sportConfig();

  saveSharedUiState();
  setStatus(`Fetching ${config.label} slate events and player prop markets...`);
  if (elements.fetchSlate) elements.fetchSlate.disabled = true;

  try {
    const marketKeys = config.markets;
    let eventPayloads = [];

    try {
      if (window.location.protocol === "file:") throw new Error("Server proxy is unavailable from file mode");
      bdlMlbSupplementError = "";
      mlbPublicHomerCandidates = [];
      if (sport === "baseball_mlb") await ensureMlbMatchupData(date);
      eventPayloads = await fetchSlateViaServer({ sport, date, marketKeys });
      eventPayloads = await ensureMlbMoneylinePayloads(eventPayloads, sport, date);
      eventPayloads = await supplementMlbPayloadsFromBdl(eventPayloads, sport, date);
    } catch (serverError) {
      const msg = serverError.message || "Unknown server error";
      // Only append the API-key hint when the server itself says the key is missing
      const hint = /ODDS_API_KEY|not configured/i.test(msg)
        ? " Add ODDS_API_KEY to .env and restart the server."
        : "";
      throw new Error(`${msg}${hint}`);
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
    const moneylineCount = slateMoneylineCount(slate);
    const hasBoardData = propCount || (config.label === "MLB" && (moneylineCount || slate.length));
    boardEnrichmentPending = false;
    const mlbPublicOnly = config.label === "MLB" && !moneylineCount && slate.length;
    setStatus(
      mlbPublicOnly
        ? `Loaded ${slate.length} MLB games from public MLB data. Sportsbook odds are unavailable, so moneyline picks use public matchup scoring.`
        : hasBoardData
        ? `Loaded ${slate.length} MLB game slate with ${moneylineCount} moneyline price${moneylineCount === 1 ? "" : "s"} and ${propCount} player prop line${propCount === 1 ? "" : "s"}.`
        : slatePropsUnavailableMessage(slate, config),
      hasBoardData ? "success" : "warn"
    );
    clearLiveBuildsForSlate();
    render();
    upsertCurrentBoard();
    loadServerSavedBoards();
    if (slate.length && sport !== "baseball_mlb") {
      fetchInjuries().then((injuries) => {
        if (token !== slateLoadToken) return;
        lastInjuries = injuries;
        applyInjuries(slate, injuries);
        clearLiveBuildsForSlate();
        render();
        upsertCurrentBoard();
      }).catch((err) => {
        setStatus(`Could not fetch injuries: ${err.message}`, "warn");
      });
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

async function initializeApp() {
  await loadSharedUiState();
  loadServerSavedBoards();
  render();
  fetchSlate();
}

initializeApp();

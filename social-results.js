const crypto = require("node:crypto");

const RESULT_GRADING_VERSION = "social-results-moneyline-v1";
const RESULT_VALUES = new Set(["PENDING", "WIN", "LOSS", "PUSH", "VOID", "MANUAL_REVIEW"]);
const FINAL_RESULTS = new Set(["WIN", "LOSS", "PUSH", "VOID"]);
const TRACKED_CONTENT_TYPES = new Set(["DAILY_3", "BEST_BET", "PICK_BREAKDOWN"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizedName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function resultId(snapshot) {
  return `result_${sha256(`${snapshot.id || ""}:${snapshot.snapshotHash || ""}`).slice(0, 18)}`;
}

function normalizeGameStatus(status) {
  const value = clean(status).toLowerCase();
  if (!value) return "unknown";
  if (/final|completed|game over|official/i.test(value)) return "final";
  if (/postponed/i.test(value)) return "postponed";
  if (/cancel/i.test(value)) return "cancelled";
  if (/suspend/i.test(value)) return "suspended";
  if (/delay/i.test(value)) return "delayed";
  if (/progress|live|warmup|manager challenge/i.test(value)) return "in_progress";
  if (/scheduled|pre-game|pregame|preview/i.test(value)) return "scheduled";
  return value.replace(/\s+/g, "_");
}

function isFinalStatus(status) {
  return normalizeGameStatus(status) === "final";
}

function isValidAmericanOdds(odds) {
  const number = Number(odds);
  return Number.isInteger(number) && (number <= -100 || number >= 100) && Math.abs(number) <= 100000;
}

function calculateUnits({ americanOdds, result, stakeUnits = 1 }) {
  const normalizedResult = clean(result).toUpperCase();
  if (normalizedResult === "PUSH" || normalizedResult === "VOID") {
    return { unitsWonLost: 0, unitStake: stakeUnits, unitCalculationStatus: "available" };
  }
  if (normalizedResult === "PENDING" || normalizedResult === "MANUAL_REVIEW") {
    return { unitsWonLost: null, unitStake: stakeUnits, unitCalculationStatus: "not_settled" };
  }
  if (!isValidAmericanOdds(americanOdds)) {
    return { unitsWonLost: null, unitStake: stakeUnits, unitCalculationStatus: "unavailable" };
  }
  if (normalizedResult === "LOSS") {
    return { unitsWonLost: -stakeUnits, unitStake: stakeUnits, unitCalculationStatus: "available" };
  }
  if (normalizedResult === "WIN") {
    const odds = Number(americanOdds);
    const profit = odds < 0 ? (100 / Math.abs(odds)) * stakeUnits : (odds / 100) * stakeUnits;
    return { unitsWonLost: profit, unitStake: stakeUnits, unitCalculationStatus: "available" };
  }
  return { unitsWonLost: null, unitStake: stakeUnits, unitCalculationStatus: "unavailable" };
}

function resultHashInput(result) {
  const {
    id,
    resultHash,
    integrityStatus,
    integrityError,
    createdAt,
    updatedAt,
    ...hashInput
  } = result || {};
  return hashInput;
}

function computeResultHash(result) {
  return sha256(canonicalStringify(resultHashInput(result)));
}

function verifyResultIntegrity(result) {
  if (!result?.resultHash) return { ...result, integrityStatus: "failed", integrityError: "Missing resultHash" };
  const expected = computeResultHash(result);
  if (expected !== result.resultHash) {
    return {
      ...result,
      integrityStatus: "failed",
      integrityError: `resultHash mismatch: expected ${expected}, stored ${result.resultHash}`
    };
  }
  return { ...result, integrityStatus: "verified" };
}

function scoreValue(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function getWinningTeam(gameResult) {
  const homeScore = scoreValue(gameResult?.homeScore);
  const awayScore = scoreValue(gameResult?.awayScore);
  if (homeScore === null || awayScore === null) return null;
  if (homeScore === awayScore) return "TIE";
  return homeScore > awayScore ? gameResult.homeTeam : gameResult.awayTeam;
}

function validateGameIdentity(snapshot, gameResult) {
  if (!gameResult) return "No game result returned";
  if (snapshot.gameId && gameResult.gameId && clean(snapshot.gameId) !== clean(gameResult.gameId)) {
    return "Game ID mismatch";
  }
  const snapshotHome = normalizedName(snapshot.homeTeam);
  const snapshotAway = normalizedName(snapshot.awayTeam);
  const resultHome = normalizedName(gameResult.homeTeam);
  const resultAway = normalizedName(gameResult.awayTeam);
  if (snapshotHome && resultHome && snapshotHome !== resultHome) return "Home team mismatch";
  if (snapshotAway && resultAway && snapshotAway !== resultAway) return "Away team mismatch";
  return "";
}

function gradeMoneylineSnapshot(snapshot, gameResult) {
  if (snapshot.integrityStatus === "failed") {
    return { result: "MANUAL_REVIEW", notes: ["Snapshot integrity failed"], manualReviewReason: snapshot.integrityError || "Snapshot integrity failed" };
  }
  if (!/moneyline|h2h|ml/i.test(clean(snapshot.market))) {
    return { result: "MANUAL_REVIEW", notes: ["Unsupported market for Phase 3"], manualReviewReason: "Unsupported market" };
  }
  const identityError = validateGameIdentity(snapshot, gameResult);
  if (identityError) return { result: "MANUAL_REVIEW", notes: [identityError], manualReviewReason: identityError };

  const normalizedStatus = normalizeGameStatus(gameResult.sourceGameStatus || gameResult.status);
  if (normalizedStatus === "postponed" || normalizedStatus === "suspended" || normalizedStatus === "delayed" || normalizedStatus === "scheduled" || normalizedStatus === "in_progress") {
    return { result: "PENDING", notes: [`Game status: ${normalizedStatus}`], manualReviewReason: "" };
  }
  if (normalizedStatus === "cancelled") {
    return { result: "MANUAL_REVIEW", notes: ["Game cancelled; sportsbook settlement may vary"], manualReviewReason: "Cancelled game" };
  }
  if (!isFinalStatus(normalizedStatus)) {
    return { result: "MANUAL_REVIEW", notes: [`Unsupported status: ${normalizedStatus}`], manualReviewReason: "Unsupported game status" };
  }
  const winningTeam = getWinningTeam(gameResult);
  if (!winningTeam) {
    return { result: "MANUAL_REVIEW", notes: ["Final score could not be interpreted"], manualReviewReason: "Invalid final score" };
  }
  if (winningTeam === "TIE") return { result: "PUSH", notes: ["Final score tied"], manualReviewReason: "" };
  const selectedKey = normalizedName(snapshot.selectedTeam);
  const winnerKey = normalizedName(winningTeam);
  if (!selectedKey || !winnerKey) {
    return { result: "MANUAL_REVIEW", notes: ["Missing selected team or winner"], manualReviewReason: "Missing team" };
  }
  return {
    result: selectedKey === winnerKey ? "WIN" : "LOSS",
    notes: [`${winningTeam} won ${gameResult.awayScore}-${gameResult.homeScore}`],
    manualReviewReason: ""
  };
}

function createResultRecord({ snapshot, gameResult = {}, resultOverride = null, settlementMethod = "automatic", manualReviewReason = "", notes = [], now = new Date().toISOString(), previousResultId = null } = {}) {
  const grade = resultOverride
    ? { result: resultOverride, notes, manualReviewReason }
    : gradeMoneylineSnapshot(snapshot, gameResult);
  const result = RESULT_VALUES.has(grade.result) ? grade.result : "MANUAL_REVIEW";
  const units = calculateUnits({
    americanOdds: snapshot.sportsbookOdds,
    result,
    stakeUnits: 1
  });
  const winningTeam = gameResult ? getWinningTeam(gameResult) : null;
  const recordCore = {
    snapshotId: snapshot.id,
    snapshotHash: snapshot.snapshotHash,
    slateDate: snapshot.slateDate,
    sport: snapshot.sport,
    gameId: snapshot.gameId,
    market: snapshot.market,
    selectedTeam: snapshot.selectedTeam,
    opponent: snapshot.opponent,
    frozenOdds: isValidAmericanOdds(snapshot.sportsbookOdds) ? Number(snapshot.sportsbookOdds) : null,
    sportsbook: snapshot.sportsbook || "",
    status: FINAL_RESULTS.has(result) ? "settled" : result === "PENDING" ? "pending" : "manual_review",
    result,
    homeScore: scoreValue(gameResult.homeScore),
    awayScore: scoreValue(gameResult.awayScore),
    winningTeam: winningTeam === "TIE" ? null : winningTeam,
    source: gameResult.source || "mlb_stats_api",
    sourceGameId: gameResult.gameId || snapshot.gameId,
    sourceGameStatus: gameResult.sourceGameStatus || gameResult.status || "",
    gameCompletedAt: gameResult.gameCompletedAt || "",
    settledAt: FINAL_RESULTS.has(result) || result === "MANUAL_REVIEW" ? now : "",
    gradingVersion: RESULT_GRADING_VERSION,
    unitStake: units.unitStake,
    unitsWonLost: units.unitsWonLost,
    unitCalculationStatus: units.unitCalculationStatus,
    notes: [...(grade.notes || []), ...notes].filter(Boolean),
    manualReviewReason: grade.manualReviewReason || manualReviewReason || "",
    settlementMethod,
    previousResultId,
    trackInOfficialRecord: true
  };
  const resultHash = computeResultHash(recordCore);
  return {
    id: previousResultId ? `result_correction_${sha256(`${previousResultId}:${now}:${result}`).slice(0, 18)}` : resultId(snapshot),
    ...recordCore,
    resultHash,
    createdAt: now,
    updatedAt: now
  };
}

function emptyPerformance({ period = "all_time", startDate = "", endDate = "" } = {}) {
  return {
    period,
    startDate,
    endDate,
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: 0,
    pending: 0,
    manualReview: 0,
    totalSettled: 0,
    winPercentage: null,
    units: 0,
    roi: null,
    riskedUnits: 0
  };
}

function calculatePerformance(results = [], options = {}) {
  const summary = emptyPerformance(options);
  const bySnapshot = new Map();
  results.filter((result) => result?.trackInOfficialRecord !== false).forEach((result) => {
    const key = result.snapshotHash || result.snapshotId || result.id;
    if (!bySnapshot.has(key)) bySnapshot.set(key, result);
  });
  bySnapshot.forEach((result) => {
    if (result.result === "WIN") {
      summary.wins += 1;
      summary.totalSettled += 1;
      summary.riskedUnits += Number(result.unitStake) || 1;
      summary.units += Number(result.unitsWonLost) || 0;
    } else if (result.result === "LOSS") {
      summary.losses += 1;
      summary.totalSettled += 1;
      summary.riskedUnits += Number(result.unitStake) || 1;
      summary.units += Number(result.unitsWonLost) || -1;
    } else if (result.result === "PUSH") {
      summary.pushes += 1;
    } else if (result.result === "VOID") {
      summary.voids += 1;
    } else if (result.result === "PENDING") {
      summary.pending += 1;
    } else if (result.result === "MANUAL_REVIEW") {
      summary.manualReview += 1;
    }
  });
  const decisions = summary.wins + summary.losses;
  summary.winPercentage = decisions ? summary.wins / decisions : null;
  summary.roi = summary.riskedUnits ? summary.units / summary.riskedUnits : null;
  return summary;
}

function dateRangeForPeriod(period, date = new Date()) {
  const base = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : date;
  const yyyyMmDd = (value) => value.toISOString().slice(0, 10);
  if (period === "daily") {
    const day = yyyyMmDd(base);
    return { period, startDate: day, endDate: day };
  }
  if (period === "weekly") {
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { period, startDate: yyyyMmDd(start), endDate: yyyyMmDd(end) };
  }
  if (period === "monthly") {
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    return { period, startDate: yyyyMmDd(start), endDate: yyyyMmDd(end) };
  }
  return { period: "all_time", startDate: "", endDate: "" };
}

function filterResultsByRange(results, range) {
  if (!range.startDate || !range.endDate) return results;
  return results.filter((result) => result.slateDate >= range.startDate && result.slateDate <= range.endDate);
}

function buildPerformance(results = [], { period = "all_time", date = new Date() } = {}) {
  const range = dateRangeForPeriod(period, date);
  return calculatePerformance(filterResultsByRange(results, range), range);
}

function buildDailyResultsContent({ slateDate, results, now = new Date().toISOString() }) {
  const summary = buildPerformance(results.filter((result) => result.slateDate === slateDate), { period: "daily", date: slateDate });
  const lines = results
    .filter((result) => result.slateDate === slateDate)
    .map((result) => {
      const icon = result.result === "WIN" ? "✓" : result.result === "LOSS" ? "✕" : result.result;
      return `${result.selectedTeam} ${result.market} ${result.frozenOdds ? (result.frozenOdds > 0 ? "+" : "") + result.frozenOdds : ""} ${icon}`;
    });
  const units = `${summary.units >= 0 ? "+" : ""}${Math.round(summary.units * 100) / 100}U`;
  return {
    id: `content_results_${sha256(`${slateDate}:${results.map((result) => result.resultHash).join(":")}`).slice(0, 18)}`,
    contentType: "DAILY_RESULTS",
    slateDate,
    sport: "baseball_mlb",
    status: "ready_for_review",
    pickSnapshotIds: [...new Set(results.filter((result) => result.slateDate === slateDate).map((result) => result.snapshotId))],
    headline: "Same Game Heat Results",
    subheadline: `${summary.wins}-${summary.losses} · ${units}`,
    caption: `SAME GAME HEAT — RESULTS\n\n${lines.join("\n")}\n\nDAY: ${summary.wins}-${summary.losses}\n${units}\n\n21+ | Bet responsibly.`,
    shortCaption: `SGH Results: ${summary.wins}-${summary.losses}, ${units}. 21+ | Bet responsibly.`,
    reelHook: "Same Game Heat results are in.",
    reelScript: `Results: ${summary.wins}-${summary.losses}, ${units}. Every pick stays on the record.`,
    storyText: `RESULTS\n${lines.join("\n")}\n${summary.wins}-${summary.losses} · ${units}`,
    reasoningSummary: "Structured settlement data only.",
    hashtags: ["#SameGameHeat", "#MLB", "#SportsBetting"],
    disclaimer: "21+ | Bet responsibly.",
    scheduledFor: null,
    createdAt: now,
    updatedAt: now,
    generatedAt: now,
    approvedAt: null,
    archivedAt: null,
    publishedAt: null,
    publicationId: null,
    generationProvider: "results-engine",
    generationModel: "deterministic",
    generationVersion: "social-results-content-v1",
    generationError: null,
    metadata: {
      results,
      dailyPerformance: summary,
      snapshotHashes: [...new Set(results.filter((result) => result.slateDate === slateDate).map((result) => result.snapshotHash))]
    }
  };
}

function parseMlbStatsGame(game) {
  const home = game?.teams?.home || {};
  const away = game?.teams?.away || {};
  return {
    gameId: String(game?.gamePk || game?.gameGuid || ""),
    homeTeam: home.team?.name || "",
    awayTeam: away.team?.name || "",
    homeScore: home.score,
    awayScore: away.score,
    sourceGameStatus: game?.status?.detailedState || game?.status?.abstractGameState || "",
    status: game?.status?.detailedState || "",
    gameCompletedAt: game?.gameDate || "",
    source: "mlb_stats_api"
  };
}

async function fetchFinalGameFromMlbStats(snapshot, { fetchImpl = fetch } = {}) {
  const gamePk = encodeURIComponent(snapshot.gameId || "");
  if (!gamePk) return null;
  const response = await fetchImpl(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
  if (!response.ok) throw new Error(`MLB Stats API ${response.status}`);
  const payload = await response.json();
  const gameData = payload.gameData || {};
  const liveData = payload.liveData || {};
  return {
    gameId: String(gameData.game?.pk || snapshot.gameId),
    homeTeam: gameData.teams?.home?.name || snapshot.homeTeam,
    awayTeam: gameData.teams?.away?.name || snapshot.awayTeam,
    homeScore: liveData.linescore?.teams?.home?.runs,
    awayScore: liveData.linescore?.teams?.away?.runs,
    sourceGameStatus: gameData.status?.detailedState || gameData.status?.abstractGameState || "",
    status: gameData.status?.detailedState || "",
    gameCompletedAt: gameData.datetime?.officialDate || "",
    source: "mlb_stats_api"
  };
}

module.exports = {
  RESULT_GRADING_VERSION,
  RESULT_VALUES,
  FINAL_RESULTS,
  TRACKED_CONTENT_TYPES,
  canonicalStringify,
  sha256,
  normalizeGameStatus,
  calculateUnits,
  gradeMoneylineSnapshot,
  createResultRecord,
  computeResultHash,
  verifyResultIntegrity,
  calculatePerformance,
  buildPerformance,
  buildDailyResultsContent,
  parseMlbStatsGame,
  fetchFinalGameFromMlbStats
};

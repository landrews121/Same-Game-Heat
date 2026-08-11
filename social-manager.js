const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  GRAPHIC_TEMPLATE_VERSION,
  GRAPHIC_RENDER_VERSION,
  GRAPHIC_FORMATS,
  renderSocialGraphic
} = require("./social-graphics");
const {
  FINAL_RESULTS,
  TRACKED_CONTENT_TYPES,
  buildPerformance,
  buildDailyResultsContent,
  createResultRecord,
  verifyResultIntegrity,
  fetchFinalGameFromMlbStats
} = require("./social-results");
const {
  rasterizeApprovedSvg,
  verifyAssetHash,
  rejectLocalAssetUrl,
  createPublicationRecord,
  computePublicationHash,
  verifyPublicationIntegrity,
  ensureDisclaimer,
  approvedCaptionForPublication
} = require("./social-publications");
const { createInstagramPublisher, safeErrorMessage } = require("./instagram-publisher");
const { runInstagramDiagnostics } = require("./instagram-diagnostics");

const SNAPSHOT_VERSION = "social-pick-v1";
const GENERATION_VERSION = "social-content-v1";
const DEFAULT_DISCLAIMER = "21+ | Bet responsibly.";
const DEFAULT_SOCIAL_HASHTAGS = [
  "#MLB",
  "#MLBPicks",
  "#MLBBetting",
  "#BaseballPicks",
  "#SportsBetting",
  "#SameGameHeat"
];
const DAILY_3_FALLBACK_SENTENCE = "These are the three sides I like most on today’s board.";
const SOCIAL_COOKIE = "sgh_social_admin";
const SOCIAL_CONTENT_TYPES = new Set([
  "DAILY_3",
  "BEST_BET",
  "PICK_BREAKDOWN",
  "DAILY_RESULTS",
  "WEEKLY_RESULTS"
]);
const SOCIAL_STATUSES = new Set([
  "draft",
  "ready_for_review",
  "approved",
  "scheduled",
  "published",
  "failed",
  "archived"
]);
const ACTIVE_SOCIAL_CONTENT_STATUSES = new Set(["draft", "ready_for_review", "approved", "scheduled", "published"]);
const SOCIAL_GRAPHIC_STATUSES = new Set(["rendered", "approved", "failed", "archived"]);
const PROHIBITED_PHRASES = [
  "GUARANTEED",
  "CAN'T LOSE",
  "CAN’T LOSE",
  "CAN'T MISS",
  "CAN’T MISS",
  "FREE MONEY",
  "LOCK OF THE CENTURY",
  "MORTGAGE PLAY",
  "RISK IT ALL",
  "BET YOUR HOUSE",
  "100% CERTAIN",
  "SURE THING",
  "NO RISK"
];
const BRAND_STYLE_EXCLUSIONS = [
  "WINNING PICKS",
  "WE'VE GOT YOU COVERED",
  "WE’VE GOT YOU COVERED",
  "EASY WINNER",
  "SMASH PLAY",
  "CASH IT",
  "LET'S GET PAID",
  "LET’S GET PAID",
  "BANKROLL BUILDER",
  "PRINTING MONEY",
  "CHECK OUT OUR PICKS",
  "DON'T MISS OUT",
  "DON’T MISS OUT",
  "GET READY",
  "LOOKING FOR WINNING PICKS",
  "HERE ARE SOME GREAT BETS",
  "BIG OPPORTUNITY",
  "TAKE ADVANTAGE",
  "EASY MONEY"
];
const ALLOWED_SOCIAL_SPORT = "baseball_mlb";
const ALLOWED_MARKETS = new Set(["h2h", "moneyline", "money line", "ml", "mlb moneyline"]);
const ALLOWED_HOME_AWAY = new Set(["Home", "Away"]);
const ALLOWED_CONFIDENCE_LABELS = new Set(["High", "Medium", "Lean", "Best Available", "No Play", "Playable Edge"]);

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

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeStringArray(value, { splitPattern = null } = {}) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeStringArray(item, { splitPattern }));
  }
  if (typeof value === "string") {
    const trimmed = cleanString(value);
    if (!trimmed) return [];
    return splitPattern ? trimmed.split(splitPattern).map(cleanString).filter(Boolean) : [trimmed];
  }
  return [];
}

function uniqueStrings(values = []) {
  return [...new Set(normalizeStringArray(values))];
}

function normalizeHashtags(value) {
  const tags = normalizeStringArray(value, { splitPattern: /[\s,]+/ })
    .map((tag) => tag.startsWith("#") ? tag : `#${tag}`)
    .filter((tag) => /^#[A-Za-z0-9_]+$/.test(tag));
  return uniqueStrings(tags);
}

function captionHashtagBlock(hashtags = DEFAULT_SOCIAL_HASHTAGS) {
  const normalized = normalizeHashtags(hashtags).slice(0, 8);
  return normalized.length ? normalized.join(" ") : DEFAULT_SOCIAL_HASHTAGS.join(" ");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSocialAiTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 15000;
  return Math.min(60000, Math.max(3000, Math.round(parsed)));
}

function sanitizeSocialAiMessage(message, secrets = []) {
  let safe = cleanString(message, "OpenAI request failed");
  for (const secret of secrets.filter(Boolean)) {
    safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/authorization:\s*[^\s,}]+/gi, "authorization: [redacted]")
    .slice(0, 260);
}

async function readOpenAiErrorMessage(response, secrets = []) {
  const body = await response.text().catch(() => "");
  let detail = cleanString(response.statusText, "request failed");
  if (body) {
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message || parsed?.error?.code || parsed?.error?.type || body;
    } catch {
      detail = body;
    }
  }
  return sanitizeSocialAiMessage(`OpenAI ${response.status}: ${detail}`, secrets);
}

function normalizeContentType(contentType) {
  const normalized = cleanString(contentType || "DAILY_3").toUpperCase();
  if (!SOCIAL_CONTENT_TYPES.has(normalized)) throw new Error("Unsupported social content type");
  return normalized;
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, inner]) => {
    if (/api[_-]?key|secret|token|authorization|password/i.test(key)) return acc;
    acc[key] = stripSecrets(inner);
    return acc;
  }, {});
}

function socialId(prefix, payload) {
  return `${prefix}_${sha256(canonicalStringify(payload)).slice(0, 18)}`;
}

function normalizedName(value) {
  return cleanString(value).toLowerCase().replace(/\s+/g, " ");
}

function validationError(message) {
  const error = new Error(`Invalid social snapshot: ${message}`);
  error.statusCode = 400;
  return error;
}

function assertDate(value, field) {
  const string = cleanString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(string)) throw validationError(`${field} must be YYYY-MM-DD`);
  return string;
}

function assertRequiredString(value, field) {
  const string = cleanString(value);
  if (!string) throw validationError(`${field} is required`);
  return string;
}

function assertFiniteRange(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw validationError(`${field} must be between ${min} and ${max}`);
  }
  return number;
}

function assertIntegerRange(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function assertAmericanOdds(value, field, { nullable = true } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || (number > -100 && number < 100) || Math.abs(number) > 100000) {
    throw validationError(`${field} must be valid American odds or null`);
  }
  return number;
}

function assertArray(value, field, { optional = false } = {}) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw validationError(`${field} must be an array`);
  return value;
}

function snapshotHashInput(snapshot) {
  const {
    id,
    snapshotHash,
    snapshotCreatedAt,
    integrityStatus,
    integrityError,
    ...hashInput
  } = snapshot || {};
  return hashInput;
}

function computeSnapshotHash(snapshot) {
  return sha256(canonicalStringify(snapshotHashInput(snapshot)));
}

function verifySnapshotIntegrity(snapshot) {
  if (!snapshot?.snapshotHash) {
    return { ...snapshot, integrityStatus: "failed", integrityError: "Missing snapshotHash" };
  }
  const expected = computeSnapshotHash(snapshot);
  if (expected !== snapshot.snapshotHash) {
    return {
      ...snapshot,
      integrityStatus: "failed",
      integrityError: `snapshotHash mismatch: expected ${expected}, stored ${snapshot.snapshotHash}`
    };
  }
  return { ...snapshot, integrityStatus: "verified" };
}

function validateSocialPickInput(input = {}, options = {}) {
  const slateDate = assertDate(input.slateDate || options.slateDate, "slateDate");
  const sport = cleanString(input.sport || options.sport || ALLOWED_SOCIAL_SPORT);
  if (sport !== ALLOWED_SOCIAL_SPORT) throw validationError("sport must equal baseball_mlb");
  const gameId = assertRequiredString(input.gameId || input.game?.id, "gameId");
  const gameLabel = assertRequiredString(input.gameLabel, "gameLabel");
  const homeTeam = assertRequiredString(input.homeTeam || input.game?.homeTeam, "homeTeam");
  const awayTeam = assertRequiredString(input.awayTeam || input.game?.awayTeam, "awayTeam");
  const selectedTeam = assertRequiredString(input.selectedTeam || input.team, "selectedTeam");
  const opponent = assertRequiredString(input.opponent, "opponent");
  const selectedKey = normalizedName(selectedTeam);
  const opponentKey = normalizedName(opponent);
  const homeKey = normalizedName(homeTeam);
  const awayKey = normalizedName(awayTeam);
  if (selectedKey !== homeKey && selectedKey !== awayKey) {
    throw validationError("selectedTeam must match homeTeam or awayTeam");
  }
  if (selectedKey === opponentKey) throw validationError("selectedTeam and opponent must not be equal");
  const expectedOpponent = selectedKey === homeKey ? awayKey : homeKey;
  if (opponentKey !== expectedOpponent) throw validationError("opponent must be the opposite team");
  const homeOrAway = cleanString(input.homeOrAway || (selectedKey === homeKey ? "Home" : selectedKey === awayKey ? "Away" : ""));
  if (!ALLOWED_HOME_AWAY.has(homeOrAway)) throw validationError("homeOrAway must be Home or Away");
  if ((homeOrAway === "Home" && selectedKey !== homeKey) || (homeOrAway === "Away" && selectedKey !== awayKey)) {
    throw validationError("homeOrAway does not match selectedTeam");
  }
  const market = cleanString(input.market || "Moneyline");
  if (!ALLOWED_MARKETS.has(normalizedName(market))) throw validationError("market must be h2h/Moneyline");
  const originalPickRank = assertIntegerRange(input.originalPickRank ?? options.originalPickRank, "originalPickRank", 1, 3);
  const modelWinProbability = assertFiniteRange(input.modelWinProbability, "modelWinProbability", 0, 1);
  const finalScore = assertFiniteRange(input.finalScore, "finalScore", 0, 100);
  const matchupEdge = assertFiniteRange(input.matchupEdge, "matchupEdge", -200, 200);
  const confidenceTier = assertIntegerRange(input.confidenceTier ?? input.tier?.tier, "confidenceTier", 0, 3);
  const confidenceLabel = assertRequiredString(input.confidenceLabel || input.tier?.label, "confidenceLabel");
  if (!ALLOWED_CONFIDENCE_LABELS.has(confidenceLabel)) throw validationError("confidenceLabel is not recognized");
  assertArray(input.reasons, "reasons");
  assertArray(input.components, "components");
  assertArray(input.riskFlags, "riskFlags");
  assertArray(input.passReasons, "passReasons", { optional: true });
  return {
    slateDate,
    sport,
    gameId,
    gameStartTime: cleanString(input.gameStartTime || input.game?.commenceTime || ""),
    gameLabel,
    homeTeam,
    awayTeam,
    selectedTeam,
    opponent,
    homeOrAway,
    market,
    sportsbookOdds: assertAmericanOdds(input.sportsbookOdds ?? input.odds ?? input.moneyline?.odds, "sportsbookOdds"),
    modelWinProbability,
    finalScore,
    confidenceTier,
    confidenceLabel,
    matchupEdge,
    fairOdds: assertAmericanOdds(input.fairOdds, "fairOdds"),
    playableThrough: assertAmericanOdds(input.playableThrough, "playableThrough"),
    originalPickRank
  };
}

function createSocialPickSnapshot(input = {}, options = {}) {
  const raw = stripSecrets(input.rawSnapshotPayload || input);
  const validated = validateSocialPickInput(input, options);
  const createdAt = options.createdAt || new Date().toISOString();

  const snapshotCore = {
    snapshotVersion: SNAPSHOT_VERSION,
    snapshotCreatedAt: createdAt,
    slateDate: validated.slateDate,
    sport: validated.sport,
    gameId: validated.gameId,
    gameStartTime: validated.gameStartTime,
    gameLabel: validated.gameLabel,
    gameNumber: input.gameNumber ?? null,
    homeTeam: validated.homeTeam,
    awayTeam: validated.awayTeam,
    selectedTeam: validated.selectedTeam,
    opponent: validated.opponent,
    homeOrAway: validated.homeOrAway,
    market: validated.market,
    line: input.line ?? null,
    sportsbook: cleanString(input.sportsbook || input.bookTitle || ""),
    sportsbookOdds: validated.sportsbookOdds,
    modelWinProbability: validated.modelWinProbability,
    finalScore: validated.finalScore,
    confidenceTier: validated.confidenceTier,
    confidenceLabel: validated.confidenceLabel,
    matchupEdge: validated.matchupEdge,
    fairOdds: validated.fairOdds,
    playableThrough: validated.playableThrough,
    starterName: cleanString(input.starterName || ""),
    dataComplete: Boolean(input.dataComplete),
    isBackfill: Boolean(input.isBackfill),
    reasons: uniqueStrings(input.reasons || []),
    components: Array.isArray(input.components) ? input.components.map(stripSecrets) : [],
    riskFlags: uniqueStrings(input.riskFlags || []),
    passReasons: uniqueStrings(input.passReasons || []),
    sourceBoardType: cleanString(input.sourceBoardType || options.sourceBoardType || "MLB_DAILY_3"),
    originalPickRank: validated.originalPickRank,
    appBuildVersion: cleanString(input.appBuildVersion || options.appBuildVersion || ""),
    boardBuildVersion: cleanString(input.boardBuildVersion || options.boardBuildVersion || ""),
    moneylineModelVersion: cleanString(input.moneylineModelVersion || options.moneylineModelVersion || ""),
    rawSnapshotPayload: raw
  };
  const snapshotHash = computeSnapshotHash(snapshotCore);
  return {
    id: socialId("snap", { snapshotHash }),
    ...snapshotCore,
    snapshotHash
  };
}

function prohibitedHits(text) {
  const haystack = String(text || "").toUpperCase();
  return PROHIBITED_PHRASES.filter((phrase) => haystack.includes(phrase));
}

function validateNoProhibitedLanguage(record) {
  const text = canonicalStringify(record);
  return prohibitedHits(text);
}

function brandStyleHits(text) {
  const haystack = String(text || "").toUpperCase();
  return BRAND_STYLE_EXCLUSIONS.filter((phrase) => haystack.includes(phrase));
}

function pickLine(snapshot) {
  const odds = formatAmericanOdds(snapshot.sportsbookOdds);
  return `${snapshot.selectedTeam} ${marketLabel(snapshot.market)}${odds ? ` ${odds}` : ""}`.trim();
}

function marketLabel(market) {
  const normalized = cleanString(market);
  return /money\s*line|moneyline|^ml$/i.test(normalized) ? "ML" : normalized;
}

function formatModelWinProbability(value) {
  const number = toNumber(value, null);
  if (number === null) return "";
  const percent = number <= 1 ? number * 100 : number;
  return `${percent.toFixed(1)}%`;
}

function formatAmericanOdds(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number > 0 ? `+${number}` : String(number);
}

function ordinalEmoji(index) {
  return ["1️⃣", "2️⃣", "3️⃣"][index] || `${index + 1}.`;
}

function snapshotReason(snapshot) {
  return cleanString(snapshot.reasons?.[0] || snapshot.passReasons?.[0] || "The model liked the matchup profile.");
}

function sentence(value) {
  const text = cleanString(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function snapshotRisk(snapshot) {
  return cleanString(snapshot.riskFlags?.[0] || "Price matters. Confirm the current number before betting.");
}

function snapshotReasons(snapshot) {
  const reasons = uniqueStrings(snapshot.reasons || []);
  return reasons.length ? reasons : [snapshotReason(snapshot)];
}

function snapshotPriceContext(snapshot) {
  const fairOdds = formatAmericanOdds(snapshot.fairOdds);
  const playableThrough = formatAmericanOdds(snapshot.playableThrough);
  if (fairOdds && playableThrough) return `SGH fair price: ${fairOdds} | Playable through: ${playableThrough}`;
  if (fairOdds) return `SGH fair price: ${fairOdds}`;
  if (playableThrough) return `Playable through: ${playableThrough}`;
  return "";
}

function publicMaterialLimitations(snapshots = []) {
  const notes = [];
  for (const snapshot of snapshots) {
    for (const flag of uniqueStrings(snapshot.riskFlags || [])) {
      if (/consensus|selected book.*unavailable|book.*unavailable|odds.*used/i.test(flag)) {
        const book = cleanString(snapshot.sportsbook);
        notes.push(book && /selected book/i.test(flag)
          ? `Price note: ${book} was unavailable at capture, so consensus odds were used.`
          : `Price note: ${flag}`);
      } else if (/lineup.*incomplete|incomplete.*lineup/i.test(flag)) {
        notes.push(`Data note: ${flag}`);
      }
    }
  }
  return uniqueStrings(notes);
}

function disclaimerRegex() {
  return /21\+\s*\|\s*Bet responsibly\.?/gi;
}

function ensureFinalDisclaimer(text) {
  const body = cleanString(text)
    .replace(disclaimerRegex(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return body ? `${body}\n\n${DEFAULT_DISCLAIMER}` : DEFAULT_DISCLAIMER;
}

function ensureInlineDisclaimer(text) {
  const body = cleanString(text)
    .replace(disclaimerRegex(), "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return body ? `${body} ${DEFAULT_DISCLAIMER}` : DEFAULT_DISCLAIMER;
}

function disclaimerCount(text) {
  return (cleanString(text).match(disclaimerRegex()) || []).length;
}

function assertSingleApprovedDisclaimer(caption) {
  if (disclaimerCount(caption) !== 1) throw validationError("Approved caption must contain exactly one responsible gambling disclaimer.");
}

function assertDaily3CaptionComplete(content, snapshots) {
  if (content?.contentType !== "DAILY_3") return;
  const caption = cleanString(content.caption).toLowerCase();
  const missingTeams = snapshots
    .slice(0, 3)
    .map((snapshot) => cleanString(snapshot.selectedTeam))
    .filter(Boolean)
    .filter((team) => !caption.includes(team.toLowerCase()));
  if (missingTeams.length || snapshots.length < 3) {
    throw validationError("Approved Daily 3 caption is incomplete. Live publication aborted.");
  }
}

function deterministicDailyShortCaption(snapshots) {
  return ensureFinalDisclaimer(`🔥 DAILY 3: ${snapshots.slice(0, 3).map(pickLine).join(" | ")}\n\n${captionHashtagBlock(["#MLB", "#MLBPicks", "#SameGameHeat"])}`);
}

function deterministicDailyStoryText(snapshots) {
  return `🔥 DAILY 3\n\n${snapshots.slice(0, 3).map(pickLine).join("\n")}\n\n@sg_heater`;
}

function genericHookReplacement() {
  return "Three MLB sides I like today.";
}

function isGenericHook(text) {
  return brandStyleHits(text).length > 0 || /curious about|looking for picks|model insights/i.test(cleanString(text));
}

function extractSentences(text) {
  return cleanString(text)
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+|;\s+/)
    .map(cleanString)
    .filter(Boolean);
}

function safeDaily3Sentence(value, snapshots = []) {
  const firstSentence = extractSentences(value)[0] || "";
  const candidate = cleanString(firstSentence)
    .replace(disclaimerRegex(), "")
    .replace(/#[A-Za-z0-9_]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!candidate) return "";
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length > 20) return "";
  if (validateNoProhibitedLanguage({ candidate }).length || brandStyleHits(candidate).length) return "";
  if (/model|probability|fair|playable|edge|risk|guarantee|lock|cash|win rate|score|tier/i.test(candidate)) return "";
  if (/[+-]\d{2,4}|\b\d{1,3}(?:\.\d)?%/.test(candidate)) return "";
  const teamNames = snapshots.map((snapshot) => cleanString(snapshot.selectedTeam).toLowerCase()).filter(Boolean);
  if (teamNames.some((team) => candidate.toLowerCase().includes(team))) return "";
  return sentence(candidate);
}

function safeAiReason(value, snapshots, snapshot) {
  const reason = sentence(value);
  if (!reason) return "";
  const lower = reason.toLowerCase();
  const otherTeams = snapshots
    .filter((item) => cleanString(item.selectedTeam).toLowerCase() !== cleanString(snapshot.selectedTeam).toLowerCase())
    .map((item) => cleanString(item.selectedTeam).toLowerCase())
    .filter(Boolean);
  if (validateNoProhibitedLanguage({ reason }).length || brandStyleHits(reason).length) return "";
  if (otherTeams.some((team) => lower.includes(team))) return "";
  if (/\b[1-3][.)]\s|[1-3]️⃣|model win probability|sgh fair price|playable through|price matters|21\+|bet responsibly|same game heat|daily 3|🔥/i.test(reason)) return "";
  if (reason.split(/\s+/).length > 34) return "";
  return reason;
}

function extractAiReasonForSnapshot(output, normalized, snapshot, index) {
  const pickReasons = Array.isArray(output?.pickReasons) ? output.pickReasons : [];
  const matchedReason = pickReasons.find((item) => {
    if (!isPlainObject(item)) return false;
    const rank = toNumber(item.rank, null);
    const team = cleanString(item.team);
    return (rank === index + 1 || !rank) && (!team || team.toLowerCase() === cleanString(snapshot.selectedTeam).toLowerCase());
  });
  if (matchedReason) {
    const reason = safeAiReason(matchedReason.reason, snapshotsForReasons(output, normalized), snapshot);
    if (reason) return reason;
  }

  const haystack = [normalized.reasoningSummary, normalized.reelScript].join(" ");
  const team = cleanString(snapshot.selectedTeam);
  const sentenceMatch = extractSentences(haystack).find((item) => team && item.toLowerCase().includes(team.toLowerCase()));
  const reason = safeAiReason(sentenceMatch, snapshotsForReasons(output, normalized), snapshot);
  if (reason) return reason;
  return sentence(snapshotReason(snapshot));
}

function snapshotsForReasons(output, normalized) {
  return Array.isArray(output?.__snapshotsForReasons) ? output.__snapshotsForReasons : Array.isArray(normalized?.__snapshotsForReasons) ? normalized.__snapshotsForReasons : [];
}

function buildDaily3Caption(snapshots, safeAiReasons = []) {
  const sentenceLine = safeDaily3Sentence(Array.isArray(safeAiReasons) ? safeAiReasons[0] : safeAiReasons, snapshots) || DAILY_3_FALLBACK_SENTENCE;
  const pickLines = snapshots.slice(0, 3).map((snapshot, index) => `${ordinalEmoji(index)} ${pickLine(snapshot)}`);
  return ensureFinalDisclaimer(`🔥 SAME GAME HEAT — DAILY 3\n\n${pickLines.join("\n")}\n\n${sentenceLine}\n\n${captionHashtagBlock()}`);
}

function buildHybridDailyCaption(output, normalized, snapshots) {
  const aiSentence = safeDaily3Sentence(
    output?.daily3Sentence || output?.sentence || output?.hook || normalized.reelHook || normalized.reasoningSummary || normalized.caption,
    snapshots
  );
  return buildDaily3Caption(snapshots, aiSentence);
}

function snapshotAllowedNumbers(snapshots) {
  const allowed = new Set();
  for (const snapshot of snapshots) {
    for (const value of [snapshot.sportsbookOdds, snapshot.fairOdds, snapshot.playableThrough]) {
      const odds = formatAmericanOdds(value);
      if (odds) allowed.add(odds);
    }
    const probability = formatModelWinProbability(snapshot.modelWinProbability);
    if (probability) allowed.add(probability);
  }
  return allowed;
}

function findWrongSnapshotValues(text, snapshots) {
  const allowed = snapshotAllowedNumbers(snapshots);
  const found = uniqueStrings([
    ...(cleanString(text).match(/[+-]\d{2,4}/g) || []),
    ...(cleanString(text).match(/\b\d{1,3}(?:\.\d)?%/g) || [])
  ]);
  return found.filter((value) => !allowed.has(value));
}

function classifyAiCopyFailures(output, contentType, snapshots) {
  const { normalized } = normalizeGeneratedContent(output, contentType, snapshots);
  const failures = validateAiCopyQuality(output, contentType, snapshots);
  const hardFailures = [];
  const repairableFailures = [];
  const combined = [normalized.headline, normalized.caption, normalized.shortCaption, normalized.reelHook, normalized.reelScript, normalized.storyText].join("\n");
  const captionStyleHits = brandStyleHits([normalized.headline, normalized.caption, normalized.shortCaption, normalized.reelScript].join("\n"));
  if (captionStyleHits.length) hardFailures.push(`Generic brand phrasing detected: ${captionStyleHits.join(", ")}`);
  const wrongValues = findWrongSnapshotValues(combined, snapshots);
  if (wrongValues.length) hardFailures.push(`AI copy changed or invented snapshot values: ${wrongValues.join(", ")}`);

  for (const failure of failures) {
    if (/Generic brand phrasing/.test(failure)) {
      if (!captionStyleHits.length) repairableFailures.push(failure);
      continue;
    }
    if (/DAILY_3 caption omitted supplied teams/.test(failure)) {
      repairableFailures.push(failure);
      continue;
    }
    if (/caption omitted supplied frozen odds|caption did not start|lacked compact pick-list structure|caption must end|caption was too long|caption included internal metrics|caption must include|caption omitted #SameGameHeat|short caption omitted|short caption was too long|short caption included internal metrics|reel hook was too long|story text was too long|Responsible gambling disclaimer missing/.test(failure)) {
      repairableFailures.push(failure);
      continue;
    }
    hardFailures.push(failure);
  }
  return {
    normalized,
    hardFailures: uniqueStrings(hardFailures),
    repairableFailures: uniqueStrings(repairableFailures)
  };
}

function repairGeneratedSocialCopy({ contentType, generated, snapshots }) {
  const safeOutput = isPlainObject(generated) ? generated : {};
  const { normalized, hardFailures, repairableFailures } = classifyAiCopyFailures(safeOutput, contentType, snapshots);
  if (hardFailures.length) return { output: normalized, hardFailures, repairReasons: [] };

  const repaired = { ...normalized };
  const repairReasons = [];
  if (contentType === "DAILY_3") {
    const originalCaption = repaired.caption;
    const originalShortCaption = repaired.shortCaption;
    const originalStoryText = repaired.storyText;
    repaired.caption = buildHybridDailyCaption(safeOutput, normalized, snapshots);
    repaired.shortCaption = deterministicDailyShortCaption(snapshots);
    repaired.storyText = deterministicDailyStoryText(snapshots);
    repaired.reelHook = safeDaily3Sentence(repaired.reelHook, snapshots) || genericHookReplacement();
    repaired.reelScript = `${repaired.reelHook} ${snapshots.slice(0, 3).map(pickLine).join(", ")}. ${DEFAULT_DISCLAIMER}`;
    if (repaired.caption !== originalCaption) repairReasons.push("daily_3_caption_canonicalized");
    if (repaired.shortCaption !== originalShortCaption) repairReasons.push("short_caption_rebuilt");
    if (repaired.storyText !== originalStoryText) repairReasons.push("story_text_rebuilt");
  } else {
    const caption = ensureFinalDisclaimer(repaired.caption);
    if (caption !== repaired.caption) {
      repaired.caption = caption;
      repairReasons.push("disclaimer_normalized");
    }
  }

  if (!repaired.hashtags.length) {
    repaired.hashtags = localSocialTemplate(contentType, snapshots).hashtags;
    repairReasons.push("hashtags_rebuilt");
  }
  repaired.hashtags = normalizeHashtags(repaired.hashtags).slice(0, 8);
  if (contentType === "DAILY_3" && repaired.reelHook === genericHookReplacement() && isGenericHook(normalized.reelHook)) repairReasons.push("reel_hook_rebuilt");
  if (repairReasons.length || repairableFailures.length) {
    repaired.presentationRepaired = true;
    repaired.repairReasons = uniqueStrings([...repairReasons, ...repairableFailures.map((failure) => failure.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""))]);
    repaired.warnings = uniqueStrings([...(repaired.warnings || []), "AI copy was reformatted to SGH publishing standards."]);
  }

  const finalFailures = validateAiCopyQuality(repaired, contentType, snapshots);
  const prohibited = validateNoProhibitedLanguage(repaired);
  if (finalFailures.length || prohibited.length) {
    return {
      output: repaired,
      hardFailures: uniqueStrings([...finalFailures, ...prohibited.map((hit) => `Prohibited language detected: ${hit}`)]),
      repairReasons: repaired.repairReasons || []
    };
  }
  return { output: repaired, hardFailures: [], repairReasons: repaired.repairReasons || [] };
}

function localSocialTemplate(contentType, snapshots) {
  const first = snapshots[0];
  const headline = contentType === "BEST_BET"
    ? `Best Bet: ${pickLine(first || {})}`
    : contentType === "PICK_BREAKDOWN"
      ? `${first?.selectedTeam || "Pick"} vs ${first?.opponent || "Opponent"} — SGH Breakdown`
      : "Same Game Heat Daily 3";
  const reasoning = snapshots.map((snapshot) => {
    const probability = formatModelWinProbability(snapshot.modelWinProbability);
    return `${snapshot.selectedTeam}: ${probability ? `${probability} model win probability. ` : ""}${sentence(snapshotReason(snapshot))} Risk to watch: ${snapshotRisk(snapshot)}`;
  });
  const priceNote = "Confirm the current number before betting.";
  const bestBetCaption = first
    ? ensureFinalDisclaimer(`🔥 BEST BET\n\n${pickLine(first)}\n\nMy favorite side on today’s board.\n\n${captionHashtagBlock(["#MLB", "#MLBPicks", "#SportsBetting", "#SameGameHeat"])}`)
    : `${headline}\n\n${DEFAULT_DISCLAIMER}`;
  const breakdownCaption = first
    ? ensureFinalDisclaimer(`🔥 PICK BREAKDOWN\n\n${pickLine(first)}\n\n${sentence(snapshotReasons(first)[0] || snapshotReason(first))}\n${priceNote}\n\n${captionHashtagBlock(["#MLB", "#MLBPicks", "#SportsBetting", "#SameGameHeat"])}`)
    : `${headline}\n\n${DEFAULT_DISCLAIMER}`;
  const dailyCaption = buildDaily3Caption(snapshots, DAILY_3_FALLBACK_SENTENCE);

  return {
    headline,
    subheadline: first?.slateDate ? `Slate date ${first.slateDate}` : "Same Game Heat read",
    caption: contentType === "BEST_BET" ? bestBetCaption : contentType === "PICK_BREAKDOWN" ? breakdownCaption : dailyCaption,
    shortCaption: contentType === "DAILY_3"
      ? deterministicDailyShortCaption(snapshots)
      : ensureInlineDisclaimer(`${headline}: ${snapshots.map(pickLine).join(", ")}.`),
    reelHook: contentType === "DAILY_3"
      ? genericHookReplacement()
      : `${first?.selectedTeam || "This side"} separated itself in the SGH model.`,
    reelScript: contentType === "DAILY_3"
      ? `${genericHookReplacement()} ${snapshots.slice(0, 3).map(pickLine).join(", ")}. ${DEFAULT_DISCLAIMER}`
      : `${headline}. ${pickLine(first || {})}. ${sentence(snapshotReason(first || {}))} ${DEFAULT_DISCLAIMER}`,
    storyText: contentType === "DAILY_3"
      ? deterministicDailyStoryText(snapshots)
      : `🔥 ${contentType === "BEST_BET" ? "BEST BET" : "PICK"}\n\n${pickLine(first || {})}\n\n@sg_heater`,
    reasoningSummary: reasoning.join(" "),
    hashtags: DEFAULT_SOCIAL_HASHTAGS,
    disclaimer: DEFAULT_DISCLAIMER,
    warnings: []
  };
}

function normalizeGeneratedContent(output = {}, contentType, snapshots) {
  const fallback = localSocialTemplate(contentType, snapshots);
  const safeOutput = isPlainObject(output) ? output : {};
  const hashtags = normalizeHashtags(safeOutput.hashtags);
  const normalized = {
    headline: cleanString(safeOutput.headline || fallback.headline),
    subheadline: cleanString(safeOutput.subheadline || fallback.subheadline),
    caption: cleanString(safeOutput.caption || fallback.caption),
    shortCaption: cleanString(safeOutput.shortCaption || fallback.shortCaption),
    reelHook: cleanString(safeOutput.reelHook || fallback.reelHook),
    reelScript: cleanString(safeOutput.reelScript || fallback.reelScript),
    storyText: cleanString(safeOutput.storyText || fallback.storyText),
    reasoningSummary: cleanString(safeOutput.reasoningSummary || fallback.reasoningSummary),
    hashtags: (hashtags.length ? hashtags : fallback.hashtags).slice(0, 8),
    disclaimer: cleanString(safeOutput.disclaimer || DEFAULT_DISCLAIMER),
    warnings: uniqueStrings(safeOutput.warnings),
    presentationRepaired: Boolean(safeOutput.presentationRepaired),
    repairReasons: uniqueStrings(safeOutput.repairReasons)
  };
  if (!normalized.disclaimer.includes("21+")) normalized.disclaimer = DEFAULT_DISCLAIMER;
  const hits = validateNoProhibitedLanguage(normalized);
  return { normalized, prohibited: hits };
}

function validateAiCopyQuality(output, contentType, snapshots) {
  const { normalized } = normalizeGeneratedContent(output, contentType, snapshots);
  const failures = [];
  const combined = [normalized.headline, normalized.caption, normalized.shortCaption, normalized.reelHook, normalized.reelScript, normalized.storyText].join("\n");
  const styleHits = brandStyleHits(combined);
  if (styleHits.length) failures.push(`Generic brand phrasing detected: ${styleHits.join(", ")}`);
  if (contentType === "DAILY_3") {
    if (!/^🔥?\s*(SAME GAME HEAT|SGH)/i.test(normalized.caption)) {
      failures.push("DAILY_3 caption did not start with an SGH-branded headline");
    }
    const missingTeams = snapshots
      .map((snapshot) => cleanString(snapshot.selectedTeam))
      .filter((team) => team && !normalized.caption.toLowerCase().includes(team.toLowerCase()));
    if (missingTeams.length) failures.push(`DAILY_3 caption omitted supplied teams: ${missingTeams.join(", ")}`);
    const oddsSnapshots = snapshots.filter((snapshot) => snapshot.sportsbookOdds !== null && snapshot.sportsbookOdds !== undefined);
    const missingOdds = oddsSnapshots.filter((snapshot) => !normalized.caption.includes(snapshot.sportsbookOdds > 0 ? `+${snapshot.sportsbookOdds}` : String(snapshot.sportsbookOdds)));
    if (missingOdds.length) failures.push("DAILY_3 caption omitted supplied frozen odds");
    const lineBreaks = (normalized.caption.match(/\n/g) || []).length;
    if (snapshots.length >= 3 && lineBreaks < 6) failures.push("DAILY_3 caption lacked compact pick-list structure");
    if (!normalized.caption.trim().endsWith(DEFAULT_DISCLAIMER)) failures.push("DAILY_3 caption must end with responsible gambling disclaimer");
    if (normalized.caption.length > 600) failures.push("DAILY_3 caption was too long");
    if (/model win probability|fair price|playable through|confidence|score|tier/i.test(normalized.caption)) failures.push("DAILY_3 caption included internal metrics");
    if (disclaimerCount(normalized.caption) !== 1) failures.push("DAILY_3 caption must include exactly one disclaimer");
    const captionTags = normalizeHashtags(normalized.caption.match(/#[A-Za-z0-9_]+/g) || []);
    if (captionTags.length < 5 || captionTags.length > 8) failures.push("DAILY_3 caption must include 5-8 hashtags");
    if (!captionTags.includes("#SameGameHeat")) failures.push("DAILY_3 caption omitted #SameGameHeat");
    const missingShortTeams = snapshots
      .map((snapshot) => cleanString(snapshot.selectedTeam))
      .filter((team) => team && !normalized.shortCaption.toLowerCase().includes(team.toLowerCase()));
    if (missingShortTeams.length) failures.push("DAILY_3 short caption omitted supplied teams");
    const missingShortOdds = oddsSnapshots.filter((snapshot) => !normalized.shortCaption.includes(snapshot.sportsbookOdds > 0 ? `+${snapshot.sportsbookOdds}` : String(snapshot.sportsbookOdds)));
    if (missingShortOdds.length) failures.push("DAILY_3 short caption omitted supplied frozen odds");
    if (!normalized.shortCaption.includes(DEFAULT_DISCLAIMER)) failures.push("DAILY_3 short caption omitted responsible gambling disclaimer");
    if (normalized.shortCaption.length > 220) failures.push("DAILY_3 short caption was too long");
    if (/model win probability|fair price|playable through|confidence|score|tier/i.test(normalized.shortCaption)) failures.push("DAILY_3 short caption included internal metrics");
    if ((normalized.reelHook.match(/[.!?]/g) || []).length > 1 || normalized.reelHook.split(/\s+/).length > 12) failures.push("DAILY_3 reel hook was too long");
    if (normalized.storyText.length > 280) failures.push("DAILY_3 story text was too long");
  }
  if (!normalized.disclaimer.includes("21+")) failures.push("Responsible gambling disclaimer missing");
  return failures;
}

function createSocialContentRecord({ contentType, snapshots, generated, status = "ready_for_review", now = new Date().toISOString(), provider = "local-template", model = "local-template", previousContentId = null }) {
  const type = normalizeContentType(contentType);
  const { normalized, prohibited } = normalizeGeneratedContent(generated, type, snapshots);
  const safeStatus = prohibited.length ? "draft" : status;
  const core = {
    contentType: type,
    slateDate: snapshots[0]?.slateDate || "",
    sport: snapshots[0]?.sport || "baseball_mlb",
    status: safeStatus,
    pickSnapshotIds: snapshots.map((snapshot) => snapshot.id),
    headline: normalized.headline,
    subheadline: normalized.subheadline,
    caption: normalized.caption,
    shortCaption: normalized.shortCaption,
    reelHook: normalized.reelHook,
    reelScript: normalized.reelScript,
    storyText: normalized.storyText,
    reasoningSummary: normalized.reasoningSummary,
    hashtags: normalized.hashtags,
    disclaimer: normalized.disclaimer,
    scheduledFor: null,
    createdAt: now,
    updatedAt: now,
    generatedAt: now,
    approvedAt: null,
    archivedAt: null,
    publishedAt: null,
    publicationId: null,
    generationProvider: provider,
    generationModel: model,
    generationVersion: GENERATION_VERSION,
    generationError: prohibited.length ? `Prohibited language detected: ${prohibited.join(", ")}` : null,
    metadata: {
      warnings: normalized.warnings,
      presentationRepaired: normalized.presentationRepaired,
      repairReasons: normalized.repairReasons,
      previousContentId,
      snapshotHashes: snapshots.map((snapshot) => snapshot.snapshotHash)
    }
  };
  return {
    id: socialId("content", { type, now, snapshots: snapshots.map((snapshot) => snapshot.snapshotHash), previousContentId }),
    ...core
  };
}

function approveSocialContent(content, now = new Date().toISOString()) {
  if (!content || content.status === "archived") throw new Error("Archived content cannot be approved");
  return { ...content, status: "approved", approvedAt: now, updatedAt: now };
}

function archiveSocialContent(content, now = new Date().toISOString()) {
  if (!content) throw new Error("Content not found");
  return { ...content, status: "archived", archivedAt: now, updatedAt: now };
}

function isActiveSocialContent(content) {
  return ACTIVE_SOCIAL_CONTENT_STATUSES.has(cleanString(content?.status));
}

function createSocialGraphicRecord({ content, snapshots, format, rendered, status = "rendered", now = new Date().toISOString(), renderVersionNumber = 1, assetPath = "", assetUrl = "", fileSize = 0, generationError = null }) {
  const safeStatus = SOCIAL_GRAPHIC_STATUSES.has(status) ? status : "failed";
  const normalizedFormat = GRAPHIC_FORMATS[format] ? format : "feed";
  const dimensions = GRAPHIC_FORMATS[normalizedFormat];
  const snapshotHashes = rendered?.snapshotHashes?.length ? rendered.snapshotHashes : snapshots.map((snapshot) => snapshot.snapshotHash).filter(Boolean);
  const snapshotIds = rendered?.snapshotIds?.length ? rendered.snapshotIds : snapshots.map((snapshot) => snapshot.id).filter(Boolean);
  const payloadCore = {
    socialContentId: content.id,
    contentType: content.contentType,
    slateDate: content.slateDate,
    format: normalizedFormat,
    width: rendered?.width || dimensions.width,
    height: rendered?.height || dimensions.height,
    templateVersion: rendered?.templateVersion || GRAPHIC_TEMPLATE_VERSION,
    renderVersion: `${GRAPHIC_RENDER_VERSION}.${renderVersionNumber}`,
    renderVersionNumber,
    snapshotIds,
    snapshotHashes,
    renderedInputHash: rendered?.renderedInputHash || "",
    createdAt: now
  };
  return {
    id: socialId("graphic", payloadCore),
    socialContentId: content.id,
    contentType: content.contentType,
    slateDate: content.slateDate,
    format: normalizedFormat,
    width: payloadCore.width,
    height: payloadCore.height,
    templateVersion: payloadCore.templateVersion,
    renderVersion: payloadCore.renderVersion,
    renderVersionNumber,
    assetStatus: safeStatus,
    status: safeStatus,
    assetPath,
    assetUrl,
    mimeType: rendered?.mimeType || "image/svg+xml",
    fileSize,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    archivedAt: null,
    generationError,
    snapshotIds,
    snapshotHashes,
    metadata: {
      renderedInputHash: payloadCore.renderedInputHash,
      formatLabel: GRAPHIC_FORMATS[normalizedFormat].label
    }
  };
}

function approveSocialGraphic(graphic, now = new Date().toISOString()) {
  if (!graphic || graphic.status === "archived") throw new Error("Archived graphic cannot be approved");
  return { ...graphic, status: "approved", assetStatus: "approved", approvedAt: now, updatedAt: now };
}

function archiveSocialGraphic(graphic, now = new Date().toISOString()) {
  if (!graphic) throw new Error("Graphic not found");
  return { ...graphic, status: "archived", assetStatus: "archived", archivedAt: now, updatedAt: now };
}

function socialContentFromRows(rows = []) {
  return rows.map((row) => row.payload || row).filter(Boolean);
}

function socialSnapshotsFromRows(rows = []) {
  return rows.map((row) => row.payload || row).filter(Boolean).map(verifySnapshotIntegrity);
}

function socialGraphicsFromRows(rows = []) {
  return rows.map((row) => row.payload || row).filter(Boolean);
}

function socialResultsFromRows(rows = []) {
  return rows.map((row) => row.payload || row).filter(Boolean).map(verifyResultIntegrity);
}

function safeDiagnosticError(candidate) {
  const error = candidate.identity?.error || candidate.media?.error || null;
  if (!error) return null;
  return {
    httpStatus: error.httpStatus || 0,
    type: cleanString(error.type),
    code: error.code ?? null,
    subcode: error.error_subcode ?? null,
    message: cleanString(error.message),
    traceId: cleanString(error.fbtrace_id)
  };
}

function buildSafeInstagramDiagnosticsPayload(diagnostics, env = process.env) {
  const configuredInstagramUserId = cleanString(env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || "");
  const recommendedInstagramUserId = cleanString(diagnostics.recommendedInstagramUserId || "");
  let configuredIdMatchStatus = "unknown";
  if (configuredInstagramUserId && recommendedInstagramUserId) {
    configuredIdMatchStatus = configuredInstagramUserId === recommendedInstagramUserId ? "match" : "mismatch";
  } else if (configuredInstagramUserId) {
    configuredIdMatchStatus = "configured_no_recommendation";
  } else if (recommendedInstagramUserId) {
    configuredIdMatchStatus = "recommendation_available";
  }

  return {
    tokenConfigured: Boolean(diagnostics.tokenConfigured),
    graphApiVersion: cleanString(diagnostics.graphApiVersion),
    expectedUsername: cleanString(diagnostics.expectedUsername),
    dryRun: Boolean(diagnostics.dryRun),
    configuredInstagramUserId,
    configuredIdMatchStatus,
    recommendedInstagramUserId,
    ambiguous: Boolean(diagnostics.ambiguous),
    readyForDryRunPublishing: Boolean(diagnostics.readyForDryRunPublishing),
    checkedAt: diagnostics.checkedAt,
    candidates: (diagnostics.candidates || []).map((candidate) => ({
      id: cleanString(candidate.id),
      classification: cleanString(candidate.classification || "unknown"),
      username: cleanString(candidate.username),
      accountType: cleanString(candidate.accountType),
      mediaEdgeReadable: Boolean(candidate.mediaEdgeReadable),
      mediaCount: candidate.mediaCount ?? null,
      matchesExpectedInstagramAccount: Boolean(candidate.matchesExpectedInstagramAccount),
      recommended: Boolean(candidate.recommended),
      error: safeDiagnosticError(candidate),
      optionalProbeErrors: (candidate.optionalProbeErrors || []).map((optional) => ({
        probe: cleanString(optional.probe),
        error: optional.error ? {
          httpStatus: optional.error.httpStatus || 0,
          type: cleanString(optional.error.type),
          code: optional.error.code ?? null,
          subcode: optional.error.error_subcode ?? null,
          message: cleanString(optional.error.message),
          traceId: cleanString(optional.error.fbtrace_id)
        } : null
      }))
    }))
  };
}

function createSocialManager({ root, env = process.env, supabaseEnabled = () => false, supabaseRequest = async () => null, fetchGameResult = fetchFinalGameFromMlbStats, fetchImpl = fetch } = {}) {
  const snapshotFile = env.SOCIAL_PICK_SNAPSHOTS_FILE || path.join(root, ".social-pick-snapshots.json");
  const contentFile = env.SOCIAL_CONTENT_FILE || path.join(root, ".social-content.json");
  const graphicsFile = env.SOCIAL_GRAPHICS_FILE || path.join(root, ".social-graphics.json");
  const resultsFile = env.SOCIAL_RESULTS_FILE || path.join(root, ".social-results.json");
  const publicationsFile = env.SOCIAL_PUBLICATIONS_FILE || path.join(root, ".social-publications.json");
  const assetsDir = env.SOCIAL_ASSETS_DIR || path.join(root, ".social-assets");
  const publicationAssetsDir = env.SOCIAL_PUBLICATION_ASSETS_DIR || path.join(root, ".social-publication-assets");
  const publicationBucket = env.SOCIAL_MEDIA_ASSETS_BUCKET || "social-media-assets";
  const uploadDryRunAssets = env.SOCIAL_DRY_RUN_UPLOAD_ASSET === "true";
  const livePublishEnabled = env.SOCIAL_LIVE_PUBLISH_ENABLED === "true";
  const livePublishLocks = new Set();
  const supabaseUrl = env.SUPABASE_URL || "";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const instagram = createInstagramPublisher({ env, fetchImpl });
  const adminSecret = env.SOCIAL_ADMIN_SECRET || "";
  const openAiKey = env.OPENAI_API_KEY || "";
  const aiModel = env.SOCIAL_AI_MODEL || "gpt-4o-mini";
  const aiTimeoutMs = parseSocialAiTimeoutMs(env.SOCIAL_AI_TIMEOUT_MS);
  const secureCookie = env.NODE_ENV === "production" || env.SOCIAL_COOKIE_SECURE === "true";

  function redactConfiguredSecrets(value) {
    let text = cleanString(value);
    [
      supabaseKey,
      env.INSTAGRAM_ACCESS_TOKEN,
      env.META_ACCESS_TOKEN,
      env.OPENAI_API_KEY,
      adminSecret
    ].filter(Boolean).forEach((secret) => {
      text = text.split(secret).join("[redacted]");
    });
    return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
  }

  function sendJson(res, status, payload, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    });
    res.end(JSON.stringify(payload));
  }

  async function readJsonArray(file) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeJsonArray(file, rows) {
    await fs.writeFile(file, JSON.stringify(rows, null, 2));
  }

  function preferNewestById(map, record) {
    if (!record?.id) return;
    const existing = map.get(record.id);
    if (!existing || String(record.updatedAt || record.createdAt || "") >= String(existing.updatedAt || existing.createdAt || "")) {
      map.set(record.id, record);
    }
  }

  function attachPublicationStage(error, stage, diagnostics = {}) {
    if (!error.stage) error.stage = stage;
    error.diagnostics = {
      ...(error.diagnostics || {}),
      ...diagnostics
    };
    return error;
  }

  function publicationStep(stage, message, diagnostics = {}) {
    const error = validationError(message);
    error.stage = stage;
    error.diagnostics = diagnostics;
    return error;
  }

  async function readLocalSnapshots() {
    return (await readJsonArray(snapshotFile)).map(verifySnapshotIntegrity);
  }

  async function writeLocalSnapshots(rows) {
    await writeJsonArray(snapshotFile, rows.slice(0, 500));
  }

  async function readLocalContent() {
    return readJsonArray(contentFile);
  }

  async function writeLocalContent(rows) {
    await writeJsonArray(contentFile, rows.slice(0, 300));
  }

  async function readLocalGraphics() {
    return readJsonArray(graphicsFile);
  }

  async function writeLocalGraphics(rows) {
    await writeJsonArray(graphicsFile, rows.slice(0, 500));
  }

  async function readLocalResults() {
    return (await readJsonArray(resultsFile)).map(verifyResultIntegrity);
  }

  async function writeLocalResults(rows) {
    await writeJsonArray(resultsFile, rows.slice(0, 1000));
  }

  async function readLocalPublications() {
    return (await readJsonArray(publicationsFile)).map(verifyPublicationIntegrity);
  }

  async function writeLocalPublications(rows) {
    await writeJsonArray(publicationsFile, rows.slice(0, 500));
  }

  async function getSnapshots(query = {}) {
    let remote = [];
    if (supabaseEnabled()) {
      try {
        const params = new URLSearchParams();
        params.set("select", "*");
        params.set("order", "created_at.desc");
        params.set("limit", "250");
        if (query.slateDate) params.set("slate_date", `eq.${query.slateDate}`);
        if (query.sport) params.set("sport", `eq.${query.sport}`);
        remote = socialSnapshotsFromRows(await supabaseRequest(`social_pick_snapshots?${params.toString()}`));
      } catch {
        remote = [];
      }
    }
    const local = await readLocalSnapshots();
    const rows = [...remote, ...local]
      .filter((snapshot) => !query.slateDate || snapshot.slateDate === query.slateDate)
      .filter((snapshot) => !query.sport || snapshot.sport === query.sport);
    const byId = new Map();
    rows.forEach((snapshot) => {
      if (!byId.has(snapshot.id)) byId.set(snapshot.id, snapshot);
    });
    return Array.from(byId.values()).sort((a, b) => String(b.snapshotCreatedAt || "").localeCompare(String(a.snapshotCreatedAt || "")));
  }

  async function saveSnapshots(snapshots) {
    const existing = await readLocalSnapshots();
    const byHash = new Map(existing.map((snapshot) => [snapshot.snapshotHash, snapshot]));
    const remoteExistingHashes = new Set();
    if (supabaseEnabled()) {
      for (const snapshot of snapshots) {
        try {
          const rows = await supabaseRequest(`social_pick_snapshots?snapshot_hash=eq.${encodeURIComponent(snapshot.snapshotHash)}&select=*`);
          const remote = socialSnapshotsFromRows(rows)[0];
          if (remote?.snapshotHash === snapshot.snapshotHash) {
            remoteExistingHashes.add(snapshot.snapshotHash);
            byHash.set(snapshot.snapshotHash, remote);
          }
        } catch {
          // Duplicate lookup is best effort; local immutable storage still protects the payload.
        }
      }
    }
    snapshots.forEach((snapshot) => {
      if (!byHash.has(snapshot.snapshotHash)) byHash.set(snapshot.snapshotHash, snapshot);
    });
    const saved = Array.from(byHash.values());
    await writeLocalSnapshots(saved);
    if (supabaseEnabled()) {
      try {
        const unsavedRemoteSnapshots = snapshots.filter((snapshot) => !remoteExistingHashes.has(snapshot.snapshotHash));
        if (!unsavedRemoteSnapshots.length) return snapshots.map((snapshot) => byHash.get(snapshot.snapshotHash) || snapshot);
        await supabaseRequest("social_pick_snapshots?on_conflict=snapshot_hash", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify(unsavedRemoteSnapshots.map((snapshot) => ({
            id: snapshot.id,
            slate_date: snapshot.slateDate,
            sport: snapshot.sport,
            snapshot_hash: snapshot.snapshotHash,
            payload: snapshot,
            created_at: snapshot.snapshotCreatedAt
          })))
        });
      } catch {
        // Local fallback is authoritative when the optional social tables are absent.
      }
    }
    return snapshots.map((snapshot) => byHash.get(snapshot.snapshotHash) || snapshot);
  }

  async function getContent(query = {}) {
    let remote = [];
    if (supabaseEnabled()) {
      try {
        const params = new URLSearchParams();
        params.set("select", "*");
        params.set("order", "updated_at.desc");
        params.set("limit", "250");
        if (query.slateDate) params.set("slate_date", `eq.${query.slateDate}`);
        if (query.status && query.status !== "all") params.set("status", `eq.${query.status}`);
        remote = socialContentFromRows(await supabaseRequest(`social_content?${params.toString()}`));
      } catch {
        remote = [];
      }
    }
    const local = await readLocalContent();
    const rows = [...remote, ...local]
      .filter((content) => !query.slateDate || content.slateDate === query.slateDate)
      .filter((content) => !query.status || query.status === "all" || content.status === query.status);
    const byId = new Map();
    rows.forEach((content) => {
      preferNewestById(byId, content);
    });
    return Array.from(byId.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async function saveContent(content) {
    const existing = await readLocalContent();
    const next = [content, ...existing.filter((item) => item.id !== content.id)];
    await writeLocalContent(next);
    if (supabaseEnabled()) {
      try {
        await supabaseRequest("social_content?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify([{
            id: content.id,
            content_type: content.contentType,
            slate_date: content.slateDate,
            sport: content.sport,
            status: content.status,
            payload: content,
            created_at: content.createdAt,
            updated_at: content.updatedAt
          }])
        });
        if (content.pickSnapshotIds?.length) {
          await supabaseRequest("social_content_snapshots", {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates" },
            body: JSON.stringify(content.pickSnapshotIds.map((snapshotId) => ({
              content_id: content.id,
              snapshot_id: snapshotId
            })))
          });
        }
      } catch {
        // Local fallback remains available.
      }
    }
    return content;
  }

  async function getGraphics(query = {}) {
    let remote = [];
    if (supabaseEnabled()) {
      try {
        const params = new URLSearchParams();
        params.set("select", "*");
        params.set("order", "updated_at.desc");
        params.set("limit", "250");
        if (query.socialContentId) params.set("social_content_id", `eq.${query.socialContentId}`);
        if (query.slateDate) params.set("slate_date", `eq.${query.slateDate}`);
        remote = socialGraphicsFromRows(await supabaseRequest(`social_graphics?${params.toString()}`));
      } catch {
        remote = [];
      }
    }
    const local = await readLocalGraphics();
    const rows = [...remote, ...local]
      .filter((graphic) => !query.socialContentId || graphic.socialContentId === query.socialContentId)
      .filter((graphic) => !query.slateDate || graphic.slateDate === query.slateDate);
    const byId = new Map();
    rows.forEach((graphic) => {
      preferNewestById(byId, graphic);
    });
    return Array.from(byId.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async function saveGraphic(graphic) {
    const existing = await readLocalGraphics();
    const next = [graphic, ...existing.filter((item) => item.id !== graphic.id)];
    await writeLocalGraphics(next);
    if (supabaseEnabled()) {
      try {
        await supabaseRequest("social_graphics?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify([{
            id: graphic.id,
            social_content_id: graphic.socialContentId,
            content_type: graphic.contentType,
            slate_date: graphic.slateDate,
            format: graphic.format,
            width: graphic.width,
            height: graphic.height,
            template_version: graphic.templateVersion,
            render_version: graphic.renderVersion,
            status: graphic.status,
            asset_path: graphic.assetPath,
            asset_url: graphic.assetUrl,
            mime_type: graphic.mimeType,
            file_size: graphic.fileSize,
            payload: graphic,
            created_at: graphic.createdAt,
            updated_at: graphic.updatedAt,
            approved_at: graphic.approvedAt
          }])
        });
      } catch {
        // Graphics metadata remains locally available when the optional table is absent.
      }
    }
    return graphic;
  }

  async function getResults(query = {}) {
    let remote = [];
    if (supabaseEnabled()) {
      try {
        const params = new URLSearchParams();
        params.set("select", "*");
        params.set("order", "updated_at.desc");
        params.set("limit", "1000");
        if (query.slateDate) params.set("slate_date", `eq.${query.slateDate}`);
        if (query.snapshotId) params.set("snapshot_id", `eq.${query.snapshotId}`);
        if (query.result) params.set("result", `eq.${query.result}`);
        remote = socialResultsFromRows(await supabaseRequest(`social_pick_results?${params.toString()}`));
      } catch {
        remote = [];
      }
    }
    const local = await readLocalResults();
    const rows = [...remote, ...local]
      .filter((result) => !query.slateDate || result.slateDate === query.slateDate)
      .filter((result) => !query.snapshotId || result.snapshotId === query.snapshotId)
      .filter((result) => !query.result || result.result === query.result);
    const byId = new Map();
    rows.forEach((result) => {
      if (!byId.has(result.id)) byId.set(result.id, result);
    });
    return Array.from(byId.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async function saveResults(records) {
    const incoming = Array.isArray(records) ? records : [records];
    const existing = await readLocalResults();
    const byId = new Map(existing.map((result) => [result.id, result]));
    incoming.forEach((record) => {
      const current = byId.get(record.id);
      if (current && FINAL_RESULTS.has(current.result) && current.resultHash !== record.resultHash) return;
      byId.set(record.id, record);
    });
    const saved = Array.from(byId.values());
    await writeLocalResults(saved);
    if (supabaseEnabled()) {
      try {
        await supabaseRequest("social_pick_results?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(incoming.map((result) => ({
            id: result.id,
            snapshot_id: result.snapshotId,
            snapshot_hash: result.snapshotHash,
            slate_date: result.slateDate,
            sport: result.sport,
            game_id: result.gameId,
            result: result.result,
            status: result.status,
            settled_at: result.settledAt || null,
            result_hash: result.resultHash,
            payload: result,
            created_at: result.createdAt,
            updated_at: result.updatedAt
          })))
        });
      } catch {
        // Local result history remains available if the optional table is missing.
      }
    }
    return incoming.map((record) => byId.get(record.id) || record);
  }

  async function getPublications(query = {}) {
    let remote = [];
    if (supabaseEnabled()) {
      try {
        const params = new URLSearchParams();
        params.set("select", "*");
        params.set("order", "updated_at.desc");
        params.set("limit", "250");
        if (query.socialGraphicId) params.set("social_graphic_id", `eq.${query.socialGraphicId}`);
        if (query.socialContentId) params.set("social_content_id", `eq.${query.socialContentId}`);
        remote = (await supabaseRequest(`social_publications?${params.toString()}`) || []).map((row) => row.payload || row).map(verifyPublicationIntegrity);
      } catch {
        remote = [];
      }
    }
    const local = await readLocalPublications();
    const rows = [...remote, ...local]
      .filter((publication) => !query.socialGraphicId || publication.socialGraphicId === query.socialGraphicId)
      .filter((publication) => !query.socialContentId || publication.socialContentId === query.socialContentId)
      .filter((publication) => query.includeArchived || publication.status !== "archived");
    const byId = new Map();
    rows.forEach((publication) => {
      preferNewestById(byId, publication);
    });
    return Array.from(byId.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function livePublicationReferences(publications = []) {
    return publications.reduce((acc, publication) => {
      if (!publication?.dryRun && ["published", "verified"].includes(publication?.status)) {
        if (publication.socialContentId) acc.contentIds.add(publication.socialContentId);
        if (publication.socialGraphicId) acc.graphicIds.add(publication.socialGraphicId);
      }
      return acc;
    }, { contentIds: new Set(), graphicIds: new Set() });
  }

  async function resetSocialTestingWorkspace(payload = {}) {
    const slateDate = cleanString(payload.slateDate || "");
    const selectedContentId = cleanString(payload.selectedContentId || "");
    const selectedGraphicId = cleanString(payload.selectedGraphicId || "");
    const allPublications = await getPublications({ includeArchived: true });
    const liveRefs = livePublicationReferences(allPublications);
    const dryRunPublications = allPublications.filter((publication) =>
      publication?.dryRun === true &&
      !["published", "verified", "archived"].includes(publication.status)
    );
    const now = new Date().toISOString();
    let dryRunPublicationCount = 0;
    for (const publication of dryRunPublications) {
      await savePublication({
        ...publication,
        status: "archived",
        archivedAt: now,
        updatedAt: now,
        metadata: {
          ...(publication.metadata || {}),
          archivedBy: "social-testing-reset"
        }
      });
      dryRunPublicationCount += 1;
    }

    let testContentCount = 0;
    if (selectedContentId && !liveRefs.contentIds.has(selectedContentId)) {
      const content = (await getContent({})).find((item) => item.id === selectedContentId);
      if (content && content.status !== "archived") {
        await saveContent(archiveSocialContent(content, now));
        testContentCount += 1;
      }
    }

    let testGraphicCount = 0;
    if (selectedGraphicId && !liveRefs.graphicIds.has(selectedGraphicId)) {
      const graphic = (await getGraphics({})).find((item) => item.id === selectedGraphicId);
      if (graphic && graphic.status !== "archived") {
        await saveGraphic(archiveSocialGraphic(graphic, now));
        testGraphicCount += 1;
      }
    }

    return {
      ok: true,
      cleared: {
        currentSelections: true,
        currentBoardCache: true,
        dryRunPublications: dryRunPublicationCount,
        testContent: testContentCount,
        testGraphics: testGraphicCount
      },
      preserved: {
        officialSnapshots: true,
        results: true,
        performanceHistory: true,
        livePublications: true,
        instagramPosts: true
      },
      slateDate
    };
  }

  async function savePublication(publication) {
    const hashedPublication = {
      ...publication,
      publicationHash: computePublicationHash(publication)
    };
    const existing = await readLocalPublications();
    const current = existing.find((item) => item.id === hashedPublication.id);
    if (current?.status === "verified" || current?.status === "published") return current;
    const next = [hashedPublication, ...existing.filter((item) => item.id !== hashedPublication.id)];
    await writeLocalPublications(next);
    if (supabaseEnabled()) {
      try {
        await supabaseRequest("social_publications?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify([{
            id: hashedPublication.id,
            social_content_id: hashedPublication.socialContentId,
            social_graphic_id: hashedPublication.socialGraphicId,
            platform: hashedPublication.platform,
            account_id: hashedPublication.accountId,
            publication_type: hashedPublication.publicationType,
            status: hashedPublication.status,
            container_id: hashedPublication.containerId,
            platform_media_id: hashedPublication.platformMediaId,
            permalink: hashedPublication.permalink,
            asset_url: hashedPublication.assetUrl,
            asset_hash: hashedPublication.assetHash,
            api_version: hashedPublication.apiVersion,
            payload: hashedPublication,
            requested_at: hashedPublication.requestedAt || null,
            published_at: hashedPublication.publishedAt || null,
            verified_at: hashedPublication.verifiedAt || null,
            created_at: hashedPublication.createdAt,
            updated_at: hashedPublication.updatedAt
          }])
        });
      } catch {
        // Publication metadata remains locally available when the optional table is absent.
      }
    }
    return hashedPublication;
  }

  function storagePublicAssetUrl(objectPath) {
    return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(publicationBucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  function isDuplicateStorageResponse(response, text = "") {
    return response.status === 409 || /KeyAlreadyExists|Duplicate|already exists/i.test(text);
  }

  async function readPublicAssetBytes(assetUrl) {
    rejectLocalAssetUrl(assetUrl);
    const response = await fetch(assetUrl, { method: "GET" });
    if (!response.ok) {
      throw publicationStep("storage_existing_asset_read", `Existing storage object could not be read: HTTP ${response.status}`);
    }
    const contentType = response.headers?.get?.("content-type") || response.headers?.get?.("Content-Type") || "";
    if (contentType && !/^image\//i.test(contentType)) {
      throw publicationStep("storage_existing_asset_read", "Existing storage object is not an image.");
    }
    try {
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw attachPublicationStage(error, "storage_existing_asset_read");
    }
  }

  async function verifyExistingStorageAsset({ assetUrl, expectedHash }) {
    const existingBytes = await readPublicAssetBytes(assetUrl);
    const existingHash = crypto.createHash("sha256").update(existingBytes).digest("hex");
    if (existingHash !== expectedHash) {
      throw publicationStep("storage_collision", "Existing storage object does not match the approved asset.", {
        expectedAssetHash: expectedHash,
        existingAssetHash: existingHash
      });
    }
    return existingHash;
  }

  async function uploadPublicationAsset({ objectPath, bytes, contentType, expectedHash }) {
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase Storage is not configured.");
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(publicationBucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const assetUrl = storagePublicAssetUrl(objectPath);
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": contentType,
        "x-upsert": "false"
      },
      body: bytes
    });
    if (!response.ok) {
      const text = await response.text();
      if (isDuplicateStorageResponse(response, text)) {
        await verifyExistingStorageAsset({ assetUrl, expectedHash });
        return {
          assetUrl,
          assetUploaded: true,
          assetReused: true,
          assetAlreadyExisted: true
        };
      }
      throw new Error(`Dry-run asset upload failed. No Instagram publication attempted. Supabase Storage ${response.status}: ${redactConfiguredSecrets(text).slice(0, 160)}`);
    }
    return {
      assetUrl,
      assetUploaded: true,
      assetReused: false,
      assetAlreadyExisted: false
    };
  }

  async function verifyAssetAccessible(assetUrl) {
    rejectLocalAssetUrl(assetUrl);
    const response = await fetch(assetUrl, { method: "HEAD" });
    if (response.ok) {
      const contentType = response.headers?.get?.("content-type") || response.headers?.get?.("Content-Type") || "";
      if (contentType && !/^image\//i.test(contentType)) throw new Error("Publication asset URL must return an image content type.");
      return true;
    }
    const getResponse = await fetch(assetUrl, { method: "GET", headers: { Range: "bytes=0-31" } });
    if (!getResponse.ok) throw new Error(`Publication asset is not reachable: ${response.status}`);
    const contentType = getResponse.headers?.get?.("content-type") || getResponse.headers?.get?.("Content-Type") || "";
    if (contentType && !/^image\//i.test(contentType)) throw new Error("Publication asset URL must return an image content type.");
    return true;
  }

  async function assertPublishable(content, graphic) {
    if (!content || content.status !== "approved") throw validationError("Social Content must be approved before publishing");
    if (!graphic || graphic.status !== "approved") throw validationError("Social Graphic must be approved before publishing");
    const snapshots = (await getSnapshots({})).filter((snapshot) => (graphic.snapshotIds || content.pickSnapshotIds || []).includes(snapshot.id));
    const badSnapshot = snapshots.find((snapshot) => snapshot.integrityStatus === "failed");
    if (badSnapshot) throw validationError(`Snapshot integrity failed: ${badSnapshot.integrityError}`);
    const approvedCaption = approvedCaptionForPublication(content);
    assertSingleApprovedDisclaimer(approvedCaption);
    assertDaily3CaptionComplete(content, snapshots);
    const hits = validateNoProhibitedLanguage({ caption: approvedCaption });
    if (hits.length) throw validationError(`Caption failed claim safety: ${hits.join(", ")}`);
    if (content.contentType === "DAILY_RESULTS") {
      const results = (content.metadata?.results || []).map(verifyResultIntegrity);
      const badResult = results.find((result) => result.integrityStatus === "failed");
      if (badResult) throw validationError(`Result integrity failed: ${badResult.integrityError}`);
    }
    return snapshots;
  }

  async function preparePublicationAsset(graphicId, options = {}) {
    const expectedContentId = cleanString(options.contentId || "");
    const diagnostics = {
      requestedGraphicId: graphicId || "",
      requestedContentId: expectedContentId || "",
      dryRun: Boolean(instagram.dryRun),
      dryRunUploadEnabled: Boolean(uploadDryRunAssets)
    };
    const graphics = await getGraphics({});
    const graphic = graphics.find((item) => item.id === graphicId);
    if (!graphic) throw publicationStep("graphic_lookup", "Approved graphic is not selected or no longer exists.", diagnostics);
    diagnostics.graphicId = graphic.id;
    diagnostics.graphicStatus = graphic.status || "";
    diagnostics.graphicContentId = graphic.socialContentId || "";
    if (expectedContentId && graphic.socialContentId !== expectedContentId) {
      throw publicationStep("validation", "Selected graphic does not belong to the selected content item.", diagnostics);
    }
    const contents = await getContent({});
    const content = contents.find((item) => item.id === graphic.socialContentId);
    diagnostics.contentId = content?.id || "";
    diagnostics.contentStatus = content?.status || "";
    if (!content) throw publicationStep("content_lookup", "Content for the selected graphic was not found.", diagnostics);
    try {
      await assertPublishable(content, graphic);
    } catch (error) {
      throw attachPublicationStage(error, "approval_check", diagnostics);
    }
    const duplicate = (await getPublications({ socialGraphicId: graphic.id })).find((item) => ["published", "verified"].includes(item.status) && item.accountId === (env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || ""));
    if (duplicate) throw publicationStep("validation", "This approved graphic already has a published Instagram receipt.", { ...diagnostics, duplicatePublicationId: duplicate.id });
    let svg = "";
    try {
      svg = await fs.readFile(graphic.assetPath, "utf8");
    } catch (error) {
      throw attachPublicationStage(error, "rasterize", { ...diagnostics, message: "Graphic SVG asset could not be read." });
    }
    const baseDate = (content.slateDate || "undated").split("-");
    const objectPrefix = `social/${baseDate[0] || "0000"}/${baseDate[1] || "00"}/${baseDate[2] || "00"}/${content.contentType}/${graphic.id}`;
    const localOutput = path.join(publicationAssetsDir, `${graphic.id}_${graphic.renderVersionNumber || 1}.png`);
    let asset;
    try {
      asset = await rasterizeApprovedSvg({ svg, format: graphic.format, outputPath: localOutput });
    } catch (error) {
      throw attachPublicationStage(error, "rasterize", diagnostics);
    }
    let assetUrl = "";
    let assetUploaded = false;
    let assetReused = false;
    let assetAlreadyExisted = false;
    let assetPublicUrlValidated = false;
    if (instagram.dryRun && !uploadDryRunAssets) {
      assetUrl = `https://dry-run.same-game-heat.local/${objectPrefix}/dry-run${asset.extension}`;
    } else {
      const objectPath = `${objectPrefix}/${graphic.renderVersion || "v1"}${asset.extension}`;
      try {
        const uploadResult = await uploadPublicationAsset({
          objectPath,
          bytes: asset.bytes,
          contentType: asset.mimeType,
          expectedHash: asset.assetHash
        });
        assetUrl = uploadResult.assetUrl;
        assetUploaded = Boolean(uploadResult.assetUploaded);
        assetReused = Boolean(uploadResult.assetReused);
        assetAlreadyExisted = Boolean(uploadResult.assetAlreadyExisted);
      } catch (error) {
        throw attachPublicationStage(error, "storage_upload", { ...diagnostics, bucket: publicationBucket, objectPath });
      }
      try {
        await verifyAssetAccessible(assetUrl);
      } catch (error) {
        throw attachPublicationStage(error, "public_url_validation", { ...diagnostics, bucket: publicationBucket, assetUploaded });
      }
      assetPublicUrlValidated = true;
    }
    try {
      await verifyAssetHash(localOutput, asset.assetHash);
    } catch (error) {
      throw attachPublicationStage(error, "receipt_create", diagnostics);
    }
    let account;
    try {
      account = await instagram.validateConnection();
    } catch (error) {
      throw attachPublicationStage(error, "validation", diagnostics);
    }
    const publication = createPublicationRecord({
      content,
      graphic,
      asset: { ...asset, assetUrl },
      account: { accountId: env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || "", username: account.username || "" },
      apiVersion: instagram.apiVersion,
      status: instagram.dryRun ? "prepared" : "asset_ready",
      dryRun: instagram.dryRun,
      assetUploaded,
      assetPublicUrlValidated,
      assetReused,
      assetAlreadyExisted
    });
    try {
      return await savePublication(publication);
    } catch (error) {
      throw attachPublicationStage(error, "receipt_create", diagnostics);
    }
  }

  function livePublicationKey(publication) {
    return [
      publication?.accountId || "",
      publication?.socialContentId || "",
      publication?.socialGraphicId || "",
      publication?.captionHash || "",
      publication?.assetHash || ""
    ].join(":");
  }

  function isLiveDuplicateCandidate(publication) {
    return publication &&
      publication.dryRun !== true &&
      ["creating_container", "container_processing", "ready_to_publish", "publishing", "published", "verified"].includes(publication.status);
  }

  async function findLivePublicationDuplicate(publication, { excludeId = "" } = {}) {
    const key = livePublicationKey(publication);
    return (await getPublications({ socialGraphicId: publication.socialGraphicId, includeArchived: true }))
      .find((item) => item.id !== excludeId && isLiveDuplicateCandidate(item) && livePublicationKey(item) === key);
  }

  async function assertLivePublicationPreflight(publication, { stage = "preflight", requireContainerReady = false } = {}) {
    const diagnostics = {
      publicationId: publication?.id || "",
      contentId: publication?.socialContentId || "",
      graphicId: publication?.socialGraphicId || "",
      dryRun: Boolean(instagram.dryRun),
      accountIdConfigured: Boolean(env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID)
    };
    if (instagram.dryRun) throw publicationStep(stage, "Live publish is blocked while SOCIAL_PUBLISH_DRY_RUN=true.", diagnostics);
    if (!publication) throw publicationStep(stage, "Publication receipt not found.", diagnostics);
    if (publication.dryRun) throw publicationStep(stage, "Dry-run receipts cannot be published live.", diagnostics);
    if (publication.integrityStatus === "failed") throw publicationStep(stage, "Publication receipt integrity failed.", diagnostics);
    if (!publication.accountId) throw publicationStep("identity_check", "Instagram user ID is missing from the publication receipt.", diagnostics);
    if (publication.accountId !== (env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || "")) {
      throw publicationStep("identity_check", "Publication account does not match configured Instagram account.", diagnostics);
    }
    if (!publication.caption || !publication.captionHash) throw publicationStep("approval_check", "Approved caption is missing.", diagnostics);
    if (sha256(publication.caption) !== publication.captionHash) throw publicationStep("approval_check", "Approved caption hash mismatch.", diagnostics);
    if (!publication.caption.includes(DEFAULT_DISCLAIMER)) throw publicationStep("approval_check", "Responsible gambling disclaimer is missing.", diagnostics);

    let account;
    try {
      account = await instagram.verifyLiveIdentity(env.INSTAGRAM_EXPECTED_USERNAME || env.INSTAGRAM_USERNAME || "sg_heater");
    } catch (error) {
      throw attachPublicationStage(error, "identity_check", diagnostics);
    }
    diagnostics.accountUsername = account.username || "";
    if ((publication.accountUsername || "").toLowerCase() !== (account.username || "").toLowerCase()) {
      throw publicationStep("identity_check", "Publication username does not match verified Instagram account.", diagnostics);
    }

    const content = (await getContent({})).find((item) => item.id === publication.socialContentId);
    const graphic = (await getGraphics({})).find((item) => item.id === publication.socialGraphicId);
    if (!content) throw publicationStep("approval_check", "Approved content no longer exists.", diagnostics);
    if (!graphic) throw publicationStep("approval_check", "Approved graphic no longer exists.", diagnostics);
    diagnostics.contentStatus = content.status || "";
    diagnostics.graphicStatus = graphic.status || "";
    if (content.status !== "approved") throw publicationStep("approval_check", "Social Content must still be approved before live publishing.", diagnostics);
    if (graphic.status !== "approved") throw publicationStep("approval_check", "Social Graphic must still be approved before live publishing.", diagnostics);
    if (graphic.socialContentId !== content.id) throw publicationStep("approval_check", "Approved graphic no longer belongs to approved content.", diagnostics);
    try {
      const snapshots = (await getSnapshots({})).filter((snapshot) => (graphic.snapshotIds || content.pickSnapshotIds || []).includes(snapshot.id));
      assertSingleApprovedDisclaimer(approvedCaptionForPublication(content));
      assertDaily3CaptionComplete(content, snapshots);
    } catch (error) {
      throw attachPublicationStage(error, "approval_check", diagnostics);
    }
    if (approvedCaptionForPublication(content) !== publication.caption) throw publicationStep("approval_check", "Live publish must use the exact approved caption.", diagnostics);
    if (sha256(approvedCaptionForPublication(content)) !== publication.captionHash) throw publicationStep("approval_check", "Approved content caption hash mismatch.", diagnostics);
    if ((graphic.snapshotHashes || []).join("|") !== (publication.snapshotHashes || []).join("|")) {
      throw publicationStep("approval_check", "Approved graphic snapshot hash mismatch.", diagnostics);
    }
    const hits = validateNoProhibitedLanguage({ caption: publication.caption });
    if (hits.length) throw publicationStep("approval_check", `Caption failed claim safety: ${hits.join(", ")}`, diagnostics);

    const duplicate = await findLivePublicationDuplicate(publication, { excludeId: publication.id });
    if (duplicate) throw publicationStep("duplicate_check", "Live publication already exists for this approved content and graphic.", { ...diagnostics, duplicatePublicationId: duplicate.id });

    try {
      await verifyAssetAccessible(publication.assetUrl);
    } catch (error) {
      throw attachPublicationStage(error, "asset_validation", diagnostics);
    }
    const localOutput = path.join(publicationAssetsDir, `${graphic.id}_${graphic.renderVersionNumber || 1}.png`);
    try {
      await verifyAssetHash(localOutput, publication.assetHash);
    } catch (error) {
      throw attachPublicationStage(error, "asset_validation", diagnostics);
    }
    if (publication.assetUrl.includes(env.SUPABASE_SERVICE_ROLE_KEY || "__never__") || publication.assetUrl.includes(env.INSTAGRAM_ACCESS_TOKEN || "__never__")) {
      throw publicationStep("asset_validation", "Publication asset URL contains secret material.", diagnostics);
    }
    if (requireContainerReady && !["FINISHED", "READY"].includes(String(publication.containerStatus || "").toUpperCase())) {
      throw publicationStep("container_status", "Instagram media container is not ready to publish.", diagnostics);
    }
    return { content, graphic, account, diagnostics };
  }

  async function publishPublication(publicationId, options = {}) {
    const publication = (await getPublications({})).find((item) => item.id === publicationId);
    if (!publication) throw validationError("Publication not found");
    if (["published", "verified"].includes(publication.status)) return publication;
    if (publication.dryRun) return savePublication({ ...publication, status: "prepared", updatedAt: new Date().toISOString() });
    if (instagram.dryRun) {
      throw publicationStep("preflight", "Live publish is blocked while SOCIAL_PUBLISH_DRY_RUN=true.", {
        publicationId: publication.id,
        dryRun: true,
        livePublishEnabled
      });
    }
    if (!livePublishEnabled) {
      throw publicationStep("preflight", "Live publishing is disabled. Set SOCIAL_LIVE_PUBLISH_ENABLED=true for the first controlled live post.", {
        publicationId: publication.id,
        dryRun: false,
        livePublishEnabled
      });
    }
    if (options.confirmLivePublish !== true) {
      throw publicationStep("confirmation", "Live publishing confirmation required.", {
        publicationId: publication.id,
        dryRun: false,
        livePublishEnabled
      });
    }
    const existingLiveReceipt = await findLivePublicationDuplicate(publication, { excludeId: publication.id });
    if (existingLiveReceipt) return existingLiveReceipt;
    const lockKey = livePublicationKey(publication);
    if (livePublishLocks.has(lockKey)) {
      const duplicate = await findLivePublicationDuplicate(publication, { excludeId: "" });
      if (duplicate) return duplicate;
      throw publicationStep("duplicate_check", "Live publication is already in progress for this approved content and graphic.", { publicationId: publication.id });
    }
    livePublishLocks.add(lockKey);
    try {
      await assertLivePublicationPreflight(publication, { stage: "preflight" });
      let container;
      try {
        container = await instagram.createMediaContainer({
          imageUrl: publication.assetUrl,
          caption: publication.caption,
          mediaType: publication.publicationType === "STORY_IMAGE" ? "STORIES" : "IMAGE"
        });
      } catch (error) {
        throw attachPublicationStage(error, "container_create", { publicationId: publication.id });
      }
      let next = {
        ...publication,
        status: "container_processing",
        containerId: container.id || "",
        containerStatus: container.status_code || "",
        containerCreatedAt: new Date().toISOString(),
        attemptCount: (Number(publication.attemptCount) || 0) + 1,
        updatedAt: new Date().toISOString()
      };
      await savePublication(next);
      let status;
      try {
        status = await instagram.checkContainerStatus(next.containerId);
      } catch (error) {
        throw attachPublicationStage(error, "container_status", { publicationId: publication.id, containerId: next.containerId });
      }
      next = { ...next, containerStatus: status.status_code || status.status || "", updatedAt: new Date().toISOString() };
      if (/ERROR|EXPIRED|FAILED/i.test(next.containerStatus)) {
        return savePublication({
          ...next,
          status: "failed",
          failedAt: new Date().toISOString(),
          lastError: `Instagram container failed: ${next.containerStatus}`,
          updatedAt: new Date().toISOString()
        });
      }
      if (next.containerStatus && !/FINISHED|READY/i.test(next.containerStatus)) {
        return savePublication(next);
      }
      await assertLivePublicationPreflight(next, { stage: "media_publish", requireContainerReady: true });
      let published;
      try {
        published = await instagram.publishContainer(next.containerId);
      } catch (error) {
        throw attachPublicationStage(error, "media_publish", { publicationId: publication.id, containerId: next.containerId });
      }
      const mediaId = published.id || published.media_id || "";
      let media = {};
      try {
        media = mediaId ? await instagram.fetchPublishedMedia(mediaId) : {};
      } catch (error) {
        throw attachPublicationStage(error, "media_verify", { publicationId: publication.id, mediaId });
      }
      if (!mediaId || !media.permalink) {
        return savePublication({
          ...next,
          status: "failed",
          platformMediaId: mediaId,
          failedAt: new Date().toISOString(),
          lastError: "Published media verification failed.",
          updatedAt: new Date().toISOString()
        });
      }
      next = {
        ...next,
        status: "verified",
        platformMediaId: mediaId,
        permalink: media.permalink,
        publishedAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          ...(next.metadata || {}),
          livePostCreated: true,
          metaPublishBlocked: false
        }
      };
      return savePublication(next);
    } finally {
      livePublishLocks.delete(lockKey);
    }
  }

  async function getOfficialTrackedSnapshots() {
    const contents = await getContent({});
    const trackedIds = new Set();
    contents
      .filter((content) => TRACKED_CONTENT_TYPES.has(content.contentType))
      .filter((content) => content.status !== "draft" && content.status !== "failed")
      .forEach((content) => (content.pickSnapshotIds || []).forEach((id) => trackedIds.add(id)));
    const snapshots = await getSnapshots({});
    return snapshots.filter((snapshot) => trackedIds.has(snapshot.id));
  }

  async function checkSocialResults({ fetchGameResult: overrideFetchGameResult = null, slateDate = "" } = {}) {
    const resultFetcher = overrideFetchGameResult || fetchGameResult;
    const snapshots = (await getOfficialTrackedSnapshots()).filter((snapshot) => !slateDate || snapshot.slateDate === slateDate);
    const existing = await getResults({});
    const bySnapshotHash = new Map(existing.map((result) => [result.snapshotHash, result]));
    const checked = [];
    const updated = [];
    for (const snapshot of snapshots) {
      const current = bySnapshotHash.get(snapshot.snapshotHash);
      if (current && FINAL_RESULTS.has(current.result)) {
        checked.push(current);
        continue;
      }
      let gameResult = null;
      try {
        gameResult = await resultFetcher(snapshot);
      } catch (error) {
        const pending = createResultRecord({
          snapshot,
          gameResult: { gameId: snapshot.gameId, homeTeam: snapshot.homeTeam, awayTeam: snapshot.awayTeam, status: "unknown", sourceGameStatus: "fetch_failed", source: "mlb_stats_api" },
          resultOverride: "PENDING",
          notes: [`Result fetch failed: ${error.message}`]
        });
        const saved = (await saveResults(pending))[0];
        checked.push(saved);
        updated.push(saved);
        continue;
      }
      const record = createResultRecord({ snapshot, gameResult: gameResult || {} });
      const saved = (await saveResults(record))[0];
      checked.push(saved);
      if (!current || current.resultHash !== saved.resultHash) updated.push(saved);
    }
    const settledEnough = checked.filter((result) => result.slateDate === (slateDate || checked[0]?.slateDate) && result.result !== "PENDING").length;
    let dailyResultsContent = null;
    if ((slateDate || checked[0]?.slateDate) && settledEnough) {
      dailyResultsContent = buildDailyResultsContent({
        slateDate: slateDate || checked[0].slateDate,
        results: checked
      });
      await saveContent(dailyResultsContent);
    }
    return {
      checked: checked.length,
      updated: updated.length,
      results: checked,
      dailyResultsContent
    };
  }

  async function createManualSettlement(existingResult, { result, reason } = {}) {
    const normalizedResult = cleanString(result).toUpperCase();
    if (!FINAL_RESULTS.has(normalizedResult) && normalizedResult !== "MANUAL_REVIEW") {
      throw validationError("manual result must be WIN, LOSS, PUSH, VOID, or MANUAL_REVIEW");
    }
    const cleanReason = cleanString(reason);
    if (cleanReason.length < 6) throw validationError("manual review reason is required");
    const snapshot = (await getSnapshots({})).find((item) => item.id === existingResult.snapshotId);
    if (!snapshot) throw validationError("snapshot for manual settlement was not found");
    const gameResult = {
      gameId: existingResult.sourceGameId || existingResult.gameId,
      homeTeam: snapshot.homeTeam,
      awayTeam: snapshot.awayTeam,
      homeScore: existingResult.homeScore,
      awayScore: existingResult.awayScore,
      sourceGameStatus: existingResult.sourceGameStatus || "manual",
      status: existingResult.sourceGameStatus || "manual",
      gameCompletedAt: existingResult.gameCompletedAt || "",
      source: existingResult.source || "manual"
    };
    return createResultRecord({
      snapshot,
      gameResult,
      resultOverride: normalizedResult,
      settlementMethod: "manual",
      manualReviewReason: cleanReason,
      notes: [`Manual settlement: ${cleanReason}`],
      previousResultId: existingResult.id
    });
  }

  function graphicAssetName({ content, format, versionNumber, svg }) {
    const type = cleanString(content.contentType || "social").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const date = cleanString(content.slateDate || "undated").replace(/[^0-9-]+/g, "");
    const shortContentId = cleanString(content.id).slice(0, 22);
    const contentHash = sha256(svg).slice(0, 12);
    return `${date}_${type}_${format}_${shortContentId}_v${versionNumber}_${contentHash}.svg`;
  }

  async function renderGraphicForContent(content, { format = "feed", sourceGraphic = null } = {}) {
    const allSnapshots = await getSnapshots({});
    const snapshots = (content.pickSnapshotIds || [])
      .map((id) => allSnapshots.find((snapshot) => snapshot.id === id))
      .filter(Boolean);
    if (!snapshots.length && content.contentType !== "DAILY_RESULTS") {
      throw validationError("graphic requires at least one frozen snapshot");
    }
    const badSnapshot = snapshots.find((snapshot) => snapshot.integrityStatus === "failed");
    if (badSnapshot) {
      const failed = createSocialGraphicRecord({
        content,
        snapshots,
        format,
        rendered: null,
        status: "failed",
        renderVersionNumber: (sourceGraphic?.renderVersionNumber || 0) + 1,
        generationError: badSnapshot.integrityError || "Snapshot integrity failed"
      });
      await saveGraphic(failed);
      return failed;
    }
    let rendered;
    try {
      rendered = renderSocialGraphic({ content, snapshots, format });
    } catch (error) {
      const failed = createSocialGraphicRecord({
        content,
        snapshots,
        format,
        rendered: null,
        status: "failed",
        renderVersionNumber: (sourceGraphic?.renderVersionNumber || 0) + 1,
        generationError: error.message
      });
      await saveGraphic(failed);
      return failed;
    }
    const existingGraphics = await getGraphics({ socialContentId: content.id });
    const sameFormat = existingGraphics.filter((graphic) => graphic.format === rendered.format);
    const versionNumber = sourceGraphic
      ? (Number(sourceGraphic.renderVersionNumber) || 0) + 1
      : sameFormat.reduce((max, graphic) => Math.max(max, Number(graphic.renderVersionNumber) || 0), 0) + 1;
    const fileName = graphicAssetName({ content, format: rendered.format, versionNumber, svg: rendered.svg });
    const absolutePath = path.join(assetsDir, fileName);
    let stat;
    try {
      await fs.mkdir(assetsDir, { recursive: true });
      await fs.writeFile(absolutePath, rendered.svg);
      stat = await fs.stat(absolutePath);
    } catch (error) {
      const failed = createSocialGraphicRecord({
        content,
        snapshots,
        format: rendered.format,
        rendered,
        status: "failed",
        renderVersionNumber: versionNumber,
        generationError: `Asset storage failed: ${error.message}`
      });
      await saveGraphic(failed);
      return failed;
    }
    const publicPath = `/.social-assets/${fileName}`;
    const graphic = createSocialGraphicRecord({
      content,
      snapshots,
      format: rendered.format,
      rendered,
      renderVersionNumber: versionNumber,
      assetPath: absolutePath,
      assetUrl: publicPath,
      fileSize: stat.size
    });
    return saveGraphic(graphic);
  }

  function signToken(timestamp) {
    return `${timestamp}.${crypto.createHmac("sha256", adminSecret).update(String(timestamp)).digest("hex")}`;
  }

  function parseCookies(header = "") {
    return String(header).split(";").reduce((acc, chunk) => {
      const index = chunk.indexOf("=");
      if (index === -1) return acc;
      acc[chunk.slice(0, index).trim()] = decodeURIComponent(chunk.slice(index + 1).trim());
      return acc;
    }, {});
  }

  function isAuthorized(req) {
    if (!adminSecret) return false;
    const token = parseCookies(req.headers.cookie || "")[SOCIAL_COOKIE] || "";
    const [timestamp, signature] = token.split(".");
    const issuedAt = Number(timestamp);
    if (!issuedAt || !signature || Date.now() - issuedAt > 12 * 60 * 60 * 1000) return false;
    const expected = signToken(timestamp).split(".")[1];
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  function socialCookie(value, maxAge) {
    const encoded = value ? encodeURIComponent(value) : "";
    return `${SOCIAL_COOKIE}=${encoded}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
  }

  function isAllowedSocialOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const originUrl = new URL(origin);
      const host = cleanString(req.headers["x-forwarded-host"] || req.headers.host);
      if (!host) return false;
      return originUrl.host === host;
    } catch {
      return false;
    }
  }

  async function generateAiContent(contentType, snapshots) {
    if (!openAiKey) {
      return {
        provider: "local-template",
        model: "local-template",
        output: localSocialTemplate(contentType, snapshots)
      };
    }

    const prompt = {
      task: "Generate Same Game Heat social copy from only the structured frozen pick snapshots.",
      brandVoice: [
        "Short, natural, human, confident, conversational, sports-page style, and easy to read on Instagram.",
        "Write like a real sports bettor/page operator sharing a simple card, not a report, sportsbook ad, or tout page.",
        "Avoid robotic analysis, heavy metrics, hype, gimmicks, and long explanations."
      ],
      rules: [
        "Do not guarantee outcomes.",
        "Do not fabricate missing facts.",
        "Use only supplied snapshot values; do not infer injuries, weather, bullpen status, lineups, records, streaks, standings, or advanced metrics unless explicitly present.",
        "Do not use prohibited phrases.",
        `Avoid generic brand filler: ${BRAND_STYLE_EXCLUSIONS.join(", ")}.`,
        "For DAILY_3, generate only one short natural sentence. The app will deterministically add the frozen teams, odds, hashtags, and disclaimer.",
        "Do not repeat the team/odds list.",
        "Do not include hashtags.",
        "Do not include the disclaimer.",
        "Do not mention model win probability, fair price, playable-through, score, tiers, risk flags, or internal diagnostics in the public caption sentence.",
        "Use emoji sparingly and do not add extra emoji to the sentence.",
        "Keep language clear for an average bettor.",
        `Use disclaimer: ${DEFAULT_DISCLAIMER}`
      ],
      formatGuidance: {
        DAILY_3: "Return a field named daily3Sentence with ONE conversational sentence, about 15-20 words max. Example: These are the three sides I like most on today’s board.",
        BEST_BET: "Keep it short: headline, pick line, one natural sentence, hashtags, disclaimer.",
        PICK_BREAKDOWN: "Keep it concise: pick, odds, 1-2 short explanation sentences, hashtags, disclaimer.",
        shortCaption: "Compact only. No model probabilities, fair price, playable-through, score, or tier.",
        reelHook: "One short sentence only. Example: Three MLB sides I like today.",
        reelScript: "Short and natural. Avoid long analytical scripts.",
        storyText: "Very concise: pick names and odds only. No long reason paragraphs."
      },
      contentType,
      snapshots
    };

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), aiTimeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.45,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write short, natural Same Game Heat Instagram copy. Return one strict JSON object only. Required keys: headline, subheadline, caption, shortCaption, reelHook, reelScript, storyText, reasoningSummary, daily3Sentence, hashtags, disclaimer, warnings. For DAILY_3, daily3Sentence is the only AI language the app may use in the final public caption. It must be one conversational sentence, max 20 words, with no teams, odds, hashtags, disclaimer, model metrics, fair price, playable-through, scores, tiers, guarantees, locks, or invented analysis. hashtags MUST be a JSON array of strings. warnings MUST be a JSON array of strings. All other listed fields MUST be JSON strings." },
            { role: "user", content: JSON.stringify(prompt) }
          ]
        })
      });
      if (!response.ok) {
        const error = new Error(await readOpenAiErrorMessage(response, [openAiKey]));
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      const text = cleanString(data.choices?.[0]?.message?.content);
      if (!text) throw new Error("OpenAI response did not include message content");
      const output = JSON.parse(text);
      if (!isPlainObject(output)) throw new Error("OpenAI response JSON must be an object");
      const repaired = repairGeneratedSocialCopy({ contentType, generated: output, snapshots });
      if (repaired.hardFailures.length) throw new Error(`AI copy quality check failed: ${repaired.hardFailures.join("; ")}`);
      return {
        provider: "openai",
        model: aiModel,
        output: {
          ...repaired.output,
          requestDurationMs: Date.now() - startedAt
        }
      };
    } catch (error) {
      const status = error.name === "AbortError" ? "timeout" : error.status || "error";
      const message = error.name === "AbortError"
        ? `OpenAI request timed out after ${aiTimeoutMs}ms`
        : sanitizeSocialAiMessage(error.message, [openAiKey]);
      console.warn("Social AI generation failed", {
        provider: "openai",
        model: aiModel,
        status,
        message
      });
      return {
        provider: "local-template",
        model: "local-template",
        output: {
          ...localSocialTemplate(contentType, snapshots),
          warnings: [`AI generation failed: ${message}. Local draft created instead.`]
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function snapshotsFromRequest(payload) {
    const type = normalizeContentType(payload.contentType || "DAILY_3");
    const board = payload.board || {};
    const picks = payload.picks || board.officialPicks || [];
    const sourceBoardType = payload.sourceBoardType || board.sourceBoardType || "MLB_DAILY_3";
    const slateDate = payload.slateDate || board.slateDate;
    const sport = payload.sport || board.sport || "baseball_mlb";
    const limited = type === "BEST_BET"
      ? picks.slice(0, 1)
      : type === "PICK_BREAKDOWN"
        ? picks.slice(Number(payload.pickIndex || 0), Number(payload.pickIndex || 0) + 1)
        : picks.slice(0, 3);
    if (!limited.length) throw new Error("No picks were provided to snapshot");
    const snapshots = limited.map((pick, index) => createSocialPickSnapshot({
      ...pick,
      slateDate: pick.slateDate || slateDate,
      sport: pick.sport || sport,
      sourceBoardType,
      originalPickRank: pick.originalPickRank ?? index + 1
    }));
    return saveSnapshots(snapshots);
  }

  async function handle(req, res, url, readRequestBody) {
    if (req.method === "POST" && url.pathname.startsWith("/api/social/") && !isAllowedSocialOrigin(req)) {
      sendJson(res, 403, { error: "Cross-origin Social Studio mutation rejected." });
      return true;
    }

    if (url.pathname === "/api/social/session") {
      sendJson(res, 200, { configured: Boolean(adminSecret), authorized: isAuthorized(req) });
      return true;
    }

    if (url.pathname === "/api/social/login") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      if (!adminSecret) {
        sendJson(res, 503, { error: "SOCIAL_ADMIN_SECRET is not configured on the server." });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      if (cleanString(payload.secret) !== adminSecret) {
        sendJson(res, 401, { error: "Invalid Social Studio secret." });
        return true;
      }
      const token = signToken(Date.now());
      sendJson(res, 200, { authorized: true }, {
        "Set-Cookie": socialCookie(token, 43200)
      });
      return true;
    }

    if (url.pathname === "/api/social/logout") {
      sendJson(res, 200, { authorized: false }, {
        "Set-Cookie": socialCookie("", 0)
      });
      return true;
    }

    if (!url.pathname.startsWith("/api/social/")) return false;
    if (!isAuthorized(req)) {
      sendJson(res, adminSecret ? 401 : 503, {
        error: adminSecret ? "Unauthorized" : "SOCIAL_ADMIN_SECRET is not configured on the server."
      });
      return true;
    }

    if (url.pathname === "/api/social/today") {
      const slateDate = url.searchParams.get("slateDate") || "";
      const sport = url.searchParams.get("sport") || "baseball_mlb";
      sendJson(res, 200, {
        slateDate,
        sport,
        snapshots: await getSnapshots({ slateDate, sport }),
        content: await getContent({ slateDate })
      });
      return true;
    }

    if (url.pathname === "/api/social/snapshots") {
      sendJson(res, 200, {
        snapshots: await getSnapshots({
          slateDate: url.searchParams.get("slateDate") || "",
          sport: url.searchParams.get("sport") || ""
        })
      });
      return true;
    }

    if (url.pathname === "/api/social/content") {
      sendJson(res, 200, {
        content: await getContent({
          slateDate: url.searchParams.get("slateDate") || "",
          status: url.searchParams.get("status") || "all"
        })
      });
      return true;
    }

    if (url.pathname === "/api/social/graphics") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      sendJson(res, 200, {
        graphics: await getGraphics({
          socialContentId: url.searchParams.get("socialContentId") || "",
          slateDate: url.searchParams.get("slateDate") || ""
        })
      });
      return true;
    }

    if (url.pathname === "/api/social/results") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      sendJson(res, 200, {
        results: await getResults({
          slateDate: url.searchParams.get("slateDate") || "",
          snapshotId: url.searchParams.get("snapshotId") || "",
          result: url.searchParams.get("result") || ""
        })
      });
      return true;
    }

    if (url.pathname === "/api/social/performance") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const allResults = await getResults({});
      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      const period = url.searchParams.get("period") || "all_time";
      sendJson(res, 200, {
        performance: buildPerformance(allResults, { period, date })
      });
      return true;
    }

    if (url.pathname === "/api/social/results/check") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const response = await checkSocialResults({ slateDate: cleanString(payload.slateDate || url.searchParams.get("slateDate") || "") });
      sendJson(res, 200, response);
      return true;
    }

    if (url.pathname === "/api/social/instagram/status") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const status = await instagram.validateConnection();
      sendJson(res, 200, {
        ...status,
        livePublishEnabled,
        liveModeArmed: Boolean(status.connected && !status.dryRun && !livePublishEnabled)
      });
      return true;
    }

    if (url.pathname === "/api/social/instagram/diagnostics") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const diagnostics = await runInstagramDiagnostics({
        ids: url.searchParams.get("ids") || "",
        env,
        fetchImpl
      });
      sendJson(res, 200, buildSafeInstagramDiagnosticsPayload(diagnostics, env));
      return true;
    }

    if (url.pathname === "/api/social/publications") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      sendJson(res, 200, {
        publications: await getPublications({
          socialGraphicId: url.searchParams.get("socialGraphicId") || "",
          socialContentId: url.searchParams.get("socialContentId") || "",
          includeArchived: url.searchParams.get("includeArchived") === "true"
        })
      });
      return true;
    }

    if (url.pathname === "/api/social/testing/reset") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const summary = await resetSocialTestingWorkspace(payload);
      sendJson(res, 200, summary);
      return true;
    }

    const publicationMatch = url.pathname.match(/^\/api\/social\/publications\/([^/]+)$/);
    if (publicationMatch && req.method === "GET") {
      const publication = (await getPublications({})).find((item) => item.id === publicationMatch[1]);
      sendJson(res, publication ? 200 : 404, publication ? { publication } : { error: "Publication not found" });
      return true;
    }

    const publicationActionMatch = url.pathname.match(/^\/api\/social\/publications\/([^/]+)\/(publish|refresh)$/);
    if (publicationActionMatch) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const [, publicationIdValue, action] = publicationActionMatch;
      try {
        if (action === "publish") {
          const payload = JSON.parse((await readRequestBody(req)) || "{}");
          const publication = await publishPublication(publicationIdValue, {
            confirmLivePublish: payload.confirmLivePublish === true
          });
          sendJson(res, 200, { publication });
          return true;
        }
        const publication = (await getPublications({})).find((item) => item.id === publicationIdValue);
        if (!publication) {
          sendJson(res, 404, { error: "Publication not found" });
          return true;
        }
        if (!publication.containerId || publication.dryRun) {
          sendJson(res, 200, { publication });
          return true;
        }
        const status = await instagram.checkContainerStatus(publication.containerId);
        const updated = await savePublication({
          ...publication,
          containerStatus: status.status_code || status.status || publication.containerStatus,
          updatedAt: new Date().toISOString()
        });
        sendJson(res, 200, { publication: updated });
        return true;
      } catch (error) {
        sendJson(res, error.statusCode || 400, {
          ok: false,
          stage: error.stage || "preflight",
          error: safeErrorMessage(error),
          message: safeErrorMessage(error),
          diagnostics: error.diagnostics || {}
        });
        return true;
      }
    }

    const resultMatch = url.pathname.match(/^\/api\/social\/results\/([^/]+)$/);
    if (resultMatch && req.method === "GET") {
      const rows = await getResults({});
      const result = rows.find((item) => item.id === resultMatch[1]);
      sendJson(res, result ? 200 : 404, result ? { result } : { error: "Result not found" });
      return true;
    }

    const manualResultMatch = url.pathname.match(/^\/api\/social\/results\/([^/]+)\/manual-review$/);
    if (manualResultMatch) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const rows = await getResults({});
      const existingResult = rows.find((item) => item.id === manualResultMatch[1]);
      if (!existingResult) {
        sendJson(res, 404, { error: "Result not found" });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const correction = await createManualSettlement(existingResult, payload);
      await saveResults(correction);
      sendJson(res, 200, { result: correction, previousResult: existingResult });
      return true;
    }

    const graphicMatch = url.pathname.match(/^\/api\/social\/graphics\/([^/]+)$/);
    if (graphicMatch && req.method === "GET") {
      const rows = await getGraphics({});
      const graphic = rows.find((item) => item.id === graphicMatch[1]);
      sendJson(res, graphic ? 200 : 404, graphic ? { graphic } : { error: "Graphic not found" });
      return true;
    }

    const graphicActionMatch = url.pathname.match(/^\/api\/social\/graphics\/([^/]+)\/(regenerate|approve|archive)$/);
    if (graphicActionMatch) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const [, graphicId, action] = graphicActionMatch;
      const graphics = await getGraphics({});
      const graphic = graphics.find((item) => item.id === graphicId);
      if (!graphic) {
        sendJson(res, 404, { error: "Graphic not found" });
        return true;
      }
      if (action === "approve") {
        const updated = await saveGraphic(approveSocialGraphic(graphic));
        sendJson(res, 200, { graphic: updated });
        return true;
      }
      if (action === "archive") {
        const updated = await saveGraphic(archiveSocialGraphic(graphic));
        sendJson(res, 200, { graphic: updated });
        return true;
      }
      const contents = await getContent({});
      const content = contents.find((item) => item.id === graphic.socialContentId);
      if (!content) {
        sendJson(res, 404, { error: "Content not found for graphic regeneration" });
        return true;
      }
      const regenerated = await renderGraphicForContent(content, { format: graphic.format, sourceGraphic: graphic });
      sendJson(res, 200, { graphic: regenerated, previousGraphic: graphic });
      return true;
    }

    const graphicPrepareMatch = url.pathname.match(/^\/api\/social\/graphics\/([^/]+)\/prepare-publication$/);
    if (graphicPrepareMatch) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      try {
        const payload = JSON.parse((await readRequestBody(req)) || "{}");
        const publication = await preparePublicationAsset(graphicPrepareMatch[1], {
          contentId: cleanString(payload.contentId || payload.content_id || ""),
          graphicId: cleanString(payload.graphicId || payload.graphic_id || "")
        });
        sendJson(res, 200, { ok: true, stage: "receipt_create", publication });
      } catch (error) {
        sendJson(res, error.statusCode || 400, {
          ok: false,
          stage: error.stage || "validation",
          error: safeErrorMessage(error),
          message: safeErrorMessage(error),
          diagnostics: error.diagnostics || {}
        });
      }
      return true;
    }

    const contentMatch = url.pathname.match(/^\/api\/social\/content\/([^/]+)$/);
    if (contentMatch && req.method === "GET") {
      const rows = await getContent({});
      const content = rows.find((item) => item.id === contentMatch[1]);
      sendJson(res, content ? 200 : 404, content ? { content } : { error: "Content not found" });
      return true;
    }

    const contentGraphicMatch = url.pathname.match(/^\/api\/social\/content\/([^/]+)\/graphics$/);
    if (contentGraphicMatch) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const rows = await getContent({});
      const content = rows.find((item) => item.id === contentGraphicMatch[1]);
      if (!content) {
        sendJson(res, 404, { error: "Content not found" });
        return true;
      }
      const graphic = await renderGraphicForContent(content, { format: payload.format || "feed" });
      sendJson(res, graphic.status === "failed" ? 400 : 200, {
        graphic,
        ...(graphic.status === "failed" ? { error: graphic.generationError || "Graphic generation failed" } : {})
      });
      return true;
    }

    if (url.pathname === "/api/social/snapshot") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const snapshots = await snapshotsFromRequest(payload);
      sendJson(res, 200, { snapshots });
      return true;
    }

    if (url.pathname === "/api/social/generate") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const payload = JSON.parse((await readRequestBody(req)) || "{}");
      const contentType = normalizeContentType(payload.contentType || "DAILY_3");
      const snapshots = await snapshotsFromRequest(payload);
      const existingDaily = contentType === "DAILY_3"
        ? (await getContent({ slateDate: snapshots[0]?.slateDate })).find((item) => item.contentType === "DAILY_3" && isActiveSocialContent(item))
        : null;
      if (existingDaily && !payload.allowDuplicate) {
        sendJson(res, 409, { error: "A Daily 3 social draft already exists for this slate. Archive it or regenerate it.", content: existingDaily });
        return true;
      }
      const generated = await generateAiContent(contentType, snapshots);
      const content = createSocialContentRecord({
        contentType,
        snapshots,
        generated: generated.output,
        provider: generated.provider,
        model: generated.model
      });
      await saveContent(content);
      sendJson(res, 200, { content, snapshots });
      return true;
    }

    const actionMatch = url.pathname.match(/^\/api\/social\/content\/([^/]+)\/(regenerate|approve|archive)$/);
    if (actionMatch) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return true;
      }
      const [, contentId, action] = actionMatch;
      const rows = await getContent({});
      const content = rows.find((item) => item.id === contentId);
      if (!content) {
        sendJson(res, 404, { error: "Content not found" });
        return true;
      }
      if (action === "approve") {
        const updated = await saveContent(approveSocialContent(content));
        sendJson(res, 200, { content: updated });
        return true;
      }
      if (action === "archive") {
        const updated = await saveContent(archiveSocialContent(content));
        sendJson(res, 200, { content: updated });
        return true;
      }
      const snapshots = (await getSnapshots({})).filter((snapshot) => content.pickSnapshotIds.includes(snapshot.id));
      const generated = await generateAiContent(content.contentType, snapshots);
      const regenerated = createSocialContentRecord({
        contentType: content.contentType,
        snapshots,
        generated: generated.output,
        provider: generated.provider,
        model: generated.model,
        previousContentId: content.id
      });
      await saveContent(regenerated);
      sendJson(res, 200, { content: regenerated, previousContent: content });
      return true;
    }

    sendJson(res, 404, { error: "Unknown social route" });
    return true;
  }

  return {
    handle,
    isAuthorized,
    createSocialPickSnapshot,
    createSocialContentRecord,
    approveSocialContent,
    archiveSocialContent,
    createSocialGraphicRecord,
    approveSocialGraphic,
    archiveSocialGraphic,
    validateNoProhibitedLanguage,
    normalizeGeneratedContent
    ,
    getResults,
    saveResults,
    checkSocialResults
    ,
    getPublications,
    savePublication,
    preparePublicationAsset,
    publishPublication
  };
}

module.exports = {
  SNAPSHOT_VERSION,
  GENERATION_VERSION,
  DEFAULT_DISCLAIMER,
  PROHIBITED_PHRASES,
  createSocialManager,
  createSocialPickSnapshot,
  createSocialContentRecord,
  approveSocialContent,
  archiveSocialContent,
  createSocialGraphicRecord,
  approveSocialGraphic,
  archiveSocialGraphic,
  normalizeGeneratedContent,
  validateNoProhibitedLanguage,
  canonicalStringify
};

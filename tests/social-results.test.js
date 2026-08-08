const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createSocialManager,
  createSocialPickSnapshot
} = require("../social-manager");
const {
  calculateUnits,
  gradeMoneylineSnapshot,
  createResultRecord,
  computeResultHash,
  verifyResultIntegrity,
  buildPerformance,
  buildDailyResultsContent
} = require("../social-results");
const { renderSocialGraphic } = require("../social-graphics");

function pick(overrides = {}) {
  const base = {
    slateDate: "2026-07-27",
    sport: "baseball_mlb",
    gameId: "game-1",
    gameStartTime: "2026-07-27T23:10:00Z",
    gameLabel: "Houston Astros @ Los Angeles Angels",
    homeTeam: "Los Angeles Angels",
    awayTeam: "Houston Astros",
    selectedTeam: "Los Angeles Angels",
    opponent: "Houston Astros",
    homeOrAway: "Home",
    market: "Moneyline",
    sportsbook: "Fanatics",
    sportsbookOdds: -125,
    modelWinProbability: 0.64,
    finalScore: 78,
    confidenceTier: 3,
    confidenceLabel: "Playable Edge",
    matchupEdge: 8,
    fairOdds: -150,
    playableThrough: -160,
    reasons: ["Starter advantage"],
    components: [{ key: "starting_pitcher", score: 80 }],
    riskFlags: ["Lineup confirmation"],
    originalPickRank: 1,
    ...overrides
  };
  return createSocialPickSnapshot(base, { createdAt: "2026-07-27T12:00:00Z" });
}

function game(overrides = {}) {
  return {
    gameId: "game-1",
    homeTeam: "Los Angeles Angels",
    awayTeam: "Houston Astros",
    homeScore: 5,
    awayScore: 3,
    sourceGameStatus: "Final",
    status: "Final",
    gameCompletedAt: "2026-07-27",
    source: "mlb_stats_api",
    ...overrides
  };
}

function contentPayload(snapshots, contentType = "DAILY_3") {
  return {
    contentType,
    board: {
      slateDate: "2026-07-27",
      sport: "baseball_mlb",
      officialPicks: snapshots.map((snapshot) => snapshot.rawSnapshotPayload || snapshot)
    }
  };
}

function captureResponse() {
  const capture = { status: 0, headers: {}, body: "" };
  return {
    capture,
    writeHead(code, headers = {}) {
      capture.status = code;
      capture.headers = headers;
    },
    end(body = "") {
      capture.body = body;
    }
  };
}

async function route(manager, { method = "GET", path = "/api/social/session", headers = {}, body = "" } = {}) {
  const response = captureResponse();
  await manager.handle(
    { headers, method },
    response,
    new URL(`http://localhost${path}`),
    async () => typeof body === "string" ? body : JSON.stringify(body)
  );
  return {
    ...response.capture,
    json: response.capture.body ? JSON.parse(response.capture.body) : null
  };
}

async function login(manager, headers = {}) {
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    headers,
    body: { secret: "secret" }
  });
  assert.equal(response.status, 200);
  return response.headers["Set-Cookie"];
}

test("moneyline favorite win grades WIN", () => {
  assert.equal(gradeMoneylineSnapshot(pick(), game()).result, "WIN");
});

test("moneyline favorite loss grades LOSS", () => {
  assert.equal(gradeMoneylineSnapshot(pick(), game({ homeScore: 2, awayScore: 4 })).result, "LOSS");
});

test("positive odds win calculates correct units", () => {
  assert.equal(calculateUnits({ americanOdds: 140, result: "WIN" }).unitsWonLost, 1.4);
});

test("negative odds win calculates correct units", () => {
  assert.equal(calculateUnits({ americanOdds: -125, result: "WIN" }).unitsWonLost, 0.8);
});

test("loss always loses stake units", () => {
  assert.equal(calculateUnits({ americanOdds: 240, result: "LOSS" }).unitsWonLost, -1);
});

test("push returns zero units", () => {
  assert.equal(calculateUnits({ americanOdds: -110, result: "PUSH" }).unitsWonLost, 0);
});

test("void returns zero units", () => {
  assert.equal(calculateUnits({ americanOdds: -110, result: "VOID" }).unitsWonLost, 0);
});

test("missing odds grades result but units unavailable", () => {
  const snapshot = pick({ sportsbookOdds: null });
  const result = createResultRecord({ snapshot, gameResult: game() });
  assert.equal(result.result, "WIN");
  assert.equal(result.unitsWonLost, null);
  assert.equal(result.unitCalculationStatus, "unavailable");
});

test("non-final game remains PENDING", () => {
  assert.equal(gradeMoneylineSnapshot(pick(), game({ sourceGameStatus: "In Progress" })).result, "PENDING");
});

test("postponed game is not falsely graded", () => {
  assert.equal(gradeMoneylineSnapshot(pick(), game({ sourceGameStatus: "Postponed" })).result, "PENDING");
});

test("suspended game is not falsely graded", () => {
  assert.equal(gradeMoneylineSnapshot(pick(), game({ sourceGameStatus: "Suspended" })).result, "PENDING");
});

test("mismatched game ID triggers MANUAL_REVIEW", () => {
  assert.equal(gradeMoneylineSnapshot(pick(), game({ gameId: "different-game" })).result, "MANUAL_REVIEW");
});

test("tampered snapshot does not auto-grade", () => {
  const snapshot = { ...pick(), selectedTeam: "Houston Astros", integrityStatus: "failed", integrityError: "bad hash" };
  assert.equal(gradeMoneylineSnapshot(snapshot, game()).result, "MANUAL_REVIEW");
});

test("duplicate result check is idempotent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-results-idempotent-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" }, fetchGameResult: async () => game() });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [pick()] } }
  });
  assert.equal(generated.status, 200);
  const first = await route(manager, { method: "POST", path: "/api/social/results/check", headers: { cookie }, body: { slateDate: "2026-07-27" } });
  const second = await route(manager, { method: "POST", path: "/api/social/results/check", headers: { cookie }, body: { slateDate: "2026-07-27" } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const results = await route(manager, { path: "/api/social/results?slateDate=2026-07-27", headers: { cookie } });
  assert.equal(results.json.results.length, 1);
});

test("same snapshot in Daily 3 and Best Bet counts once", () => {
  const snapshot = pick();
  const result = createResultRecord({ snapshot, gameResult: game() });
  const duplicate = { ...result, id: "duplicate_content_reference" };
  const performance = buildPerformance([result, duplicate], { period: "all_time" });
  assert.equal(performance.wins, 1);
  assert.equal(performance.totalSettled, 1);
});

test("archived losing content still counts in official record", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-results-archived-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" }, fetchGameResult: async () => game({ homeScore: 1, awayScore: 4 }) });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [pick()] } }
  });
  await route(manager, { method: "POST", path: `/api/social/content/${generated.json.content.id}/archive`, headers: { cookie }, body: {} });
  await route(manager, { method: "POST", path: "/api/social/results/check", headers: { cookie }, body: { slateDate: "2026-07-27" } });
  const performance = await route(manager, { path: "/api/social/performance?period=daily&date=2026-07-27", headers: { cookie } });
  assert.equal(performance.json.performance.losses, 1);
});

test("win percentage excludes pushes", () => {
  const snapshot = pick();
  const win = createResultRecord({ snapshot, gameResult: game() });
  const push = createResultRecord({ snapshot: pick({ gameId: "game-2", sportsbookOdds: -110 }), gameResult: game({ gameId: "game-2", homeScore: 4, awayScore: 4 }) });
  const summary = buildPerformance([win, push], { period: "all_time" });
  assert.equal(summary.winPercentage, 1);
});

test("ROI calculation is correct", () => {
  const a = createResultRecord({ snapshot: pick({ sportsbookOdds: -125 }), gameResult: game() });
  const b = createResultRecord({ snapshot: pick({ gameId: "game-2", sportsbookOdds: 110 }), gameResult: game({ gameId: "game-2", homeScore: 2, awayScore: 5 }) });
  const c = createResultRecord({ snapshot: pick({ gameId: "game-3", sportsbookOdds: -120 }), gameResult: game({ gameId: "game-3", homeScore: 4, awayScore: 2 }) });
  const summary = buildPerformance([a, b, c], { period: "all_time" });
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
  assert.ok(Math.abs(summary.units - 0.6333333333333333) < 0.000001);
  assert.ok(Math.abs(summary.roi - 0.2111111111111111) < 0.000001);
});

test("finalized settlement cannot silently overwrite", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-results-no-overwrite-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const snapshot = pick();
  const win = createResultRecord({ snapshot, gameResult: game() });
  const loss = createResultRecord({ snapshot, gameResult: game({ homeScore: 1, awayScore: 4 }) });
  await manager.saveResults(win);
  await manager.saveResults(loss);
  const results = await manager.getResults({});
  assert.equal(results[0].result, "WIN");
});

test("result hash is deterministic", () => {
  const snapshot = pick();
  const a = createResultRecord({ snapshot, gameResult: game(), now: "2026-07-27T23:00:00Z" });
  const b = createResultRecord({ snapshot, gameResult: game(), now: "2026-07-27T23:00:00Z" });
  assert.equal(a.resultHash, b.resultHash);
  assert.equal(a.resultHash, computeResultHash(a));
});

test("result hash mismatch is detected", () => {
  const result = createResultRecord({ snapshot: pick(), gameResult: game() });
  const verified = verifyResultIntegrity({ ...result, selectedTeam: "Houston Astros" });
  assert.equal(verified.integrityStatus, "failed");
});

test("unauthorized results check is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-results-auth-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, { method: "POST", path: "/api/social/results/check", body: { slateDate: "2026-07-27" } });
  assert.equal(response.status, 401);
});

test("cross-origin results mutation is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-results-origin-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/results/check",
    headers: { host: "same-game-heat.onrender.com", origin: "https://evil.example" },
    body: { slateDate: "2026-07-27" }
  });
  assert.equal(response.status, 403);
});

test("Daily Results content uses actual settlement data", () => {
  const result = createResultRecord({ snapshot: pick(), gameResult: game() });
  const content = buildDailyResultsContent({ slateDate: "2026-07-27", results: [result], now: "2026-07-28T01:00:00Z" });
  assert.match(content.caption, /Los Angeles Angels Moneyline -125/);
  assert.match(content.caption, /DAY: 1-0/);
  assert.equal(content.metadata.dailyPerformance.wins, 1);
});

test("Daily Results graphic contains correct W/L states", () => {
  const win = createResultRecord({ snapshot: pick(), gameResult: game() });
  const loss = createResultRecord({ snapshot: pick({ gameId: "game-2", selectedTeam: "Houston Astros", opponent: "Los Angeles Angels", homeOrAway: "Away" }), gameResult: game({ gameId: "game-2" }) });
  const content = buildDailyResultsContent({ slateDate: "2026-07-27", results: [win, loss] });
  const graphic = renderSocialGraphic({ content, snapshots: [], format: "feed" });
  assert.match(graphic.svg, /DAILY RESULTS/);
  assert.match(graphic.svg, /WIN/);
  assert.match(graphic.svg, /LOSS/);
});

test("results fetch failure does not break check route", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-results-fetch-fail-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" }, fetchGameResult: async () => { throw new Error("network down"); } });
  const cookie = await login(manager);
  await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [pick()] } }
  });
  const response = await route(manager, { method: "POST", path: "/api/social/results/check", headers: { cookie }, body: { slateDate: "2026-07-27" } });
  assert.equal(response.status, 200);
  assert.equal(response.json.results[0].result, "PENDING");
});

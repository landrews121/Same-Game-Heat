const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createSocialManager,
  createSocialPickSnapshot,
  createSocialContentRecord,
  approveSocialContent,
  archiveSocialContent,
  normalizeGeneratedContent,
  validateNoProhibitedLanguage
} = require("../social-manager");
const { renderSocialGraphic, RESPONSIBLE_FOOTER } = require("../social-graphics");

function samplePick(overrides = {}) {
  return {
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
    sportsbookOdds: -105,
    modelWinProbability: 0.551,
    finalScore: 75,
    confidenceTier: 3,
    confidenceLabel: "Playable Edge",
    matchupEdge: 7,
    fairOdds: -123,
    playableThrough: -140,
    starterName: "Starter Name",
    dataComplete: true,
    reasons: ["Starter advantage", "Bullpen advantage"],
    components: [{ key: "startingPitcher", score: 74 }],
    riskFlags: ["Confirm lineups before wagering."],
    passReasons: [],
    sourceBoardType: "MLB_DAILY_3",
    originalPickRank: 1,
    rawSnapshotPayload: {
      team: "Los Angeles Angels",
      apiKey: "do-not-store"
    },
    ...overrides
  };
}

function samplePickForTeam(selectedTeam, opponent, rank, overrides = {}) {
  const homeTeam = selectedTeam;
  const awayTeam = opponent;
  return samplePick({
    gameId: `game-${rank}`,
    gameLabel: `${awayTeam} @ ${homeTeam}`,
    homeTeam,
    awayTeam,
    selectedTeam,
    opponent,
    homeOrAway: "Home",
    sportsbookOdds: rank === 2 ? 145 : -105,
    modelWinProbability: rank === 3 ? 0.61 : 0.55 + rank * 0.04,
    finalScore: 70 + rank,
    originalPickRank: rank,
    reasons: [`${selectedTeam} has a starting-pitching edge`, "Bullpen profile supports the pick"],
    ...overrides
  });
}

function sampleContent(contentType, snapshots, overrides = {}) {
  return createSocialContentRecord({
    contentType,
    snapshots,
    generated: {},
    now: "2026-07-27T12:00:00Z",
    ...overrides
  });
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
  const parsed = response.capture.body ? JSON.parse(response.capture.body) : null;
  return { ...response.capture, json: parsed };
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

test("snapshot serialization is deterministic and strips secrets", () => {
  const a = createSocialPickSnapshot(samplePick(), { createdAt: "2026-07-27T12:00:00Z" });
  const b = createSocialPickSnapshot(samplePick(), { createdAt: "2026-07-27T12:00:00Z" });
  assert.equal(a.snapshotHash, b.snapshotHash);
  assert.equal(a.id, b.id);
  assert.equal(a.rawSnapshotPayload.apiKey, undefined);
});

test("missing required snapshot fields are rejected", () => {
  assert.throws(() => createSocialPickSnapshot(samplePick({ selectedTeam: "" })), /selectedTeam/);
  assert.throws(() => createSocialPickSnapshot(samplePick({ slateDate: "" })), /slateDate/);
});

test("content generation normalizes missing fields and requires disclaimer", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const record = createSocialContentRecord({
    contentType: "BEST_BET",
    snapshots: [snapshot],
    generated: { headline: "Best Bet", caption: "Angels ML" },
    now: "2026-07-27T12:00:00Z"
  });
  assert.equal(record.status, "ready_for_review");
  assert.match(record.disclaimer, /21\+/);
  assert.deepEqual(record.pickSnapshotIds, [snapshot.id]);
});

test("prohibited language forces draft status", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const record = createSocialContentRecord({
    contentType: "DAILY_3",
    snapshots: [snapshot],
    generated: { headline: "Guaranteed free money", caption: "This cannot lose." }
  });
  assert.equal(record.status, "draft");
  assert.match(record.generationError, /Prohibited language/);
  assert.ok(validateNoProhibitedLanguage(record).length > 0);
});

test("approved and archived transitions preserve immutable snapshot id", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const record = createSocialContentRecord({
    contentType: "PICK_BREAKDOWN",
    snapshots: [snapshot],
    generated: {}
  });
  const approved = approveSocialContent(record, "2026-07-27T13:00:00Z");
  assert.equal(approved.status, "approved");
  assert.equal(approved.pickSnapshotIds[0], snapshot.id);
  const archived = archiveSocialContent(approved, "2026-07-27T14:00:00Z");
  assert.equal(archived.status, "archived");
  assert.equal(archived.pickSnapshotIds[0], snapshot.id);
});

test("malformed generated output falls back to safe local fields", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ headline: null, hashtags: ["#SameGameHeat"] }, "DAILY_3", [snapshot]);
  assert.equal(result.prohibited.length, 0);
  assert.ok(result.normalized.caption.includes("Los Angeles Angels"));
});

test("local social manager blocks unauthorized protected endpoints", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-test-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const req = { headers: {}, method: "GET" };
  let status = 0;
  const res = {
    writeHead(code) { status = code; },
    end() {}
  };
  await manager.handle(req, res, new URL("http://localhost/api/social/content"), async () => "");
  assert.equal(status, 401);
});

test("approved regeneration creates a new content version id", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const original = approveSocialContent(createSocialContentRecord({
    contentType: "DAILY_3",
    snapshots: [snapshot],
    generated: {},
    now: "2026-07-27T12:00:00Z"
  }));
  const regenerated = createSocialContentRecord({
    contentType: original.contentType,
    snapshots: [snapshot],
    generated: {},
    now: "2026-07-27T12:05:00Z",
    previousContentId: original.id
  });
  assert.notEqual(regenerated.id, original.id);
  assert.equal(regenerated.metadata.previousContentId, original.id);
});

test("Daily 3 route prevents duplicate active content for the same slate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-route-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const res = () => {
    const capture = { status: 0, headers: {}, body: "" };
    return {
      capture,
      writeHead(code, headers = {}) {
        capture.status = code;
        capture.headers = headers;
      },
      end(body) {
        capture.body = body;
      }
    };
  };

  const loginRes = res();
  await manager.handle(
    { headers: {}, method: "POST" },
    loginRes,
    new URL("http://localhost/api/social/login"),
    async () => JSON.stringify({ secret: "secret" })
  );
  const cookie = loginRes.capture.headers["Set-Cookie"];
  assert.ok(cookie);

  const body = JSON.stringify({
    contentType: "DAILY_3",
    board: {
      slateDate: "2026-07-27",
      sport: "baseball_mlb",
      officialPicks: [samplePick()]
    }
  });
  const firstRes = res();
  await manager.handle(
    { headers: { cookie }, method: "POST" },
    firstRes,
    new URL("http://localhost/api/social/generate"),
    async () => body
  );
  assert.equal(firstRes.capture.status, 200);

  const secondRes = res();
  await manager.handle(
    { headers: { cookie }, method: "POST" },
    secondRes,
    new URL("http://localhost/api/social/generate"),
    async () => body
  );
  assert.equal(secondRes.capture.status, 409);
});

test("forged high modelWinProbability is rejected", () => {
  assert.throws(() => createSocialPickSnapshot(samplePick({ modelWinProbability: 99 })), /modelWinProbability/);
});

test("negative modelWinProbability is rejected", () => {
  assert.throws(() => createSocialPickSnapshot(samplePick({ modelWinProbability: -0.01 })), /modelWinProbability/);
});

test("selectedTeam must match one side of the game", () => {
  assert.throws(() => createSocialPickSnapshot(samplePick({ selectedTeam: "Seattle Mariners" })), /selectedTeam/);
});

test("invalid originalPickRank is rejected", () => {
  assert.throws(() => createSocialPickSnapshot(samplePick({ originalPickRank: 4 })), /originalPickRank/);
});

test("client supplied snapshot id is ignored", () => {
  const snapshot = createSocialPickSnapshot(samplePick({ id: "snap_from_client" }));
  assert.notEqual(snapshot.id, "snap_from_client");
  assert.match(snapshot.id, /^snap_/);
});

test("all Social Studio POST mutation routes require auth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-auth-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const protectedRoutes = [
    ["/api/social/snapshot", { contentType: "BEST_BET", board: { officialPicks: [samplePick()] } }],
    ["/api/social/generate", { contentType: "BEST_BET", board: { officialPicks: [samplePick()] } }],
    ["/api/social/content/content_123/regenerate", {}],
    ["/api/social/content/content_123/approve", {}],
    ["/api/social/content/content_123/archive", {}]
  ];
  for (const [pathName, body] of protectedRoutes) {
    const response = await route(manager, { method: "POST", path: pathName, body });
    assert.equal(response.status, 401, pathName);
  }
});

test("production cookie includes Secure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-prod-cookie-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", NODE_ENV: "production" } });
  const cookie = await login(manager);
  assert.match(cookie, /;\s*Secure/);
});

test("development cookie omits Secure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-dev-cookie-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", NODE_ENV: "development" } });
  const cookie = await login(manager);
  assert.doesNotMatch(cookie, /;\s*Secure/);
});

test("cross-origin Social Studio mutation is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-origin-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    headers: { host: "same-game-heat.onrender.com", origin: "https://evil.example" },
    body: { secret: "secret" }
  });
  assert.equal(response.status, 403);
});

test("valid same-origin mutation succeeds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-same-origin-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const cookie = await login(manager, { host: "localhost", origin: "http://localhost" });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/snapshot",
    headers: { cookie, host: "localhost", origin: "http://localhost" },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.snapshots.length, 1);
});

test("local snapshot hash mismatch is detected on read", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-hash-"));
  const snapshotFile = path.join(root, "snapshots.json");
  const snapshot = createSocialPickSnapshot(samplePick(), { createdAt: "2026-07-27T12:00:00Z" });
  await fs.writeFile(snapshotFile, JSON.stringify([{ ...snapshot, selectedTeam: "Houston Astros" }], null, 2));
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PICK_SNAPSHOTS_FILE: snapshotFile }
  });
  const cookie = await login(manager);
  const response = await route(manager, {
    path: "/api/social/snapshots?slateDate=2026-07-27&sport=baseball_mlb",
    headers: { cookie }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.snapshots[0].integrityStatus, "failed");
  assert.match(response.json.snapshots[0].integrityError, /snapshotHash mismatch/);
});

test("approved regeneration route preserves original content and creates a new record", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-regenerate-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const cookie = await login(manager);
  const generateResponse = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } }
  });
  assert.equal(generateResponse.status, 200);
  const original = generateResponse.json.content;
  const approveResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${original.id}/approve`,
    headers: { cookie },
    body: {}
  });
  assert.equal(approveResponse.status, 200);
  const approved = approveResponse.json.content;
  assert.equal(approved.status, "approved");

  const regenerateResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${original.id}/regenerate`,
    headers: { cookie },
    body: {}
  });
  assert.equal(regenerateResponse.status, 200);
  assert.notEqual(regenerateResponse.json.content.id, original.id);
  assert.equal(regenerateResponse.json.previousContent.id, original.id);
  assert.equal(regenerateResponse.json.previousContent.status, "approved");

  const originalResponse = await route(manager, {
    path: `/api/social/content/${original.id}`,
    headers: { cookie }
  });
  assert.equal(originalResponse.status, 200);
  assert.equal(originalResponse.json.content.id, original.id);
  assert.equal(originalResponse.json.content.status, "approved");
});

test("duplicate snapshot_hash reuses immutable existing snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-duplicate-"));
  const snapshotFile = path.join(root, "snapshots.json");
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PICK_SNAPSHOTS_FILE: snapshotFile }
  });
  const cookie = await login(manager);
  const body = { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } };
  const first = await route(manager, { method: "POST", path: "/api/social/snapshot", headers: { cookie }, body });
  const second = await route(manager, {
    method: "POST",
    path: "/api/social/snapshot",
    headers: { cookie },
    body: {
      contentType: "BEST_BET",
      board: {
        slateDate: "2026-07-27",
        sport: "baseball_mlb",
        officialPicks: [samplePick({ id: "client_supplied_duplicate_id" })]
      }
    }
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.json.snapshots[0].id, first.json.snapshots[0].id);
  const rows = JSON.parse(await fs.readFile(snapshotFile, "utf8"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, first.json.snapshots[0].id);
});

test("Daily 3 feed graphic renders three frozen picks", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Los Angeles Angels", "Houston Astros", 1)),
    createSocialPickSnapshot(samplePickForTeam("Detroit Tigers", "Baltimore Orioles", 2)),
    createSocialPickSnapshot(samplePickForTeam("New York Mets", "Atlanta Braves", 3))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed" });
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1350);
  assert.match(graphic.svg, /DAILY 3/);
  assert.match(graphic.svg, /Los Angeles Angels/);
  assert.match(graphic.svg, /Detroit Tigers/);
  assert.match(graphic.svg, /New York Mets/);
});

test("Daily 3 graphic renders only two picks when two frozen selections exist", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Arizona Diamondbacks", "Pittsburgh Pirates", 1)),
    createSocialPickSnapshot(samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed" });
  assert.match(graphic.svg, /Arizona Diamondbacks/);
  assert.match(graphic.svg, /Philadelphia Phillies/);
  assert.doesNotMatch(graphic.svg, /San Francisco Giants/);
});

test("backfill indicator appears on Daily 3 graphic", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Seattle Mariners", "Texas Rangers", 1, { isBackfill: true }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed" });
  assert.match(graphic.svg, /BEST AVAILABLE/);
});

test("Best Bet graphic uses snapshot number one", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Los Angeles Dodgers", "San Diego Padres", 1)),
    createSocialPickSnapshot(samplePickForTeam("Toronto Blue Jays", "Washington Nationals", 2))
  ];
  const content = sampleContent("BEST_BET", [snapshots[0]]);
  const graphic = renderSocialGraphic({ content, snapshots: [snapshots[0]], format: "feed" });
  assert.match(graphic.svg, /Los Angeles Dodgers/);
  assert.doesNotMatch(graphic.svg, /Toronto Blue Jays/);
});

test("long team names stay inside supported feed dimensions", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Arizona Diamondbacks", "San Francisco Giants", 1, {
      reasons: ["Long team-name fixture with a supporting reason that should wrap cleanly in the card"]
    })),
    createSocialPickSnapshot(samplePickForTeam("Philadelphia Phillies", "San Francisco Giants", 2))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed" });
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1350);
  assert.match(graphic.svg, /Arizona Diamondbacks/);
  assert.match(graphic.svg, /Philadelphia Phillies/);
});

test("prohibited language blocks graphic rendering", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const content = sampleContent("BEST_BET", [snapshot], {
    generated: { headline: "Guaranteed free money", caption: "Angels ML" }
  });
  assert.throws(() => renderSocialGraphic({ content, snapshots: [snapshot], format: "feed" }), /Graphic text failed claim safety/);
});

test("graphic uses frozen snapshot odds instead of live-looking content values", () => {
  const snapshot = createSocialPickSnapshot(samplePick({ sportsbookOdds: -105 }));
  const content = sampleContent("BEST_BET", [snapshot], {
    generated: { headline: "Best Bet", caption: "Live board moved this to +999" }
  });
  const graphic = renderSocialGraphic({ content, snapshots: [snapshot], format: "feed" });
  assert.match(graphic.svg, /-105/);
  assert.doesNotMatch(graphic.svg, /\+999/);
});

test("Story graphic dimensions are 1080x1920", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const content = sampleContent("BEST_BET", [snapshot]);
  const graphic = renderSocialGraphic({ content, snapshots: [snapshot], format: "story" });
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1920);
});

test("responsible gambling footer is present", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const content = sampleContent("PICK_BREAKDOWN", [snapshot]);
  const graphic = renderSocialGraphic({ content, snapshots: [snapshot], format: "feed" });
  assert.ok(graphic.svg.includes(RESPONSIBLE_FOOTER));
});

test("graphic record stores snapshot hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-graphic-hashes-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } }
  });
  const graphicResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "feed" }
  });
  assert.equal(graphicResponse.status, 200);
  assert.deepEqual(graphicResponse.json.graphic.snapshotHashes, generated.json.snapshots.map((snapshot) => snapshot.snapshotHash));
});

test("approved graphic is not overwritten on regeneration and new render version is created", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-graphic-version-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } }
  });
  const firstGraphic = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "feed" }
  });
  const approved = await route(manager, {
    method: "POST",
    path: `/api/social/graphics/${firstGraphic.json.graphic.id}/approve`,
    headers: { cookie },
    body: {}
  });
  assert.equal(approved.json.graphic.status, "approved");

  const regenerated = await route(manager, {
    method: "POST",
    path: `/api/social/graphics/${firstGraphic.json.graphic.id}/regenerate`,
    headers: { cookie },
    body: {}
  });
  assert.equal(regenerated.status, 200);
  assert.notEqual(regenerated.json.graphic.id, firstGraphic.json.graphic.id);
  assert.equal(regenerated.json.graphic.renderVersionNumber, firstGraphic.json.graphic.renderVersionNumber + 1);
  assert.equal(regenerated.json.previousGraphic.status, "approved");
});

test("unauthorized graphic mutation is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-graphic-auth-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/content/content_123/graphics",
    body: { format: "feed" }
  });
  assert.equal(response.status, 401);
});

test("cross-origin graphic mutation is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-graphic-origin-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/content/content_123/graphics",
    headers: { host: "same-game-heat.onrender.com", origin: "https://evil.example" },
    body: { format: "feed" }
  });
  assert.equal(response.status, 403);
});

test("asset storage failure creates a failed graphic record without throwing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-storage-fail-"));
  const badAssetsPath = path.join(root, "not-a-directory");
  await fs.writeFile(badAssetsPath, "file blocks asset directory");
  const manager = createSocialManager({
    root,
    env: {
      SOCIAL_ADMIN_SECRET: "secret",
      SOCIAL_ASSETS_DIR: badAssetsPath
    }
  });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } }
  });
  const graphicResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "feed" }
  });
  assert.equal(graphicResponse.status, 400);
  assert.equal(graphicResponse.json.graphic.status, "failed");
  assert.match(graphicResponse.json.graphic.generationError, /Asset storage failed/);
});

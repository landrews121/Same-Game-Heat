const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  rasterizeApprovedSvg,
  readPngDimensions,
  verifyAssetHash,
  rejectLocalAssetUrl,
  createPublicationRecord,
  verifyPublicationIntegrity
} = require("../social-publications");
const { createResultRecord } = require("../social-results");
const { createInstagramPublisher } = require("../instagram-publisher");
const {
  createSocialManager,
  createSocialPickSnapshot
} = require("../social-manager");

function pick(overrides = {}) {
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

async function login(manager) {
  const response = await route(manager, { method: "POST", path: "/api/social/login", body: { secret: "secret" } });
  assert.equal(response.status, 200);
  return response.headers["Set-Cookie"];
}

async function approvedContentAndGraphic(manager, cookie) {
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [pick()] } }
  });
  const content = generated.json.content;
  await route(manager, { method: "POST", path: `/api/social/content/${content.id}/approve`, headers: { cookie }, body: {} });
  const graphic = await route(manager, { method: "POST", path: `/api/social/content/${content.id}/graphics`, headers: { cookie }, body: { format: "feed" } });
  await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.json.graphic.id}/approve`, headers: { cookie }, body: {} });
  return { content, graphic: graphic.json.graphic };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, rows) {
  await fs.writeFile(file, JSON.stringify(rows, null, 2));
}

function publicationFixture(overrides = {}) {
  const snapshot = createSocialPickSnapshot(pick(), { createdAt: "2026-07-27T12:00:00Z" });
  const content = {
    id: "content_1",
    contentType: "BEST_BET",
    slateDate: "2026-07-27",
    caption: "Approved caption\n\n21+ | Bet responsibly.",
    pickSnapshotIds: [snapshot.id],
    metadata: { snapshotHashes: [snapshot.snapshotHash] }
  };
  const graphic = {
    id: "graphic_1",
    format: "feed",
    renderVersion: "v1",
    snapshotIds: [snapshot.id],
    snapshotHashes: [snapshot.snapshotHash]
  };
  return createPublicationRecord({
    content,
    graphic,
    asset: { assetUrl: "https://cdn.example.com/a.png", assetHash: "abc123", mimeType: "image/png", width: 1080, height: 1350 },
    account: { accountId: "123", username: "samegameheat" },
    apiVersion: "v23.0",
    ...overrides
  });
}

function fakeMetaFetch({ containerStatus = "FINISHED", throwOnMeta = false } = {}) {
  const calls = [];
  const fn = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || "GET" });
    if (options.method === "HEAD") return { ok: true, status: 200, json: async () => ({}) };
    if (throwOnMeta && href.includes("graph.facebook.com")) {
      return { ok: false, status: 500, statusText: "Error", json: async () => ({ error: { message: "Provider down access_token=secret" } }) };
    }
    if (href.includes("/123/media_publish")) return { ok: true, json: async () => ({ id: "ig_media_1" }) };
    if (href.includes("/123/media")) return { ok: true, json: async () => ({ id: "container_1" }) };
    if (href.includes("/container_1")) return { ok: true, json: async () => ({ id: "container_1", status_code: containerStatus }) };
    if (href.includes("/ig_media_1")) return { ok: true, json: async () => ({ id: "ig_media_1", permalink: "https://www.instagram.com/p/test/" }) };
    return { ok: true, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

test("raster asset has expected Feed dimensions", async () => {
  const asset = await rasterizeApprovedSvg({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"></svg>', format: "feed" });
  assert.equal(asset.width, 1080);
  assert.equal(asset.height, 1350);
  if (asset.mimeType === "image/png") assert.deepEqual(readPngDimensions(asset.bytes), { width: 1080, height: 1350 });
});

test("raster asset has expected Story dimensions", async () => {
  const asset = await rasterizeApprovedSvg({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"></svg>', format: "story" });
  assert.equal(asset.width, 1080);
  assert.equal(asset.height, 1920);
});

test("publication asset hash is deterministic", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><text>SGH</text></svg>';
  const a = await rasterizeApprovedSvg({ svg, format: "feed" });
  const b = await rasterizeApprovedSvg({ svg, format: "feed" });
  assert.equal(a.assetHash, b.assetHash);
});

test("modified publication asset fails hash validation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-hash-"));
  const out = path.join(root, "asset.png");
  const asset = await rasterizeApprovedSvg({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"></svg>', format: "feed", outputPath: out });
  await fs.appendFile(out, "tampered");
  await assert.rejects(() => verifyAssetHash(out, asset.assetHash), /hash mismatch/);
});

test("local filesystem URLs are rejected", () => {
  assert.throws(() => rejectLocalAssetUrl("file:///tmp/a.png"), /public HTTPS/);
  assert.throws(() => rejectLocalAssetUrl("http://localhost:4000/.social-assets/a.svg"), /public HTTPS|Local asset/);
});

test("missing Instagram token reports not configured and never exposes token", async () => {
  const publisher = createInstagramPublisher({ env: {}, fetchImpl: async () => { throw new Error("should not call"); } });
  const status = await publisher.validateConnection();
  assert.equal(status.configured, false);
  assert.equal(JSON.stringify(status).includes("access_token"), false);
});

test("dry-run validates connection without contacting Meta", async () => {
  let called = false;
  const publisher = createInstagramPublisher({
    env: {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      INSTAGRAM_USER_ID: "17841404477734906",
      INSTAGRAM_EXPECTED_USERNAME: "sg_heater",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl: async () => { called = true; }
  });
  const status = await publisher.validateConnection();
  assert.equal(status.connected, true);
  assert.equal(status.username, "sg_heater");
  assert.equal(status.dryRun, true);
  assert.equal(called, false);
});

test("unapproved content cannot prepare publication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-unapproved-content-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [pick()] } }
  });
  const graphic = await route(manager, { method: "POST", path: `/api/social/content/${generated.json.content.id}/graphics`, headers: { cookie }, body: { format: "feed" } });
  await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.json.graphic.id}/approve`, headers: { cookie }, body: {} });
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.json.graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 400);
});

test("unapproved graphic cannot prepare publication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-unapproved-graphic-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [pick()] } }
  });
  await route(manager, { method: "POST", path: `/api/social/content/${generated.json.content.id}/approve`, headers: { cookie }, body: {} });
  const graphic = await route(manager, { method: "POST", path: `/api/social/content/${generated.json.content.id}/graphics`, headers: { cookie }, body: { format: "feed" } });
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.json.graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 400);
});

test("tampered snapshot blocks publication preparation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-tampered-snapshot-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { graphic } = await approvedContentAndGraphic(manager, cookie);
  const snapshotFile = path.join(root, ".social-pick-snapshots.json");
  const snapshots = await readJson(snapshotFile);
  snapshots[0].selectedTeam = "Tampered Team";
  await writeJson(snapshotFile, snapshots);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 400);
  assert.match(prepared.json.error, /Snapshot integrity failed/);
});

test("tampered Daily Results settlement blocks publication preparation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-tampered-result-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { content, graphic } = await approvedContentAndGraphic(manager, cookie);
  const snapshot = (await readJson(path.join(root, ".social-pick-snapshots.json")))[0];
  const result = createResultRecord({
    snapshot,
    gameResult: { gameId: snapshot.gameId, homeTeam: snapshot.homeTeam, awayTeam: snapshot.awayTeam, status: "final", homeScore: 5, awayScore: 3 }
  });
  const tamperedResult = { ...result, result: result.result === "WIN" ? "LOSS" : "WIN" };
  const contentFile = path.join(root, ".social-content.json");
  const contents = await readJson(contentFile);
  contents[0] = {
    ...contents[0],
    id: content.id,
    contentType: "DAILY_RESULTS",
    status: "approved",
    metadata: { ...contents[0].metadata, results: [tamperedResult] }
  };
  await writeJson(contentFile, contents);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 400);
  assert.match(prepared.json.error, /Result integrity failed/);
});

test("prohibited caption blocks publication preparation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-prohibited-caption-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { graphic } = await approvedContentAndGraphic(manager, cookie);
  const contentFile = path.join(root, ".social-content.json");
  const contents = await readJson(contentFile);
  contents[0] = { ...contents[0], caption: "Guaranteed winner tonight\n\n21+ | Bet responsibly." };
  await writeJson(contentFile, contents);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 400);
  assert.match(prepared.json.error, /Caption failed claim safety/);
});

test("dry-run prepare creates prepared publication and does not publish", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-run-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { graphic } = await approvedContentAndGraphic(manager, cookie);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.json.publication.status, "prepared");
  const published = await route(manager, { method: "POST", path: `/api/social/publications/${prepared.json.publication.id}/publish`, headers: { cookie }, body: {} });
  assert.equal(published.json.publication.status, "prepared");
  assert.equal(published.json.publication.platformMediaId, "");
});

test("dry-run can prepare a real public Supabase asset without publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-upload-"));
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method || "GET" });
    if (options.method === "POST" && String(url).includes("/storage/v1/object/")) {
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }
    if (options.method === "HEAD") return { ok: true, status: 200, json: async () => ({}) };
    throw new Error("Meta should not be called during dry-run upload preparation");
  };
  try {
    const manager = createSocialManager({
      root,
      env: {
        SOCIAL_ADMIN_SECRET: "secret",
        SOCIAL_PUBLISH_DRY_RUN: "true",
        SOCIAL_DRY_RUN_UPLOAD_ASSET: "true",
        INSTAGRAM_ACCESS_TOKEN: "token",
        INSTAGRAM_USER_ID: "123",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SOCIAL_MEDIA_ASSETS_BUCKET: "social-media-assets"
      }
    });
    const cookie = await login(manager);
    const { graphic } = await approvedContentAndGraphic(manager, cookie);
    const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.json.publication.status, "prepared");
    assert.match(prepared.json.publication.assetUrl, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/social-media-assets\//);
    assert.equal(prepared.json.publication.platformMediaId, "");
    assert.ok(calls.some((call) => call.method === "POST" && call.href.includes("/storage/v1/object/")));
    assert.ok(calls.some((call) => call.method === "HEAD"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("prepared dry-run publication never reports published", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-status-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { graphic } = await approvedContentAndGraphic(manager, cookie);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  const refreshed = await route(manager, { method: "POST", path: `/api/social/publications/${prepared.json.publication.id}/refresh`, headers: { cookie }, body: {} });
  assert.equal(refreshed.json.publication.status, "prepared");
  assert.notEqual(refreshed.json.publication.status, "published");
});

test("unauthorized publish endpoint is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-auth-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, { method: "POST", path: "/api/social/publications/pub_123/publish", body: {} });
  assert.equal(response.status, 401);
});

test("cross-origin publish endpoint is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-origin-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/publications/pub_123/publish",
    headers: { host: "same-game-heat.onrender.com", origin: "https://evil.example" },
    body: {}
  });
  assert.equal(response.status, 403);
});

test("publication receipt preserves exact caption, hash, and snapshot hashes", () => {
  const snapshot = createSocialPickSnapshot(pick(), { createdAt: "2026-07-27T12:00:00Z" });
  const content = { id: "content_1", contentType: "BEST_BET", slateDate: "2026-07-27", caption: "Approved caption\n\n21+ | Bet responsibly.", pickSnapshotIds: [snapshot.id], metadata: { snapshotHashes: [snapshot.snapshotHash] } };
  const graphic = { id: "graphic_1", format: "feed", renderVersion: "v1", snapshotIds: [snapshot.id], snapshotHashes: [snapshot.snapshotHash] };
  const record = createPublicationRecord({
    content,
    graphic,
    asset: { assetUrl: "https://cdn.example.com/a.png", assetHash: "abc123", mimeType: "image/png", width: 1080, height: 1350 },
    account: { accountId: "123", username: "samegameheat" },
    apiVersion: "v23.0"
  });
  assert.equal(record.caption, content.caption);
  assert.equal(record.assetHash, "abc123");
  assert.deepEqual(record.snapshotHashes, [snapshot.snapshotHash]);
  assert.equal(verifyPublicationIntegrity(record).integrityStatus, "verified");
});

test("same approved graphic cannot prepare a second publication after publish", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-no-duplicate-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { content, graphic } = await approvedContentAndGraphic(manager, cookie);
  await manager.savePublication(publicationFixture({
    content,
    graphic,
    account: { accountId: "123", username: "samegameheat" },
    status: "verified"
  }));
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 400);
  assert.match(prepared.json.error, /already has a published Instagram receipt/);
});

test("double publish request is idempotent after verification", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-idempotent-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const saved = await manager.savePublication({
    ...publicationFixture({ status: "verified" }),
    platformMediaId: "ig_existing",
    permalink: "https://www.instagram.com/p/existing/"
  });
  const published = await route(manager, { method: "POST", path: `/api/social/publications/${saved.id}/publish`, headers: { cookie }, body: {} });
  assert.equal(published.status, 200);
  assert.equal(published.json.publication.platformMediaId, "ig_existing");
});

test("successful container creation does not equal successful publication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-container-only-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "IN_PROGRESS" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
    const saved = await manager.savePublication(publicationFixture({ status: "asset_ready" }));
    const result = await manager.publishPublication(saved.id);
    assert.equal(result.status, "container_processing");
    assert.equal(result.containerId, "container_1");
    assert.equal(result.platformMediaId, "");
  } finally {
    global.fetch = originalFetch;
  }
});

test("failed container processing does not publish", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-container-failed-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "ERROR" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
    const saved = await manager.savePublication(publicationFixture({ status: "asset_ready" }));
    const result = await manager.publishPublication(saved.id);
    assert.equal(result.status, "failed");
    assert.equal(result.platformMediaId, "");
  } finally {
    global.fetch = originalFetch;
  }
});

test("published receipt stores platform media ID and permalink", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-receipt-media-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
    const saved = await manager.savePublication(publicationFixture({ status: "asset_ready" }));
    const result = await manager.publishPublication(saved.id);
    assert.equal(result.status, "verified");
    assert.equal(result.platformMediaId, "ig_media_1");
    assert.equal(result.permalink, "https://www.instagram.com/p/test/");
    assert.equal(result.caption, saved.caption);
    assert.equal(result.assetHash, saved.assetHash);
    assert.deepEqual(result.snapshotHashes, saved.snapshotHashes);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Meta API failure does not break publication listing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-meta-failure-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ throwOnMeta: true });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
    const cookie = await login(manager);
    const saved = await manager.savePublication(publicationFixture({ status: "asset_ready" }));
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${saved.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 400);
    const list = await route(manager, { method: "GET", path: "/api/social/publications", headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.json.publications.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

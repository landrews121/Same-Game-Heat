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
  sha256,
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

function toArrayBuffer(bytes) {
  const buffer = Buffer.from(bytes);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
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
    if (options.method === "POST" && href.includes("/storage/v1/object/")) return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    if (options.method === "HEAD") return { ok: true, status: 200, headers: { get: () => "image/png" }, json: async () => ({}) };
    if (throwOnMeta && href.includes("graph.facebook.com")) {
      return { ok: false, status: 500, statusText: "Error", json: async () => ({ error: { message: "Provider down access_token=secret" } }) };
    }
    if (href.includes("graph.facebook.com") && href.includes("/123?")) return { ok: true, json: async () => ({ id: "123", username: "samegameheat" }) };
    if (href.includes("/123/media_publish")) return { ok: true, json: async () => ({ id: "ig_media_1" }) };
    if (href.includes("/123/media")) return { ok: true, json: async () => ({ id: "container_1" }) };
    if (href.includes("/container_1")) return { ok: true, json: async () => ({ id: "container_1", status_code: containerStatus }) };
    if (href.includes("/ig_media_1")) return { ok: true, json: async () => ({ id: "ig_media_1", permalink: "https://www.instagram.com/p/test/" }) };
    return { ok: true, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

async function liveReadyPublication(manager, cookie) {
  const { content, graphic } = await approvedContentAndGraphic(manager, cookie);
  const prepared = await route(manager, {
    method: "POST",
    path: `/api/social/graphics/${graphic.id}/prepare-publication`,
    headers: { cookie },
    body: { contentId: content.id, graphicId: graphic.id }
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.json.publication.status, "asset_ready");
  assert.equal(prepared.json.publication.dryRun, false);
  return prepared.json.publication;
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
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "sg_heater" } });
  const cookie = await login(manager);
  const { graphic } = await approvedContentAndGraphic(manager, cookie);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.json.publication.status, "prepared");
  assert.equal(prepared.json.publication.dryRun, true);
  assert.equal(prepared.json.publication.provider, "dry-run");
  assert.equal(prepared.json.publication.simulatedProvider, true);
  assert.equal(prepared.json.publication.accountUsername, "sg_heater");
  assert.equal(prepared.json.publication.assetUploaded, false);
  assert.equal(prepared.json.publication.platformMediaId, "");
  assert.equal(prepared.json.publication.containerId, "");
  assert.match(prepared.json.publication.assetUrl, /^https:\/\/dry-run\.same-game-heat\.local\//);
  assert.equal(prepared.json.publication.captionHash.length, 64);
  assert.equal(prepared.json.publication.metadata.safetyGate, "SOCIAL_PUBLISH_DRY_RUN");
  const published = await route(manager, { method: "POST", path: `/api/social/publications/${prepared.json.publication.id}/publish`, headers: { cookie }, body: {} });
  assert.equal(published.json.publication.status, "prepared");
  assert.equal(published.json.publication.platformMediaId, "");
});

test("live publish endpoint keeps dry-run receipts blocked and never calls Meta", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-receipt-block-"));
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method || "GET" });
    throw new Error("Meta should not be called for dry-run receipt publish");
  };
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
    const cookie = await login(manager);
    const { graphic } = await approvedContentAndGraphic(manager, cookie);
    const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${prepared.json.publication.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 200);
    assert.equal(published.json.publication.status, "prepared");
    assert.equal(calls.some((call) => call.href.includes("graph.facebook.com")), false);
    assert.equal(calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("dry-run can prepare a real public Supabase asset without publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-upload-"));
  const calls = [];
  const uploadedBodies = [];
  let uploadAttempts = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method || "GET" });
    if (options.method === "POST" && String(url).includes("/storage/v1/object/")) {
      uploadAttempts += 1;
      if (uploadAttempts > 1) {
        return {
          ok: false,
          status: 409,
          text: async () => JSON.stringify({ statusCode: 409, error: "Duplicate", code: "KeyAlreadyExists" }),
          json: async () => ({})
        };
      }
      uploadedBodies.push(options.body);
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }
    if ((options.method || "GET") === "GET" && String(url).includes("/storage/v1/object/public/")) {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => toArrayBuffer(uploadedBodies[0]), text: async () => "" };
    }
    if (options.method === "HEAD") return { ok: true, status: 200, headers: { get: () => "image/png" }, json: async () => ({}) };
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
        INSTAGRAM_EXPECTED_USERNAME: "sg_heater",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SOCIAL_MEDIA_ASSETS_BUCKET: "social-media-assets"
      }
    });
    const cookie = await login(manager);
    const { content, graphic } = await approvedContentAndGraphic(manager, cookie);
    const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: { contentId: content.id, graphicId: graphic.id } });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.json.ok, true);
    assert.equal(prepared.json.stage, "receipt_create");
    assert.equal(prepared.json.publication.status, "prepared");
    assert.equal(prepared.json.publication.assetUploaded, true);
    assert.equal(prepared.json.publication.simulatedProvider, true);
    assert.equal(prepared.json.publication.accountUsername, "sg_heater");
    assert.equal(prepared.json.publication.metadata.assetPublicUrlValidated, true);
    assert.equal(prepared.json.publication.metadata.assetReused, false);
    assert.equal(prepared.json.publication.metadata.assetAlreadyExisted, false);
    assert.equal(prepared.json.publication.metadata.metaPublishBlocked, true);
    assert.equal(prepared.json.publication.metadata.livePostCreated, false);
    assert.match(prepared.json.publication.assetUrl, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/social-media-assets\//);
    assert.equal(prepared.json.publication.platformMediaId, "");
    assert.equal(prepared.json.publication.permalink, "");
    assert.equal(prepared.json.publication.assetUrl.includes("service-role"), false);
    assert.equal(JSON.stringify(prepared.json.publication).includes("service-role"), false);
    assert.equal(JSON.stringify(prepared.json.publication).includes("token"), false);
    assert.equal(prepared.json.publication.assetHash, sha256(uploadedBodies[0]));
    assert.ok(calls.some((call) => call.method === "POST" && call.href.includes("/storage/v1/object/")));
    assert.ok(calls.some((call) => call.method === "HEAD"));
    assert.equal(calls.some((call) => call.href.includes("/media_publish")), false);
    assert.equal(calls.some((call) => call.href.includes("graph.facebook.com")), false);
    const retried = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
    assert.equal(retried.status, 200);
    assert.equal(retried.json.publication.id, prepared.json.publication.id);
    assert.equal(retried.json.publication.assetUrl, prepared.json.publication.assetUrl);
    assert.equal(retried.json.publication.assetHash, prepared.json.publication.assetHash);
    assert.equal(retried.json.publication.metadata.assetReused, true);
    assert.equal(retried.json.publication.metadata.assetAlreadyExisted, true);
    assert.equal(retried.json.publication.metadata.assetPublicUrlValidated, true);
    assert.equal(retried.json.publication.metadata.metaPublishBlocked, true);
    assert.equal(retried.json.publication.metadata.livePostCreated, false);
    assert.equal(uploadAttempts, 2);
    assert.equal(uploadedBodies.length, 1);
    assert.ok(calls.some((call) => call.method === "GET" && call.href.includes("/storage/v1/object/public/")));
    assert.equal(calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("dry-run public asset validation falls back to small GET when HEAD is blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-upload-get-"));
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method || "GET", range: options.headers?.Range || "" });
    if (options.method === "POST" && String(url).includes("/storage/v1/object/")) {
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }
    if (options.method === "HEAD") return { ok: false, status: 405, json: async () => ({}) };
    if (options.method === "GET") return { ok: true, status: 206, json: async () => ({}) };
    throw new Error("Unexpected request");
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
        SUPABASE_SERVICE_ROLE_KEY: "service-role"
      }
    });
    const cookie = await login(manager);
    const { graphic } = await approvedContentAndGraphic(manager, cookie);
    const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.json.publication.assetUploaded, true);
    assert.ok(calls.some((call) => call.method === "GET" && call.range === "bytes=0-31"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("dry-run duplicate storage object with different hash fails safely", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-upload-collision-"));
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method || "GET" });
    if (options.method === "POST" && String(url).includes("/storage/v1/object/")) {
      return {
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ statusCode: 409, error: "Duplicate", message: "The resource already exists", code: "KeyAlreadyExists", secret: "service-role" }),
        json: async () => ({})
      };
    }
    if ((options.method || "GET") === "GET" && String(url).includes("/storage/v1/object/public/")) {
      return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => toArrayBuffer("different-approved-asset"), text: async () => "" };
    }
    throw new Error("No request should happen after storage collision");
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
    assert.equal(prepared.status, 400);
    assert.equal(prepared.json.stage, "storage_collision");
    assert.match(prepared.json.error, /does not match the approved asset/i);
    assert.equal(JSON.stringify(prepared.json).includes("service-role"), false);
    assert.equal(JSON.stringify(prepared.json).includes("token"), false);
    assert.ok(calls.some((call) => call.method === "POST" && call.href.includes("/storage/v1/object/")));
    assert.ok(calls.some((call) => call.method === "GET" && call.href.includes("/storage/v1/object/public/")));
    assert.equal(calls.some((call) => call.href.includes("graph.facebook.com")), false);
    assert.equal(calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("dry-run upload failure prevents receipt and never calls Meta", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-dry-upload-fail-"));
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ href: String(url), method: options.method || "GET" });
    if (options.method === "POST" && String(url).includes("/storage/v1/object/")) {
      return { ok: false, status: 403, text: async () => "service-role token denied", json: async () => ({}) };
    }
    throw new Error("No request should happen after failed upload");
  };
  try {
    const manager = createSocialManager({
      root,
      env: {
        SOCIAL_ADMIN_SECRET: "secret",
        SOCIAL_PUBLISH_DRY_RUN: "true",
        SOCIAL_DRY_RUN_UPLOAD_ASSET: "true",
        INSTAGRAM_ACCESS_TOKEN: "ig-secret-token",
        INSTAGRAM_USER_ID: "123",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role"
      }
    });
    const cookie = await login(manager);
    const { graphic } = await approvedContentAndGraphic(manager, cookie);
    const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
    assert.equal(prepared.status, 400);
    assert.equal(prepared.json.ok, false);
    assert.equal(prepared.json.stage, "storage_upload");
    assert.match(prepared.json.error, /Dry-run asset upload failed\. No Instagram publication attempted/);
    assert.match(prepared.json.message, /Dry-run asset upload failed\. No Instagram publication attempted/);
    assert.doesNotMatch(prepared.json.error, /service-role|ig-secret-token/);
    assert.equal(prepared.json.diagnostics.graphicId, graphic.id);
    assert.equal(prepared.json.diagnostics.graphicStatus, "approved");
    assert.equal(prepared.json.diagnostics.dryRun, true);
    assert.equal(prepared.json.diagnostics.dryRunUploadEnabled, true);
    const publications = await route(manager, { method: "GET", path: "/api/social/publications", headers: { cookie } });
    assert.equal(publications.json.publications.length, 0);
    assert.equal(calls.some((call) => call.href.includes("graph.facebook.com")), false);
    assert.equal(calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("prepare publication reports visible stage when selected content and graphic do not match", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-content-mismatch-"));
  const manager = createSocialManager({
    root,
    env: {
      SOCIAL_ADMIN_SECRET: "secret",
      SOCIAL_PUBLISH_DRY_RUN: "true",
      SOCIAL_DRY_RUN_UPLOAD_ASSET: "true",
      INSTAGRAM_ACCESS_TOKEN: "token",
      INSTAGRAM_USER_ID: "123",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    }
  });
  const cookie = await login(manager);
  const { graphic } = await approvedContentAndGraphic(manager, cookie);
  const prepared = await route(manager, {
    method: "POST",
    path: `/api/social/graphics/${graphic.id}/prepare-publication`,
    headers: { cookie },
    body: { contentId: "content_wrong", graphicId: graphic.id }
  });
  assert.equal(prepared.status, 400);
  assert.equal(prepared.json.ok, false);
  assert.equal(prepared.json.stage, "validation");
  assert.match(prepared.json.error, /Selected graphic does not belong to the selected content item/);
  assert.equal(prepared.json.diagnostics.requestedContentId, "content_wrong");
  assert.equal(prepared.json.diagnostics.graphicId, graphic.id);
  assert.equal(prepared.json.diagnostics.graphicStatus, "approved");
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

test("testing reset archives dry-run receipts and preserves official history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-testing-reset-"));
  let metaCalled = false;
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" },
    fetchImpl: async () => {
      metaCalled = true;
      throw new Error("Reset should not call Meta");
    }
  });
  const cookie = await login(manager);
  const { content, graphic } = await approvedContentAndGraphic(manager, cookie);
  const snapshotBefore = (await readJson(path.join(root, ".social-pick-snapshots.json")))[0];
  const result = createResultRecord({
    snapshot: snapshotBefore,
    gameResult: { gameId: snapshotBefore.gameId, homeTeam: snapshotBefore.homeTeam, awayTeam: snapshotBefore.awayTeam, status: "final", homeScore: 5, awayScore: 2 }
  });
  await writeJson(path.join(root, ".social-results.json"), [result]);
  const prepared = await route(manager, { method: "POST", path: `/api/social/graphics/${graphic.id}/prepare-publication`, headers: { cookie }, body: {} });
  assert.equal(prepared.status, 200);

  const reset = await route(manager, {
    method: "POST",
    path: "/api/social/testing/reset",
    headers: { cookie },
    body: {
      slateDate: "2026-07-27",
      selectedContentId: content.id,
      selectedGraphicId: graphic.id
    }
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.ok, true);
  assert.equal(reset.json.cleared.currentSelections, true);
  assert.equal(reset.json.cleared.currentBoardCache, true);
  assert.equal(reset.json.cleared.dryRunPublications, 1);
  assert.equal(reset.json.cleared.testContent, 1);
  assert.equal(reset.json.cleared.testGraphics, 1);
  assert.deepEqual(reset.json.preserved, {
    officialSnapshots: true,
    results: true,
    performanceHistory: true,
    livePublications: true,
    instagramPosts: true
  });
  assert.equal(JSON.stringify(reset.json).includes("token"), false);
  assert.equal(metaCalled, false);

  const activePublications = await route(manager, { method: "GET", path: "/api/social/publications", headers: { cookie } });
  assert.equal(activePublications.status, 200);
  assert.equal(activePublications.json.publications.length, 0);
  const archivedPublications = await route(manager, { method: "GET", path: "/api/social/publications?includeArchived=true", headers: { cookie } });
  assert.equal(archivedPublications.json.publications.length, 1);
  assert.equal(archivedPublications.json.publications[0].dryRun, true);
  assert.equal(archivedPublications.json.publications[0].status, "archived");

  const snapshotsAfter = await readJson(path.join(root, ".social-pick-snapshots.json"));
  const resultsAfter = await readJson(path.join(root, ".social-results.json"));
  const contentAfter = await readJson(path.join(root, ".social-content.json"));
  const graphicsAfter = await readJson(path.join(root, ".social-graphics.json"));
  assert.equal(snapshotsAfter.length, 1);
  assert.equal(snapshotsAfter[0].id, snapshotBefore.id);
  assert.equal(resultsAfter.length, 1);
  assert.equal(resultsAfter[0].id, result.id);
  assert.equal(contentAfter.find((item) => item.id === content.id).status, "archived");
  assert.equal(graphicsAfter.find((item) => item.id === graphic.id).status, "archived");
});

test("testing reset preserves live publication records and linked content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-testing-reset-live-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", SOCIAL_PUBLISH_DRY_RUN: "true", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123" } });
  const cookie = await login(manager);
  const { content, graphic } = await approvedContentAndGraphic(manager, cookie);
  const live = await manager.savePublication(publicationFixture({
    content,
    graphic,
    dryRun: false,
    status: "published",
    account: { accountId: "123", username: "sg_heater" }
  }));
  const reset = await route(manager, {
    method: "POST",
    path: "/api/social/testing/reset",
    headers: { cookie },
    body: {
      selectedContentId: content.id,
      selectedGraphicId: graphic.id
    }
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.cleared.testContent, 0);
  assert.equal(reset.json.cleared.testGraphics, 0);
  assert.equal(reset.json.cleared.dryRunPublications, 0);

  const activePublications = await route(manager, { method: "GET", path: "/api/social/publications", headers: { cookie } });
  assert.equal(activePublications.json.publications.length, 1);
  assert.equal(activePublications.json.publications[0].id, live.id);
  assert.equal(activePublications.json.publications[0].status, "published");
  const contentAfter = await readJson(path.join(root, ".social-content.json"));
  const graphicsAfter = await readJson(path.join(root, ".social-graphics.json"));
  assert.notEqual(contentAfter.find((item) => item.id === content.id).status, "archived");
  assert.notEqual(graphicsAfter.find((item) => item.id === graphic.id).status, "archived");
});

test("anonymous testing reset request is rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-testing-reset-auth-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const response = await route(manager, { method: "POST", path: "/api/social/testing/reset", body: {} });
  assert.equal(response.status, 401);
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
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const result = await manager.publishPublication(saved.id);
    assert.equal(result.status, "container_processing");
    assert.equal(result.containerId, "container_1");
    assert.equal(result.platformMediaId, "");
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("failed container processing does not publish", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-container-failed-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "ERROR" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const result = await manager.publishPublication(saved.id);
    assert.equal(result.status, "failed");
    assert.equal(result.platformMediaId, "");
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("published receipt stores platform media ID and permalink", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-receipt-media-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const result = await manager.publishPublication(saved.id);
    assert.equal(result.status, "verified");
    assert.equal(result.platformMediaId, "ig_media_1");
    assert.equal(result.permalink, "https://www.instagram.com/p/test/");
    assert.equal(result.caption, saved.caption);
    assert.equal(result.assetHash, saved.assetHash);
    assert.deepEqual(result.snapshotHashes, saved.snapshotHashes);
    const publishCallIndex = global.fetch.calls.findIndex((call) => call.href.includes("/media_publish"));
    const finalIdentityIndex = global.fetch.calls.findIndex((call, index) => index > publishCallIndex - 4 && call.href.includes("graph.facebook.com") && call.href.includes("/123?"));
    assert.ok(publishCallIndex > -1);
    assert.ok(finalIdentityIndex > -1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live publish blocks username mismatch before Meta write mutations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-user-mismatch-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "sg_heater", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${saved.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 400);
    assert.equal(published.json.stage, "identity_check");
    assert.match(published.json.error, /username mismatch/i);
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/123/media")), false);
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live publish blocks account ID mismatch before Meta write mutations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-account-mismatch-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const tampered = await manager.savePublication({ ...saved, accountId: "456", updatedAt: new Date().toISOString() });
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${tampered.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 400);
    assert.equal(published.json.stage, "identity_check");
    assert.match(published.json.error, /account does not match/i);
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live publish blocks duplicate live receipt but ignores dry-run receipt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-live-duplicate-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    await manager.savePublication({ ...saved, id: "pub_dry_history", dryRun: true, status: "prepared", provider: "dry-run", updatedAt: new Date().toISOString() });
    const stillAllowed = await route(manager, { method: "POST", path: `/api/social/publications/${saved.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(stillAllowed.status, 200);
    assert.equal(stillAllowed.json.publication.status, "verified");
    const next = await manager.savePublication({ ...saved, id: "pub_second_same_key", status: "asset_ready", containerId: "", containerStatus: "", platformMediaId: "", permalink: "", dryRun: false, updatedAt: new Date().toISOString() });
    const blocked = await route(manager, { method: "POST", path: `/api/social/publications/${next.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.json.publication.status, "verified");
    assert.equal(blocked.json.publication.id, stillAllowed.json.publication.id);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live publish blocks caption mutation and missing disclaimer before Meta write mutations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-caption-mutation-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const tampered = await manager.savePublication({ ...saved, caption: "Changed caption", captionHash: sha256("Changed caption"), updatedAt: new Date().toISOString() });
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${tampered.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 400);
    assert.equal(published.json.stage, "approval_check");
    assert.match(published.json.error, /disclaimer|exact approved caption/i);
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live publish blocks invalid public asset URL before Meta write mutations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-asset-invalid-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const tampered = await manager.savePublication({ ...saved, assetUrl: "http://localhost/a.png", updatedAt: new Date().toISOString() });
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${tampered.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 400);
    assert.equal(published.json.stage, "asset_validation");
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live publish blocks raster asset hash mismatch before Meta write mutations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-pub-asset-hash-invalid-"));
  const originalFetch = global.fetch;
  global.fetch = fakeMetaFetch({ containerStatus: "FINISHED" });
  try {
    const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret", INSTAGRAM_ACCESS_TOKEN: "token", INSTAGRAM_USER_ID: "123", INSTAGRAM_EXPECTED_USERNAME: "samegameheat", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" } });
    const cookie = await login(manager);
    const saved = await liveReadyPublication(manager, cookie);
    const tampered = await manager.savePublication({ ...saved, assetHash: "bad-hash", updatedAt: new Date().toISOString() });
    const published = await route(manager, { method: "POST", path: `/api/social/publications/${tampered.id}/publish`, headers: { cookie }, body: {} });
    assert.equal(published.status, 400);
    assert.equal(published.json.stage, "asset_validation");
    assert.equal(global.fetch.calls.some((call) => call.href.includes("/media_publish")), false);
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

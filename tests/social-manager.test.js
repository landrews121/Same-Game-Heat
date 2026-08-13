const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {
  createSocialManager,
  createSocialPickSnapshot,
  createSocialContentRecord,
  approveSocialContent,
  archiveSocialContent,
  normalizeGeneratedContent,
  validateNoProhibitedLanguage
} = require("../social-manager");
const {
  renderSocialGraphic,
  RESPONSIBLE_FOOTER,
  GRAPHIC_TEMPLATE_VERSION,
  STATS_GRAPHIC_TEMPLATE_VERSION,
  STATS_BOARD_LAYOUT,
  estimateTextWidth,
  fitTextToWidth,
  wrapTextToWidth,
  shortenStatsWatch,
  selectStatsBoardMetrics
} = require("../social-graphics");
const { STORY_MUSIC_RECOMMENDATIONS } = require("../story-music");
const { createPublicationRecord } = require("../social-publications");
const {
  buildDailyPickStats,
  resolveMlbGameForSnapshot
} = require("../social-pick-stats");

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

function mockOpenAiResponse({ status = 200, body = {}, textBody = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Provider Error",
    async json() {
      return body;
    },
    async text() {
      return textBody ?? JSON.stringify(body);
    }
  };
}

async function withMockedSocialAi({ env = {}, fetchImpl, picks = [samplePick()], run }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-ai-"));
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  global.fetch = fetchImpl;
  console.warn = (...args) => warnings.push(args);
  try {
    const manager = createSocialManager({
      root,
      env: {
        SOCIAL_ADMIN_SECRET: "secret",
        OPENAI_API_KEY: "sk-test-secret-should-not-leak",
        SOCIAL_AI_MODEL: "gpt-4o-mini",
        ...env
      }
    });
    const cookie = await login(manager);
    const response = await route(manager, {
      method: "POST",
      path: "/api/social/generate",
      headers: { cookie },
      body: {
        contentType: "DAILY_3",
        board: {
          slateDate: "2026-07-27",
          sport: "baseball_mlb",
          officialPicks: picks
        }
      }
    });
    await run({ response, warnings });
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
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

test("normal string arrays are preserved during generated content normalization", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ hashtags: ["#SameGameHeat", "#MLB"], warnings: ["Confirm lineups"] }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.hashtags, ["#SameGameHeat", "#MLB"]);
  assert.deepEqual(result.normalized.warnings, ["Confirm lineups"]);
});

test("space separated hashtag string is normalized", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ hashtags: "#SameGameHeat #MLB #SportsBetting" }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.hashtags, ["#SameGameHeat", "#MLB", "#SportsBetting"]);
});

test("comma separated hashtag string is normalized", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ hashtags: "#SameGameHeat, #MLB, #SportsBetting" }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.hashtags, ["#SameGameHeat", "#MLB", "#SportsBetting"]);
});

test("warnings string becomes one warning instead of splitting words", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ warnings: "Confirm lineups before posting." }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.warnings, ["Confirm lineups before posting."]);
});

test("null warnings are normalized to an empty list", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ warnings: null }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.warnings, []);
});

test("null hashtags safely fall back to local template hashtags", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ hashtags: null }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.hashtags, ["#MLB", "#MLBPicks", "#MLBBetting", "#BaseballPicks", "#SportsBetting", "#SameGameHeat"]);
});

test("plain object hashtags and warnings do not crash normalization", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ hashtags: { tag: "#SameGameHeat" }, warnings: { text: "Confirm lineups" } }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.hashtags, ["#MLB", "#MLBPicks", "#MLBBetting", "#BaseballPicks", "#SportsBetting", "#SameGameHeat"]);
  assert.deepEqual(result.normalized.warnings, []);
});

test("mixed array string fields do not crash normalization", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ hashtags: ["#SameGameHeat", 12, null, "#MLB"], warnings: ["Confirm", 12, false, null] }, "DAILY_3", [snapshot]);
  assert.deepEqual(result.normalized.hashtags, ["#SameGameHeat", "#MLB"]);
  assert.deepEqual(result.normalized.warnings, ["Confirm"]);
});

test("prohibited-language validation still runs after normalization", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ caption: "This is free money.", hashtags: "#SameGameHeat #MLB" }, "DAILY_3", [snapshot]);
  assert.ok(result.prohibited.length > 0);
});

test("disclaimer is still enforced after normalization", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const result = normalizeGeneratedContent({ disclaimer: "Bet carefully", hashtags: "#SameGameHeat #MLB" }, "DAILY_3", [snapshot]);
  assert.equal(result.normalized.disclaimer, "21+ | Bet responsibly.");
});

test("fallback DAILY_3 stays short human and contains frozen teams odds hashtags and disclaimer", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { sportsbookOdds: -247, modelWinProbability: 0.631, fairOdds: -171, playableThrough: -154, reasons: ["Starting-pitching matchup"], riskFlags: ["Selected book was unavailable, so consensus odds were used."] })),
    createSocialPickSnapshot(samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { sportsbookOdds: -190, modelWinProbability: 0.606, fairOdds: -154, playableThrough: -138, reasons: ["Home-field edge"] })),
    createSocialPickSnapshot(samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { sportsbookOdds: -158, modelWinProbability: 0.586, fairOdds: -142, reasons: ["Favorable overall matchup score"], isBackfill: true }))
  ];
  const result = normalizeGeneratedContent({}, "DAILY_3", snapshots);
  assert.match(result.normalized.caption, /^🔥 SAME GAME HEAT — DAILY 3/);
  assert.match(result.normalized.caption, /1️⃣ Milwaukee Brewers ML -247/);
  assert.match(result.normalized.caption, /2️⃣ Philadelphia Phillies ML -190/);
  assert.match(result.normalized.caption, /3️⃣ St\. Louis Cardinals ML -158/);
  assert.match(result.normalized.caption, /Milwaukee Brewers ML -247/);
  assert.doesNotMatch(result.normalized.caption, /63\.1%|60\.6%|58\.6%/);
  assert.doesNotMatch(result.normalized.caption, /Starting-pitching matchup|fair price|Playable through|lower-confidence/i);
  assert.match(result.normalized.caption, /These are the three sides I like most/);
  assert.match(result.normalized.caption, /#MLB #MLBPicks #MLBBetting #BaseballPicks #SportsBetting #SameGameHeat/);
  assert.ok(result.normalized.caption.trim().endsWith("21+ | Bet responsibly."));
  assert.ok(result.normalized.caption.length < 600);
  assert.equal((result.normalized.caption.match(/21\+ \| Bet responsibly\./g) || []).length, 1);
  assert.match(result.normalized.reelHook, /Three MLB sides I like today/i);
  assert.doesNotMatch(result.normalized.reelHook, /Curious about|winning picks/i);
  assert.match(result.normalized.reelScript, /Milwaukee Brewers/);
  assert.match(result.normalized.reelScript, /Philadelphia Phillies/);
  assert.match(result.normalized.reelScript, /St\. Louis Cardinals/);
  assert.ok(result.normalized.shortCaption.length < 280);
  assert.match(result.normalized.shortCaption, /Milwaukee Brewers ML -247/);
  assert.doesNotMatch(result.normalized.shortCaption, /63\.1%/);
  assert.match(result.normalized.shortCaption, /21\+ \| Bet responsibly/);
  assert.ok(result.normalized.storyText.length < 280);
  assert.doesNotMatch(result.normalized.storyText, /63\.1%|fair price|Playable through/i);
});

test("internal warnings are not dumped into DAILY_3 caption", () => {
  const consensus = "Selected book was unavailable, so consensus odds were used.";
  const internal = "Bullpen workload estimates limited.";
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { riskFlags: [consensus, internal] })),
    createSocialPickSnapshot(samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { riskFlags: [consensus, internal] })),
    createSocialPickSnapshot(samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { riskFlags: [consensus, internal] }))
  ];
  const result = normalizeGeneratedContent({}, "DAILY_3", snapshots);
  assert.doesNotMatch(result.normalized.caption, /consensus odds were used/);
  assert.doesNotMatch(result.normalized.caption, /Bullpen workload estimates limited/);
});

test("fallback BEST_BET uses short human tone", () => {
  const snapshot = createSocialPickSnapshot(samplePick({ selectedTeam: "Milwaukee Brewers", homeTeam: "Milwaukee Brewers", awayTeam: "Atlanta Braves", opponent: "Atlanta Braves", sportsbookOdds: -247, modelWinProbability: 0.631, fairOdds: -171, playableThrough: -154, reasons: ["Starting-pitching matchup"], riskFlags: ["Confirm lineups before posting."] }));
  const result = normalizeGeneratedContent({}, "BEST_BET", [snapshot]);
  assert.match(result.normalized.caption, /^🔥 BEST BET/);
  assert.match(result.normalized.caption, /Milwaukee Brewers ML -247/);
  assert.match(result.normalized.caption, /My favorite side on today’s board/);
  assert.doesNotMatch(result.normalized.caption, /63\.1%|fair price|Playable through|WHY SGH LIKES IT|RISK TO WATCH/i);
  assert.ok(result.normalized.caption.length < 240);
});

test("fallback PICK_BREAKDOWN stays concise", () => {
  const snapshot = createSocialPickSnapshot(samplePick({ reasons: ["Bullpen profile supports the pick"], riskFlags: ["Projected lineup data was incomplete."] }));
  const result = normalizeGeneratedContent({}, "PICK_BREAKDOWN", [snapshot]);
  assert.match(result.normalized.caption, /🔥 PICK BREAKDOWN/);
  assert.match(result.normalized.caption, /Los Angeles Angels ML -105/);
  assert.match(result.normalized.caption, /Bullpen profile supports the pick/);
  assert.match(result.normalized.caption, /Confirm the current number/);
  assert.doesNotMatch(result.normalized.caption, /WHY IT RATES WELL|RISK TO WATCH|MODEL/i);
  assert.ok(result.normalized.caption.length < 280);
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

test("Daily 3 route allows a new draft after the previous one is archived", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-archived-daily3-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const cookie = await login(manager);
  const body = {
    contentType: "DAILY_3",
    board: {
      slateDate: "2026-07-27",
      sport: "baseball_mlb",
      officialPicks: [samplePick()]
    }
  };
  const first = await route(manager, { method: "POST", path: "/api/social/generate", headers: { cookie }, body });
  assert.equal(first.status, 200);
  const archived = await route(manager, {
    method: "POST",
    path: `/api/social/content/${first.json.content.id}/archive`,
    headers: { cookie },
    body: {}
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.json.content.status, "archived");

  const second = await route(manager, { method: "POST", path: "/api/social/generate", headers: { cookie }, body });
  assert.equal(second.status, 200);
  assert.equal(second.json.content.contentType, "DAILY_3");
  assert.notEqual(second.json.content.id, first.json.content.id);
  assert.notEqual(second.json.content.status, "archived");
});

test("newer archived local Daily 3 beats stale active remote duplicate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-stale-remote-daily3-"));
  const snapshot = createSocialPickSnapshot(samplePick(), { createdAt: "2026-07-27T12:00:00Z" });
  const activeRemote = createSocialContentRecord({
    contentType: "DAILY_3",
    snapshots: [snapshot],
    generated: {},
    now: "2026-07-27T12:01:00Z"
  });
  const archivedLocal = archiveSocialContent(activeRemote, "2026-07-27T12:02:00Z");
  await fs.writeFile(path.join(root, ".social-content.json"), JSON.stringify([archivedLocal], null, 2));
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret" },
    supabaseEnabled: () => true,
    supabaseRequest: async (pathName, options = {}) => {
      if (!options.method && String(pathName).startsWith("social_content?")) {
        return [{
          id: activeRemote.id,
          content_type: activeRemote.contentType,
          slate_date: activeRemote.slateDate,
          status: activeRemote.status,
          payload: activeRemote,
          created_at: activeRemote.createdAt,
          updated_at: activeRemote.updatedAt
        }];
      }
      return [];
    }
  });
  const cookie = await login(manager);
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: {
      contentType: "DAILY_3",
      board: {
        slateDate: "2026-07-27",
        sport: "baseball_mlb",
        officialPicks: [samplePick()]
      }
    }
  });
  assert.equal(response.status, 200);
  assert.notEqual(response.json.content.id, activeRemote.id);
  assert.notEqual(response.json.content.status, "archived");
});

test("successful OpenAI social response preserves provider and configured model", async () => {
  let capturedBody = null;
  await withMockedSocialAi({
    fetchImpl: async (_url, options) => {
      assert.ok(options.signal);
      capturedBody = JSON.parse(options.body);
      return mockOpenAiResponse({
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "AI Daily 3",
                daily3Sentence: "These are the three sides I like most on today’s board.",
                caption: "These are the three sides I like most on today’s board.",
                shortCaption: "Daily 3.",
                hashtags: ["#SameGameHeat"],
                disclaimer: "21+ | Bet responsibly."
              })
            }
          }]
        }
      });
    },
    run: async ({ response, warnings }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "openai");
      assert.equal(response.json.content.generationModel, "gpt-4o-mini");
      assert.equal(response.json.content.headline, "AI Daily 3");
      assert.match(response.json.content.caption, /These are the three sides I like most/);
      assert.equal(capturedBody.model, "gpt-4o-mini");
      assert.equal(capturedBody.response_format.type, "json_object");
      assert.equal(warnings.length, 0);
    }
  });
});

test("OpenAI prompt includes SGH brand voice and no-invention rules", async () => {
  let capturedBody = null;
  await withMockedSocialAi({
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return mockOpenAiResponse({
        body: {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "Same Game Heat Daily 3",
                daily3Sentence: "Keeping it simple today — this side stood out.",
                caption: "Keeping it simple today — this side stood out.",
                shortCaption: "Daily 3.",
                reelHook: "Three MLB sides I like today.",
                reelScript: "Three MLB sides I like today.",
                storyText: "Los Angeles Angels ML -105",
                hashtags: ["#SameGameHeat", "#MLB"],
                disclaimer: "21+ | Bet responsibly.",
                warnings: []
              })
            }
          }]
        }
      });
    },
    run: async () => {
      const system = capturedBody.messages[0].content;
      const user = JSON.parse(capturedBody.messages[1].content);
      assert.match(system, /Same Game Heat/);
      assert.match(system, /daily3Sentence/);
      assert.match(system, /max 20 words/);
      assert.match(user.brandVoice.join(" "), /Short, natural, human/);
      assert.match(user.rules.join(" "), /Do not fabricate missing facts/);
      assert.match(user.rules.join(" "), /do not infer injuries, weather, bullpen status, lineups/);
      assert.match(user.formatGuidance.DAILY_3, /ONE conversational sentence/i);
      assert.doesNotMatch(user.formatGuidance.DAILY_3, /model win probability/i);
    }
  });
});

test("OpenAI response with string hashtags preserves provider and canonicalizes Daily 3 caption", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "AI Daily 3",
              caption: "🔥 SAME GAME HEAT — DAILY 3\n\nThis AI caption should stay for Los Angeles Angels ML -105 with 55.1% model win probability.\n\n21+ | Bet responsibly.",
              shortCaption: "Los Angeles Angels ML -105 (55.1%). 21+ | Bet responsibly.",
              daily3Sentence: "My top side for the slate.",
              hashtags: "#SameGameHeat #MLB #SportsBetting",
              warnings: "Confirm lineups before posting.",
              disclaimer: "21+ | Bet responsibly."
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "openai");
      assert.match(response.json.content.caption, /^🔥 SAME GAME HEAT — DAILY 3/);
      assert.match(response.json.content.caption, /1️⃣ Los Angeles Angels ML -105/);
      assert.match(response.json.content.caption, /My top side for the slate/);
      assert.doesNotMatch(response.json.content.caption, /Model win probability: 55\.1%/);
      assert.doesNotMatch(response.json.content.caption, /This AI caption should stay/);
      assert.deepEqual(response.json.content.hashtags, ["#SameGameHeat", "#MLB", "#SportsBetting"]);
      assert.deepEqual(response.json.content.metadata.warnings, [
        "Confirm lineups before posting.",
        "AI copy was reformatted to SGH publishing standards."
      ]);
    }
  });
});

test("three-pick OpenAI DAILY_3 with visual blocks preserves provider", async () => {
  const picks = [
    samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { sportsbookOdds: -247, modelWinProbability: 0.631 }),
    samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { sportsbookOdds: -190, modelWinProbability: 0.606 }),
    samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { sportsbookOdds: -158, modelWinProbability: 0.586 })
  ];
  await withMockedSocialAi({
    picks,
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Same Game Heat Daily 3",
              daily3Sentence: "These are my top three sides for the slate.",
              caption: "🔥 SAME GAME HEAT — DAILY 3\n\n1️⃣ Milwaukee Brewers ML -247\nModel win probability: 63.1%\nMilwaukee grades well behind the supplied starting-pitching edge.\n\n2️⃣ Philadelphia Phillies ML -190\nModel win probability: 60.6%\nPhiladelphia gets support from the supplied matchup profile.\n\n3️⃣ St. Louis Cardinals ML -158\nModel win probability: 58.6%\nSt. Louis rounds out the board with the supplied model edge.\n\nPrice matters. Confirm the current number before betting.\n\n21+ | Bet responsibly.",
              shortCaption: "🔥 SGH Daily 3: Milwaukee Brewers ML -247 (63.1%), Philadelphia Phillies ML -190 (60.6%), St. Louis Cardinals ML -158 (58.6%). 21+ | Bet responsibly.",
              reelHook: "Three moneylines separated themselves from today's slate.",
              reelScript: "SGH scanned the MLB slate. Milwaukee Brewers grade at 63.1% behind the starting-pitching edge. Philadelphia Phillies sit at 60.6% with matchup support. St. Louis Cardinals round it out at 58.6%. Price matters. 21+ | Bet responsibly.",
              storyText: "🔥 SGH DAILY 3\n\nMilwaukee Brewers ML -247\n63.1%\n\nPhiladelphia Phillies ML -190\n60.6%\n\nSt. Louis Cardinals ML -158\n58.6%\n\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat", "#MLB", "#MLBPicks"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "openai");
      assert.match(response.json.content.caption, /1️⃣ Milwaukee Brewers/);
      assert.match(response.json.content.caption, /These are my top three sides for the slate/);
      assert.doesNotMatch(response.json.content.caption, /Model win probability|fair price|Playable through/i);
    }
  });
});

test("one-paragraph three-pick OpenAI DAILY_3 is repaired and preserves provider", async () => {
  const picks = [
    samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { sportsbookOdds: -247, modelWinProbability: 0.631 }),
    samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { sportsbookOdds: -190, modelWinProbability: 0.606 }),
    samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { sportsbookOdds: -158, modelWinProbability: 0.586 })
  ];
  await withMockedSocialAi({
    picks,
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Same Game Heat Daily 3",
              daily3Sentence: "Three moneylines I’m rolling with today.",
              caption: "🔥 SAME GAME HEAT — DAILY 3 Milwaukee Brewers ML -247 63.1% Philadelphia Phillies ML -190 60.6% St. Louis Cardinals ML -158 58.6% 21+ | Bet responsibly.",
              shortCaption: "Milwaukee Brewers ML -247 (63.1%), Philadelphia Phillies ML -190 (60.6%), St. Louis Cardinals ML -158 (58.6%). 21+ | Bet responsibly.",
              reelHook: "Three moneylines separated themselves from today's slate.",
              reelScript: "Milwaukee Brewers, Philadelphia Phillies, and St. Louis Cardinals grade highest. 21+ | Bet responsibly.",
              storyText: "Milwaukee Brewers ML -247\n63.1%\nPhiladelphia Phillies ML -190\n60.6%\nSt. Louis Cardinals ML -158\n58.6%\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "openai");
      assert.equal(response.json.content.metadata.presentationRepaired, true);
      assert.match(response.json.content.metadata.repairReasons.join(" "), /daily_3_caption_canonicalized/);
      assert.match(response.json.content.caption, /1️⃣ Milwaukee Brewers/);
      assert.match(response.json.content.caption, /2️⃣ Philadelphia Phillies/);
      assert.match(response.json.content.caption, /3️⃣ St\. Louis Cardinals/);
      assert.match(response.json.content.caption, /Three moneylines I’m rolling with today/);
      assert.doesNotMatch(response.json.content.caption, /63\.1%|60\.6%|58\.6%/);
      assert.ok(response.json.content.caption.trim().endsWith("21+ | Bet responsibly."));
      assert.match(response.json.content.shortCaption, /Milwaukee Brewers ML -247/);
      assert.match(response.json.content.shortCaption, /Philadelphia Phillies ML -190/);
      assert.match(response.json.content.shortCaption, /St\. Louis Cardinals ML -158/);
      assert.doesNotMatch(response.json.content.shortCaption, /63\.1%|60\.6%|58\.6%/);
    }
  });
});

test("missing headline disclaimer shortCaption teams and weak hook are repaired without fallback", async () => {
  const picks = [
    samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { sportsbookOdds: -247, modelWinProbability: 0.631, reasons: ["Starting-pitching edge"] }),
    samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { sportsbookOdds: -190, modelWinProbability: 0.606, reasons: ["Home-field edge"] }),
    samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { sportsbookOdds: -158, modelWinProbability: 0.586, reasons: ["Matchup score"] })
  ];
  await withMockedSocialAi({
    picks,
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Daily Card",
              daily3Sentence: "Keeping it simple today — these three stood out.",
              caption: "Milwaukee Brewers are backed by the starter edge. Philadelphia Phillies are supported by the home-field edge. St. Louis Cardinals round out the slate on matchup score.",
              shortCaption: "MLB Daily Picks: Brewers, Phillies, Cardinals",
              reelHook: "Curious about today's model insights for MLB matchups?",
              reelScript: "Milwaukee Brewers, Philadelphia Phillies, and St. Louis Cardinals grade highest. 21+ | Bet responsibly.",
              storyText: "Long story text",
              hashtags: [],
              disclaimer: "",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "openai");
      assert.equal(response.json.content.metadata.presentationRepaired, true);
      assert.match(response.json.content.caption, /^🔥 SAME GAME HEAT — DAILY 3/);
      assert.match(response.json.content.caption, /Keeping it simple today/);
      assert.doesNotMatch(response.json.content.caption, /Starting-pitching edge|63\.1%|fair price|Playable through/i);
      assert.ok(response.json.content.caption.trim().endsWith("21+ | Bet responsibly."));
      assert.match(response.json.content.shortCaption, /Milwaukee Brewers ML -247/);
      assert.match(response.json.content.shortCaption, /Philadelphia Phillies ML -190/);
      assert.match(response.json.content.shortCaption, /St\. Louis Cardinals ML -158/);
      assert.equal(response.json.content.reelHook, "Three MLB sides I like today.");
      assert.match(response.json.content.metadata.repairReasons.join(" "), /reel_hook_rebuilt/);
    }
  });
});

test("duplicate disclaimer is normalized during DAILY_3 presentation repair", async () => {
  const picks = [
    samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { sportsbookOdds: -247, modelWinProbability: 0.631 }),
    samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { sportsbookOdds: -190, modelWinProbability: 0.606 }),
    samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { sportsbookOdds: -158, modelWinProbability: 0.586 })
  ];
  await withMockedSocialAi({
    picks,
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Same Game Heat Daily 3",
              daily3Sentence: "These are the three that stood out on today’s board.",
              caption: "Milwaukee Brewers ML -247 63.1%. Philadelphia Phillies ML -190 60.6%. St. Louis Cardinals ML -158 58.6%. 21+ | Bet responsibly. 21+ | Bet responsibly.",
              shortCaption: "Milwaukee Brewers ML -247 (63.1%), Philadelphia Phillies ML -190 (60.6%), St. Louis Cardinals ML -158 (58.6%). 21+ | Bet responsibly.",
              reelHook: "Three moneylines separated themselves from today's slate.",
              reelScript: "Milwaukee Brewers, Philadelphia Phillies, and St. Louis Cardinals grade highest. 21+ | Bet responsibly.",
              storyText: "Milwaukee Brewers ML -247\n63.1%\nPhiladelphia Phillies ML -190\n60.6%\nSt. Louis Cardinals ML -158\n58.6%\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.json.content.generationProvider, "openai");
      assert.equal((response.json.content.caption.match(/21\+ \| Bet responsibly\./g) || []).length, 1);
      assert.ok(response.json.content.caption.trim().endsWith("21+ | Bet responsibly."));
    }
  });
});

test("AI DAILY_3 with wrong frozen odds still falls back safely", async () => {
  const picks = [
    samplePickForTeam("Milwaukee Brewers", "Atlanta Braves", 1, { sportsbookOdds: -247, modelWinProbability: 0.631 }),
    samplePickForTeam("Philadelphia Phillies", "Miami Marlins", 2, { sportsbookOdds: -190, modelWinProbability: 0.606 }),
    samplePickForTeam("St. Louis Cardinals", "Chicago Cubs", 3, { sportsbookOdds: -158, modelWinProbability: 0.586 })
  ];
  await withMockedSocialAi({
    picks,
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Same Game Heat Daily 3",
              caption: "🔥 SAME GAME HEAT — DAILY 3\n\n1️⃣ Milwaukee Brewers ML -999\nModel win probability: 63.1%\nStarter edge.\n\n2️⃣ Philadelphia Phillies ML -190\nModel win probability: 60.6%\nHome edge.\n\n3️⃣ St. Louis Cardinals ML -158\nModel win probability: 58.6%\nMatchup edge.\n\n21+ | Bet responsibly.",
              shortCaption: "Milwaukee Brewers ML -999 (63.1%), Philadelphia Phillies ML -190 (60.6%), St. Louis Cardinals ML -158 (58.6%). 21+ | Bet responsibly.",
              reelHook: "Three moneylines separated themselves from today's slate.",
              reelScript: "Milwaukee Brewers, Philadelphia Phillies, and St. Louis Cardinals grade highest. 21+ | Bet responsibly.",
              storyText: "Milwaukee Brewers ML -999\n63.1%\nPhiladelphia Phillies ML -190\n60.6%\nSt. Louis Cardinals ML -158\n58.6%\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.match(response.json.content.metadata.warnings[0], /changed or invented snapshot values/);
      assert.doesNotMatch(response.json.content.caption, /-999/);
    }
  });
});

test("generic covered copy falls back to deterministic SGH template", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Hot Picks Today",
              caption: "We've got you covered with Los Angeles Angels ML -105 and 55.1% model win probability.\n\n21+ | Bet responsibly.",
              shortCaption: "We've got you covered.",
              reelHook: "We've got you covered.",
              reelScript: "We've got you covered.",
              storyText: "Los Angeles Angels ML -105\n55.1%\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.match(response.json.content.metadata.warnings[0], /Generic brand phrasing/);
      assert.doesNotMatch(response.json.content.caption, /We've got you covered/i);
    }
  });
});

test("winning picks phrasing falls back to deterministic SGH template", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Winning Picks",
              caption: "Winning picks: Los Angeles Angels ML -105 with 55.1% model win probability.\n\n21+ | Bet responsibly.",
              shortCaption: "Winning picks.",
              reelHook: "Looking for winning picks?",
              reelScript: "Winning picks are here.",
              storyText: "Los Angeles Angels ML -105\n55.1%\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.match(response.json.content.metadata.warnings[0], /Generic brand phrasing/);
      assert.doesNotMatch(response.json.content.caption, /Winning picks/i);
    }
  });
});

test("OpenAI DAILY_3 that omits supplied teams is repaired deterministically", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "Same Game Heat Daily 3",
              caption: "The model likes today's MLB slate.\n\n21+ | Bet responsibly.",
              shortCaption: "SGH Daily 3. 21+ | Bet responsibly.",
              reelHook: "Three teams separated from the slate.",
              reelScript: "The model liked the slate. 21+ | Bet responsibly.",
              storyText: "DAILY 3\n21+ | Bet responsibly.",
              hashtags: ["#SameGameHeat"],
              disclaimer: "21+ | Bet responsibly.",
              warnings: []
            })
          }
        }]
      }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "openai");
      assert.equal(response.json.content.metadata.presentationRepaired, true);
      assert.match(response.json.content.metadata.repairReasons.join(" "), /omitted_supplied_teams/);
      assert.match(response.json.content.caption, /Los Angeles Angels/);
      assert.doesNotMatch(response.json.content.caption, /The model likes/);
    }
  });
});

test("top-level malformed OpenAI JSON structure falls back safely", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({
      body: { choices: [{ message: { content: JSON.stringify(["foo", "bar"]) } }] }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.match(response.json.content.metadata.warnings[0], /must be an object/);
    }
  });
});

test("OpenAI timeout falls back to local template and respects configured timeout", async () => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  await withMockedSocialAi({
    env: { SOCIAL_AI_TIMEOUT_MS: "60000" },
    fetchImpl: async (_url, options) => {
      assert.ok(options.signal);
      throw abortError;
    },
    run: async ({ response, warnings }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "local-template");
      const warning = response.json.content.metadata.warnings[0];
      assert.match(warning, /timed out after 60000ms/);
      assert.equal(warnings[0][0], "Social AI generation failed");
      assert.equal(warnings[0][1].status, "timeout");
    }
  });
});

test("invalid OpenAI timeout env uses safe default", async () => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  await withMockedSocialAi({
    env: { SOCIAL_AI_TIMEOUT_MS: "not-a-number" },
    fetchImpl: async () => {
      throw abortError;
    },
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.match(response.json.content.metadata.warnings[0], /timed out after 15000ms/);
    }
  });
});

for (const status of [401, 429, 500]) {
  test(`OpenAI ${status} falls back to local template with sanitized warning`, async () => {
    await withMockedSocialAi({
      fetchImpl: async () => mockOpenAiResponse({
        status,
        body: { error: { message: `Provider rejected sk-test-secret-should-not-leak with status ${status}` } }
      }),
      run: async ({ response, warnings }) => {
        assert.equal(response.status, 200);
        assert.equal(response.json.content.generationProvider, "local-template");
        const serialized = JSON.stringify({ content: response.json.content, warnings });
        assert.match(response.json.content.metadata.warnings[0], new RegExp(`OpenAI ${status}`));
        assert.doesNotMatch(serialized, /sk-test-secret-should-not-leak/);
        assert.match(serialized, /\[redacted\]/);
      }
    });
  });
}

test("malformed OpenAI JSON falls back to local template", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({
      body: { choices: [{ message: { content: "{bad-json" } }] }
    }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.match(response.json.content.metadata.warnings[0], /AI generation failed/);
    }
  });
});

test("invalid OpenAI response falls back to local template", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => mockOpenAiResponse({ body: { choices: [] } }),
    run: async ({ response }) => {
      assert.equal(response.status, 200);
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.match(response.json.content.metadata.warnings[0], /did not include message content/);
    }
  });
});

test("network OpenAI failure warning never includes API key", async () => {
  await withMockedSocialAi({
    fetchImpl: async () => {
      throw new Error("network failed for Bearer sk-test-secret-should-not-leak");
    },
    run: async ({ response, warnings }) => {
      const serialized = JSON.stringify({ content: response.json.content, warnings });
      assert.equal(response.json.content.generationProvider, "local-template");
      assert.doesNotMatch(serialized, /sk-test-secret-should-not-leak/);
      assert.match(serialized, /Bearer \[redacted\]/);
    }
  });
});

test("frontend social generation clears loading status in finally", async () => {
  const source = await fs.readFile(path.join(__dirname, "../social.js"), "utf8");
  assert.match(source, /async function generateContent/);
  assert.match(source, /finally\s*{/);
  assert.match(source, /showStatus\(finalStatus\)/);
  assert.match(source, /draft created/);
});

test("frontend dry-run publication action is explicit", async () => {
  const source = await fs.readFile(path.join(__dirname, "../social.js"), "utf8");
  const html = await fs.readFile(path.join(__dirname, "../social.html"), "utf8");
  assert.match(source, /Run Dry-Run Publication Test/);
  assert.match(source, /Dry-run publication receipt prepared/);
  assert.match(source, /DRY-RUN RECEIPT/);
  assert.match(source, /Dry Run Only/);
  assert.match(source, /Existing asset reused/);
  assert.match(source, /function isDryRunPublication/);
  assert.match(source, /publication\?\.dryRun === true/);
  assert.match(source, /status === "dry_run_prepared"/);
  assert.match(source, /provider === "dry-run"/);
  assert.match(source, /publication\?\.metadata\?\.metaPublishBlocked === true/);
  assert.match(source, /status\?\.dryRun === true \|\| isDryRunPublication\(publication\)/);
  assert.match(source, /disabled>Dry Run Only<\/button>/);
  assert.doesNotMatch(source, /disabled>Dry Run Only<\/button>`[^`]*data-publication-action="publish"/s);
  assert.match(source, /LIVE INSTAGRAM PUBLISHING ENABLED/);
  assert.match(source, /Publish Live to/);
  assert.doesNotMatch(source, /Publish to Instagram/);
  assert.match(source, /function canRenderLivePublish/);
  assert.match(source, /status\?\.dryRun !== true/);
  assert.match(source, /publication\?\.status === "asset_ready"/);
  assert.match(source, /Confirm Live Publish/);
  assert.match(source, /confirmLivePublish: true/);
  assert.match(html, /I understand this will publish a real post/);
  assert.match(html, /\.live-confirm-panel\.hidden\s*{\s*display: none;/);
  assert.match(html, /body\.live-modal-open\s*{\s*overflow: hidden;/);
  assert.match(html, /\.live-confirm-check\s*{[^}]*overflow-wrap: anywhere;/s);
  assert.match(source, /function closeLivePublishConfirm\(event\)/);
  assert.match(source, /event\?\.preventDefault\?\.\(\)/);
  assert.match(source, /state\.pendingLivePublish = null/);
  assert.match(source, /els\.livePublishUnderstand\) els\.livePublishUnderstand\.checked = false/);
  assert.match(source, /els\.confirmLivePublish\.disabled = true/);
  assert.match(source, /document\.body\.classList\.remove\("live-modal-open"\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /Publishing Live\.\.\./);
  assert.match(source, /LIVE MODE ARMED — PUBLISHING DISABLED/);
  assert.match(source, /LIVE ENABLED/);
  assert.match(source, /Approved content is not selected/);
  assert.match(source, /Approved graphic is not selected/);
  assert.match(source, /contentId: selectedContent\.id/);
  assert.match(source, /els\.publicationStatus/);
  assert.match(source, /finally\s*{/);
});

test("social studio cache version is bumped for Social Studio UI updates", async () => {
  const html = await fs.readFile(path.join(__dirname, "../social.html"), "utf8");
  assert.match(html, /social\.js\?v=social-studio-v27/);
  assert.match(html, /livePublishConfirmPanel/);
  assert.match(html, /livePublishUnderstand/);
});

test("story graphic generation gives clear frontend feedback", async () => {
  const source = await fs.readFile(path.join(__dirname, "../social.js"), "utf8");
  assert.match(source, /Select a content item before generating a graphic\./);
  assert.match(source, /graphicGenerationInFlight/);
  assert.match(source, /button\.textContent = `Generating \$\{label\}\.\.\.`/);
  assert.match(source, /JSON\.stringify\(\{ format: normalizedFormat, graphicType: normalizedGraphicType \}\)/);
  assert.match(source, /graphicLabel\(normalizedFormat, normalizedGraphicType\)/);
  assert.match(source, /button\.disabled = true/);
  assert.match(source, /button\.disabled = false/);
  assert.match(source, /button\.textContent = originalText/);
});

test("Daily 3 Story music recommendation is shown as a manual workflow step", async () => {
  const source = await fs.readFile(path.join(__dirname, "../social.js"), "utf8");
  assert.match(source, /storyMusicForContent/);
  assert.match(source, /data-copy-story-music/);
  assert.match(source, /Music copied\./);
  assert.match(source, /Unable to copy music\. Please copy it manually:/);
  assert.match(source, /Add this track manually in Instagram before posting\./);
  assert.match(source, /Story checklist: ✓ Graphic ready/);
});

test("frontend testing reset clears local workspace and avoids refresh rehydration", async () => {
  const source = await fs.readFile(path.join(__dirname, "../social.js"), "utf8");
  assert.match(source, /sgh-social-testing-reset/);
  assert.match(source, /Clear the current Social Studio testing workspace\?/);
  assert.match(source, /localStorage\.removeItem\(SOCIAL_BOARD_KEY\)/);
  assert.match(source, /state\.selectedContent = null/);
  assert.match(source, /renderContentDetail\(null\)/);
  assert.match(source, /\/api\/social\/testing\/reset/);
  assert.match(source, /Testing workspace cleared\./);
  assert.match(source, /if \(localStorage\.getItem\(SOCIAL_RESET_KEY\)\)/);
  assert.match(source, /function refreshCurrentBoard/);
});

test("MLB Moneyline V2 uses qualified plays and does not backfill to force three picks", async () => {
  const source = await fs.readFile(path.join(__dirname, "../app.js"), "utf8");
  assert.match(source, /const moneylineModelVersion = "mlb-moneyline-v2"/);
  assert.match(source, /Today's Qualified Moneyline Plays/);
  assert.match(source, /No moneyline wager met the V2 edge, risk, pitcher, and price requirements/);
  assert.match(source, /minimumWinProbability:\s*0\.62/);
  assert.match(source, /minimumMarketEdge:\s*0\.04/);
  assert.match(source, /minimumAdvantages:\s*3/);
  assert.match(source, /noVigProbabilityForSide/);
  assert.match(source, /isMoneylineWorseThanPlayable/);
  assert.match(source, /killCritic/);
  assert.match(source, /failurePath/);
  assert.match(source, /verdict:\s*qualifies \? "QUALIFIED" : leanEligible \? "LEAN" : avoid \? "AVOID" : "PASS"/);
  assert.doesNotMatch(source, /Best Available/);
  assert.doesNotMatch(source, /Backfilled as the next-best unique team/);
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
    ["/api/social/content/content_123/archive", {}],
    ["/api/social/testing/reset", {}]
  ];
  for (const [pathName, body] of protectedRoutes) {
    const response = await route(manager, { method: "POST", path: pathName, body });
    assert.equal(response.status, 401, pathName);
  }
});

test("Social Studio login normalizes environment whitespace, creates a protected session, and never returns the secret", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-login-session-"));
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: " secret\n", NODE_ENV: "production" }
  });

  const beforeLogin = await route(manager);
  assert.equal(beforeLogin.status, 200);
  assert.deepEqual(beforeLogin.json, { configured: true, authorized: false });

  const authenticated = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    body: { secret: "secret" }
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(authenticated.json, { authorized: true });
  assert.match(authenticated.headers["Set-Cookie"], /^sgh_social_admin=/);
  assert.match(authenticated.headers["Set-Cookie"], /HttpOnly/);
  assert.match(authenticated.headers["Set-Cookie"], /SameSite=Lax/);
  assert.match(authenticated.headers["Set-Cookie"], /Secure/);
  assert.doesNotMatch(JSON.stringify(authenticated), /secret/);

  const afterLogin = await route(manager, {
    headers: { cookie: authenticated.headers["Set-Cookie"] }
  });
  assert.deepEqual(afterLogin.json, { configured: true, authorized: true });
});

test("Social Studio login rejects wrong or malformed credentials without creating a session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-login-reject-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });

  const wrong = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    body: { secret: "wrong" }
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "Invalid Social Studio secret.");
  assert.equal(wrong.headers["Set-Cookie"], undefined);
  assert.doesNotMatch(JSON.stringify(wrong), /secret(?!\.)/i);

  const malformed = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    body: "{"
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error, "Invalid Social Studio login request.");
  assert.equal(malformed.headers["Set-Cookie"], undefined);
});

test("Social Studio login fails safely when the server secret is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-login-unconfigured-"));
  const manager = createSocialManager({ root, env: {} });
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    body: { secret: "anything" }
  });
  assert.equal(response.status, 503);
  assert.equal(response.json.error, "SOCIAL_ADMIN_SECRET is not configured on the server.");
  assert.equal(response.headers["Set-Cookie"], undefined);
});

test("Social Studio browser login posts the secret key and verifies its new session before unlocking", async () => {
  const client = await fs.readFile(path.join(__dirname, "..", "social.js"), "utf8");
  const page = await fs.readFile(path.join(__dirname, "..", "social.html"), "utf8");
  assert.match(client, /api\("\/api\/social\/login"/);
  assert.match(client, /JSON\.stringify\(\{ secret: els\.socialSecret\.value\.trim\(\) \}\)/);
  assert.match(client, /const session = await api\("\/api\/social\/session"\)/);
  assert.match(client, /if \(!session\.authorized\) \{/);
  assert.match(client, /error\.code = "missing_session_cookie"/);
  assert.match(page, /social\.js\?v=social-studio-v27/);
  assert.match(page, /story-music\.js\?v=story-music-v3/);
});

test("Social Studio login startup keeps the required form independent from optional Story Music controls", async () => {
  const client = await fs.readFile(path.join(__dirname, "..", "social.js"), "utf8");
  const page = await fs.readFile(path.join(__dirname, "..", "social.html"), "utf8");
  assert.match(page, /<form id="loginForm"/);
  assert.match(page, /<button class="studio-button" type="submit">Unlock Studio<\/button>/);
  assert.match(client, /els\.loginForm\.addEventListener\("submit", submitSocialLogin\)/);
  assert.match(client, /els\.loginForm\.dataset\.loginHandlerReady = "true"/);
  assert.match(client, /function bindIfPresent\(element, eventName, handler\)/);
  assert.match(client, /bindIfPresent\(els\.contentDetail, "click"/);
  assert.match(client, /window\.SGHStoryMusic\?\.getStoryMusicRecommendation/);
  assert.match(client, /function showStartupFailure\(\)/);
  assert.match(client, /Social Studio failed to initialize\. Refresh the page and try again\./);
  assert.match(client, /bootstrap\(\)\.catch\(showStartupFailure\)/);
});

test("Social Studio login exposes submit progress and restores the button after a failed request", async () => {
  const client = await fs.readFile(path.join(__dirname, "..", "social.js"), "utf8");
  assert.match(client, /function showLoginStatus\(message\)/);
  assert.match(client, /target\.classList\.toggle\("hidden", !message\)/);
  assert.match(client, /function setLoginBusy\(isBusy\)/);
  assert.match(client, /submitButton\.textContent = isBusy \? "Unlocking\.\.\." : "Unlock Studio"/);
  assert.match(client, /setLoginBusy\(true\)/);
  assert.match(client, /finally \{\s*setLoginBusy\(false\);\s*\}/);
  assert.match(client, /Login request started\.\.\./);
  assert.match(client, /Checking credentials\.\.\./);
  assert.match(client, /Credentials accepted\. Verifying session\.\.\./);
  assert.match(client, /Session verified\. Opening Social Studio\.\.\./);
  assert.match(client, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(client, /return safeMessage;/);
  assert.match(client, /Social Studio authentication is not configured\./);
  assert.match(client, /Credentials were accepted, but the session could not be verified\./);
  assert.match(client, /Login request could not reach the server\./);
  assert.match(client, /if \(!unlocked\) els\.socialSecret\.focus\(\);/);
  assert.match(client, /window\.addEventListener\("error", showClientError\)/);
  assert.match(client, /window\.addEventListener\("unhandledrejection", showClientError\)/);
});

test("Social Studio login uses AJAX without resetting the form or navigating away on failure", async () => {
  const client = await fs.readFile(path.join(__dirname, "..", "social.js"), "utf8");
  const page = await fs.readFile(path.join(__dirname, "..", "social.html"), "utf8");

  assert.match(client, /async function submitSocialLogin\(event\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(client, /body: JSON\.stringify\(\{ secret: els\.socialSecret\.value\.trim\(\) \}\)/);
  assert.match(client, /els\.socialSecret\.value = "";/);
  assert.ok(client.indexOf('els.socialSecret.value = "";') < client.indexOf("els.loginPanel.classList.add(\"hidden\")"));
  assert.doesNotMatch(client, /loginForm\.reset\(|els\.loginForm\.reset\(|\.requestSubmit\(|\.submit\(|location\.reload\(|window\.location/);
  assert.doesNotMatch(page, /<form id="loginForm"[^>]+\b(?:action|method)=/);
});

test("Social Studio page loads each frontend script once without a shared api declaration", async () => {
  const page = await fs.readFile(path.join(__dirname, "..", "social.html"), "utf8");
  const storyMusic = await fs.readFile(path.join(__dirname, "..", "story-music.js"), "utf8");
  const social = await fs.readFile(path.join(__dirname, "..", "social.js"), "utf8");

  assert.equal((page.match(/<script\s+src="\/social\.js\?v=[^"]+"><\/script>/g) || []).length, 1);
  assert.equal((page.match(/<script\s+src="\/story-music\.js\?v=[^"]+"><\/script>/g) || []).length, 1);
  assert.doesNotMatch(storyMusic, /\b(const|let|var|function)\s+api\b/);
  assert.match(storyMusic, /^\(\(\) => \{/);
  assert.match(storyMusic, /window\.SGHStoryMusic = storyMusicApi/);
  assert.doesNotThrow(() => new vm.Script(`${storyMusic}\n${social}`));
});

test("Daily Pick Stats endpoint is authenticated and delegates frozen Daily 3 snapshots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-daily-pick-stats-"));
  const calls = [];
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret" },
    fetchDailyPickStats: async (input) => {
      calls.push(input);
      return {
        contentId: input.contentId,
        source: "MLB Stats API",
        picks: input.snapshots.map((snapshot) => ({ snapshotId: snapshot.id }))
      };
    }
  });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: {
      contentType: "DAILY_3",
      board: {
        slateDate: "2026-07-27",
        sport: "baseball_mlb",
        officialPicks: [
          samplePickForTeam("Los Angeles Angels", "Houston Astros", 1),
          samplePickForTeam("New York Mets", "Atlanta Braves", 2),
          samplePickForTeam("Detroit Tigers", "Baltimore Orioles", 3)
        ]
      }
    }
  });

  const unauthorized = await route(manager, {
    path: `/api/social/content/${generated.json.content.id}/pick-stats`
  });
  assert.equal(unauthorized.status, 401);

  const post = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/pick-stats`,
    headers: { cookie },
    body: {}
  });
  assert.equal(post.status, 405);

  const response = await route(manager, {
    path: `/api/social/content/${generated.json.content.id}/pick-stats`,
    headers: { cookie }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.stats.contentId, generated.json.content.id);
  assert.equal(response.json.stats.picks.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contentId, generated.json.content.id);
  assert.equal(calls[0].snapshots.length, 3);
  assert.ok(calls[0].fetchImpl);
});

test("Daily Pick Stats UI is load-on-demand and research-only", async () => {
  const client = await fs.readFile(path.join(__dirname, "..", "social.js"), "utf8");
  const page = await fs.readFile(path.join(__dirname, "..", "social.html"), "utf8");
  assert.match(client, /Daily Pick Stats/);
  assert.match(client, /data-load-pick-stats/);
  assert.match(client, /data-generate-stats-board/);
  assert.match(client, /Load Daily Pick Stats before generating a Stats Board\./);
  assert.match(client, /api\(`\/api\/social\/content\/\$\{encodeURIComponent\(content\.id\)\}\/pick-stats`\)/);
  assert.match(client, /Research only; this does not change approved picks\./);
  assert.match(client, /Verified Daily Pick Stats loaded from MLB Stats API\./);
  assert.match(page, /\.pick-stats-panel/);
  assert.match(page, /\.pick-stats-actions/);
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
    createSocialPickSnapshot(samplePickForTeam("Los Angeles Angels", "Houston Astros", 1, { reasons: ["Starting-pitching edge with ace on the mound."] })),
    createSocialPickSnapshot(samplePickForTeam("Detroit Tigers", "Baltimore Orioles", 2, { reasons: ["Home-field advantage in a favorable matchup."] })),
    createSocialPickSnapshot(samplePickForTeam("New York Mets", "Atlanta Braves", 3, { reasons: ["Schedule advantage and favorable rest matchup."] }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed" });
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1350);
  assert.equal(graphic.templateVersion, GRAPHIC_TEMPLATE_VERSION);
  assert.equal(graphic.templateVersion, "social-graphics-template-v2");
  assert.match(graphic.svg, /DAILY 3/);
  assert.match(graphic.svg, /SAME GAME HEAT/);
  assert.match(graphic.svg, /MLB/);
  assert.match(graphic.svg, /07\/27\/2026/);
  assert.equal((graphic.svg.match(/class="daily3-pick-card"/g) || []).length, 3);
  assert.match(graphic.svg, /data-rank="1"/);
  assert.match(graphic.svg, /data-rank="2"/);
  assert.match(graphic.svg, /data-rank="3"/);
  assert.match(graphic.svg, /Los Angeles Angels/);
  assert.match(graphic.svg, /Detroit Tigers/);
  assert.match(graphic.svg, /New York Mets/);
  assert.match(graphic.svg, /LAA/);
  assert.match(graphic.svg, /DET/);
  assert.match(graphic.svg, /NYM/);
  assert.match(graphic.svg, /MONEYLINE/);
  assert.match(graphic.svg, /-105/);
  assert.match(graphic.svg, /\+145/);
  assert.match(graphic.svg, /Starting-pitching edge/);
  assert.match(graphic.svg, /Home-field advantage/);
  assert.match(graphic.svg, /Schedule advantage/);
  assert.match(graphic.svg, /Research, not a guarantee\./);
  assert.ok(graphic.svg.includes(RESPONSIBLE_FOOTER));
  assert.doesNotMatch(graphic.svg, /55\.1%|59%|61%/);
  assert.doesNotMatch(graphic.svg, /Fair|Playable|Confidence|score/i);
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

test("Daily 3 feed omits internal backfill indicator", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Seattle Mariners", "Texas Rangers", 1, { isBackfill: true }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed" });
  assert.doesNotMatch(graphic.svg, /BEST AVAILABLE/);
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
  assert.match(graphic.svg, /ARI/);
  assert.match(graphic.svg, /PHI/);
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

test("Daily 3 story graphic renders clean 1080x1920 public pick cards", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Los Angeles Angels", "Houston Astros", 1, { reasons: ["Starting-pitching edge with ace on the mound."] })),
    createSocialPickSnapshot(samplePickForTeam("Detroit Tigers", "Baltimore Orioles", 2, { reasons: ["Home-field advantage in a favorable matchup."] })),
    createSocialPickSnapshot(samplePickForTeam("New York Mets", "Atlanta Braves", 3, { reasons: ["Schedule advantage and favorable rest matchup."] }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "Story" });
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1920);
  assert.equal(graphic.format, "story");
  assert.match(graphic.svg, /width="1080" height="1920" viewBox="0 0 1080 1920"/);
  assert.match(graphic.svg, /SAME GAME HEAT/);
  assert.match(graphic.svg, /DAILY 3/);
  assert.match(graphic.svg, /07\/27\/2026/);
  assert.match(graphic.svg, /Los Angeles Angels/);
  assert.match(graphic.svg, /Detroit Tigers/);
  assert.match(graphic.svg, /New York Mets/);
  assert.match(graphic.svg, /LAA/);
  assert.match(graphic.svg, /DET/);
  assert.match(graphic.svg, /NYM/);
  assert.match(graphic.svg, /MONEYLINE/);
  assert.match(graphic.svg, /@sg_heater/);
  assert.ok(graphic.svg.includes(RESPONSIBLE_FOOTER));
  assert.doesNotMatch(graphic.svg, /\d+(?:\.\d)?%\s*WIN/i);
  assert.doesNotMatch(graphic.svg, /Fair|Playable|Confidence|Model/i);
});

test("Daily 3 Story music is reusable metadata and never part of the SVG", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const content = sampleContent("DAILY_3", [snapshot]);
  const music = STORY_MUSIC_RECOMMENDATIONS.DAILY_3;
  assert.equal(music.title, "Let’s Go");
  assert.equal(music.artist, "Key Glock");
  assert.equal(music.manualAddRequired, true);
  assert.deepEqual(content.metadata.storyMusic, music);
  const graphic = renderSocialGraphic({ content, snapshots: [snapshot], format: "story" });
  assert.doesNotMatch(graphic.svg, /Let’s Go|Key Glock/);
});

test("Story publication receipt retains music guidance without sending media fields", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const content = sampleContent("DAILY_3", [snapshot]);
  const publication = createPublicationRecord({
    content,
    graphic: {
      id: "graphic_story_1",
      format: "story",
      snapshotIds: [snapshot.id],
      snapshotHashes: [snapshot.snapshotHash],
      renderVersion: "social-graphics-renderer-v1.1"
    },
    asset: {
      assetUrl: "https://cdn.example.com/daily-3-story.png",
      assetHash: "asset_hash",
      mimeType: "image/png",
      width: 1080,
      height: 1920
    },
    dryRun: true
  });
  assert.deepEqual(publication.metadata.storyMusic, STORY_MUSIC_RECOMMENDATIONS.DAILY_3);
  assert.equal(publication.metadata.storyMusic.audioUrl, undefined);
  assert.equal(publication.metadata.storyMusic.attachment, undefined);
  const feedPublication = createPublicationRecord({
    content,
    graphic: {
      id: "graphic_feed_1",
      format: "feed",
      snapshotIds: [snapshot.id],
      snapshotHashes: [snapshot.snapshotHash],
      renderVersion: "social-graphics-renderer-v1.1"
    },
    asset: {
      assetUrl: "https://cdn.example.com/daily-3-feed.png",
      assetHash: "feed_hash",
      mimeType: "image/png",
      width: 1080,
      height: 1350
    },
    dryRun: true
  });
  assert.equal(feedPublication.metadata.storyMusic, null);
});

test("unsupported graphic formats do not silently fall back to feed", () => {
  const snapshot = createSocialPickSnapshot(samplePick());
  const content = sampleContent("BEST_BET", [snapshot]);
  assert.throws(
    () => renderSocialGraphic({ content, snapshots: [snapshot], format: "poster" }),
    /Unsupported graphic format: poster/
  );
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

test("content graphic route normalizes Story and rejects unsupported formats visibly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-story-format-"));
  const manager = createSocialManager({ root, env: { SOCIAL_ADMIN_SECRET: "secret" } });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: { contentType: "BEST_BET", board: { slateDate: "2026-07-27", sport: "baseball_mlb", officialPicks: [samplePick()] } }
  });
  const storyResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "Story" }
  });
  assert.equal(storyResponse.status, 200);
  assert.equal(storyResponse.json.graphic.format, "story");
  assert.equal(storyResponse.json.graphic.width, 1080);
  assert.equal(storyResponse.json.graphic.height, 1920);

  const unsupportedResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "poster" }
  });
  assert.equal(unsupportedResponse.status, 400);
  assert.equal(unsupportedResponse.json.error, "Unsupported graphic format: poster");
});

function samplePickStatsPackage(snapshots, overrides = {}) {
  return {
    contentId: "content_daily_3",
    slateDate: "2026-07-27",
    generatedAt: overrides.generatedAt || "2026-07-27T16:00:00Z",
    source: "MLB Stats API",
    picks: snapshots.map((snapshot, index) => ({
      snapshotId: snapshot.id,
      gameId: snapshot.gameId,
      selectedTeam: {
        name: snapshot.selectedTeam,
        homeAway: "HOME",
        recentForm: {
          last5: { games: 5, wins: 4, losses: 1, averageRunsScored: 5.8 },
          last10: { games: 10, wins: 7, losses: 3, averageRunsScored: 5.1 }
        },
        relevantRecord: { wins: 31 + index, losses: 18 },
        headToHead: { wins: 4, losses: 2, games: 6 },
        offense: { runsPerGame: 4.9 + index / 10, ops: `.75${index}` }
      },
      opponentTeam: {
        name: snapshot.opponent,
        recentForm: { last10: { games: 10, wins: 3, losses: 7 } }
      },
      selectedPitcher: {
        name: `Starter ${index + 1}`,
        season: { era: `3.${index}5` },
        last3Starts: { starts: 3, era: 2.45 + index, inningsPitched: "18.0" }
      },
      supportingStats: [`${snapshot.selectedTeam} owns the cleaner recent form profile.`],
      riskStat: `${snapshot.opponent} has been competitive lately.`,
      dataSources: ["MLB Stats API"],
      unavailable: []
    }))
  };
}

function mlbGameFixture(overrides = {}) {
  const gamePk = overrides.gamePk || 777001;
  return {
    gamePk,
    gameDate: overrides.gameDate || "2026-07-27T23:10:00Z",
    gameNumber: overrides.gameNumber || 1,
    status: { abstractGameState: "Preview", detailedState: "Scheduled" },
    teams: {
      away: {
        team: { id: 117, name: "Houston Astros", abbreviation: "HOU" },
        leagueRecord: { wins: 55, losses: 48 },
        probablePitcher: overrides.awayPitcher === null ? null : { id: 54321, fullName: "Houston Starter" }
      },
      home: {
        team: { id: 108, name: "Los Angeles Angels", abbreviation: "LAA" },
        leagueRecord: { wins: 50, losses: 53 },
        probablePitcher: overrides.homePitcher === null ? null : { id: 12345, fullName: "Angels Starter" }
      }
    },
    ...overrides
  };
}

function finalGameFixture({ gamePk, date, homeId = 108, awayId = 117, homeScore = 5, awayScore = 3 }) {
  return {
    gamePk,
    gameDate: `${date}T23:10:00Z`,
    status: { abstractGameState: "Final", detailedState: "Final" },
    teams: {
      away: { team: { id: awayId, name: "Houston Astros" }, score: awayScore },
      home: { team: { id: homeId, name: "Los Angeles Angels" }, score: homeScore }
    }
  };
}

function fakeMlbStatsFetch({ games = [mlbGameFixture()], failCategories = new Set(), doubleheader = false } = {}) {
  const scheduleGames = doubleheader
    ? [mlbGameFixture({ gamePk: 777001, gameDate: "2026-07-27T17:10:00Z", gameNumber: 1 }), mlbGameFixture({ gamePk: 777002, gameDate: "2026-07-27T23:10:00Z", gameNumber: 2 })]
    : games;
  const recentGames = Array.from({ length: 10 }, (_, index) => finalGameFixture({
    gamePk: 880000 + index,
    date: `2026-07-${String(26 - index).padStart(2, "0")}`,
    homeScore: index < 7 ? 5 : 2,
    awayScore: index < 7 ? 3 : 4
  }));
  return async (url) => {
    const parsed = new URL(String(url));
    const pathName = parsed.pathname;
    const fail = (category) => failCategories.has(category)
      ? { ok: false, status: 503, json: async () => ({}) }
      : null;

    if (pathName.endsWith("/schedule") && parsed.searchParams.get("gamePk")) {
      const gamePk = parsed.searchParams.get("gamePk");
      return { ok: true, status: 200, json: async () => ({ dates: [{ games: scheduleGames.filter((game) => String(game.gamePk) === gamePk) }] }) };
    }
    if (pathName.endsWith("/schedule") && parsed.searchParams.get("teamId")) {
      const isSeason = String(parsed.searchParams.get("startDate") || "").endsWith("-01-01");
      const failed = fail(isSeason ? "team_season_schedule" : "team_recent_schedule");
      if (failed) return failed;
      return { ok: true, status: 200, json: async () => ({ dates: [{ games: recentGames }] }) };
    }
    if (pathName.endsWith("/schedule")) {
      return { ok: true, status: 200, json: async () => ({ dates: [{ games: scheduleGames }] }) };
    }
    if (/\/teams\/\d+\/stats$/.test(pathName)) {
      const failed = fail("season_hitting");
      if (failed) return failed;
      return { ok: true, status: 200, json: async () => ({ stats: [{ splits: [{ stat: { gamesPlayed: 103, runs: 494, homeRuns: 123, avg: ".252", obp: ".328", slg: ".414", ops: ".742" } }] }] }) };
    }
    if (/\/people\/\d+$/.test(pathName)) {
      const failed = fail("pitcher_person");
      if (failed) return failed;
      return { ok: true, status: 200, json: async () => ({ people: [{ id: 12345, fullName: "Angels Starter", pitchHand: { code: "R" } }] }) };
    }
    if (/\/people\/\d+\/stats$/.test(pathName) && parsed.searchParams.get("stats") === "season") {
      const failed = fail("pitcher_season");
      if (failed) return failed;
      return { ok: true, status: 200, json: async () => ({ stats: [{ splits: [{ stat: { era: "3.14", whip: "1.09", strikeOuts: 118, baseOnBalls: 31, inningsPitched: "112.0" } }] }] }) };
    }
    if (/\/people\/\d+\/stats$/.test(pathName) && parsed.searchParams.get("stats") === "gameLog") {
      const failed = fail("pitcher_gamelog");
      if (failed) return failed;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stats: [{ splits: [
            { date: "2026-07-20", isStarter: true, stat: { gamesStarted: 1, inningsPitched: "6.0", earnedRuns: 2, runs: 2, strikeOuts: 7, baseOnBalls: 1 } },
            { date: "2026-07-14", isStarter: true, stat: { gamesStarted: 1, inningsPitched: "5.0", earnedRuns: 1, runs: 1, strikeOuts: 5, baseOnBalls: 2 } },
            { date: "2026-07-08", isStarter: true, stat: { gamesStarted: 1, inningsPitched: "7.0", earnedRuns: 3, runs: 3, strikeOuts: 8, baseOnBalls: 1 } }
          ] }]
        })
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("Stats Board metrics prefer verified values and skip unavailable boxes", () => {
  const metrics = selectStatsBoardMetrics({
    selectedTeam: {
      homeAway: "AWAY",
      recentForm: {
        last10: { wins: 6, losses: 4 },
        last5: { wins: 3, losses: 2 }
      },
      relevantRecord: { wins: 20, losses: 14 },
      offense: { runsPerGame: null, ops: "Unavailable" },
      headToHead: { wins: 2, losses: 1 }
    },
    selectedPitcher: {
      season: { era: "3.82" },
      last3Starts: { era: 2.1 }
    }
  });
  assert.deepEqual(metrics.map((metric) => metric.label), ["LAST 10", "LAST 5", "AWAY", "STARTER L3"]);
  assert.deepEqual(metrics.map((metric) => metric.value), ["6-4", "3-2", "20-14", "2.10 ERA"]);
});

test("Daily Pick Stats resolves direct MLB game IDs and preserves frozen pick values", async () => {
  const snapshot = createSocialPickSnapshot(samplePick({
    gameId: "odds-api-internal-game",
    mlbGamePk: "777001",
    sportsbookOdds: -105,
    selectedTeam: "Los Angeles Angels",
    opponent: "Houston Astros",
    homeTeam: "Los Angeles Angels",
    awayTeam: "Houston Astros",
    homeOrAway: "Home"
  }));
  const stats = await buildDailyPickStats({ contentId: "content_1", snapshots: [snapshot], fetchImpl: fakeMlbStatsFetch() });
  const pick = stats.picks[0];

  assert.equal(pick.gameId, "odds-api-internal-game");
  assert.equal(pick.mlbGamePk, "777001");
  assert.equal(pick.gameResolution.status, "resolved");
  assert.equal(pick.gameResolution.method, "explicit_mlb_game_pk");
  assert.equal(pick.selectedTeam.id, 108);
  assert.equal(pick.opponentTeam.id, 117);
  assert.equal(pick.selectedTeam.recentForm.last5.games, 5);
  assert.equal(pick.selectedTeam.recentForm.last10.games, 10);
  assert.equal(pick.selectedTeam.offense.ops, ".742");
  assert.equal(pick.selectedTeam.offense.runsPerGame, 4.8);
  assert.deepEqual(pick.selectedTeam.relevantRecord, { wins: 7, losses: 3 });
  assert.equal(pick.selectedPitcher.name, "Angels Starter");
  assert.equal(snapshot.sportsbookOdds, -105);
  assert.equal(snapshot.gameId, "odds-api-internal-game");
});

test("Daily Pick Stats resolves numeric and prefixed legacy game IDs", async () => {
  const numeric = createSocialPickSnapshot(samplePick({ gameId: "777001" }));
  const prefixed = createSocialPickSnapshot(samplePick({ gameId: "mlb-777001" }));
  const fetchImpl = fakeMlbStatsFetch();

  const numericResult = await buildDailyPickStats({ snapshots: [numeric], fetchImpl });
  const prefixedResult = await buildDailyPickStats({ snapshots: [prefixed], fetchImpl });

  assert.equal(numericResult.picks[0].gameResolution.method, "legacy_game_id");
  assert.equal(prefixedResult.picks[0].gameResolution.method, "legacy_game_id");
  assert.equal(numericResult.picks[0].mlbGamePk, "777001");
  assert.equal(prefixedResult.picks[0].mlbGamePk, "777001");
});

test("arbitrary internal gameId is not used as MLB gamePk and team date fallback resolves reversed orientation", async () => {
  const snapshot = createSocialPickSnapshot(samplePick({
    gameId: "game-1",
    gameLabel: "Los Angeles Angels @ Houston Astros",
    homeTeam: "Houston Astros",
    awayTeam: "Los Angeles Angels",
    selectedTeam: "Los Angeles Angels",
    opponent: "Houston Astros",
    homeOrAway: "Away"
  }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    return fakeMlbStatsFetch({ games: [mlbGameFixture()] })(url, options);
  };
  const stats = await buildDailyPickStats({ snapshots: [snapshot], fetchImpl });

  assert.equal(calls.some((url) => url.includes("gamePk=game-1")), false);
  assert.equal(stats.picks[0].gameResolution.method, "team_date_match");
  assert.equal(stats.picks[0].mlbGamePk, "777001");
  assert.equal(stats.picks[0].selectedTeam.id, 108);
  assert.equal(stats.picks[0].opponentTeam.id, 117);
});

test("legacy gameLabel opponent fallback supports schedule resolution without opponent field", async () => {
  const snapshot = {
    ...createSocialPickSnapshot(samplePick({
      gameId: "odds-internal",
      gameLabel: "Houston Astros @ Los Angeles Angels",
      selectedTeam: "Los Angeles Angels",
      opponent: "Houston Astros",
      homeTeam: "Los Angeles Angels",
      awayTeam: "Houston Astros",
      homeOrAway: "Home"
    })),
    opponent: ""
  };
  const stats = await buildDailyPickStats({ snapshots: [snapshot], fetchImpl: fakeMlbStatsFetch() });

  assert.equal(stats.picks[0].gameResolution.status, "resolved");
  assert.equal(stats.picks[0].opponentTeam.name, "Houston Astros");
});

test("doubleheader ambiguity is handled safely", async () => {
  const snapshot = {
    ...createSocialPickSnapshot(samplePick({
      gameId: "odds-internal",
      gameStartTime: "",
      gameLabel: "Houston Astros @ Los Angeles Angels"
    })),
    gameNumber: null
  };
  const resolution = await resolveMlbGameForSnapshot(snapshot, fakeMlbStatsFetch({ doubleheader: true }), []);

  assert.equal(resolution.status, "ambiguous");
  assert.equal(resolution.method, "ambiguous");
  assert.equal(resolution.game, null);
});

test("partial MLB endpoint failures do not erase available team stats", async () => {
  const snapshot = createSocialPickSnapshot(samplePick({ mlbGamePk: "777001" }));
  const stats = await buildDailyPickStats({
    snapshots: [snapshot],
    fetchImpl: fakeMlbStatsFetch({ failCategories: new Set(["pitcher_season", "pitcher_gamelog"]) })
  });
  const pick = stats.picks[0];

  assert.equal(pick.gameResolution.status, "resolved");
  assert.equal(pick.selectedTeam.recentForm.last5.games, 5);
  assert.equal(pick.selectedTeam.recentForm.last10.games, 10);
  assert.equal(pick.selectedTeam.offense.ops, ".742");
  assert.equal(pick.selectedTeam.relevantRecord.wins, 7);
  assert.equal(pick.selectedPitcher.name, "Angels Starter");
  assert.equal(pick.selectedPitcher.season.era, null);
  assert.equal(pick.selectedPitcher.last3Starts, null);
  assert.ok(pick.diagnostics.some((item) => item.category === "pitcher_season"));
  assert.ok(pick.diagnostics.some((item) => item.category === "pitcher_gamelog"));
});

test("offense endpoint failure does not erase recent form or venue record", async () => {
  const snapshot = createSocialPickSnapshot(samplePick({ mlbGamePk: "777001" }));
  const stats = await buildDailyPickStats({
    snapshots: [snapshot],
    fetchImpl: fakeMlbStatsFetch({ failCategories: new Set(["season_hitting"]) })
  });
  const pick = stats.picks[0];

  assert.equal(pick.gameResolution.status, "resolved");
  assert.equal(pick.selectedTeam.offense, null);
  assert.equal(pick.selectedTeam.recentForm.last10.games, 10);
  assert.equal(pick.selectedTeam.relevantRecord.losses, 3);
  assert.ok(pick.unavailable.includes("Season offense unavailable."));
});

test("new frozen Social Studio snapshots preserve opponent and official MLB gamePk", () => {
  const snapshot = createSocialPickSnapshot(samplePick({
    gameId: "odds-api-game",
    mlbGamePk: 777001,
    opponent: "Houston Astros"
  }));

  assert.equal(snapshot.gameId, "odds-api-game");
  assert.equal(snapshot.mlbGamePk, "777001");
  assert.equal(snapshot.opponent, "Houston Astros");
});

test("Daily 3 Stats Board renders as a separate deterministic template without removed metrics", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Chicago White Sox", "Cleveland Guardians", 1, { sportsbookOdds: -166, modelWinProbability: 0.582 })),
    createSocialPickSnapshot(samplePickForTeam("Toronto Blue Jays", "Washington Nationals", 2, { sportsbookOdds: -154, modelWinProbability: 0.577 })),
    createSocialPickSnapshot(samplePickForTeam("Tampa Bay Rays", "Baltimore Orioles", 3, { sportsbookOdds: -162, modelWinProbability: 0.575 }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const pickStats = samplePickStatsPackage(snapshots);
  const graphic = renderSocialGraphic({ content, snapshots, format: "feed", graphicType: "daily_3_stats", pickStats });
  const regular = renderSocialGraphic({ content, snapshots, format: "feed" });

  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1350);
  assert.equal(graphic.format, "feed");
  assert.equal(graphic.graphicType, "daily_3_stats");
  assert.equal(graphic.templateVersion, STATS_GRAPHIC_TEMPLATE_VERSION);
  assert.notEqual(graphic.renderedInputHash, regular.renderedInputHash);
  assert.ok(graphic.statsHash);
  assert.match(graphic.svg, /DAILY 3/);
  assert.match(graphic.svg, /STATS BOARD/);
  assert.match(graphic.svg, /Verified MLB stats for today's Daily 3 picks/);
  assert.match(graphic.svg, /Chicago White Sox/);
  assert.match(graphic.svg, /-166/);
  assert.match(graphic.svg, /LAST 10/);
  assert.match(graphic.svg, /WATCH/);
  assert.match(graphic.svg, /@sg_heater/);
  assert.match(graphic.svg, /Stats: MLB Stats API/);
  assert.doesNotMatch(graphic.svg, /58\.2%/);
  assert.doesNotMatch(graphic.svg, /FAIR/i);
  assert.doesNotMatch(graphic.svg, /PLAYABLE/i);
});

test("Daily 3 Stats Board layout fits long teams metrics and watch copy inside strict regions", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Arizona Diamondbacks", "Washington Nationals", 1, { sportsbookOdds: -171 })),
    createSocialPickSnapshot(samplePickForTeam("Philadelphia Phillies", "San Francisco Giants", 2, { sportsbookOdds: -102 })),
    createSocialPickSnapshot(samplePickForTeam("San Francisco Giants", "Kansas City Royals", 3, { sportsbookOdds: +120 }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const pickStats = samplePickStatsPackage(snapshots);
  pickStats.picks[0].selectedPitcher.last3Starts.era = 2.12;
  pickStats.picks[1].selectedPitcher.last3Starts.era = 0;
  pickStats.picks[0].selectedTeam.relevantRecord = { wins: 35, losses: 26 };
  pickStats.picks[0].selectedTeam.offense.runsPerGame = 5.2;
  pickStats.picks[0].selectedTeam.offense.ops = ".757";
  pickStats.picks[0].riskStat = "Washington Nationals is 6-4 in its last 10 games and opponent starter owns a 3.41 season ERA with traffic allowed early.";
  pickStats.picks[1].riskStat = "San Francisco Giants is 7-3 in its last 10 games with a bullpen that has been competitive lately.";
  pickStats.picks[2].riskStat = "Kansas City Royals opponent starter owns a 4.88 season ERA and the bullpen was used heavily yesterday.";

  const graphic = renderSocialGraphic({ content, snapshots, format: "feed", graphicType: "daily_3_stats", pickStats });
  const layout = STATS_BOARD_LAYOUT;
  assert.equal(graphic.width, 1080);
  assert.equal(graphic.height, 1350);
  assert.equal((graphic.svg.match(/class="daily3-stats-card"/g) || []).length, 3);
  assert.match(graphic.svg, /Arizona Diamondbacks/);
  assert.match(graphic.svg, /Philadelphia Phillies/);
  assert.match(graphic.svg, /San Francisco Giants/);
  assert.match(graphic.svg, /STARTER L3/);
  assert.match(graphic.svg, />2\.12</);
  assert.match(graphic.svg, />0\.00</);
  assert.match(graphic.svg, />ERA</);
  assert.match(graphic.svg, />35-26</);
  assert.match(graphic.svg, />5\.2</);
  assert.match(graphic.svg, />\.757</);

  const fittedArizona = fitTextToWidth("Arizona Diamondbacks", layout.teamTextWidth, { preferred: 38, min: 30, maxLines: 2 });
  assert.ok(fittedArizona.lines.length <= 2);
  assert.ok(fittedArizona.fontSize >= 30);
  assert.ok(fittedArizona.maxLineWidth <= layout.teamTextWidth);

  const fittedPhiladelphia = fitTextToWidth("Philadelphia Phillies", layout.teamTextWidth, { preferred: 38, min: 30, maxLines: 2 });
  assert.ok(fittedPhiladelphia.maxLineWidth <= layout.teamTextWidth);

  const matchupLines = wrapTextToWidth("vs Washington Nationals", layout.teamTextWidth, 15, 2);
  assert.ok(matchupLines.every((line) => estimateTextWidth(line, 15) <= layout.teamTextWidth));

  const starterWidth = estimateTextWidth("2.12", 26);
  const zeroEraWidth = estimateTextWidth("0.00", 26);
  const venueWidth = estimateTextWidth("35-26", 26);
  assert.ok(starterWidth < layout.metricBoxWidth - 24);
  assert.ok(zeroEraWidth < layout.metricBoxWidth - 24);
  assert.ok(venueWidth < layout.metricBoxWidth - 24);

  const watch = shortenStatsWatch(pickStats.picks[0].riskStat, "Arizona Diamondbacks", "Washington Nationals");
  const watchLines = wrapTextToWidth(watch, layout.watchWidth, 16, 4);
  assert.ok(watchLines.length <= 4);
  assert.ok(watchLines.every((line) => estimateTextWidth(line, 16) <= layout.watchWidth));
  assert.doesNotMatch(watch, /Washington Nationals/);

  assert.match(graphic.svg, new RegExp(`clipPath id="stats-team-clip-1"`));
  assert.match(graphic.svg, new RegExp(`clipPath id="stats-metrics-clip-1"`));
  assert.match(graphic.svg, new RegExp(`clipPath id="stats-watch-clip-1"`));
});

test("Stats Board omits redundant supporting copy when metrics already show the same Last 10", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Chicago Cubs", "Washington Nationals", 1, { sportsbookOdds: -171 })),
    createSocialPickSnapshot(samplePickForTeam("Tampa Bay Rays", "Baltimore Orioles", 2, { sportsbookOdds: -135 })),
    createSocialPickSnapshot(samplePickForTeam("Toronto Blue Jays", "New York Yankees", 3, { sportsbookOdds: -154 }))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const pickStats = samplePickStatsPackage(snapshots);
  pickStats.picks[0].supportingStats = ["Chicago Cubs is 7-3 in its last 10 games."];
  pickStats.picks[0].riskStat = "Washington Nationals is 6-4 in its last 10 games.";

  const graphic = renderSocialGraphic({ content, snapshots, format: "feed", graphicType: "daily_3_stats", pickStats });
  assert.doesNotMatch(graphic.svg, /Chicago Cubs is 7-3 in its last 10 games/);
  assert.match(graphic.svg, /WSH/);
});

test("normal Daily 3 Feed and Story graphics are unchanged by Stats Board layout repair", () => {
  const snapshots = [
    createSocialPickSnapshot(samplePickForTeam("Los Angeles Angels", "Houston Astros", 1)),
    createSocialPickSnapshot(samplePickForTeam("Detroit Tigers", "Baltimore Orioles", 2)),
    createSocialPickSnapshot(samplePickForTeam("New York Mets", "Atlanta Braves", 3))
  ];
  const content = sampleContent("DAILY_3", snapshots);
  const feed = renderSocialGraphic({ content, snapshots, format: "feed" });
  const story = renderSocialGraphic({ content, snapshots, format: "story" });
  assert.equal(feed.templateVersion, GRAPHIC_TEMPLATE_VERSION);
  assert.equal(story.templateVersion, GRAPHIC_TEMPLATE_VERSION);
  assert.equal(feed.graphicType, "standard");
  assert.equal(story.graphicType, "standard");
  assert.doesNotMatch(feed.svg, /STATS BOARD/);
  assert.doesNotMatch(story.svg, /STATS BOARD/);
});

test("Stats Board graphic route creates a distinct type and regeneration preserves it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-stats-board-"));
  const calls = [];
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret" },
    fetchDailyPickStats: async ({ contentId, snapshots }) => {
      calls.push({ contentId, snapshots });
      return samplePickStatsPackage(snapshots, { generatedAt: `2026-07-27T16:0${calls.length}:00Z` });
    }
  });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: {
      contentType: "DAILY_3",
      board: {
        slateDate: "2026-07-27",
        sport: "baseball_mlb",
        officialPicks: [
          samplePickForTeam("Chicago White Sox", "Cleveland Guardians", 1),
          samplePickForTeam("Toronto Blue Jays", "Washington Nationals", 2),
          samplePickForTeam("Tampa Bay Rays", "Baltimore Orioles", 3)
        ]
      }
    }
  });

  const feedResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "feed" }
  });
  const statsResponse = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "feed", graphicType: "daily_3_stats" }
  });
  assert.equal(feedResponse.status, 200);
  assert.equal(statsResponse.status, 200);
  assert.notEqual(statsResponse.json.graphic.id, feedResponse.json.graphic.id);
  assert.equal(statsResponse.json.graphic.graphicType, "daily_3_stats");
  assert.equal(statsResponse.json.graphic.templateVersion, STATS_GRAPHIC_TEMPLATE_VERSION);
  assert.equal(statsResponse.json.graphic.renderVersionNumber, 1);
  assert.ok(statsResponse.json.graphic.metadata.statsHash);
  assert.equal(statsResponse.json.graphic.metadata.statsSource, "MLB Stats API");
  assert.equal(calls.length, 1);

  const regenerated = await route(manager, {
    method: "POST",
    path: `/api/social/graphics/${statsResponse.json.graphic.id}/regenerate`,
    headers: { cookie },
    body: {}
  });
  assert.equal(regenerated.status, 200);
  assert.equal(regenerated.json.graphic.graphicType, "daily_3_stats");
  assert.equal(regenerated.json.graphic.renderVersionNumber, 2);
  assert.notEqual(regenerated.json.graphic.id, statsResponse.json.graphic.id);
  assert.notEqual(regenerated.json.graphic.metadata.statsHash, statsResponse.json.graphic.metadata.statsHash);
  assert.equal(calls.length, 2);
});

test("Stats Board graphic type rejects non-feed formats", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-social-stats-board-format-"));
  const manager = createSocialManager({
    root,
    env: { SOCIAL_ADMIN_SECRET: "secret" },
    fetchDailyPickStats: async ({ snapshots }) => samplePickStatsPackage(snapshots)
  });
  const cookie = await login(manager);
  const generated = await route(manager, {
    method: "POST",
    path: "/api/social/generate",
    headers: { cookie },
    body: {
      contentType: "DAILY_3",
      board: {
        slateDate: "2026-07-27",
        sport: "baseball_mlb",
        officialPicks: [
          samplePickForTeam("Chicago White Sox", "Cleveland Guardians", 1),
          samplePickForTeam("Toronto Blue Jays", "Washington Nationals", 2),
          samplePickForTeam("Tampa Bay Rays", "Baltimore Orioles", 3)
        ]
      }
    }
  });
  const response = await route(manager, {
    method: "POST",
    path: `/api/social/content/${generated.json.content.id}/graphics`,
    headers: { cookie },
    body: { format: "story", graphicType: "daily_3_stats" }
  });
  assert.equal(response.status, 400);
  assert.match(response.json.error, /Stats Board supports feed format only/);
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

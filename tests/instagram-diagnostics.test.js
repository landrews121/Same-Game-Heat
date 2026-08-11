const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  parseDiagnosticIds,
  runInstagramDiagnostics,
  formatInstagramDiagnostics,
  sanitizeMetaError
} = require("../instagram-diagnostics");
const { createSocialManager } = require("../social-manager");

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    json: async () => body
  };
}

function diagnosticFetch({
  token = "secret-token",
  mediaOkFor = "17841404477734906",
  unsupportedId = "1235870939610391",
  accountTypeFailsFor = [],
  mediaCountFailsFor = []
} = {}) {
  const calls = [];
  const accountTypeFailures = new Set(Array.isArray(accountTypeFailsFor) ? accountTypeFailsFor : [accountTypeFailsFor]);
  const mediaCountFailures = new Set(Array.isArray(mediaCountFailsFor) ? mediaCountFailsFor : [mediaCountFailsFor]);
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    assert.equal(options.method, "GET");
    assert.doesNotMatch(String(url), /media_publish/);
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("access_token"), token);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = parts[1];
    const edge = parts[2];
    if (edge === "media") {
      if (id === mediaOkFor) return mockResponse(200, { data: [{ id: "media-1" }] });
      return mockResponse(400, {
        error: {
          type: "OAuthException",
          code: 100,
          error_subcode: 33,
          message: `Unsupported get request for access_token=${token}`,
          fbtrace_id: "trace-media"
        }
      });
    }
    const fields = parsed.searchParams.get("fields") || "";
    if (id === unsupportedId) {
      return mockResponse(400, {
        error: {
          type: "OAuthException",
          code: 100,
          message: "Tried accessing nonexisting field (username) on node type (BusinessAsset)",
          fbtrace_id: "trace-profile"
        }
      });
    }
    if (fields === "id,username") {
      return mockResponse(200, { id, username: "sg_heater" });
    }
    if (fields === "id,account_type") {
      if (accountTypeFailures.has(id)) {
        return mockResponse(400, {
          error: {
            type: "OAuthException",
            code: 100,
            message: "Tried accessing nonexisting field (account_type)",
            fbtrace_id: "trace-account-type"
          }
        });
      }
      return mockResponse(200, { id, account_type: "BUSINESS" });
    }
    if (fields === "id,media_count") {
      if (mediaCountFailures.has(id)) {
        return mockResponse(400, {
          error: {
            type: "OAuthException",
            code: 100,
            message: "Tried accessing nonexisting field (media_count)",
            fbtrace_id: "trace-media-count"
          }
        });
      }
      return mockResponse(200, { id, media_count: 42 });
    }
    return mockResponse(200, {
      id,
      username: "sg_heater",
      name: "Same Game Heat",
      account_type: "BUSINESS",
      media_count: 42
    });
  };
  return { fetchImpl, calls };
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

async function route(manager, { method = "GET", path: routePath = "/api/social/session", headers = {}, body = "" } = {}) {
  const response = captureResponse();
  await manager.handle(
    { headers, method },
    response,
    new URL(`http://localhost${routePath}`),
    async () => typeof body === "string" ? body : JSON.stringify(body)
  );
  const parsed = response.capture.body ? JSON.parse(response.capture.body) : null;
  return { ...response.capture, json: parsed };
}

async function login(manager) {
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/login",
    body: { secret: "secret" }
  });
  assert.equal(response.status, 200);
  return response.headers["Set-Cookie"];
}

test("parseDiagnosticIds combines CLI env and configured Instagram IDs", () => {
  assert.deepEqual(
    parseDiagnosticIds({
      explicitIds: "a,b",
      env: { INSTAGRAM_DIAGNOSTIC_IDS: "b,c", INSTAGRAM_USER_ID: "d" }
    }),
    ["a", "b", "c", "d"]
  );
});

test("candidate resolving to sg_heater is recommended and unsupported candidate is not", async () => {
  const { fetchImpl } = diagnosticFetch();
  const result = await runInstagramDiagnostics({
    ids: "1235870939610391,17841404477734906",
    env: {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      META_GRAPH_API_VERSION: "v26.0",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.recommendedInstagramUserId, "17841404477734906");
  assert.equal(result.readyForDryRunPublishing, true);
  assert.equal(result.candidates[0].recommended, false);
  assert.equal(result.candidates[0].mediaEdgeReadable, false);
  assert.equal(result.candidates[1].classification, "instagram_graph_user");
  assert.equal(result.candidates[1].username, "sg_heater");
  assert.equal(result.candidates[1].mediaCount, 42);
});

test("id username identity succeeds while account_type fails and still classifies Instagram user", async () => {
  const { fetchImpl } = diagnosticFetch({ accountTypeFailsFor: "17841404477734906" });
  const result = await runInstagramDiagnostics({
    ids: "17841404477734906",
    env: {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.identity.ok, true);
  assert.equal(candidate.username, "sg_heater");
  assert.equal(candidate.classification, "instagram_graph_user");
  assert.equal(candidate.matchesExpectedInstagramAccount, true);
  assert.equal(candidate.recommended, true);
  assert.equal(result.recommendedInstagramUserId, "17841404477734906");
  assert.equal(candidate.optionalProbeErrors.length, 1);
  assert.equal(candidate.optionalProbeErrors[0].probe, "account_type");
  assert.match(candidate.optionalProbeErrors[0].error.message, /account_type/);
});

test("id username identity succeeds while media_count fails and still classifies Instagram user", async () => {
  const { fetchImpl } = diagnosticFetch({ mediaCountFailsFor: "17841404477734906" });
  const result = await runInstagramDiagnostics({
    ids: "17841404477734906",
    env: {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.identity.ok, true);
  assert.equal(candidate.username, "sg_heater");
  assert.equal(candidate.mediaCount, null);
  assert.equal(candidate.classification, "instagram_graph_user");
  assert.equal(candidate.matchesExpectedInstagramAccount, true);
  assert.equal(candidate.recommended, true);
  assert.equal(candidate.optionalProbeErrors.length, 1);
  assert.equal(candidate.optionalProbeErrors[0].probe, "media_count");
});

test("unsupported optional fields do not clear username or downgrade classification", async () => {
  const { fetchImpl } = diagnosticFetch({
    accountTypeFailsFor: "17841404477734906",
    mediaCountFailsFor: "17841404477734906"
  });
  const result = await runInstagramDiagnostics({
    ids: "17841404477734906",
    env: {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.username, "sg_heater");
  assert.equal(candidate.classification, "instagram_graph_user");
  assert.equal(candidate.recommended, true);
  assert.deepEqual(candidate.optionalProbeErrors.map((item) => item.probe), ["account_type", "media_count"]);
});

test("candidate with no username is not recommended", async () => {
  const { fetchImpl } = diagnosticFetch({ unsupportedId: "1235870939610391" });
  const result = await runInstagramDiagnostics({
    ids: "1235870939610391",
    env: {
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const candidate = result.candidates[0];
  assert.equal(candidate.identity.ok, false);
  assert.equal(candidate.username, "");
  assert.notEqual(candidate.classification, "instagram_graph_user");
  assert.equal(candidate.recommended, false);
  assert.equal(result.recommendedInstagramUserId, "");
});

test("diagnostic output never includes the token and sanitizes Meta errors", async () => {
  const { fetchImpl } = diagnosticFetch({ token: "secret-token" });
  const result = await runInstagramDiagnostics({
    ids: "1235870939610391,17841404477734906",
    env: { INSTAGRAM_ACCESS_TOKEN: "secret-token", SOCIAL_PUBLISH_DRY_RUN: "true" },
    fetchImpl
  });
  const output = formatInstagramDiagnostics(result);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
  assert.doesNotMatch(output, /secret-token/);
  assert.match(output, /access_token=\[redacted\]/);
  assert.match(output, /Unsupported get request/);
});

test("two matching candidates produces ambiguous result instead of guessing", async () => {
  const { fetchImpl } = diagnosticFetch({ mediaOkFor: "a", unsupportedId: "none" });
  const result = await runInstagramDiagnostics({
    ids: "a,b",
    env: { INSTAGRAM_ACCESS_TOKEN: "secret-token", SOCIAL_PUBLISH_DRY_RUN: "true" },
    fetchImpl
  });
  assert.equal(result.ambiguous, true);
  assert.equal(result.recommendedInstagramUserId, "");
  assert.equal(result.readyForDryRunPublishing, false);
});

test("zero matching candidates produces no recommendation", async () => {
  const { fetchImpl } = diagnosticFetch({ unsupportedId: "a" });
  const result = await runInstagramDiagnostics({
    ids: "a",
    env: { INSTAGRAM_ACCESS_TOKEN: "secret-token", SOCIAL_PUBLISH_DRY_RUN: "true" },
    fetchImpl
  });
  assert.equal(result.recommendedInstagramUserId, "");
  assert.equal(result.readyForDryRunPublishing, false);
});

test("diagnostic never calls POST or media_publish", async () => {
  const { fetchImpl, calls } = diagnosticFetch();
  await runInstagramDiagnostics({
    ids: "1235870939610391,17841404477734906",
    env: { INSTAGRAM_ACCESS_TOKEN: "secret-token", SOCIAL_PUBLISH_DRY_RUN: "true" },
    fetchImpl
  });
  assert.ok(calls.length >= 6);
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.ok(calls.every((call) => !(new URL(call.url).pathname.endsWith("/media") && call.method === "POST")));
  assert.ok(calls.every((call) => !call.url.includes("/media_publish")));
});

test("INSTAGRAM_USER_ID is only used as input and is not overwritten", async () => {
  const env = {
    INSTAGRAM_ACCESS_TOKEN: "secret-token",
    INSTAGRAM_USER_ID: "1235870939610391",
    INSTAGRAM_DIAGNOSTIC_IDS: "17841404477734906",
    SOCIAL_PUBLISH_DRY_RUN: "true"
  };
  const { fetchImpl } = diagnosticFetch();
  const result = await runInstagramDiagnostics({ env, fetchImpl });
  assert.equal(env.INSTAGRAM_USER_ID, "1235870939610391");
  assert.equal(result.recommendedInstagramUserId, "17841404477734906");
});

test("sanitizeMetaError removes tokens from error messages", () => {
  const error = sanitizeMetaError({
    error: {
      type: "OAuthException",
      code: 190,
      error_subcode: 460,
      message: "Bad token access_token=secret-token",
      fbtrace_id: "trace"
    }
  }, { status: 400 }, ["secret-token"]);
  assert.equal(error.httpStatus, 400);
  assert.equal(error.code, 190);
  assert.equal(error.error_subcode, 460);
  assert.doesNotMatch(JSON.stringify(error), /secret-token/);
  assert.match(error.message, /access_token=\[redacted\]/);
});

test("protected Social Studio diagnostics route requires auth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-instagram-route-"));
  const { fetchImpl } = diagnosticFetch();
  const manager = createSocialManager({
    root,
    env: {
      SOCIAL_ADMIN_SECRET: "secret",
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const response = await route(manager, {
    path: "/api/social/instagram/diagnostics?ids=17841404477734906"
  });
  assert.equal(response.status, 401);
  assert.equal(response.json.error, "Unauthorized");
});

test("protected Social Studio diagnostics route returns safe GET-only account summary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-instagram-route-"));
  const { fetchImpl, calls } = diagnosticFetch({ accountTypeFailsFor: "17841404477734906" });
  const manager = createSocialManager({
    root,
    env: {
      SOCIAL_ADMIN_SECRET: "secret",
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      INSTAGRAM_USER_ID: "1235870939610391",
      INSTAGRAM_EXPECTED_USERNAME: "sg_heater",
      META_GRAPH_API_VERSION: "v26.0",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const cookie = await login(manager);
  const response = await route(manager, {
    path: "/api/social/instagram/diagnostics?ids=1235870939610391,17841404477734906",
    headers: { cookie }
  });
  const body = JSON.stringify(response.json);
  assert.equal(response.status, 200);
  assert.equal(response.json.tokenConfigured, true);
  assert.equal(response.json.graphApiVersion, "v26.0");
  assert.equal(response.json.expectedUsername, "sg_heater");
  assert.equal(response.json.recommendedInstagramUserId, "17841404477734906");
  assert.equal(response.json.configuredIdMatchStatus, "mismatch");
  assert.equal(response.json.readyForDryRunPublishing, true);
  assert.equal(response.json.candidates.length, 2);
  assert.equal(response.json.candidates[1].recommended, true);
  assert.equal(response.json.candidates[1].username, "sg_heater");
  assert.equal(response.json.candidates[1].classification, "instagram_graph_user");
  assert.equal(response.json.candidates[1].optionalProbeErrors[0].probe, "account_type");
  assert.ok(calls.length >= 6);
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.ok(calls.every((call) => !call.url.includes("/media_publish")));
  assert.doesNotMatch(body, /secret-token/);
  assert.doesNotMatch(body, /access_token=/);
  assert.equal(Object.hasOwn(response.json.candidates[0], "profile"), false);
  assert.equal(Object.hasOwn(response.json.candidates[0], "identity"), false);
  assert.equal(Object.hasOwn(response.json.candidates[0], "instagramProfile"), false);
  assert.equal(Object.hasOwn(response.json.candidates[0], "media"), false);
});

test("protected Social Studio diagnostics route rejects non-GET without Meta mutation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sgh-instagram-route-"));
  const { fetchImpl, calls } = diagnosticFetch();
  const manager = createSocialManager({
    root,
    env: {
      SOCIAL_ADMIN_SECRET: "secret",
      INSTAGRAM_ACCESS_TOKEN: "secret-token",
      SOCIAL_PUBLISH_DRY_RUN: "true"
    },
    fetchImpl
  });
  const cookie = await login(manager);
  const response = await route(manager, {
    method: "POST",
    path: "/api/social/instagram/diagnostics?ids=17841404477734906",
    headers: { cookie }
  });
  assert.equal(response.status, 405);
  assert.deepEqual(calls, []);
});

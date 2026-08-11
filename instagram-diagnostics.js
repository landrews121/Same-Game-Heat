const DEFAULT_GRAPH_VERSION = "v23.0";
const DEFAULT_EXPECTED_USERNAME = "sg_heater";

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeIdList(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeIdList);
  return clean(value)
    .split(",")
    .map(clean)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeMessage(value, secrets = []) {
  let text = clean(value);
  for (const secret of secrets.filter(Boolean)) {
    text = text.split(secret).join("[redacted]");
  }
  return text
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/EA[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .slice(0, 500);
}

function sanitizeMetaError(payload, response, secrets = []) {
  const error = payload?.error || {};
  return {
    httpStatus: response?.status || 0,
    type: clean(error.type),
    code: error.code ?? null,
    error_subcode: error.error_subcode ?? null,
    message: safeMessage(error.message || response?.statusText || "Meta request failed", secrets),
    fbtrace_id: clean(error.fbtrace_id)
  };
}

function classifyCandidate({ profile, instagramProfile, media }) {
  if (instagramProfile?.ok && instagramProfile.data?.username) return "instagram_graph_user";
  const errors = [profile?.error, instagramProfile?.error, media?.error]
    .map((error) => clean(error?.message).toLowerCase())
    .join(" ");
  if (/page|pages_read|pages_show|facebook page/.test(errors)) return "facebook_page_id";
  if (/business|asset/.test(errors) && !instagramProfile?.data?.username) return "business_asset_id";
  if (/system user/.test(errors)) return "system_user_id";
  return "unknown";
}

function summarizeRequest(result) {
  return result.ok ? "SUCCESS" : `ERROR ${result.error?.httpStatus || ""}`.trim();
}

async function metaGet({ baseUrl, accessToken, path, params = {}, fetchImpl, timeoutMs = 12000 }) {
  const url = new URL(`${baseUrl}${path}`);
  Object.entries({ ...params, access_token: accessToken }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, request: path, error: sanitizeMetaError(payload, response, [accessToken]) };
    }
    return { ok: true, request: path, data: payload };
  } catch (error) {
    return {
      ok: false,
      request: path,
      error: {
        httpStatus: 0,
        type: error.name === "AbortError" ? "timeout" : "network_error",
        code: null,
        error_subcode: null,
        message: safeMessage(error.name === "AbortError" ? "Meta request timed out" : error.message, [accessToken]),
        fbtrace_id: ""
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseDiagnosticIds({ explicitIds = [], env = process.env } = {}) {
  return unique([
    ...normalizeIdList(explicitIds),
    ...normalizeIdList(env.INSTAGRAM_DIAGNOSTIC_IDS),
    ...normalizeIdList(env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID)
  ]);
}

async function diagnoseCandidate({ id, baseUrl, accessToken, fetchImpl, timeoutMs }) {
  const encodedId = encodeURIComponent(id);
  const profile = await metaGet({
    baseUrl,
    accessToken,
    path: `/${encodedId}`,
    params: { fields: "id,name" },
    fetchImpl,
    timeoutMs
  });
  const instagramProfile = await metaGet({
    baseUrl,
    accessToken,
    path: `/${encodedId}`,
    params: { fields: "id,username,name,account_type,media_count" },
    fetchImpl,
    timeoutMs
  });
  const media = await metaGet({
    baseUrl,
    accessToken,
    path: `/${encodedId}/media`,
    params: { limit: "1" },
    fetchImpl,
    timeoutMs
  });
  const classification = classifyCandidate({ profile, instagramProfile, media });
  const username = instagramProfile.ok ? clean(instagramProfile.data?.username) : "";
  return {
    id,
    profile,
    instagramProfile,
    media,
    classification,
    username,
    mediaEdgeReadable: Boolean(media.ok),
    mediaCount: instagramProfile.ok && instagramProfile.data?.media_count !== undefined ? instagramProfile.data.media_count : null
  };
}

function candidateRecommendation(candidate, expectedUsername) {
  return candidate.classification === "instagram_graph_user"
    && candidate.username.toLowerCase() === expectedUsername.toLowerCase();
}

async function runInstagramDiagnostics({
  ids = [],
  env = process.env,
  fetchImpl = fetch,
  expectedUsername = env.INSTAGRAM_EXPECTED_USERNAME || env.INSTAGRAM_USERNAME || DEFAULT_EXPECTED_USERNAME
} = {}) {
  const accessToken = env.INSTAGRAM_ACCESS_TOKEN || env.META_ACCESS_TOKEN || "";
  const graphApiVersion = env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const timeoutMs = Number(env.META_GRAPH_TIMEOUT_MS || 12000);
  const candidateIds = parseDiagnosticIds({ explicitIds: ids, env });
  const baseUrl = `https://graph.facebook.com/${graphApiVersion}`;
  const tokenConfigured = Boolean(accessToken);
  const results = {
    tokenConfigured,
    graphApiVersion,
    expectedUsername,
    dryRun: env.SOCIAL_PUBLISH_DRY_RUN === "true",
    candidates: [],
    recommendedInstagramUserId: "",
    ambiguous: false,
    readyForDryRunPublishing: false,
    checkedAt: new Date().toISOString()
  };

  if (!tokenConfigured || !candidateIds.length) return results;

  for (const id of candidateIds) {
    const candidate = await diagnoseCandidate({ id, baseUrl, accessToken, fetchImpl, timeoutMs });
    const matchesExpectedInstagramAccount = candidateRecommendation(candidate, expectedUsername);
    results.candidates.push({
      ...candidate,
      matchesExpectedInstagramAccount,
      recommended: false
    });
  }

  const matches = results.candidates.filter((candidate) => candidate.matchesExpectedInstagramAccount);
  if (matches.length === 1) {
    matches[0].recommended = true;
    results.recommendedInstagramUserId = matches[0].id;
  } else if (matches.length > 1) {
    results.ambiguous = true;
  }
  const recommended = results.candidates.find((candidate) => candidate.recommended);
  results.readyForDryRunPublishing = Boolean(
    recommended
    && recommended.mediaEdgeReadable
    && tokenConfigured
    && results.dryRun
  );
  return results;
}

function formatMetaError(error) {
  if (!error) return "";
  const code = error.code ? ` (#${error.code})` : "";
  const subcode = error.error_subcode ? ` subcode ${error.error_subcode}` : "";
  const trace = error.fbtrace_id ? ` trace ${error.fbtrace_id}` : "";
  return `${error.httpStatus || "n/a"}${code}${subcode}: ${error.message}${trace}`;
}

function formatInstagramDiagnostics(results) {
  const lines = [
    "Instagram Diagnostics",
    "---------------------",
    "",
    `Token configured: ${results.tokenConfigured ? "YES" : "NO"}`,
    `Graph API version: ${results.graphApiVersion}`,
    `Expected username: ${results.expectedUsername || "(not set)"}`,
    `Dry run enabled: ${results.dryRun ? "YES" : "NO"}`,
    ""
  ];

  for (const candidate of results.candidates) {
    lines.push(`Candidate: ${candidate.id}`);
    lines.push(`Profile GET: ${summarizeRequest(candidate.profile)}`);
    lines.push(`Instagram fields GET: ${summarizeRequest(candidate.instagramProfile)}`);
    lines.push(`Username: ${candidate.username || "null"}`);
    lines.push(`Object classification: ${candidate.classification}`);
    lines.push(`Media edge: ${candidate.mediaEdgeReadable ? "accessible" : "not accessible"}`);
    if (candidate.mediaCount !== null) lines.push(`Media count: ${candidate.mediaCount}`);
    if (candidate.profile?.error) lines.push(`Profile error: ${formatMetaError(candidate.profile.error)}`);
    if (candidate.instagramProfile?.error) lines.push(`Instagram fields error: ${formatMetaError(candidate.instagramProfile.error)}`);
    if (candidate.media?.error) lines.push(`Media edge error: ${formatMetaError(candidate.media.error)}`);
    lines.push(`Matches @${results.expectedUsername}: ${candidate.matchesExpectedInstagramAccount ? "YES" : "NO"}`);
    lines.push(`Recommended: ${candidate.recommended ? "YES" : "NO"}`);
    lines.push("");
  }

  lines.push("Recommended INSTAGRAM_USER_ID:");
  lines.push(results.recommendedInstagramUserId || (results.ambiguous ? "AMBIGUOUS - multiple matching candidates" : "NONE"));
  lines.push("");
  lines.push("Ready for dry-run publishing:");
  lines.push(results.readyForDryRunPublishing ? "YES" : "NO");
  return lines.join("\n");
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  DEFAULT_EXPECTED_USERNAME,
  parseDiagnosticIds,
  runInstagramDiagnostics,
  formatInstagramDiagnostics,
  sanitizeMetaError,
  safeMessage
};

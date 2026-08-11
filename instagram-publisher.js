const DEFAULT_GRAPH_VERSION = "v23.0";

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function mask(value) {
  const text = clean(value);
  if (!text) return "";
  if (text.length <= 6) return "***";
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function safeErrorMessage(error) {
  return clean(error?.message || error).replace(/access_token=[^&\s]+/gi, "access_token=***");
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function createInstagramPublisher({ env = process.env, fetchImpl = fetch } = {}) {
  const accessToken = env.INSTAGRAM_ACCESS_TOKEN || env.META_ACCESS_TOKEN || "";
  const accountId = env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || "";
  const apiVersion = env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const timeoutMs = Number(env.META_GRAPH_TIMEOUT_MS || 12000);
  const dryRun = env.SOCIAL_PUBLISH_DRY_RUN === "true";
  const baseUrl = `https://graph.facebook.com/${apiVersion}`;

  async function graphRequest(path, { method = "GET", params = {}, body = null } = {}) {
    if (!accessToken || !accountId) throw new Error("Instagram credentials are not configured.");
    const url = new URL(`${baseUrl}${path}`);
    Object.entries({ ...params, access_token: accessToken }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        signal: timeout.signal,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(`Meta API ${message}`);
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Meta API request timed out.");
      throw error;
    } finally {
      timeout.cancel();
    }
  }

  async function validateConnection() {
    const configured = Boolean(accessToken && accountId);
    const base = {
      configured,
      connected: false,
      accountId: accountId ? mask(accountId) : "",
      username: "",
      apiVersion,
      tokenConfigured: Boolean(accessToken),
      checkedAt: new Date().toISOString(),
      dryRun
    };
    if (!configured) return base;
    if (dryRun) {
      return {
        ...base,
        connected: true,
        username: clean(env.INSTAGRAM_EXPECTED_USERNAME || env.INSTAGRAM_USERNAME || accountId)
      };
    }
    try {
      const account = await graphRequest(`/${encodeURIComponent(accountId)}`, {
        params: { fields: "id,username" }
      });
      return {
        ...base,
        connected: true,
        accountId: account.id ? mask(account.id) : base.accountId,
        username: account.username || ""
      };
    } catch (error) {
      return { ...base, lastError: safeErrorMessage(error) };
    }
  }

  async function verifyLiveIdentity(expectedUsername = "") {
    if (dryRun) throw new Error("Live identity check is unavailable while dry run is enabled.");
    const expected = clean(expectedUsername || env.INSTAGRAM_EXPECTED_USERNAME || env.INSTAGRAM_USERNAME || "");
    if (!accessToken) throw new Error("Instagram access token is not configured.");
    if (!accountId) throw new Error("Instagram user ID is not configured.");
    if (!expected) throw new Error("Expected Instagram username is not configured.");
    const account = await graphRequest(`/${encodeURIComponent(accountId)}`, {
      params: { fields: "id,username" }
    });
    if (clean(account.id) !== clean(accountId)) throw new Error("Instagram account ID mismatch.");
    if (clean(account.username).toLowerCase() !== expected.toLowerCase()) throw new Error("Instagram username mismatch.");
    return { id: account.id, username: account.username };
  }

  async function createMediaContainer({ imageUrl, caption, mediaType = "IMAGE" }) {
    if (dryRun) return { id: `dry_container_${Date.now()}`, status_code: "FINISHED", dryRun: true };
    return graphRequest(`/${encodeURIComponent(accountId)}/media`, {
      method: "POST",
      params: {
        image_url: imageUrl,
        caption,
        media_type: mediaType === "STORIES" ? "STORIES" : undefined
      }
    });
  }

  async function checkContainerStatus(containerId) {
    if (dryRun) return { id: containerId, status_code: "FINISHED", dryRun: true };
    return graphRequest(`/${encodeURIComponent(containerId)}`, {
      params: { fields: "id,status_code,status" }
    });
  }

  async function publishContainer(containerId) {
    if (dryRun) return { id: `dry_media_${Date.now()}`, dryRun: true };
    return graphRequest(`/${encodeURIComponent(accountId)}/media_publish`, {
      method: "POST",
      params: { creation_id: containerId }
    });
  }

  async function fetchPublishedMedia(mediaId) {
    if (dryRun) return { id: mediaId, permalink: "", dryRun: true };
    return graphRequest(`/${encodeURIComponent(mediaId)}`, {
      params: { fields: "id,permalink,media_type,timestamp,username" }
    });
  }

  return {
    apiVersion,
    dryRun,
    validateConnection,
    verifyLiveIdentity,
    createMediaContainer,
    checkContainerStatus,
    publishContainer,
    fetchPublishedMedia
  };
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  createInstagramPublisher,
  safeErrorMessage
};

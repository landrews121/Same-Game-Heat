const SOCIAL_BOARD_KEY = "sgh-social-current-board";
const SOCIAL_RESET_KEY = "sgh-social-testing-reset";

const state = {
  authorized: false,
  board: null,
  snapshots: [],
  content: [],
  selectedContent: null,
  graphicsByContent: new Map(),
  results: [],
  performance: {},
  instagramStatus: null,
  instagramDiagnostics: null,
  publications: [],
  pendingLivePublish: null,
  livePublishInFlight: false,
  graphicGenerationInFlight: new Set()
};

const els = {
  loginPanel: document.querySelector("#loginPanel"),
  socialApp: document.querySelector("#socialApp"),
  loginForm: document.querySelector("#loginForm"),
  socialSecret: document.querySelector("#socialSecret"),
  loginStatus: document.querySelector("#loginStatus"),
  studioStatus: document.querySelector("#studioStatus"),
  todayBoard: document.querySelector("#todayBoard"),
  boardSourceNote: document.querySelector("#boardSourceNote"),
  createDaily3: document.querySelector("#createDaily3"),
  createBestBet: document.querySelector("#createBestBet"),
  createBreakdown: document.querySelector("#createBreakdown"),
  refreshBoard: document.querySelector("#refreshBoard"),
  resetTestingWorkspace: document.querySelector("#resetTestingWorkspace"),
  breakdownPick: document.querySelector("#breakdownPick"),
  queueStatus: document.querySelector("#queueStatus"),
  refreshQueue: document.querySelector("#refreshQueue"),
  contentQueue: document.querySelector("#contentQueue"),
  contentDetail: document.querySelector("#contentDetail"),
  checkResults: document.querySelector("#checkResults"),
  resultsStatus: document.querySelector("#resultsStatus"),
  performanceSummary: document.querySelector("#performanceSummary"),
  resultsList: document.querySelector("#resultsList"),
  refreshPublishing: document.querySelector("#refreshPublishing"),
  instagramStatus: document.querySelector("#instagramStatus"),
  runInstagramDiagnostics: document.querySelector("#runInstagramDiagnostics"),
  instagramDiagnosticsStatus: document.querySelector("#instagramDiagnosticsStatus"),
  instagramDiagnostics: document.querySelector("#instagramDiagnostics"),
  publicationStatus: document.querySelector("#publicationStatus"),
  publicationList: document.querySelector("#publicationList"),
  livePublishConfirmPanel: document.querySelector("#livePublishConfirmPanel"),
  livePublishAccount: document.querySelector("#livePublishAccount"),
  livePublishAccountCheck: document.querySelector("#livePublishAccountCheck"),
  livePublishContent: document.querySelector("#livePublishContent"),
  livePublishGraphic: document.querySelector("#livePublishGraphic"),
  livePublishAsset: document.querySelector("#livePublishAsset"),
  livePublishCaption: document.querySelector("#livePublishCaption"),
  livePublishUnderstand: document.querySelector("#livePublishUnderstand"),
  cancelLivePublish: document.querySelector("#cancelLivePublish"),
  confirmLivePublish: document.querySelector("#confirmLivePublish")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showStatus(message, target = els.studioStatus) {
  if (!target) return;
  target.textContent = message || "";
  target.classList.toggle("hidden", !message);
}

function showStartupFailure(error) {
  state.authorized = false;
  els.loginPanel?.classList.remove("hidden");
  els.socialApp?.classList.add("hidden");
  showStatus("Social Studio failed to initialize. Refresh the page and try again.", els.loginStatus);
  // The error can help diagnose a broken optional control without exposing credentials in the UI.
  console.error("Social Studio startup error", error);
}

function bindIfPresent(element, eventName, handler) {
  if (!element) return false;
  element.addEventListener(eventName, handler);
  return true;
}

function setLoginBusy(isBusy) {
  const submitButton = els.loginForm?.querySelector('button[type="submit"]');
  if (!submitButton) return;
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Unlocking..." : "Unlock Studio";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const stage = payload.stage ? `${payload.stage}: ` : "";
    throw new Error(`${stage}${payload.error || payload.message || `${response.status} ${response.statusText}`}`);
  }
  return payload;
}

function loadCurrentBoard() {
  if (localStorage.getItem(SOCIAL_RESET_KEY)) {
    state.board = null;
    localStorage.removeItem(SOCIAL_BOARD_KEY);
    renderBoard();
    return;
  }
  try {
    state.board = JSON.parse(localStorage.getItem(SOCIAL_BOARD_KEY) || "null");
  } catch {
    state.board = null;
  }
  renderBoard();
}

function refreshCurrentBoard() {
  localStorage.removeItem(SOCIAL_RESET_KEY);
  loadCurrentBoard();
}

function currentSelectedGraphicId() {
  if (!state.selectedContent?.id) return "";
  const graphics = state.graphicsByContent.get(state.selectedContent.id) || [];
  const active = graphics.find((graphic) => graphic.status !== "archived") || graphics[0];
  return active?.id || "";
}

function clearTestingWorkspaceView(message = "Testing workspace cleared.") {
  state.board = null;
  state.snapshots = [];
  state.content = [];
  state.selectedContent = null;
  state.graphicsByContent = new Map();
  state.instagramDiagnostics = null;
  state.publications = [];
  localStorage.removeItem(SOCIAL_BOARD_KEY);
  localStorage.setItem(SOCIAL_RESET_KEY, JSON.stringify({ resetAt: new Date().toISOString() }));
  renderBoard();
  renderQueue();
  renderContentDetail(null);
  renderInstagramDiagnostics();
  renderPublishing();
  showStatus(message);
}

async function resetTestingWorkspace() {
  const ok = window.confirm("Clear the current Social Studio testing workspace? Official snapshots, finalized results, and live publication history will be kept.");
  if (!ok) return;
  const selectedContentId = state.selectedContent?.id || "";
  const selectedGraphicId = currentSelectedGraphicId();
  const slateDate = state.board?.slateDate || "";
  showStatus("Clearing Social Studio testing workspace...");
  const payload = await api("/api/social/testing/reset", {
    method: "POST",
    body: JSON.stringify({ slateDate, selectedContentId, selectedGraphicId })
  });
  clearTestingWorkspaceView("Testing workspace cleared.");
  state.instagramStatus = (await api("/api/social/instagram/status").catch(() => state.instagramStatus)) || state.instagramStatus;
  renderPublishing();
  return payload;
}

function formatOdds(odds) {
  const number = Number(odds);
  if (!Number.isFinite(number)) return "Odds TBD";
  return number > 0 ? `+${number}` : String(number);
}

function formatProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "TBD";
  return `${Math.round(number * 1000) / 10}%`;
}

function formatUnits(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Units TBD";
  return `${number >= 0 ? "+" : ""}${Math.round(number * 100) / 100}U`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "TBD";
  return `${Math.round(number * 1000) / 10}%`;
}

function graphicLabel(format) {
  const normalizedFormat = String(format || "feed").toLowerCase();
  if (normalizedFormat === "story") return "Story";
  if (normalizedFormat === "square") return "Square";
  return "Feed";
}

function storyMusicForContent(content) {
  if (content?.contentType !== "DAILY_3") return null;
  const stored = content.metadata?.storyMusic;
  if (stored?.title && stored?.artist) return stored;
  return window.SGHStoryMusic?.getStoryMusicRecommendation?.(content.contentType) || null;
}

function storyMusicText(music) {
  return music ? `${music.title} — ${music.artist}` : "";
}

function publicationDisplayStatus(publication) {
  if (isDryRunPublication(publication) && publication?.status === "prepared") return "dry_run_prepared";
  return publication?.status || "";
}

function isDryRunPublication(publication) {
  const status = String(publication?.status || "").toLowerCase();
  const provider = String(publication?.provider || "").toLowerCase();
  return publication?.dryRun === true ||
    publication?.simulated === true ||
    status === "dry_run_prepared" ||
    provider === "dry-run" ||
    publication?.metadata?.metaPublishBlocked === true;
}

function canRenderLivePublish(publication, status) {
  return Boolean(
    status?.connected &&
    status?.dryRun !== true &&
    status?.livePublishEnabled === true &&
    !isDryRunPublication(publication) &&
    publication?.status === "asset_ready" &&
    publication?.assetUrl &&
    publication?.accountUsername
  );
}

function publicationActionControl(publication, status, accountLabel) {
  if (status?.dryRun === true || isDryRunPublication(publication)) {
    return `<button class="studio-button secondary" type="button" disabled>Dry Run Only</button>`;
  }
  if (canRenderLivePublish(publication, status)) {
    return `<button class="studio-button" type="button" data-publication-action="publish" data-publication-id="${escapeHtml(publication.id)}">Publish Live to ${escapeHtml(accountLabel)}</button>`;
  }
  return `<button class="studio-button secondary" type="button" disabled>Live Publish Locked</button>`;
}

function selectedGraphicById(graphicId) {
  if (!state.selectedContent?.id || !graphicId) return null;
  const graphics = state.graphicsByContent.get(state.selectedContent.id) || [];
  return graphics.find((graphic) => graphic.id === graphicId) || null;
}

function renderBoard() {
  const picks = state.board?.officialPicks || [];
  els.createDaily3.disabled = !picks.length;
  els.createBestBet.disabled = !picks.length;
  els.createBreakdown.disabled = !picks.length;
  els.boardSourceNote.textContent = picks.length
    ? `Official board from ${state.board.slateDate} · ${state.board.sportsbook || "selected sportsbook"} · ${state.board.generatedAt || "current session"}`
    : "No official board found. Open the main MLB board first, let it generate, then return here.";

  els.breakdownPick.innerHTML = picks.map((pick, index) =>
    `<option value="${index}">${index + 1}. ${escapeHtml(pick.selectedTeam)} ${escapeHtml(pick.market)}</option>`
  ).join("");

  els.todayBoard.innerHTML = picks.length
    ? picks.map((pick, index) => `
      <article class="studio-pick">
        <strong>${index + 1}. ${escapeHtml(pick.selectedTeam)} ${escapeHtml(pick.market)} ${escapeHtml(formatOdds(pick.sportsbookOdds))}</strong>
        <div class="studio-meta">
          <span class="studio-pill">${escapeHtml(pick.gameLabel)}</span>
          <span class="studio-pill">${escapeHtml(formatProbability(pick.modelWinProbability))} win</span>
          <span class="studio-pill">Score ${escapeHtml(pick.finalScore ?? "TBD")}</span>
          <span class="studio-pill">${escapeHtml(pick.confidenceLabel || "Confidence TBD")}</span>
          <span class="studio-pill">Fair ${escapeHtml(formatOdds(pick.fairOdds))}</span>
          <span class="studio-pill">Playable ${escapeHtml(formatOdds(pick.playableThrough))}</span>
        </div>
        <p>${escapeHtml((pick.reasons || []).slice(0, 2).join(" · ") || "No reasons captured.")}</p>
        <p><strong>Risk:</strong> ${escapeHtml((pick.riskFlags || [])[0] || "Confirm lineups and price before posting.")}</p>
      </article>
    `).join("")
    : `<div class="studio-warning">Social Studio does not calculate picks. It freezes the official Daily 3 already generated on the main app.</div>`;
}

async function refreshQueue() {
  if (!state.authorized) return;
  localStorage.removeItem(SOCIAL_RESET_KEY);
  const slateDate = state.board?.slateDate || "";
  const status = els.queueStatus.value || "all";
  const query = new URLSearchParams();
  if (slateDate) query.set("slateDate", slateDate);
  query.set("status", status);
  const payload = await api(`/api/social/content?${query.toString()}`);
  const snapshotQuery = new URLSearchParams();
  if (slateDate) snapshotQuery.set("slateDate", slateDate);
  const snapshotPayload = await api(`/api/social/snapshots?${snapshotQuery.toString()}`);
  state.content = payload.content || [];
  state.snapshots = snapshotPayload.snapshots || [];
  renderQueue();
  await refreshResults();
  await refreshPublishing();
}

async function refreshPublishing() {
  if (!state.authorized || !els.instagramStatus || !els.publicationList) return;
  const [statusPayload, publicationsPayload] = await Promise.all([
    api("/api/social/instagram/status"),
    api("/api/social/publications")
  ]);
  state.instagramStatus = statusPayload;
  state.publications = publicationsPayload.publications || [];
  renderPublishing();
}

function renderPublishing() {
  if (!els.instagramStatus || !els.publicationList) return;
  const status = state.instagramStatus || {};
  const accountLabel = status.username ? `@${status.username}` : "configured Instagram account";
  const liveEnabled = status.connected && !status.dryRun && status.livePublishEnabled === true;
  const liveArmed = status.connected && !status.dryRun && status.livePublishEnabled !== true;
  els.instagramStatus.innerHTML = `
    ${liveEnabled ? `<div class="studio-warning">LIVE INSTAGRAM PUBLISHING ENABLED · Account: ${escapeHtml(accountLabel)} · This can create a real Instagram post.</div>` : ""}
    ${liveArmed ? `<div class="studio-warning">LIVE MODE ARMED — PUBLISHING DISABLED · Account: ${escapeHtml(accountLabel)} · Set SOCIAL_LIVE_PUBLISH_ENABLED=true only for a controlled live post.</div>` : ""}
    <div class="studio-meta">
      <span class="studio-pill">${status.connected ? "CONNECTED" : "NOT CONNECTED"}</span>
      <span class="studio-pill">Token ${status.tokenConfigured ? "configured" : "missing"}</span>
      <span class="studio-pill">API ${escapeHtml(status.apiVersion || "default")}</span>
      ${status.username ? `<span class="studio-pill">@${escapeHtml(status.username)}</span>` : ""}
      ${status.dryRun ? `<span class="studio-pill">DRY RUN</span>` : liveEnabled ? `<span class="studio-pill">LIVE ENABLED</span>` : `<span class="studio-pill">LIVE MODE ARMED — PUBLISHING DISABLED</span>`}
    </div>
    ${status.lastError ? `<div class="studio-warning">${escapeHtml(status.lastError)}</div>` : ""}
  `;
  els.publicationList.innerHTML = state.publications.length
    ? state.publications.map((publication) => {
      const isDryRunReceipt = isDryRunPublication(publication);
      return `
      <article class="graphic-row">
        <div>
          <strong>${escapeHtml(publication.contentType)} · ${escapeHtml(publication.publicationType)}</strong>
          <div class="studio-meta">
            <span class="studio-pill">${escapeHtml(publicationDisplayStatus(publication))}</span>
            <span class="studio-pill">${escapeHtml(publication.slateDate)}</span>
            <span class="studio-pill">${escapeHtml(publication.provider)}</span>
            ${isDryRunReceipt ? `<span class="studio-pill">DRY-RUN RECEIPT</span>` : ""}
            <span class="studio-pill">Asset uploaded ${publication.assetUploaded ? "YES" : "NO"}</span>
            ${publication.metadata?.assetReused ? `<span class="studio-pill">Existing asset reused</span>` : ""}
            ${publication.metadata?.assetPublicUrlValidated ? `<span class="studio-pill">Public URL validated</span>` : ""}
            ${isDryRunReceipt ? `<span class="studio-pill">Meta publish BLOCKED</span><span class="studio-pill">Live post NO</span>` : ""}
          </div>
          <p>${escapeHtml(publication.caption || "")}</p>
          ${publication.accountUsername ? `<p>Account: @${escapeHtml(publication.accountUsername)}</p>` : ""}
          ${publication.assetUrl ? `<p>Asset URL: ${escapeHtml(publication.assetUrl)}</p>` : ""}
          ${publication.permalink ? `<p>Permalink: ${escapeHtml(publication.permalink)}</p>` : isDryRunReceipt ? "<p>Permalink: none</p>" : ""}
          <code>${escapeHtml(publication.assetHash || "")}</code>
        </div>
        <div class="graphic-actions">
          ${publication.assetUrl ? `<a class="studio-button secondary" href="${escapeHtml(publication.assetUrl)}" target="_blank" rel="noopener">Asset</a>` : ""}
          ${publication.permalink ? `<a class="studio-button" href="${escapeHtml(publication.permalink)}" target="_blank" rel="noopener">View Instagram Post</a>` : ""}
          <button class="studio-button secondary" type="button" data-publication-action="refresh" data-publication-id="${escapeHtml(publication.id)}">Refresh Status</button>
          ${publicationActionControl(publication, status, accountLabel)}
        </div>
      </article>
    `}).join("")
    : "<p>No publication records prepared yet.</p>";
}

function openLivePublishConfirm(publication) {
  if (!els.livePublishConfirmPanel || !publication) return;
  const account = publication.accountUsername ? `@${publication.accountUsername}` : (state.instagramStatus?.username ? `@${state.instagramStatus.username}` : "the configured Instagram account");
  state.pendingLivePublish = publication;
  state.livePublishInFlight = false;
  els.livePublishAccount.textContent = account;
  els.livePublishAccountCheck.textContent = account;
  els.livePublishContent.textContent = publication.contentType || "Approved content";
  els.livePublishGraphic.textContent = publication.publicationType || "Approved graphic";
  els.livePublishAsset.textContent = publication.assetUrl ? "Validated public asset" : "Asset not validated";
  els.livePublishCaption.textContent = publication.caption || "No caption available";
  els.livePublishUnderstand.checked = false;
  els.confirmLivePublish.disabled = true;
  els.confirmLivePublish.textContent = "Confirm Live Publish";
  els.cancelLivePublish.disabled = false;
  els.livePublishConfirmPanel.classList.remove("hidden");
  document.body.classList.add("live-modal-open");
}

function closeLivePublishConfirm(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  state.pendingLivePublish = null;
  state.livePublishInFlight = false;
  if (els.livePublishUnderstand) els.livePublishUnderstand.checked = false;
  if (els.confirmLivePublish) {
    els.confirmLivePublish.disabled = true;
    els.confirmLivePublish.textContent = "Confirm Live Publish";
  }
  if (els.cancelLivePublish) els.cancelLivePublish.disabled = false;
  els.livePublishConfirmPanel?.classList.add("hidden");
  document.body.classList.remove("live-modal-open");
}

async function confirmLivePublish() {
  const publication = state.pendingLivePublish;
  if (!publication || state.livePublishInFlight || !els.livePublishUnderstand.checked) return;
  state.livePublishInFlight = true;
  els.confirmLivePublish.disabled = true;
  els.cancelLivePublish.disabled = true;
  els.confirmLivePublish.textContent = "Publishing Live...";
  showStatus("Publishing Live...", els.publicationStatus);
  try {
    const payload = await api(`/api/social/publications/${encodeURIComponent(publication.id)}/publish`, {
      method: "POST",
      body: JSON.stringify({ confirmLivePublish: true })
    });
    const published = payload.publication || {};
    if (!['verified', 'published'].includes(String(published.status))) {
      throw new Error(`Live publish did not verify: ${published.status || "unknown status"}`);
    }
    showStatus(`LIVE POST PUBLISHED · Account: @${published.accountUsername || state.instagramStatus?.username || "configured Instagram account"} · Media ID: ${published.platformMediaId || "not returned"} · Permalink: ${published.permalink || "not returned"} · Published: ${published.publishedAt || published.updatedAt || "now"}`, els.publicationStatus);
    closeLivePublishConfirm();
    await refreshPublishing();
  } catch (error) {
    const message = error.message || "Live publication failed.";
    showStatus(message, els.publicationStatus);
    els.confirmLivePublish.disabled = false;
  } finally {
    state.livePublishInFlight = false;
    els.cancelLivePublish.disabled = false;
    if (!els.livePublishConfirmPanel.classList.contains("hidden")) {
      els.confirmLivePublish.textContent = "Confirm Live Publish";
    }
  }
}

function diagnosticMatchMessage(diagnostics) {
  if (!diagnostics) return "";
  if (diagnostics.recommendedInstagramUserId) {
    return `Recommended ID: ${diagnostics.recommendedInstagramUserId}`;
  }
  if (diagnostics.ambiguous) {
    return "Ambiguous: more than one candidate matched the expected account.";
  }
  return "No matching Instagram Graph user found.";
}

function renderInstagramDiagnostics() {
  if (!els.instagramDiagnostics) return;
  const diagnostics = state.instagramDiagnostics;
  if (!diagnostics) {
    els.instagramDiagnostics.innerHTML = "";
    return;
  }
  const candidates = diagnostics.candidates || [];
  const configuredText = diagnostics.configuredInstagramUserId
    ? `Configured ID ${diagnostics.configuredInstagramUserId} · ${diagnostics.configuredIdMatchStatus || "unknown"}`
    : "No configured Instagram ID";
  els.instagramDiagnostics.innerHTML = `
    <article class="graphic-row">
      <div>
        <strong>${escapeHtml(diagnosticMatchMessage(diagnostics))}</strong>
        <div class="studio-meta">
          <span class="studio-pill">Token ${diagnostics.tokenConfigured ? "configured" : "missing"}</span>
          <span class="studio-pill">API ${escapeHtml(diagnostics.graphApiVersion || "default")}</span>
          <span class="studio-pill">Expected @${escapeHtml(diagnostics.expectedUsername || "sg_heater")}</span>
          <span class="studio-pill">${diagnostics.dryRun ? "DRY RUN" : "LIVE MODE"}</span>
          <span class="studio-pill">${diagnostics.readyForDryRunPublishing ? "Ready dry-run" : "Not dry-run ready"}</span>
        </div>
        <p>${escapeHtml(configuredText)}</p>
      </div>
    </article>
    ${candidates.length ? candidates.map((candidate) => `
      <article class="graphic-row">
        <div>
          <strong>${escapeHtml(candidate.id)} ${candidate.recommended ? "· Recommended" : ""}</strong>
          <div class="studio-meta">
            <span class="studio-pill">${escapeHtml(candidate.classification || "unknown")}</span>
            <span class="studio-pill">${candidate.username ? `@${escapeHtml(candidate.username)}` : "Username not resolved"}</span>
            ${candidate.accountType ? `<span class="studio-pill">${escapeHtml(candidate.accountType)}</span>` : ""}
            <span class="studio-pill">Media edge ${candidate.mediaEdgeReadable ? "readable" : "blocked"}</span>
            <span class="studio-pill">Matches expected ${candidate.matchesExpectedInstagramAccount ? "YES" : "NO"}</span>
          </div>
          ${candidate.mediaCount !== null && candidate.mediaCount !== undefined ? `<p>Media count: ${escapeHtml(candidate.mediaCount)}</p>` : ""}
          ${candidate.error ? `<div class="studio-warning">${escapeHtml(candidate.error.message || "Meta request failed")}</div>` : ""}
          ${(candidate.optionalProbeErrors || []).length ? `<p>Optional probe warning: ${escapeHtml(candidate.optionalProbeErrors.map((item) => `${item.probe}: ${item.error?.message || "failed"}`).join(" · "))}</p>` : ""}
        </div>
      </article>
    `).join("") : "<p>No candidates were checked.</p>"}
  `;
}

async function runInstagramDiagnostics() {
  if (!state.authorized || !els.instagramDiagnostics) return;
  const ids = "1235870939610391,17841404477734906";
  let finalMessage = "";
  showStatus("Running diagnostics...", els.instagramDiagnosticsStatus);
  try {
    const query = new URLSearchParams({ ids });
    state.instagramDiagnostics = await api(`/api/social/instagram/diagnostics?${query.toString()}`);
    renderInstagramDiagnostics();
  } catch (error) {
    finalMessage = error.message;
  } finally {
    showStatus(finalMessage, els.instagramDiagnosticsStatus);
  }
}

async function refreshResults() {
  if (!state.authorized) return;
  const slateDate = state.board?.slateDate || "";
  const resultQuery = new URLSearchParams();
  if (slateDate) resultQuery.set("slateDate", slateDate);
  const resultsPayload = await api(`/api/social/results?${resultQuery.toString()}`);
  state.results = resultsPayload.results || [];
  const date = slateDate || new Date().toISOString().slice(0, 10);
  const periods = ["daily", "weekly", "monthly", "all_time"];
  const entries = await Promise.all(periods.map(async (period) => {
    const params = new URLSearchParams({ period, date });
    const payload = await api(`/api/social/performance?${params.toString()}`);
    return [period, payload.performance];
  }));
  state.performance = Object.fromEntries(entries);
  renderResults();
}

function renderPerformanceCard(label, summary = {}) {
  const record = `${summary.wins || 0}-${summary.losses || 0}`;
  return `
    <article class="result-summary-card">
      <span class="studio-pill">${escapeHtml(label)}</span>
      <strong>${escapeHtml(record)}</strong>
      <div>${escapeHtml(formatUnits(summary.units))}</div>
      <div>${escapeHtml(formatPercent(summary.winPercentage))} win · ${escapeHtml(formatPercent(summary.roi))} ROI</div>
    </article>
  `;
}

function renderResults() {
  if (!els.performanceSummary || !els.resultsList) return;
  els.performanceSummary.innerHTML = [
    renderPerformanceCard("Today", state.performance.daily),
    renderPerformanceCard("Week", state.performance.weekly),
    renderPerformanceCard("Month", state.performance.monthly),
    renderPerformanceCard("All Time", state.performance.all_time)
  ].join("");
  els.resultsList.innerHTML = state.results.length
    ? state.results.map((result) => `
      <article class="result-row">
        <div>
          <strong>${escapeHtml(result.selectedTeam)} ${escapeHtml(result.market)} ${escapeHtml(formatOdds(result.frozenOdds))}</strong>
          <div>${escapeHtml(result.opponent ? `vs ${result.opponent}` : result.gameId)} · ${escapeHtml(result.sourceGameStatus || "status pending")}</div>
          ${result.manualReviewReason ? `<div class="studio-warning">${escapeHtml(result.manualReviewReason)}</div>` : ""}
        </div>
        <span class="result-badge ${escapeHtml(String(result.result || "").toLowerCase())}">${escapeHtml(result.result || "PENDING")}</span>
        <strong>${escapeHtml(formatUnits(result.unitsWonLost))}</strong>
      </article>
    `).join("")
    : "<p>No tracked result records for this slate yet.</p>";
}

async function checkResults() {
  const slateDate = state.board?.slateDate || "";
  showStatus("Checking MLB final scores against frozen snapshots...", els.resultsStatus);
  const payload = await api("/api/social/results/check", {
    method: "POST",
    body: JSON.stringify({ slateDate })
  });
  showStatus(`Checked ${payload.checked || 0}; updated ${payload.updated || 0}.`, els.resultsStatus);
  await refreshQueue();
}

async function loadGraphicsForContent(contentId) {
  if (!contentId) return [];
  const query = new URLSearchParams({ socialContentId: contentId });
  const payload = await api(`/api/social/graphics?${query.toString()}`);
  const graphics = payload.graphics || [];
  state.graphicsByContent.set(contentId, graphics);
  return graphics;
}

function renderQueue() {
  els.contentQueue.innerHTML = state.content.length
    ? state.content.map((content) => `
      <article class="content-row ${state.selectedContent?.id === content.id ? "active" : ""}" data-content-id="${escapeHtml(content.id)}">
        <strong>${escapeHtml(content.headline || content.contentType)}</strong>
        <div class="studio-meta">
          <span class="studio-pill">${escapeHtml(content.contentType)}</span>
          <span class="studio-pill">${escapeHtml(content.status)}</span>
          <span class="studio-pill">${escapeHtml(content.slateDate)}</span>
          <span class="studio-pill">${escapeHtml(content.generationProvider)}</span>
        </div>
        <p>${escapeHtml(content.shortCaption || content.caption || "")}</p>
      </article>
    `).join("")
    : `<p>No content in this queue yet.</p>`;
}

function renderContentDetail(content) {
  if (!content) {
    els.contentDetail.innerHTML = "<p>Select a generated item from the queue.</p>";
    return;
  }
  const snapshots = (content.pickSnapshotIds || []).map((id) =>
    state.snapshots.find((snapshot) => snapshot.id === id) || { id }
  );
  const graphics = state.graphicsByContent.get(content.id) || [];
  const storyGraphic = graphics.find((graphic) => String(graphic.format || "").toLowerCase() === "story" && graphic.status !== "archived");
  const storyMusic = storyMusicForContent(content);
  const warnings = Array.isArray(content.metadata?.warnings) ? content.metadata.warnings : [];
  const publishingStatus = state.instagramStatus || {};
  const dryRunPublicationMode = Boolean(publishingStatus.dryRun);
  const dryRunPublicationReady = Boolean(publishingStatus.connected && publishingStatus.dryRun);
  els.contentDetail.innerHTML = `
    <div class="studio-meta">
      <span class="studio-pill">${escapeHtml(content.contentType)}</span>
      <span class="studio-pill">${escapeHtml(content.status)}</span>
      <span class="studio-pill">${escapeHtml(content.generationProvider)} · ${escapeHtml(content.generationModel)}</span>
    </div>
    ${content.generationError ? `<div class="studio-warning">${escapeHtml(content.generationError)}</div>` : ""}
    ${warnings.length ? `<div class="studio-warning">${warnings.map((warning) => escapeHtml(warning)).join("<br>")}</div>` : ""}
    <div class="snapshot-list">
      ${snapshots.map((snapshot) => `
        <div class="snapshot-mini">
          <strong>${escapeHtml(snapshot.selectedTeam || "Frozen pick")} ${escapeHtml(snapshot.market || "")} ${escapeHtml(formatOdds(snapshot.sportsbookOdds))}</strong>
          <div>${escapeHtml(snapshot.gameLabel || "")}</div>
          <div>${escapeHtml(formatProbability(snapshot.modelWinProbability))} win · score ${escapeHtml(snapshot.finalScore ?? "TBD")} · fair ${escapeHtml(formatOdds(snapshot.fairOdds))}</div>
          <code>${escapeHtml(snapshot.id)}</code>
        </div>
      `).join("")}
    </div>
    <div class="studio-field">
      <label>Caption</label>
      <textarea readonly id="detailCaption">${escapeHtml(content.caption || "")}</textarea>
    </div>
    <div class="studio-field">
      <label>Short Caption</label>
      <textarea readonly id="detailShortCaption">${escapeHtml(content.shortCaption || "")}</textarea>
    </div>
    <div class="studio-field">
      <label>Reel Hook</label>
      <textarea readonly>${escapeHtml(content.reelHook || "")}</textarea>
    </div>
    <div class="studio-field">
      <label>Story Text</label>
      <textarea readonly>${escapeHtml(content.storyText || "")}</textarea>
    </div>
    <div class="graphics-panel">
      <h3>
        <span>Graphics</span>
        <span class="studio-pill">${escapeHtml(String(graphics.length))} asset${graphics.length === 1 ? "" : "s"}</span>
      </h3>
      <div class="studio-row">
        <button class="studio-button" type="button" data-generate-graphic="feed">Generate Feed Graphic</button>
        <button class="studio-button secondary" type="button" data-generate-graphic="story">Generate Story Graphic</button>
      </div>
      ${storyMusic ? `
        <div class="studio-field story-music-recommendation">
          <label>Story Music</label>
          <strong>${escapeHtml(storyMusicText(storyMusic))}</strong>
          <p>Add this track manually in Instagram before posting.</p>
          <div class="studio-row">
            <button class="studio-button secondary" type="button" data-copy-story-music>Copy Music</button>
            ${storyGraphic ? `<span class="studio-pill">Story checklist: ✓ Graphic ready</span><span class="studio-pill">○ Add music: ${escapeHtml(storyMusicText(storyMusic))}</span>` : ""}
          </div>
        </div>
      ` : ""}
      <div class="graphic-list">
        ${graphics.length ? graphics.map((graphic) => `
          <article class="graphic-row">
            <a href="${escapeHtml(graphic.assetUrl || "#")}" target="_blank" rel="noopener">
              ${graphic.assetUrl
                ? `<img class="graphic-preview" alt="${escapeHtml(graphicLabel(graphic.format))} graphic preview" src="${escapeHtml(graphic.assetUrl)}?v=${escapeHtml(graphic.updatedAt || graphic.id)}">`
                : `<div class="studio-warning">${escapeHtml(graphic.generationError || "Graphic asset unavailable.")}</div>`}
            </a>
            <div class="graphic-meta">
              <strong>${escapeHtml(graphicLabel(graphic.format))} Graphic</strong>
              <div class="studio-meta">
                <span class="studio-pill">${escapeHtml(graphic.status || graphic.assetStatus)}</span>
                <span class="studio-pill">${escapeHtml(graphic.width)}x${escapeHtml(graphic.height)}</span>
                <span class="studio-pill">${escapeHtml(graphic.templateVersion)}</span>
                <span class="studio-pill">${escapeHtml(graphic.renderVersion)}</span>
              </div>
              <p>${escapeHtml(graphic.generationError || `Rendered ${graphic.updatedAt || graphic.createdAt || ""}`)}</p>
              <code>${escapeHtml(graphic.id)}</code>
              <div class="graphic-actions">
                ${graphic.assetUrl ? `<a class="studio-button secondary" href="${escapeHtml(graphic.assetUrl)}" target="_blank" rel="noopener">View</a>` : ""}
                ${graphic.assetUrl ? `<a class="studio-button secondary" href="${escapeHtml(graphic.assetUrl)}" download>Download</a>` : ""}
                <button class="studio-button secondary" type="button" data-graphic-action="regenerate" data-graphic-id="${escapeHtml(graphic.id)}">Regenerate</button>
                <button class="studio-button" type="button" data-graphic-action="approve" data-graphic-id="${escapeHtml(graphic.id)}" ${graphic.status === "approved" ? "disabled" : ""}>Approve Graphic</button>
                <button class="studio-button secondary" type="button" data-prepare-publication="${escapeHtml(graphic.id)}" ${graphic.status !== "approved" || content.status !== "approved" || (dryRunPublicationMode && !dryRunPublicationReady) ? "disabled" : ""}>${dryRunPublicationMode ? "Run Dry-Run Publication Test" : "Prepare for Instagram"}</button>
                <button class="studio-button danger" type="button" data-graphic-action="archive" data-graphic-id="${escapeHtml(graphic.id)}">Archive Graphic</button>
              </div>
            </div>
          </article>
        `).join("") : `<p>No graphics generated for this content yet.</p>`}
      </div>
    </div>
    <div class="studio-row">
      <button class="studio-button secondary" type="button" data-action="copy">Copy Caption</button>
      <button class="studio-button secondary" type="button" data-action="regenerate">Regenerate</button>
      <button class="studio-button" type="button" data-action="approve" ${content.status === "approved" ? "disabled" : ""}>Approve</button>
      <button class="studio-button danger" type="button" data-action="archive">Archive</button>
    </div>
  `;
}

async function selectContent(content) {
  state.selectedContent = content;
  renderQueue();
  renderContentDetail(state.selectedContent);
  if (content?.id) {
    await loadGraphicsForContent(content.id);
    renderContentDetail(state.selectedContent);
  }
}

async function generateContent(contentType, pickIndex = 0) {
  if (!state.board?.officialPicks?.length) {
    showStatus("No official board is available to snapshot yet.");
    return;
  }
  showStatus(`Generating ${contentType} social draft...`);
  localStorage.removeItem(SOCIAL_RESET_KEY);
  let finalStatus = "";
  try {
    const payload = await api("/api/social/generate", {
      method: "POST",
      body: JSON.stringify({
        contentType,
        board: state.board,
        pickIndex: Number(pickIndex || 0)
      })
    });
    state.selectedContent = payload.content;
    finalStatus = payload.content?.metadata?.warnings?.[0] || `New ${contentType.replaceAll("_", " ")} draft created.`;
    await refreshQueue();
    renderContentDetail(state.selectedContent);
  } catch (error) {
    finalStatus = error.message || "Social draft generation failed.";
  } finally {
    showStatus(finalStatus);
  }
}

async function handleContentAction(action) {
  const content = state.selectedContent;
  if (!content) return;
  if (action === "copy") {
    await navigator.clipboard.writeText(content.caption || "");
    showStatus("Caption copied.");
    return;
  }
  showStatus(`${action} in progress...`);
  const payload = await api(`/api/social/content/${encodeURIComponent(content.id)}/${action}`, { method: "POST", body: "{}" });
  state.selectedContent = payload.content;
  showStatus("");
  await refreshQueue();
  if (state.selectedContent?.id) await loadGraphicsForContent(state.selectedContent.id);
  renderContentDetail(state.selectedContent);
}

async function generateGraphic(format, button = null) {
  const normalizedFormat = String(format || "feed").toLowerCase();
  const content = state.selectedContent;
  if (!content) {
    showStatus("Select a content item before generating a graphic.");
    return;
  }
  const inFlightKey = `${content.id}:${normalizedFormat}`;
  if (state.graphicGenerationInFlight.has(inFlightKey)) return;
  state.graphicGenerationInFlight.add(inFlightKey);
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = `Generating ${graphicLabel(normalizedFormat)}...`;
  }
  showStatus(`Generating ${graphicLabel(normalizedFormat)} graphic...`);
  try {
    const payload = await api(`/api/social/content/${encodeURIComponent(content.id)}/graphics`, {
      method: "POST",
      body: JSON.stringify({ format: normalizedFormat })
    });
    await loadGraphicsForContent(content.id);
    const latestContent = state.content.find((item) => item.id === content.id) || content;
    state.selectedContent = latestContent;
    showStatus(payload.graphic?.status === "failed" ? payload.graphic.generationError || payload.error || "Graphic generation failed." : `${graphicLabel(normalizedFormat)} graphic generated.`);
    renderContentDetail(latestContent);
  } catch (error) {
    showStatus(error.message || `${graphicLabel(normalizedFormat)} graphic generation failed.`);
  } finally {
    state.graphicGenerationInFlight.delete(inFlightKey);
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function copyStoryMusic() {
  const music = storyMusicForContent(state.selectedContent);
  const text = storyMusicText(music);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showStatus("Music copied.");
  } catch {
    showStatus(`Unable to copy music. Please copy it manually: ${text}`);
  }
}

async function handleGraphicAction(action, graphicId) {
  if (!state.selectedContent || !graphicId) return;
  showStatus(`${action} graphic in progress...`);
  const payload = await api(`/api/social/graphics/${encodeURIComponent(graphicId)}/${action}`, {
    method: "POST",
    body: "{}"
  });
  await loadGraphicsForContent(state.selectedContent.id);
  showStatus(payload.graphic?.status === "failed" ? payload.graphic.generationError : "");
  renderContentDetail(state.selectedContent);
}

async function preparePublication(graphicId, button = null) {
  const dryRun = Boolean(state.instagramStatus?.dryRun);
  const selectedContent = state.selectedContent;
  const selectedGraphic = selectedGraphicById(graphicId);
  if (!selectedContent) {
    showStatus("Approved content is not selected.", els.publicationStatus);
    return;
  }
  if (!graphicId || !selectedGraphic) {
    showStatus("Approved graphic is not selected.", els.publicationStatus);
    return;
  }
  if (selectedContent.status !== "approved") {
    showStatus(`Content is ${selectedContent.status || "not approved"}. Approve the Daily 3 content first.`, els.publicationStatus);
    return;
  }
  if (selectedGraphic.status !== "approved") {
    showStatus(`Graphic is ${selectedGraphic.status || "not approved"}. Approve the Feed Graphic first.`, els.publicationStatus);
    return;
  }
  if (dryRun && !(state.instagramStatus?.connected && state.instagramStatus?.dryRun)) {
    showStatus("Dry-run publishing is not connected.", els.publicationStatus);
    return;
  }

  const previousText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = dryRun ? "Running..." : "Preparing...";
  }
  showStatus(dryRun ? "Running dry-run publication test..." : "Preparing approved graphic for Instagram...");
  showStatus("", els.publicationStatus);
  try {
    const payload = await api(`/api/social/graphics/${encodeURIComponent(graphicId)}/prepare-publication`, {
      method: "POST",
      body: JSON.stringify({ contentId: selectedContent.id, graphicId })
    });
    showStatus(payload.publication.dryRun
      ? `Dry-run publication receipt prepared: ${payload.publication.status}`
      : `Publication asset ready: ${payload.publication.status}`);
    showStatus(payload.publication.dryRun
      ? `Dry-run receipt created. Asset uploaded ${payload.publication.assetUploaded ? "YES" : "NO"}. Meta publish BLOCKED.`
      : "Publication asset ready.",
      els.publicationStatus);
    await refreshPublishing();
  } catch (error) {
    const message = error.message || "Publication preparation failed.";
    showStatus(message);
    showStatus(message, els.publicationStatus);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

async function handlePublicationAction(action, publicationId, button = null) {
  if (action === "publish") {
    const publication = state.publications.find((item) => item.id === publicationId);
    if (!publication) {
      showStatus("The selected publication could not be found.", els.publicationStatus);
      return;
    }
    openLivePublishConfirm(publication);
    return;
  }
  const previousText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = action === "publish" ? "Publishing..." : "Refreshing...";
  }
  showStatus(`${action} publication in progress...`);
  showStatus("", els.publicationStatus);
  try {
    const payload = await api(`/api/social/publications/${encodeURIComponent(publicationId)}/${action}`, {
      method: "POST",
      body: "{}"
    });
    showStatus(`Publication status: ${payload.publication.status}`);
    showStatus(`Publication status: ${payload.publication.status}`, els.publicationStatus);
    await refreshPublishing();
  } catch (error) {
    const message = error.message || "Publication action failed.";
    showStatus(message);
    showStatus(message, els.publicationStatus);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

async function bootstrap() {
  try {
    const session = await api("/api/social/session");
    state.authorized = Boolean(session.authorized);
    if (!session.configured) {
      showStatus("SOCIAL_ADMIN_SECRET is not configured on the server.", els.loginStatus);
    }
  } catch {
    state.authorized = false;
  }
  els.loginPanel.classList.toggle("hidden", state.authorized);
  els.socialApp.classList.toggle("hidden", !state.authorized);
  if (state.authorized) {
    loadCurrentBoard();
    if (localStorage.getItem(SOCIAL_RESET_KEY)) {
      renderQueue();
      renderContentDetail(null);
      await refreshPublishing();
      showStatus("Testing workspace cleared.");
    } else {
      await refreshQueue();
    }
  }
}

async function submitSocialLogin(event) {
  event.preventDefault();
  showStatus("", els.loginStatus);
  setLoginBusy(true);
  let unlocked = false;
  try {
    const login = await api("/api/social/login", {
      method: "POST",
      body: JSON.stringify({ secret: els.socialSecret.value.trim() })
    });
    if (!login.authorized) throw new Error("Unable to create Social Studio session.");
    const session = await api("/api/social/session");
    if (!session.authorized) throw new Error("Unable to create Social Studio session.");
    state.authorized = true;
    els.socialSecret.value = "";
    els.loginPanel.classList.add("hidden");
    els.socialApp.classList.remove("hidden");
    unlocked = true;
    loadCurrentBoard();
    await refreshQueue();
  } catch (error) {
    showStatus(error.message || "Unable to create Social Studio session.", unlocked ? els.studioStatus : els.loginStatus);
  } finally {
    setLoginBusy(false);
  }
}

function initializeSocialStudio() {
  if (!els.loginForm || !els.socialSecret || !els.loginPanel || !els.socialApp) {
    showStartupFailure(new Error("Required Social Studio login elements are missing."));
    return;
  }

  els.loginForm.addEventListener("submit", submitSocialLogin);

  try {
    bindIfPresent(els.refreshBoard, "click", refreshCurrentBoard);
    bindIfPresent(els.resetTestingWorkspace, "click", () => resetTestingWorkspace().catch((error) => showStatus(error.message)));
    bindIfPresent(els.refreshQueue, "click", refreshQueue);
    bindIfPresent(els.refreshPublishing, "click", () => refreshPublishing().catch((error) => showStatus(error.message)));
    bindIfPresent(els.runInstagramDiagnostics, "click", () => runInstagramDiagnostics().catch((error) => showStatus(error.message, els.instagramDiagnosticsStatus)));
    bindIfPresent(els.checkResults, "click", () => checkResults().catch((error) => showStatus(error.message, els.resultsStatus)));
    bindIfPresent(els.queueStatus, "change", refreshQueue);
    bindIfPresent(els.createDaily3, "click", () => generateContent("DAILY_3"));
    bindIfPresent(els.createBestBet, "click", () => generateContent("BEST_BET"));
    bindIfPresent(els.createBreakdown, "click", () => generateContent("PICK_BREAKDOWN", els.breakdownPick?.value));
    bindIfPresent(els.contentQueue, "click", (event) => {
      const row = event.target.closest("[data-content-id]");
      if (!row) return;
      selectContent(state.content.find((content) => content.id === row.dataset.contentId))
        .catch((error) => showStatus(error.message));
    });
    bindIfPresent(els.contentDetail, "click", (event) => {
      const copyMusicButton = event.target.closest("[data-copy-story-music]");
      if (copyMusicButton) {
        copyStoryMusic();
        return;
      }
      const graphicGenerateButton = event.target.closest("[data-generate-graphic]");
      if (graphicGenerateButton) {
        generateGraphic(graphicGenerateButton.dataset.generateGraphic, graphicGenerateButton).catch((error) => showStatus(error.message));
        return;
      }
      const graphicActionButton = event.target.closest("[data-graphic-action]");
      if (graphicActionButton) {
        handleGraphicAction(graphicActionButton.dataset.graphicAction, graphicActionButton.dataset.graphicId)
          .catch((error) => showStatus(error.message));
        return;
      }
      const prepareButton = event.target.closest("[data-prepare-publication]");
      if (prepareButton) {
        preparePublication(prepareButton.dataset.preparePublication, prepareButton).catch((error) => {
          const message = error.message || "Publication preparation failed.";
          showStatus(message);
          showStatus(message, els.publicationStatus);
        });
        return;
      }
      const button = event.target.closest("[data-action]");
      if (!button) return;
      handleContentAction(button.dataset.action).catch((error) => showStatus(error.message));
    });
    bindIfPresent(els.publicationList, "click", (event) => {
      const button = event.target.closest("[data-publication-action]");
      if (!button) return;
      handlePublicationAction(button.dataset.publicationAction, button.dataset.publicationId, button)
        .catch((error) => {
          const message = error.message || "Publication action failed.";
          showStatus(message);
          showStatus(message, els.publicationStatus);
        });
    });
    bindIfPresent(els.livePublishUnderstand, "change", () => {
      if (els.confirmLivePublish) {
        els.confirmLivePublish.disabled = !els.livePublishUnderstand.checked || state.livePublishInFlight;
      }
    });
    bindIfPresent(els.cancelLivePublish, "click", closeLivePublishConfirm);
    bindIfPresent(els.confirmLivePublish, "click", () => confirmLivePublish().catch((error) => showStatus(error.message, els.publicationStatus)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.livePublishConfirmPanel?.classList.contains("hidden")) closeLivePublishConfirm(event);
    });
  } catch (error) {
    showStartupFailure(error);
    return;
  }

  bootstrap().catch(showStartupFailure);
}

initializeSocialStudio();

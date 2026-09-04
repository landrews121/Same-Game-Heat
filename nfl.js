"use strict";

const modeLabels = {
  standalone: "Standalone game",
  sunday_early: "Sunday early window",
  sunday_late: "Sunday late window",
  rollover: "Sunday rollover"
};

const $ = (id) => document.getElementById(id);
const dateInput = $("nflDate");
const modeInput = $("nflMode");
const weekInput = $("nflWeek");
const status = $("nflStatus");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

function renderWinners(board) {
  const winners = board.winners?.picks || [];
  if (!winners.length) {
    $("nflWinners").innerHTML = '<p class="nfl-empty">No official game winner is available because the schedule or market data is incomplete.</p>';
    return;
  }
  $("nflWinners").innerHTML = winners.map((pick, index) => `
    <article class="nfl-pick-card">
      <div class="nfl-rank">${index + 1}</div>
      <div class="nfl-pick-main">
        <small class="nfl-official-label">OFFICIAL GAME WINNER</small>
        <strong>${escapeHtml(pick.team)} ML ${pick.moneyline ?? "—"}</strong>
        <span>${escapeHtml(pick.opponent)} · ${escapeHtml(pick.homeOrAway)}</span>
        <span>Win ${percent(pick.modelWinProbability)} · Market baseline ${percent(pick.marketBaselineProbability)} · Football adjustment ${percent(pick.footballAdjustment)}</span>
        <span>Bet grade ${escapeHtml(pick.grade)} · Data confidence ${pick.dataConfidence?.score ?? "—"}% ${escapeHtml(pick.dataConfidence?.level || "LOW")}</span>
      </div>
      <div class="nfl-pick-score">${pick.betQualityScore ?? "—"}<small>${escapeHtml(pick.grade)}</small></div>
      <p class="nfl-risk">${escapeHtml((pick.killCritic?.reasons || pick.riskFlags || ["No major risk flag returned."])[0])}</p>
    </article>`).join("");
}

function sourceLabel(source) {
  return String(source || "MISSING").replaceAll("_", " ");
}

function renderDataStatus(board) {
  const games = board.games || [];
  if (!games.length) {
    $("nflDataStatus").innerHTML = '<p class="nfl-empty">No games were returned for this date/window.</p>';
    return;
  }

  const propStatus = board.propModelStatus || {};
  const summary = `<article class="nfl-data-game"><div class="nfl-data-game-heading"><strong>Prop model pipeline</strong><span>${escapeHtml(`${propStatus.modeledCandidates || 0} modeled candidates`)}</span></div><div class="nfl-data-grid"><span>Raw markets: ${propStatus.rawPropMarkets ?? 0}</span><span>Players resolved: ${propStatus.playersResolved ?? 0}</span><span>Projections: ${propStatus.propsProjected ?? 0}</span><span>Hit probabilities: ${propStatus.propsWithHitProbability ?? 0}</span><span>Safe eligible: ${propStatus.safeEligibleProps ?? 0}</span><span>Heat eligible: ${propStatus.heatEligibleProps ?? 0}</span></div></article>`;
  $("nflDataStatus").innerHTML = summary + games.map((game) => {
    const sides = [game.homeTeam, game.awayTeam].map((teamName) => board.winners?.all?.find((pick) => pick.gameId === game.id && pick.team === teamName)).filter(Boolean);
    const representative = sides[0];
    const metrics = representative?.metrics?.metricSources || {};
    const critical = representative?.criticalData || {};
    const confidence = representative?.dataConfidence;
    const metric = (key) => sourceLabel(metrics[key] || "MISSING");
    return `<article class="nfl-data-game">
      <div class="nfl-data-game-heading"><strong>${escapeHtml(game.awayTeam)} @ ${escapeHtml(game.homeTeam)}</strong><span>${escapeHtml(confidence ? `Data confidence: ${confidence.score}% ${confidence.level}` : "Data confidence: unavailable")}</span></div>
      <div class="nfl-data-grid">
        <span>Schedule: ${sourceLabel(critical.schedule || "MISSING")}</span>
        <span>Market: ${sourceLabel(critical.market || "MISSING")}</span>
        <span>QB: ${escapeHtml(representative?.qbStatus === "uncertain" ? "UNCERTAIN" : metric("quarterback"))}</span>
        <span>Efficiency: ${escapeHtml(metric("previousSeasonEfficiency"))}</span>
        <span>Roster: ${escapeHtml(metric("rosterTalent"))}</span>
        <span>Trenches: ${escapeHtml(metric("trenchEdge"))}</span>
        <span>Injuries: ${escapeHtml(metric("injuries"))}</span>
        <span>Weather: ${escapeHtml(metric("homeTravelWeather"))}</span>
      </div>
    </article>`;
  }).join("");
}

function renderProps(board) {
  const props = (board.props || []).slice(0, 12);
  if (!props.length) {
    $("nflProps").innerHTML = '<p class="nfl-empty">No modeled player prop markets were returned for this slate.</p>';
    return;
  }
  const rawCount = board.propModelStatus?.rawPropMarkets ?? board.rawProps?.length ?? props.length;
  $("nflProps").innerHTML = `<p class="nfl-empty">${rawCount} raw market${rawCount === 1 ? "" : "s"} became ${props.length} strongest-side model recommendation${props.length === 1 ? "" : "s"}.</p>` + props.map((prop) => `
    <div class="nfl-market-row"><strong>${escapeHtml(prop.player)}</strong><span>${escapeHtml(String(prop.side || "").toUpperCase())} ${escapeHtml(prop.market)} ${prop.line ?? "—"} · ${prop.odds ?? "—"}</span><span>Projection ${Number.isFinite(Number(prop.projection)) ? Number(prop.projection).toFixed(1) : "—"} · Hit ${percent(prop.hitProbability)} · ${escapeHtml(prop.dataConfidence?.level || "LOW")}</span></div>`).join("");
}

function renderCard(targetId, state, emptyMessage) {
  const legs = state?.legs || [];
  const label = targetId === "nflSafe6" ? "SAFE 6" : "HEAT 6";
  const summary = legs.length && state?.averageLegProbability !== null && state?.averageLegProbability !== undefined
    ? `<p class="nfl-empty">${label} · ${escapeHtml(state.strength || "RANKED")} · Average ${percent(state.averageLegProbability)} · Lowest ${percent(state.lowestLegProbability)} · Highest ${percent(state.highestLegProbability)} · Combined estimate ${percent(state.estimatedCombinedProbability)}</p>`
    : "";
  $(targetId).innerHTML = legs.length
    ? summary + legs.map((leg) => `<div class="nfl-market-row"><strong>${escapeHtml(leg.player)}</strong><span>${escapeHtml(String(leg.side || "").toUpperCase())} ${escapeHtml(leg.market)} ${leg.line ?? "—"} · ${leg.odds ?? "—"}</span><span>Projection ${Number.isFinite(Number(leg.projection)) ? Number(leg.projection).toFixed(1) : "—"} · Hit ${percent(leg.hitProbability)} · ${escapeHtml(leg.grade)} · ${escapeHtml(leg.dataConfidence?.level || "LOW")}</span></div>`).join("")
    : `<p class="nfl-empty">${escapeHtml(state?.reason || emptyMessage)}</p>`;
}

function renderRollover() {
  const result = {
    startingBankroll: Number($("rolloverStarting").value || 0),
    earlyWager: Number($("rolloverWager").value || 0),
    earlyReturn: Number($("rolloverReturn").value || 0),
    mode: $("rolloverMode").value
  };
  const rate = { conservative: 0.25, standard: 0.5, aggressive: 0.75 }[result.mode];
  const profit = result.earlyReturn - result.earlyWager;
  const protectedProfit = Math.max(0, profit * rate);
  $("rolloverResult").innerHTML = `<strong>Early profit: $${profit.toFixed(2)}</strong><span>Protected profit: $${protectedProfit.toFixed(2)} · Late rollover bankroll: $${protectedProfit.toFixed(2)}</span>`;
}

function renderBoard(board) {
  const games = board.games || [];
  $("nflModeLabel").textContent = modeLabels[board.mode] || board.mode;
  $("nflSource").textContent = `${board.source || "NFL market feed"} · Week ${board.week || 1}`;
  $("nflPriorNotice").hidden = !board.preseasonPriorMode;
  $("nflGameCount").textContent = games.length;
  $("nflQualifiedCount").textContent = board.winners?.picks?.length || 0;
  $("nflSafeState").textContent = board.safe6?.complete ? `6 legs · ${board.safe6.strength || "RANKED"}` : "Not complete";
  $("nflHeatState").textContent = board.heat6?.complete ? `6 legs · ${board.heat6.strength || "RANKED"}` : "Not complete";
  renderWinners(board);
  renderProps(board);
  renderCard("nflSafe6", board.safe6, "No Safe 6 generated. Fewer than six usable lower-variance modeled markets were returned.");
  renderCard("nflHeat6", board.heat6, "No Heat 6 generated. Fewer than six usable modeled markets were returned.");
  renderDataStatus(board);
  $("nflNotes").innerHTML = (board.dataNotes || ["No board has been loaded."]).map((note) => `<p>${escapeHtml(note)}</p>`).join("");
}

async function loadBoard() {
  const button = $("loadNflBoard");
  button.disabled = true;
  setStatus(`Loading ${modeLabels[modeInput.value].toLowerCase()}...`);
  try {
    const query = new URLSearchParams({ date: dateInput.value || today(), mode: modeInput.value, week: weekInput.value || "1" });
    const response = await fetch(`/api/nfl/board?${query}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "NFL board request failed");
    renderBoard(payload);
    setStatus(`${payload.games.length} NFL game${payload.games.length === 1 ? "" : "s"} loaded. Player markets were modeled from available prior, role, market, and fallback inputs.`, "success");
  } catch (error) {
    setStatus(`Could not load NFL board: ${error.message}`, "error");
    renderBoard({ mode: modeInput.value, week: weekInput.value, games: [], winners: { picks: [] }, safe6: {}, heat6: {}, dataNotes: ["NFL board unavailable until the server and Odds API are connected."] });
  } finally {
    button.disabled = false;
  }
}

dateInput.value = today();
$("loadNflBoard").addEventListener("click", loadBoard);
modeInput.addEventListener("change", loadBoard);
["rolloverStarting", "rolloverWager", "rolloverReturn", "rolloverMode"].forEach((id) => $(id).addEventListener("input", renderRollover));
renderRollover();

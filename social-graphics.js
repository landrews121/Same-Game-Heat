const crypto = require("node:crypto");

const GRAPHIC_TEMPLATE_VERSION = "social-graphics-template-v1";
const GRAPHIC_RENDER_VERSION = "social-graphics-renderer-v1";
const RESPONSIBLE_FOOTER = "21+ | Bet responsibly.";
const GRAPHIC_FORMATS = {
  feed: { width: 1080, height: 1350, label: "Feed Portrait" },
  story: { width: 1080, height: 1920, label: "Story / Reel Cover" },
  square: { width: 1080, height: 1080, label: "Square" }
};
const PROHIBITED_PHRASES = [
  "GUARANTEED",
  "CAN'T LOSE",
  "CAN’T LOSE",
  "CAN'T MISS",
  "CAN’T MISS",
  "FREE MONEY",
  "LOCK OF THE CENTURY",
  "MORTGAGE PLAY",
  "RISK IT ALL",
  "BET YOUR HOUSE",
  "100% CERTAIN",
  "SURE THING",
  "NO RISK"
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
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

function shortDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${month}/${day}/${year}` : String(value);
}

function teamInitials(name) {
  return clean(name)
    .split(/\s+/)
    .filter((word) => !/^(the|of)$/i.test(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 4)
    .toUpperCase() || "SGH";
}

function wrapText(text, maxChars, maxLines = 3) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1)).trim()}...`;
  return kept;
}

function prohibitedHits(input) {
  const text = canonicalStringify(input).toUpperCase();
  return PROHIBITED_PHRASES.filter((phrase) => text.includes(phrase));
}

function tspanLines(text, x, y, size, options = {}) {
  const maxChars = options.maxChars || Math.max(18, Math.floor(680 / (size * 0.55)));
  const lines = wrapText(text, maxChars, options.maxLines || 3);
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * (size * 1.22)}" font-size="${size}" font-weight="${options.weight || 700}" fill="${options.fill || "#101827"}">${escapeXml(line)}</text>`
  ).join("");
}

function card(x, y, width, height, options = {}) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${options.rx || 26}" fill="${options.fill || "#ffffff"}" stroke="${options.stroke || "#d5e0f3"}" stroke-width="${options.strokeWidth || 3}"/>`;
}

function pill(x, y, text, options = {}) {
  const size = options.size || 28;
  const width = Math.max(options.minWidth || 110, text.length * size * 0.52 + 42);
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${size + 22}" rx="${(size + 22) / 2}" fill="${options.fill || "#e7f0ff"}"/>`,
    `<text x="${x + 21}" y="${y + size + 4}" font-size="${size}" font-weight="900" fill="${options.color || "#153f7c"}">${escapeXml(text)}</text>`
  ].join("");
}

function header({ width, slateDate, label }) {
  return [
    `<rect x="0" y="0" width="${width}" height="210" fill="#153f7c"/>`,
    `<path d="M0 0 H${width} V210 H0 Z" fill="url(#brandGrad)"/>`,
    `<text x="66" y="82" font-size="32" font-weight="900" letter-spacing="3" fill="#d8e7ff">SAME GAME HEAT</text>`,
    `<text x="66" y="154" font-size="68" font-weight="900" fill="#ffffff">${escapeXml(label)}</text>`,
    `<text x="${width - 66}" y="86" text-anchor="end" font-size="32" font-weight="900" fill="#ffffff">${escapeXml(shortDate(slateDate))}</text>`
  ].join("");
}

function footer(width, height) {
  return [
    `<line x1="66" y1="${height - 112}" x2="${width - 66}" y2="${height - 112}" stroke="#d5e0f3" stroke-width="3"/>`,
    `<text x="66" y="${height - 54}" font-size="29" font-weight="900" fill="#5c6b83">${escapeXml(RESPONSIBLE_FOOTER)}</text>`,
    `<text x="${width - 66}" y="${height - 54}" text-anchor="end" font-size="25" font-weight="800" fill="#8b97ab">Research, not a guarantee</text>`
  ].join("");
}

function pickRow(snapshot, index, x, y, width, height) {
  const backfill = snapshot.isBackfill ? pill(x + width - 250, y + 26, "BEST AVAILABLE", { size: 22, fill: "#fff2c8", color: "#9a6400", minWidth: 220 }) : "";
  const reason = snapshot.reasons?.[0] || "Model liked the matchup profile.";
  return [
    card(x, y, width, height, { rx: 24, fill: "#f9fbff" }),
    `<circle cx="${x + 58}" cy="${y + 62}" r="32" fill="#153f7c"/>`,
    `<text x="${x + 58}" y="${y + 75}" text-anchor="middle" font-size="36" font-weight="900" fill="#ffffff">${index + 1}</text>`,
    `<circle cx="${x + 132}" cy="${y + 64}" r="42" fill="#e7f0ff" stroke="#b9cff0" stroke-width="3"/>`,
    `<text x="${x + 132}" y="${y + 77}" text-anchor="middle" font-size="29" font-weight="900" fill="#153f7c">${escapeXml(teamInitials(snapshot.selectedTeam))}</text>`,
    tspanLines(snapshot.selectedTeam, x + 198, y + 54, 37, { maxChars: 25, maxLines: 2, weight: 900, fill: "#101827" }),
    `<text x="${x + 198}" y="${y + 132}" font-size="25" font-weight="800" fill="#6f7b91">${escapeXml(snapshot.gameLabel || `${snapshot.selectedTeam} vs ${snapshot.opponent}`)}</text>`,
    `<text x="${x + width - 34}" y="${y + 82}" text-anchor="end" font-size="44" font-weight="900" fill="#153f7c">${escapeXml(formatOdds(snapshot.sportsbookOdds))}</text>`,
    backfill,
    pill(x + 198, y + height - 70, `${formatProbability(snapshot.modelWinProbability)} win`, { size: 24, minWidth: 160 }),
    pill(x + 390, y + height - 70, snapshot.confidenceLabel || "Confidence", { size: 24, minWidth: 150 }),
    tspanLines(reason, x + 575, y + height - 35, 24, { maxChars: 34, maxLines: 1, weight: 800, fill: "#5c6b83" })
  ].join("");
}

function renderDaily3({ content, snapshots, width, height, format }) {
  const rowHeight = format === "story" ? 250 : 220;
  const startY = format === "story" ? 330 : 285;
  const gap = format === "story" ? 34 : 24;
  return [
    header({ width, slateDate: content.slateDate, label: "DAILY 3" }),
    `<text x="66" y="${startY - 42}" font-size="30" font-weight="900" fill="#5c6b83">Frozen picks from approved Social Studio snapshots</text>`,
    snapshots.slice(0, 3).map((snapshot, index) => pickRow(snapshot, index, 66, startY + index * (rowHeight + gap), width - 132, rowHeight)).join(""),
    footer(width, height)
  ].join("");
}

function renderBestBet({ content, snapshots, width, height }) {
  const snapshot = snapshots[0];
  const reasons = (snapshot.reasons || []).slice(0, 3);
  const risk = snapshot.riskFlags?.[0] || "Confirm lineups and price before betting.";
  return [
    header({ width, slateDate: content.slateDate, label: "BEST BET" }),
    card(66, 280, width - 132, height - 430, { rx: 34, fill: "#ffffff", stroke: "#b9cff0" }),
    `<circle cx="${width - 190}" cy="395" r="76" fill="#e7f0ff" stroke="#153f7c" stroke-width="4"/>`,
    `<text x="${width - 190}" y="419" text-anchor="middle" font-size="52" font-weight="900" fill="#153f7c">${escapeXml(teamInitials(snapshot.selectedTeam))}</text>`,
    tspanLines(snapshot.selectedTeam, 116, 388, 76, { maxChars: 18, maxLines: 2, weight: 900 }),
    `<text x="116" y="540" font-size="34" font-weight="900" fill="#6f7b91">${escapeXml(snapshot.homeOrAway)} vs ${escapeXml(snapshot.opponent)}</text>`,
    `<text x="116" y="625" font-size="46" font-weight="900" fill="#153f7c">${escapeXml(snapshot.market)} ${escapeXml(formatOdds(snapshot.sportsbookOdds))}</text>`,
    pill(116, 674, `${formatProbability(snapshot.modelWinProbability)} model`, { size: 33, minWidth: 245 }),
    pill(400, 674, snapshot.confidenceLabel || "Confidence", { size: 33, minWidth: 190, fill: "#fff1f3", color: "#9f2435" }),
    `<text x="116" y="820" font-size="28" font-weight="900" fill="#6f7b91">Fair ${escapeXml(formatOdds(snapshot.fairOdds))} · Playable through ${escapeXml(formatOdds(snapshot.playableThrough))}</text>`,
    `<text x="116" y="910" font-size="32" font-weight="900" fill="#153f7c">Why it rates well</text>`,
    reasons.map((reason, index) => [
      `<circle cx="126" cy="${964 + index * 58}" r="8" fill="#c83243"/>`,
      tspanLines(reason, 150, 974 + index * 58, 28, { maxChars: 44, maxLines: 1, weight: 800, fill: "#101827" })
    ].join("")).join(""),
    `<rect x="116" y="${height - 300}" width="${width - 232}" height="104" rx="20" fill="#f9fbff" stroke="#d5e0f3" stroke-width="3"/>`,
    `<text x="142" y="${height - 252}" font-size="27" font-weight="900" fill="#c83243">Risk to watch</text>`,
    tspanLines(risk, 142, height - 210, 25, { maxChars: 58, maxLines: 2, weight: 800, fill: "#5c6b83" }),
    footer(width, height)
  ].join("");
}

function renderPickBreakdown({ content, snapshots, width, height }) {
  const snapshot = snapshots[0];
  const reasons = (snapshot.reasons || []).slice(0, 4);
  const risk = snapshot.riskFlags?.[0] || "Confirm lineups and price before betting.";
  const components = (snapshot.components || []).slice(0, 4);
  const riskY = height - 300;
  return [
    header({ width, slateDate: content.slateDate, label: "PICK BREAKDOWN" }),
    card(66, 270, width - 132, 270, { rx: 30, fill: "#f9fbff" }),
    tspanLines(`${snapshot.selectedTeam} vs ${snapshot.opponent}`, 104, 350, 52, { maxChars: 28, maxLines: 2, weight: 900 }),
    `<text x="104" y="486" font-size="38" font-weight="900" fill="#153f7c">${escapeXml(snapshot.market)} ${escapeXml(formatOdds(snapshot.sportsbookOdds))}</text>`,
    pill(width - 340, 424, `${formatProbability(snapshot.modelWinProbability)} model`, { size: 31, minWidth: 260 }),
    card(66, 590, width - 132, 180, { rx: 24, fill: "#ffffff" }),
    `<text x="104" y="656" font-size="30" font-weight="900" fill="#6f7b91">MATCHUP EDGE</text>`,
    `<text x="104" y="724" font-size="68" font-weight="900" fill="#153f7c">${escapeXml(String(snapshot.matchupEdge ?? "TBD"))}</text>`,
    `<text x="430" y="664" font-size="30" font-weight="900" fill="#6f7b91">CONFIDENCE</text>`,
    `<text x="430" y="724" font-size="44" font-weight="900" fill="#c83243">${escapeXml(snapshot.confidenceLabel || "TBD")}</text>`,
    card(66, 820, width - 132, 300, { rx: 24, fill: "#ffffff" }),
    `<text x="104" y="878" font-size="32" font-weight="900" fill="#153f7c">KEY REASONS</text>`,
    reasons.map((reason, index) => [
      `<circle cx="116" cy="${930 + index * 50}" r="7" fill="#c83243"/>`,
      tspanLines(reason, 138, 940 + index * 50, 25, { maxChars: 58, maxLines: 1, weight: 800, fill: "#101827" })
    ].join("")).join(""),
    card(66, riskY, width - 132, 96, { rx: 20, fill: "#fff7f8", stroke: "#efbbc3" }),
    `<text x="104" y="${riskY + 45}" font-size="26" font-weight="900" fill="#c83243">RISK TO WATCH</text>`,
    tspanLines(risk, 104, riskY + 80, 23, { maxChars: 70, maxLines: 1, weight: 800, fill: "#5c6b83" }),
    components.length ? `<text x="104" y="${height - 150}" font-size="23" font-weight="800" fill="#8b97ab">${escapeXml(components.map((component) => `${component.key || component.label || "Component"} ${component.score ?? ""}`.trim()).join(" · "))}</text>` : "",
    footer(width, height)
  ].join("");
}

function renderDailyResults({ content, width, height }) {
  const summary = content?.metadata?.dailyPerformance || {};
  const results = Array.isArray(content?.metadata?.results) ? content.metadata.results : [];
  const units = Number.isFinite(Number(summary.units))
    ? `${Number(summary.units) >= 0 ? "+" : ""}${Math.round(Number(summary.units) * 100) / 100}U`
    : "Units TBD";
  const record = Number.isFinite(Number(summary.wins)) && Number.isFinite(Number(summary.losses))
    ? `${summary.wins}-${summary.losses}`
    : "Record TBD";
  const resultColor = (result) => {
    if (result === "WIN") return "#1f9d55";
    if (result === "LOSS") return "#c83243";
    if (result === "MANUAL_REVIEW") return "#9a6400";
    return "#6f7b91";
  };
  const rows = results.slice(0, 7).map((result, index) => {
    const y = 512 + index * 98;
    const odds = result.frozenOdds ? formatOdds(result.frozenOdds) : "Odds unavailable";
    const unitsText = Number.isFinite(Number(result.unitsWonLost))
      ? `${Number(result.unitsWonLost) >= 0 ? "+" : ""}${Math.round(Number(result.unitsWonLost) * 100) / 100}U`
      : "";
    return [
      `<text x="116" y="${y}" font-size="31" font-weight="900" fill="#101827">${escapeXml(`${result.selectedTeam} ${result.market} ${odds}`)}</text>`,
      `<text x="${width - 260}" y="${y}" text-anchor="end" font-size="29" font-weight="900" fill="${resultColor(result.result)}">${escapeXml(result.result)}</text>`,
      `<text x="${width - 116}" y="${y}" text-anchor="end" font-size="29" font-weight="900" fill="#5c6b83">${escapeXml(unitsText)}</text>`
    ].join("");
  }).join("");
  return [
    header({ width, slateDate: content.slateDate, label: "DAILY RESULTS" }),
    card(66, 290, width - 132, 164, { rx: 30, fill: "#ffffff", stroke: "#b9cff0" }),
    `<text x="116" y="372" font-size="66" font-weight="900" fill="#153f7c">${escapeXml(record)}</text>`,
    `<text x="${width - 116}" y="372" text-anchor="end" font-size="54" font-weight="900" fill="${Number(summary.units) >= 0 ? "#1f9d55" : "#c83243"}">${escapeXml(units)}</text>`,
    `<text x="116" y="422" font-size="26" font-weight="900" fill="#6f7b91">Win percentage excludes pushes, voids, and pending picks.</text>`,
    card(66, 482, width - 132, Math.min(720, Math.max(220, results.length * 98 + 38)), { rx: 26, fill: "#f9fbff" }),
    results.length ? rows : `<text x="116" y="574" font-size="34" font-weight="900" fill="#5c6b83">No settled picks yet.</text>`,
    footer(width, height)
  ].join("");
}

function renderSocialGraphic({ content, snapshots, format = "feed" }) {
  const normalizedFormat = GRAPHIC_FORMATS[format] ? format : "feed";
  const dimensions = GRAPHIC_FORMATS[normalizedFormat];
  const safeContent = content || {};
  const safeSnapshots = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
  const renderInput = {
    content: safeContent,
    snapshots: safeSnapshots.map((snapshot) => ({
      id: snapshot.id,
      snapshotHash: snapshot.snapshotHash,
      slateDate: snapshot.slateDate,
      selectedTeam: snapshot.selectedTeam,
      opponent: snapshot.opponent,
      homeOrAway: snapshot.homeOrAway,
      gameLabel: snapshot.gameLabel,
      market: snapshot.market,
      sportsbookOdds: snapshot.sportsbookOdds,
      modelWinProbability: snapshot.modelWinProbability,
      confidenceLabel: snapshot.confidenceLabel,
      matchupEdge: snapshot.matchupEdge,
      fairOdds: snapshot.fairOdds,
      playableThrough: snapshot.playableThrough,
      reasons: snapshot.reasons,
      riskFlags: snapshot.riskFlags,
      components: snapshot.components,
      isBackfill: snapshot.isBackfill
    })),
    format: normalizedFormat,
    templateVersion: GRAPHIC_TEMPLATE_VERSION,
    renderVersion: GRAPHIC_RENDER_VERSION
  };
  const hits = prohibitedHits(renderInput);
  if (hits.length) {
    const error = new Error(`Graphic text failed claim safety: ${hits.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const { width, height } = dimensions;
  const defs = `
    <defs>
      <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#153f7c"/>
        <stop offset="72%" stop-color="#153f7c"/>
        <stop offset="100%" stop-color="#c83243"/>
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#123361" flood-opacity="0.16"/>
      </filter>
    </defs>`;
  const background = `<rect width="${width}" height="${height}" fill="#edf4ff"/><path d="M0 ${height * 0.68} L${width} ${height * 0.34} L${width} ${height} L0 ${height} Z" fill="#fff7f8" opacity="0.9"/>`;
  const contentType = safeContent.contentType || "DAILY_3";
  let body;
  if (contentType === "BEST_BET") body = renderBestBet({ content: safeContent, snapshots: safeSnapshots, width, height, format: normalizedFormat });
  else if (contentType === "PICK_BREAKDOWN") body = renderPickBreakdown({ content: safeContent, snapshots: safeSnapshots, width, height, format: normalizedFormat });
  else if (contentType === "DAILY_RESULTS") body = renderDailyResults({ content: safeContent, snapshots: safeSnapshots, width, height, format: normalizedFormat });
  else body = renderDaily3({ content: safeContent, snapshots: safeSnapshots, width, height, format: normalizedFormat });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(contentType)} Same Game Heat graphic">
    ${defs}
    ${background}
    <g filter="url(#shadow)">${body}</g>
  </svg>`;
  return {
    svg,
    width,
    height,
    format: normalizedFormat,
    mimeType: "image/svg+xml",
    templateVersion: GRAPHIC_TEMPLATE_VERSION,
    renderVersion: GRAPHIC_RENDER_VERSION,
    renderedInputHash: sha256(canonicalStringify(renderInput)),
    snapshotHashes: safeSnapshots.map((snapshot) => snapshot.snapshotHash).filter(Boolean),
    snapshotIds: safeSnapshots.map((snapshot) => snapshot.id).filter(Boolean)
  };
}

module.exports = {
  GRAPHIC_TEMPLATE_VERSION,
  GRAPHIC_RENDER_VERSION,
  GRAPHIC_FORMATS,
  RESPONSIBLE_FOOTER,
  renderSocialGraphic,
  prohibitedHits,
  canonicalStringify,
  sha256
};

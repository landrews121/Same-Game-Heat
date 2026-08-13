const crypto = require("node:crypto");

const GRAPHIC_TEMPLATE_VERSION = "social-graphics-template-v2";
const STATS_GRAPHIC_TEMPLATE_VERSION = "social-stats-template-v4";
const GRAPHIC_RENDER_VERSION = "social-graphics-renderer-v1";
const RESPONSIBLE_FOOTER = "21+ | Bet responsibly.";
const GRAPHIC_TYPES = {
  standard: "standard",
  daily_3_stats: "daily_3_stats"
};
const GRAPHIC_FORMATS = {
  feed: { width: 1080, height: 1350, label: "Feed Portrait" },
  story: { width: 1080, height: 1920, label: "Story / Reel Cover" },
  square: { width: 1080, height: 1080, label: "Square" }
};
const STATS_BOARD_LAYOUT = {
  cardX: 34,
  cardWidth: 1012,
  cardHeight: 202,
  headerY: 458,
  firstRowY: 530,
  rowGap: 10,
  rankWidth: 72,
  badgeX: 92,
  badgeSize: 92,
  teamTextX: 204,
  teamTextWidth: 250,
  metricsX: 474,
  metricsWidth: 336,
  metricBoxWidth: 104,
  metricBoxHeight: 72,
  metricColGap: 8,
  metricRowGap: 8,
  watchX: 830,
  watchWidth: 190,
  watchTextX: 888,
  watchTextWidth: 132
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

function normalizeGraphicFormat(format = "feed") {
  const rawFormat = clean(format || "feed", "feed");
  const normalizedFormat = rawFormat.toLowerCase();
  if (!GRAPHIC_FORMATS[normalizedFormat]) {
    const error = new Error(`Unsupported graphic format: ${rawFormat || "unknown"}`);
    error.statusCode = 400;
    throw error;
  }
  return normalizedFormat;
}

function normalizeGraphicType(graphicType = "standard") {
  const normalizedType = clean(graphicType || "standard", "standard").toLowerCase();
  if (!Object.values(GRAPHIC_TYPES).includes(normalizedType)) {
    const error = new Error(`Unsupported graphic type: ${graphicType || "unknown"}`);
    error.statusCode = 400;
    throw error;
  }
  return normalizedType;
}

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

const MLB_TEAM_ABBREVIATIONS = new Map([
  ["arizona diamondbacks", "ARI"],
  ["atlanta braves", "ATL"],
  ["baltimore orioles", "BAL"],
  ["boston red sox", "BOS"],
  ["chicago cubs", "CHC"],
  ["chicago white sox", "CWS"],
  ["cincinnati reds", "CIN"],
  ["cleveland guardians", "CLE"],
  ["colorado rockies", "COL"],
  ["detroit tigers", "DET"],
  ["houston astros", "HOU"],
  ["kansas city royals", "KC"],
  ["los angeles angels", "LAA"],
  ["los angeles dodgers", "LAD"],
  ["miami marlins", "MIA"],
  ["milwaukee brewers", "MIL"],
  ["minnesota twins", "MIN"],
  ["new york mets", "NYM"],
  ["new york yankees", "NYY"],
  ["athletics", "ATH"],
  ["oakland athletics", "OAK"],
  ["philadelphia phillies", "PHI"],
  ["pittsburgh pirates", "PIT"],
  ["san diego padres", "SD"],
  ["san francisco giants", "SF"],
  ["seattle mariners", "SEA"],
  ["st. louis cardinals", "STL"],
  ["st louis cardinals", "STL"],
  ["tampa bay rays", "TB"],
  ["texas rangers", "TEX"],
  ["toronto blue jays", "TOR"],
  ["washington nationals", "WSH"]
]);

function teamAbbreviation(name) {
  const key = clean(name).toLowerCase();
  return MLB_TEAM_ABBREVIATIONS.get(key) || teamInitials(name).slice(0, 3);
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

function textLines(text, x, y, size, options = {}) {
  const maxChars = options.maxChars || Math.max(18, Math.floor(680 / (size * 0.55)));
  const lines = wrapText(text, maxChars, options.maxLines || 3);
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * (options.lineHeight || size * 1.16)}" font-size="${size}" font-weight="${options.weight || 800}" fill="${options.fill || "#101827"}" ${options.anchor ? `text-anchor="${options.anchor}"` : ""}>${escapeXml(line)}</text>`
  ).join("");
}

function estimateTextWidth(text, fontSize) {
  return clean(text).split("").reduce((width, char) => {
    if (char === " ") return width + fontSize * 0.32;
    if (/[A-Z]/.test(char)) return width + fontSize * 0.66;
    if (/[0-9]/.test(char)) return width + fontSize * 0.58;
    if (/[-+./]/.test(char)) return width + fontSize * 0.36;
    return width + fontSize * 0.53;
  }, 0);
}

function wrapTextToWidth(text, maxWidth, fontSize, maxLines = 2) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (current && estimateTextWidth(next, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 4 && estimateTextWidth(`${last}...`, fontSize) > maxWidth) {
    last = last.slice(0, -1).trim();
  }
  kept[maxLines - 1] = `${last}...`;
  return kept;
}

function fitTextToWidth(text, maxWidth, options = {}) {
  const preferred = options.preferred || 42;
  const minimum = options.min || 30;
  const maxLines = options.maxLines || 2;
  for (let fontSize = preferred; fontSize >= minimum; fontSize -= 1) {
    if (estimateTextWidth(text, fontSize) <= maxWidth) {
      return { fontSize, lines: [clean(text)], maxLineWidth: estimateTextWidth(text, fontSize) };
    }
  }
  for (let fontSize = preferred; fontSize >= minimum; fontSize -= 1) {
    const lines = wrapTextToWidth(text, maxWidth, fontSize, maxLines);
    if (lines.every((line) => estimateTextWidth(line, fontSize) <= maxWidth)) {
      return {
        fontSize,
        lines,
        maxLineWidth: Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)), 0)
      };
    }
  }
  const lines = wrapTextToWidth(text, maxWidth, minimum, maxLines);
  return {
    fontSize: minimum,
    lines,
    maxLineWidth: Math.max(...lines.map((line) => estimateTextWidth(line, minimum)), 0)
  };
}

function renderFittedText(text, x, y, maxWidth, options = {}) {
  const fitted = fitTextToWidth(text, maxWidth, options);
  const lineHeight = options.lineHeight || fitted.fontSize * 1.08;
  return fitted.lines.map((line, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" font-size="${fitted.fontSize}" font-weight="${options.weight || 900}" fill="${options.fill || "#ffffff"}">${escapeXml(line)}</text>`
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

function renderClassicDaily3({ content, snapshots, width, height, format }) {
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

function daily3Reason(snapshot) {
  const reason = clean(snapshot.reasons?.[0] || snapshot.passReasons?.[0] || "Model liked the matchup profile.");
  return reason.replace(/\s+/g, " ");
}

function reasonIconType(reason) {
  const text = clean(reason).toLowerCase();
  if (/starter|pitch|ace|mound|rotation/.test(text)) return "baseball";
  if (/home|park|stadium|field/.test(text)) return "home";
  if (/rest|schedule|travel|day off/.test(text)) return "calendar";
  if (/bullpen|relief|closer/.test(text)) return "bullpen";
  if (/market|odds|price|line/.test(text)) return "chart";
  return "baseball";
}

function reasonIcon(type, x, y) {
  const color = "#0b4c9c";
  if (type === "home") {
    return `<path d="M${x} ${y + 22} L${x + 24} ${y} L${x + 48} ${y + 22} V${y + 54} H${x + 12} V${y + 28} H${x + 36} V${y + 54} H${x} Z" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round"/>`;
  }
  if (type === "calendar") {
    return `<rect x="${x + 3}" y="${y + 8}" width="45" height="44" rx="5" fill="none" stroke="${color}" stroke-width="5"/><path d="M${x + 3} ${y + 22} H${x + 48}" stroke="${color}" stroke-width="5"/><path d="M${x + 15} ${y} V${y + 14} M${x + 36} ${y} V${y + 14}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  }
  if (type === "bullpen") {
    return `<path d="M${x + 8} ${y + 48} C${x + 8} ${y + 12}, ${x + 42} ${y + 12}, ${x + 42} ${y + 48}" fill="none" stroke="${color}" stroke-width="5"/><path d="M${x + 16} ${y + 48} V${y + 28} H${x + 34} V${y + 48}" fill="none" stroke="${color}" stroke-width="5"/>`;
  }
  if (type === "chart") {
    return `<path d="M${x + 2} ${y + 52} H${x + 52}" stroke="${color}" stroke-width="5"/><path d="M${x + 10} ${y + 42} L${x + 22} ${y + 30} L${x + 32} ${y + 35} L${x + 48} ${y + 12}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<circle cx="${x + 26}" cy="${y + 28}" r="23" fill="none" stroke="#b10f24" stroke-width="5"/><path d="M${x + 12} ${y + 12} C${x + 22} ${y + 24}, ${x + 22} ${y + 34}, ${x + 12} ${y + 44} M${x + 40} ${y + 12} C${x + 30} ${y + 24}, ${x + 30} ${y + 34}, ${x + 40} ${y + 44}" fill="none" stroke="#b10f24" stroke-width="4"/>`;
}

function stadiumDefs(width, height) {
  return `
    <radialGradient id="daily3Light" cx="12%" cy="4%" r="38%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="18%" stop-color="#b8d7ff" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#07162f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="stadiumBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#061733"/>
      <stop offset="50%" stop-color="#0b2448"/>
      <stop offset="100%" stop-color="#070b16"/>
    </linearGradient>
    <linearGradient id="redHeat" x1="80%" y1="10%" x2="100%" y2="70%">
      <stop offset="0%" stop-color="#ff293f" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#860014" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="fieldDirt" x1="0%" y1="35%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#153916"/>
      <stop offset="42%" stop-color="#6b351b"/>
      <stop offset="100%" stop-color="#091f18"/>
    </linearGradient>
    <pattern id="daily3Grain" patternUnits="userSpaceOnUse" width="18" height="18">
      <circle cx="2" cy="3" r="1.1" fill="#ffffff" opacity="0.12"/>
      <circle cx="12" cy="11" r="0.9" fill="#ffffff" opacity="0.08"/>
      <circle cx="7" cy="16" r="0.8" fill="#c83243" opacity="0.12"/>
    </pattern>
    <pattern id="distress" patternUnits="userSpaceOnUse" width="46" height="30">
      <rect width="46" height="30" fill="#ffffff"/>
      <path d="M4 4 H18 M25 8 H43 M8 18 H29 M35 24 H45" stroke="#0b1d3e" stroke-width="3" opacity="0.32"/>
      <circle cx="32" cy="15" r="3" fill="#0b1d3e" opacity="0.22"/>
    </pattern>
    <clipPath id="daily3SafeClip"><rect x="0" y="0" width="${width}" height="${height}" rx="0"/></clipPath>`;
}

function renderDaily3BrandMark(width) {
  return [
    `<g transform="translate(${width - 270},72)">`,
    `<path d="M96 0 C134 4 159 30 165 67 C137 82 108 100 92 132 C70 103 40 86 3 72 C9 31 42 2 96 0 Z" fill="#c90924" opacity="0.96"/>`,
    `<path d="M42 88 C66 48 106 33 154 29 C124 45 107 68 98 96 C84 75 66 76 42 88 Z" fill="#ff394c"/>`,
    `<text x="83" y="90" text-anchor="middle" font-size="58" font-weight="900" font-style="italic" fill="#ffffff" stroke="#07162f" stroke-width="3">SGH</text>`,
    `</g>`,
    `<g transform="translate(${width - 250},250)">`,
    `<rect x="0" y="0" width="170" height="55" rx="8" fill="#ffffff"/>`,
    `<rect x="7" y="7" width="156" height="41" rx="6" fill="#153f7c"/>`,
    `<text x="76" y="39" text-anchor="middle" font-size="34" font-weight="900" fill="#ffffff" font-style="italic">MLB</text>`,
    `<circle cx="136" cy="27" r="11" fill="#ffffff"/>`,
    `<path d="M148 17 L159 27 L148 37" fill="#c83243"/>`,
    `</g>`
  ].join("");
}

function renderDaily3Header({ width, slateDate }) {
  return [
    `<rect x="0" y="0" width="${width}" height="1350" fill="url(#stadiumBg)"/>`,
    `<path d="M0 420 C240 320 500 365 720 290 C870 238 1002 166 1080 92 V1350 H0 Z" fill="url(#fieldDirt)" opacity="0.95"/>`,
    `<path d="M755 -40 L1080 -40 V432 C946 377 845 328 746 277 Z" fill="url(#redHeat)" opacity="0.95"/>`,
    `<path d="M716 0 L650 405" stroke="#ffffff" stroke-width="5" opacity="0.88"/>`,
    `<path d="M0 0 H1080 V1350 H0 Z" fill="url(#daily3Light)"/>`,
    `<rect x="0" y="0" width="${width}" height="1350" fill="url(#daily3Grain)" opacity="0.8"/>`,
    `<g opacity="0.55">`,
    `<circle cx="54" cy="40" r="9" fill="#ffffff"/><circle cx="84" cy="52" r="7" fill="#ffffff"/><circle cx="41" cy="72" r="6" fill="#ffffff"/>`,
    `<path d="M0 372 C230 330 372 340 548 302 C632 284 703 261 760 232" fill="none" stroke="#d9e8ff" stroke-width="4" opacity="0.25"/>`,
    `<path d="M0 524 C190 470 348 490 520 432 C646 390 733 337 806 277" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.18"/>`,
    `</g>`,
    `<text x="86" y="98" font-size="48" font-weight="900" letter-spacing="12" fill="#ffffff" opacity="0.96">SAME GAME HEAT</text>`,
    `<text x="76" y="268" font-size="152" font-weight="900" letter-spacing="2" fill="url(#distress)" stroke="#ffffff" stroke-width="2">DAILY 3</text>`,
    `<path d="M72 322 H160 M196 322 H240 M276 322 H320 M356 322 H400" stroke="#c90924" stroke-width="8"/>`,
    `<text x="128" y="398" font-size="48" font-weight="900" letter-spacing="4" fill="#ffffff">${escapeXml(shortDate(slateDate))}</text>`,
    `<path d="M80 350 H410 L382 426 H52 Z" fill="#c90924"/>`,
    `<text x="128" y="398" font-size="48" font-weight="900" letter-spacing="4" fill="#ffffff">${escapeXml(shortDate(slateDate))}</text>`,
    renderDaily3BrandMark(width)
  ].join("");
}

function renderDaily3Card(snapshot, index, y) {
  const x = 58;
  const width = 970;
  const height = 218;
  const teamName = clean(snapshot.selectedTeam, "Team TBD");
  const abbreviation = teamAbbreviation(teamName);
  const reason = daily3Reason(snapshot);
  const iconType = reasonIconType(reason);
  const teamFont = teamName.length > 24 ? 39 : teamName.length > 18 ? 43 : 56;
  const teamLines = wrapText(teamName, teamName.length > 24 ? 21 : 19, 2);
  const moneylineY = teamLines.length > 1 ? y + 144 : y + 126;
  return [
    `<g class="daily3-pick-card" data-rank="${index + 1}">`,
    `<title>${escapeXml(`${index + 1}. ${teamName} ${formatOdds(snapshot.sportsbookOdds)}`)}</title>`,
    `<desc>${escapeXml(`${teamName} moneyline ${formatOdds(snapshot.sportsbookOdds)}. ${reason}`)}</desc>`,
    `<path d="M${x + 12} ${y} H${x + width - 12} Q${x + width} ${y} ${x + width} ${y + 24} V${y + height - 24} Q${x + width} ${y + height} ${x + width - 24} ${y + height} H${x + 12} Q${x} ${y + height} ${x + 5} ${y + height - 24} L${x + 52} ${y + 26} Q${x + 58} ${y} ${x + 82} ${y} Z" fill="#fdfdfd" stroke="#ffffff" stroke-width="3"/>`,
    `<path d="M${x + 54} ${y + 5} L${x + 2} ${y + height - 2} H${x + 48} L${x + 104} ${y + 5} Z" fill="#0b4c9c"/>`,
    `<circle cx="${x + 30}" cy="${y + 66}" r="46" fill="#061733" stroke="#ffffff" stroke-width="5"/>`,
    `<text x="${x + 30}" y="${y + 83}" text-anchor="middle" font-size="54" font-weight="900" fill="#ffffff">${index + 1}</text>`,
    `<circle cx="${x + 176}" cy="${y + 110}" r="76" fill="#07162f" stroke="#d6dde8" stroke-width="6"/>`,
    `<circle cx="${x + 176}" cy="${y + 110}" r="66" fill="#0b2e63" stroke="#6fa4d8" stroke-width="4"/>`,
    `<text x="${x + 176}" y="${y + 132}" text-anchor="middle" font-size="${abbreviation.length > 3 ? 46 : 58}" font-weight="900" fill="#ffffff" letter-spacing="1">${escapeXml(abbreviation)}</text>`,
    teamLines.map((line, lineIndex) => `<text x="${x + 290}" y="${y + 78 + lineIndex * (teamFont * 1.08)}" font-size="${teamFont}" font-weight="900" fill="#071943">${escapeXml(line)}</text>`).join(""),
    `<text x="${x + 292}" y="${moneylineY}" font-size="29" font-weight="900" fill="#b10f24" letter-spacing="2">MONEYLINE</text>`,
    `<text x="${x + width - 34}" y="${y + 96}" text-anchor="end" font-size="74" font-weight="900" font-style="italic" fill="#071943">${escapeXml(formatOdds(snapshot.sportsbookOdds))}</text>`,
    `<line x1="${x + 692}" y1="${y + 126}" x2="${x + 692}" y2="${y + 180}" stroke="#c9ced8" stroke-width="3"/>`,
    reasonIcon(iconType, x + 724, y + 128),
    textLines(reason, x + 790, y + 150, 25, { maxChars: 19, maxLines: 2, weight: 900, fill: "#071943", lineHeight: 31 }),
    `</g>`
  ].join("");
}

function renderDaily3Footer(width, height) {
  return [
    `<path d="M0 ${height - 126} C212 ${height - 88} 410 ${height - 134} 600 ${height - 102} C812 ${height - 68} 958 ${height - 100} ${width} ${height - 76} V${height} H0 Z" fill="#061733" opacity="0.96"/>`,
    `<path d="M824 ${height - 92} C906 ${height - 132} 1005 ${height - 153} 1080 ${height - 172} V${height} H760 Z" fill="#c90924" opacity="0.86"/>`,
    `<path d="M66 ${height - 80} l26 -14 l26 14 v38 l-26 18 l-26 -18 z" fill="#0b4c9c" stroke="#ffffff" stroke-width="3"/>`,
    `<path d="M82 ${height - 62} C90 ${height - 82} 104 ${height - 82} 112 ${height - 62} C104 ${height - 69} 91 ${height - 69} 82 ${height - 62} Z" fill="#c90924"/>`,
    `<text x="158" y="${height - 55}" font-size="30" font-weight="900" fill="#ffffff">${escapeXml(RESPONSIBLE_FOOTER)}</text>`,
    `<line x1="445" y1="${height - 90}" x2="445" y2="${height - 34}" stroke="#c90924" stroke-width="4"/>`,
    `<text x="506" y="${height - 55}" font-size="30" font-weight="900" fill="#ffffff">Research, not a guarantee.</text>`
  ].join("");
}

function validMetricValue(value) {
  const text = clean(value);
  if (!text) return false;
  return !/^(n\/a|na|tbd|unavailable|unknown|null|undefined)$/i.test(text);
}

function recordMetricValue(record) {
  if (!record || !Number.isFinite(Number(record.wins)) || !Number.isFinite(Number(record.losses))) return "";
  return `${record.wins}-${record.losses}`;
}

function addMetric(metrics, label, value) {
  if (!validMetricValue(value) || metrics.some((metric) => metric.label === label)) return;
  metrics.push({ label, value: clean(value) });
}

function firstValid(...values) {
  return values.find(validMetricValue) || "";
}

function formatEra(value) {
  if (!validMetricValue(value)) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : clean(value);
}

function trimNumericStat(value) {
  const text = clean(value);
  return text.replace(/\s+R\/G$/i, "").replace(/\s+ERA$/i, "");
}

function statCell(label, value, x, y, width, options = {}) {
  const display = validMetricValue(value) ? trimNumericStat(value) : "Unavailable";
  const labelSize = label.length > 8 ? 13 : label.length > 6 ? 15 : 16;
  const fittedValue = fitTextToWidth(display, width - 14, { preferred: options.valueSize || 25, min: 15, maxLines: 1 });
  const valueSize = fittedValue.fontSize;
  const unit = validMetricValue(value) && /\s+ERA$/i.test(clean(value)) ? "ERA" : "";
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${options.height || 86}" rx="12" fill="${options.fill || "#07162f"}" stroke="${options.stroke || "#244f85"}" stroke-width="2"/>`,
    `<text x="${x + width / 2}" y="${y + 27}" text-anchor="middle" font-size="${labelSize}" font-weight="900" letter-spacing="0.6" fill="${options.labelColor || "#8fb7e7"}">${escapeXml(label)}</text>`,
    `<text x="${x + width / 2}" y="${y + (unit ? 54 : 58)}" text-anchor="middle" font-size="${valueSize}" font-weight="900" fill="${options.valueColor || "#ffffff"}">${escapeXml(fittedValue.lines[0] || display)}</text>`,
    unit ? `<text x="${x + width / 2}" y="${y + 68}" text-anchor="middle" font-size="12" font-weight="900" fill="${options.labelColor || "#8fb7e7"}">${unit}</text>` : ""
  ].join("");
}

function compactStat(label, value) {
  return { label, value: validMetricValue(value) ? clean(value) : "Unavailable" };
}

function shortTeamLabel(teamName) {
  const words = clean(teamName).split(/\s+/).filter(Boolean);
  return words.at(-1) || "Team";
}

function formatStatsBoardWatchText(text, teamName, opponent) {
  const raw = clean(text);
  if (!raw) return "Watch matchup context.";

  const starterEra = raw.match(/(?:opponent\s+)?starter(?:\s+[A-Za-z.'-]+)*\s+(?:owns|has|carries)\s+(?:a\s+)?([\d.]+)(?:\s+season)?\s+ERA/i)
    || raw.match(/(?:opponent\s+)?starter[^.]*?([\d.]+)\s+(?:season\s+)?ERA/i);
  if (starterEra) return `Opp. starter: ${starterEra[1]} ERA`;

  const record = raw.match(/^(.*?)\s+(?:is|went)\s+(\d+-\d+)\s+in\s+(?:its|their|the)\s+last\s+10\s+games?/i);
  if (record) return `${teamAbbreviation(record[1])}: ${record[2]} last 10`;

  const runs = raw.match(/^(.*?)\s+(?:has|have)\s+averaged\s+([\d.]+)\s+runs?\s+(?:over|in)\s+(?:its|their|the)\s+last\s+10/i);
  if (runs) return `${teamAbbreviation(runs[1])}: ${runs[2]} runs/game L10`;

  let shortened = raw;
  const selected = clean(teamName);
  const opp = clean(opponent);
  if (selected) shortened = shortened.replaceAll(selected, teamAbbreviation(selected));
  if (opp) shortened = shortened.replaceAll(opp, teamAbbreviation(opp));
  shortened = shortened
    .replace(/\bin its last\s+/gi, "last ")
    .replace(/\bowns a\s+/gi, "")
    .replace(/\bowns the\s+/gi, "")
    .replace(/\bhas been\s+/gi, "")
    .replace(/\bprofile\b/gi, "")
    .replace(/\bseason ERA\b/gi, "ERA")
    .replace(/\s+/g, " ")
    .trim();
  if (/starter/i.test(shortened)) shortened = shortened.replace(/opponent starter/i, "Opp. starter");
  return shortened || "Watch matchup context.";
}

function shortenStatsWatch(text, teamName, opponent) {
  return formatStatsBoardWatchText(text, teamName, opponent);
}

function isRedundantStatsSentence(text, details) {
  const normalized = clean(text).toLowerCase();
  if (!normalized) return true;
  return details.stats.some((metric) => {
    if (!validMetricValue(metric.value) || metric.value === "Unavailable") return false;
    const value = trimNumericStat(metric.value).toLowerCase();
    if (!value || !normalized.includes(value)) return false;
    if (metric.label === "LAST 10" && /last 10/.test(normalized)) return true;
    if (metric.label === "LAST 5" && /last 5/.test(normalized)) return true;
    if ((metric.label === "RUNS/G" || metric.label === "OPS") && normalized.includes(metric.label.toLowerCase().replace("/", ""))) return true;
    return false;
  });
}

function renderWatchText(text, x, y, width, options = {}) {
  const lines = wrapTextToWidth(text, width, options.size || 16, options.maxLines || 4);
  return lines.map((line, index) =>
    `<text x="${x}" y="${y + index * (options.lineHeight || 21)}" font-size="${options.size || 16}" font-weight="${options.weight || 800}" fill="${options.fill || "#ffffff"}">${escapeXml(line)}</text>`
  ).join("");
}

function statsBoardPickDetails({ snapshot, pick }) {
  const selectedTeam = pick?.selectedTeam || {};
  const opponentTeam = pick?.opponentTeam || {};
  const selectedPitcher = pick?.selectedPitcher || {};
  const teamName = clean(snapshot?.selectedTeam || selectedTeam.name, "Team TBD");
  const opponent = clean(snapshot?.opponent || opponentTeam.name, "Opponent TBD");
  const venue = selectedTeam.homeAway || snapshot?.homeOrAway || "Venue";
  const last3Era = formatEra(selectedPitcher.last3Starts?.era);
  const starterName = firstValid(selectedPitcher.name, "Starter TBD");
  const starterLine = last3Era ? `${last3Era} ERA` : firstValid(selectedPitcher.season?.era, "Starter TBD");
  const starterNote = validMetricValue(starterName) && starterName !== "Starter TBD"
    ? wrapText(starterName, 18, 1)[0]
    : "Probable starter";
  const offense = selectedTeam.offense || {};
  const runs = validMetricValue(offense.runsPerGame) ? String(offense.runsPerGame) : "";
  const homeRuns = firstValid(offense.homeRuns, offense.hr);
  const supporting = clean((pick?.supportingStats || []).find(validMetricValue), "Verified stats pending.");
  const watch = clean(pick?.riskStat || (pick?.unavailable || []).find(validMetricValue), "");
  return {
    teamName,
    opponent,
    abbreviation: teamAbbreviation(teamName),
    odds: formatOdds(snapshot?.sportsbookOdds),
    matchup: `${teamName} vs ${opponent}`,
    venue,
    starterNote,
    supporting,
    watch,
    stats: [
      compactStat("LAST 10", recordMetricValue(selectedTeam.recentForm?.last10)),
      compactStat("LAST 5", recordMetricValue(selectedTeam.recentForm?.last5)),
      compactStat(venue.toUpperCase(), recordMetricValue(selectedTeam.relevantRecord)),
      compactStat("STARTER L3", starterLine),
      compactStat("RUNS/G", runs),
      compactStat("OPS", offense.ops),
      compactStat("HR", homeRuns),
      compactStat("H2H", recordMetricValue(selectedTeam.headToHead))
    ]
  };
}

function selectStatsBoardMetrics(pick = {}) {
  const selectedTeam = pick.selectedTeam || {};
  const selectedPitcher = pick.selectedPitcher || {};
  const metrics = [];
  addMetric(metrics, "LAST 10", recordMetricValue(selectedTeam.recentForm?.last10));
  addMetric(metrics, "LAST 5", recordMetricValue(selectedTeam.recentForm?.last5));
  addMetric(metrics, selectedTeam.homeAway || "VENUE", recordMetricValue(selectedTeam.relevantRecord));
  if (selectedPitcher.last3Starts?.era !== null && selectedPitcher.last3Starts?.era !== undefined) {
    const era = Number(selectedPitcher.last3Starts.era);
    addMetric(metrics, "STARTER L3", `${Number.isFinite(era) ? era.toFixed(2) : selectedPitcher.last3Starts.era} ERA`);
  }
  addMetric(metrics, "SP ERA", selectedPitcher.season?.era);
  if (selectedTeam.offense?.runsPerGame !== null && selectedTeam.offense?.runsPerGame !== undefined) {
    addMetric(metrics, "RUNS/G", selectedTeam.offense.runsPerGame);
  }
  addMetric(metrics, "OPS", selectedTeam.offense?.ops);
  addMetric(metrics, "H2H", recordMetricValue(selectedTeam.headToHead));
  return metrics.slice(0, 4);
}

function renderStatsBoardHeader({ width, slateDate }) {
  return [
    `<rect x="0" y="0" width="${width}" height="1350" fill="url(#stadiumBg)"/>`,
    `<path d="M0 410 C218 330 474 372 710 286 C858 232 992 146 1080 80 V1350 H0 Z" fill="url(#fieldDirt)" opacity="0.96"/>`,
    `<path d="M734 -50 L1080 -50 V448 C938 374 836 326 725 278 Z" fill="url(#redHeat)" opacity="0.98"/>`,
    `<path d="M716 0 L646 430" stroke="#ffffff" stroke-width="5" opacity="0.78"/>`,
    `<path d="M0 0 H1080 V1350 H0 Z" fill="url(#daily3Light)"/>`,
    `<rect x="0" y="0" width="${width}" height="1350" fill="url(#daily3Grain)" opacity="0.8"/>`,
    `<rect x="0" y="0" width="${width}" height="54" fill="#c90924" opacity="0.97"/>`,
    `<text x="26" y="37" font-size="24" font-weight="900" font-style="italic" letter-spacing="1.2" fill="#ffffff">SAME GAME HEAT</text>`,
    `<text x="287" y="37" font-size="24" font-weight="900" font-style="italic" letter-spacing="1.2" fill="#ffffff">SAME GAME HEAT</text>`,
    `<text x="548" y="37" font-size="24" font-weight="900" font-style="italic" letter-spacing="1.2" fill="#ffffff">SAME GAME HEAT</text>`,
    `<text x="809" y="37" font-size="24" font-weight="900" font-style="italic" letter-spacing="1.2" fill="#ffffff">SAME GAME HEAT</text>`,
    `<text x="84" y="122" font-size="39" font-weight="900" letter-spacing="9" fill="#ffffff">SAME GAME HEAT</text>`,
    `<text x="80" y="262" font-size="125" font-weight="900" letter-spacing="2" fill="url(#distress)" stroke="#ffffff" stroke-width="2">DAILY 3</text>`,
    `<text x="220" y="354" font-size="76" font-weight="900" letter-spacing="3" fill="#c90924">STATS BOARD</text>`,
    `<line x1="284" y1="393" x2="410" y2="393" stroke="#c90924" stroke-width="4"/>`,
    `<line x1="670" y1="393" x2="796" y2="393" stroke="#c90924" stroke-width="4"/>`,
    `<text x="432" y="407" font-size="30" font-weight="900" letter-spacing="1.5" fill="#ffffff">${escapeXml(shortDate(slateDate))}</text>`,
    `<text x="80" y="444" font-size="22" font-weight="900" fill="#c5d7f1">Verified MLB stats for today's Daily 3 picks</text>`,
    renderDaily3BrandMark(width)
  ].join("");
}

function renderStatsBoardCard({ snapshot, pick, index, y }) {
  const layout = STATS_BOARD_LAYOUT;
  const x = layout.cardX;
  const width = layout.cardWidth;
  const height = layout.cardHeight;
  const details = statsBoardPickDetails({ snapshot, pick });
  const teamClip = `stats-team-clip-${index + 1}`;
  const metricsClip = `stats-metrics-clip-${index + 1}`;
  const watchClip = `stats-watch-clip-${index + 1}`;
  const teamText = fitTextToWidth(details.teamName, layout.teamTextWidth, { preferred: 34, min: 25, maxLines: 2 });
  const teamLineHeight = Math.max(28, teamText.fontSize * 1.04);
  const teamNameBlock = teamText.lines.map((line, lineIndex) =>
    `<text x="${layout.teamTextX}" y="${y + 50 + lineIndex * teamLineHeight}" font-size="${teamText.fontSize}" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`
  ).join("");
  const moneylineY = y + 120;
  const matchupY = y + 148;
  const matchupLines = wrapTextToWidth(`vs ${details.opponent}`, layout.teamTextWidth, 15, 2);
  const primaryStats = details.stats.slice(0, 6);
  const supportIsDuplicate = isRedundantStatsSentence(details.supporting, details);
  const watchSource = supportIsDuplicate ? details.watch : (details.watch || details.supporting);
  const watchLine = shortenStatsWatch(watchSource, details.teamName, details.opponent);
  return [
    `<g class="daily3-stats-card" data-rank="${index + 1}">`,
    `<title>${escapeXml(`${index + 1}. ${details.teamName} stats board ${details.odds}`)}</title>`,
    `<desc>${escapeXml(`${details.teamName} moneyline ${details.odds}. ${watchLine}`)}</desc>`,
    `<clipPath id="${teamClip}"><rect x="${layout.teamTextX}" y="${y + 18}" width="${layout.teamTextWidth}" height="${height - 28}"/></clipPath>`,
    `<clipPath id="${metricsClip}"><rect x="${layout.metricsX}" y="${y + 18}" width="${layout.metricsWidth}" height="${height - 36}"/></clipPath>`,
    `<clipPath id="${watchClip}"><rect x="${layout.watchX}" y="${y + 18}" width="${layout.watchWidth}" height="${height - 36}"/></clipPath>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="#051222" stroke="#6f89aa" stroke-width="2" opacity="0.96"/>`,
    `<rect x="${x}" y="${y}" width="${layout.rankWidth}" height="${height}" rx="16" fill="#b7081c"/>`,
    `<rect x="${x + 48}" y="${y}" width="38" height="${height}" fill="#b7081c"/>`,
    `<text x="${x + 38}" y="${y + 108}" text-anchor="middle" font-size="63" font-weight="900" fill="#ffffff">${index + 1}</text>`,
    `<line x1="${x + layout.rankWidth}" y1="${y}" x2="${x + layout.rankWidth}" y2="${y + height}" stroke="#ffffff" stroke-width="1.5" opacity="0.35"/>`,
    `<circle cx="${layout.badgeX + layout.badgeSize / 2}" cy="${y + height / 2}" r="${layout.badgeSize / 2}" fill="#07162f" stroke="#ffffff" stroke-width="4"/>`,
    `<circle cx="${layout.badgeX + layout.badgeSize / 2}" cy="${y + height / 2}" r="${layout.badgeSize / 2 - 9}" fill="#0b4c9c" stroke="#75a8df" stroke-width="3"/>`,
    `<text x="${layout.badgeX + layout.badgeSize / 2}" y="${y + height / 2 + 14}" text-anchor="middle" font-size="${details.abbreviation.length > 3 ? 27 : 34}" font-weight="900" fill="#ffffff">${escapeXml(details.abbreviation)}</text>`,
    `<g clip-path="url(#${teamClip})">`,
    teamNameBlock,
    `<text x="${layout.teamTextX}" y="${moneylineY}" font-size="18" font-weight="900" fill="#ec2037" letter-spacing="1.3">MONEYLINE ${escapeXml(details.odds)}</text>`,
    matchupLines.map((line, lineIndex) => `<text x="${layout.teamTextX}" y="${matchupY + lineIndex * 18}" font-size="15" font-weight="800" fill="#9fb4ce">${escapeXml(line)}</text>`).join(""),
    `</g>`,
    `<line x1="${layout.metricsX - 14}" y1="${y + 24}" x2="${layout.metricsX - 14}" y2="${y + height - 24}" stroke="#d7e4f5" stroke-width="1.5" opacity="0.20"/>`,
    `<g clip-path="url(#${metricsClip})">`,
    primaryStats.map((metric, metricIndex) => {
      const col = metricIndex % 3;
      const row = Math.floor(metricIndex / 3);
      return statCell(
        metric.label,
        metric.value,
        layout.metricsX + col * (layout.metricBoxWidth + layout.metricColGap),
        y + 24 + row * (layout.metricBoxHeight + layout.metricRowGap),
        layout.metricBoxWidth,
        { height: layout.metricBoxHeight }
      );
    }).join(""),
    `</g>`,
    `<line x1="${layout.watchX - 18}" y1="${y + 24}" x2="${layout.watchX - 18}" y2="${y + height - 24}" stroke="#d7e4f5" stroke-width="2" opacity="0.32"/>`,
    `<g clip-path="url(#${watchClip})">`,
    reasonIcon(reasonIconType(watchLine), layout.watchX, y + 30),
    `<text x="${layout.watchX + 56}" y="${y + 48}" font-size="18" font-weight="900" fill="#ff344a" letter-spacing="1">WATCH</text>`,
    renderWatchText(watchLine, layout.watchTextX, y + 82, layout.watchTextWidth, { size: 14, maxLines: 4, lineHeight: 18 }),
    `</g>`,
    `</g>`
  ].join("");
}

function renderDaily3StatsBoard({ content, snapshots, pickStats, width, height }) {
  const picks = snapshots.slice(0, 3);
  const statsPicks = Array.isArray(pickStats?.picks) ? pickStats.picks : [];
  const bySnapshotId = new Map(statsPicks.map((pick) => [clean(pick.snapshotId), pick]));
  const layout = STATS_BOARD_LAYOUT;
  return [
    renderStatsBoardHeader({ width, slateDate: content.slateDate || picks[0]?.slateDate || pickStats?.slateDate }),
    `<rect x="${layout.cardX}" y="${layout.headerY}" width="${layout.cardWidth}" height="50" rx="14" fill="#061733" stroke="#6f89aa" stroke-width="2" opacity="0.96"/>`,
    `<text x="${layout.cardX + 40}" y="${layout.headerY + 33}" font-size="19" font-weight="900" letter-spacing="2" fill="#ffffff">#</text>`,
    `<text x="${layout.badgeX + 28}" y="${layout.headerY + 33}" font-size="19" font-weight="900" letter-spacing="1.4" fill="#ffffff">PICK</text>`,
    `<text x="${layout.metricsX + 20}" y="${layout.headerY + 33}" font-size="19" font-weight="900" letter-spacing="1.4" fill="#ffffff">RECENT / STARTER / OFFENSE</text>`,
    `<text x="${layout.watchX + 2}" y="${layout.headerY + 33}" font-size="19" font-weight="900" letter-spacing="1.4" fill="#ffffff">WATCH</text>`,
    picks.map((snapshot, index) => renderStatsBoardCard({
      snapshot,
      pick: bySnapshotId.get(clean(snapshot.id)) || { selectedTeam: { name: snapshot.selectedTeam }, unavailable: ["Verified stats pending"] },
      index,
      y: layout.firstRowY + index * (layout.cardHeight + layout.rowGap)
    })).join(""),
    `<rect x="34" y="1164" width="1012" height="92" rx="16" fill="#061733" stroke="#6f89aa" stroke-width="2" opacity="0.96"/>`,
    `<text x="92" y="1204" font-size="23" font-weight="900" fill="#ffffff">TEAM OPS / RUNS / STARTER FORM</text>`,
    `<text x="92" y="1236" font-size="20" font-weight="800" fill="#9fb4ce">Built from verified Daily Pick Stats. Missing data is shown as unavailable, not guessed.</text>`,
    `<text x="${width - 84}" y="1234" text-anchor="end" font-size="21" font-weight="900" fill="#ff344a">@sg_heater</text>`,
    `<text x="${width - 84}" y="${height - 154}" text-anchor="end" font-size="20" font-weight="900" fill="#d8e7ff">Stats: ${escapeXml(pickStats?.source || "MLB Stats API")}</text>`,
    renderDaily3Footer(width, height)
  ].join("");
}

function renderDaily3Feed({ content, snapshots, width, height }) {
  const picks = snapshots.slice(0, 3);
  return [
    renderDaily3Header({ width, slateDate: content.slateDate || picks[0]?.slateDate }),
    picks.map((snapshot, index) => renderDaily3Card(snapshot, index, 448 + index * 250)).join(""),
    renderDaily3Footer(width, height)
  ].join("");
}

function renderDaily3StoryCard(snapshot, index, y) {
  const x = 82;
  const width = 916;
  const height = 254;
  const teamName = clean(snapshot.selectedTeam, "Team TBD");
  const abbreviation = teamAbbreviation(teamName);
  const reason = daily3Reason(snapshot);
  const teamFont = teamName.length > 25 ? 44 : teamName.length > 18 ? 50 : 60;
  const teamLines = wrapText(teamName, teamName.length > 25 ? 22 : 20, 2);
  return [
    `<g class="daily3-story-pick-card" data-rank="${index + 1}">`,
    `<title>${escapeXml(`${index + 1}. ${teamName} ${formatOdds(snapshot.sportsbookOdds)}`)}</title>`,
    `<desc>${escapeXml(`${teamName} moneyline ${formatOdds(snapshot.sportsbookOdds)}. ${reason}`)}</desc>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="32" fill="#ffffff" stroke="#dbe6f5" stroke-width="3"/>`,
    `<path d="M${x} ${y + 30} Q${x} ${y} ${x + 30} ${y} H${x + 126} L${x + 68} ${y + height} H${x + 30} Q${x} ${y + height} ${x} ${y + height - 30} Z" fill="#0b4c9c"/>`,
    `<circle cx="${x + 4}" cy="${y + 82}" r="47" fill="#061733" stroke="#ffffff" stroke-width="5"/>`,
    `<text x="${x + 4}" y="${y + 99}" text-anchor="middle" font-size="54" font-weight="900" fill="#ffffff">${index + 1}</text>`,
    `<circle cx="${x + 164}" cy="${y + 128}" r="74" fill="#07162f" stroke="#d6dde8" stroke-width="6"/>`,
    `<circle cx="${x + 164}" cy="${y + 128}" r="63" fill="#0b2e63" stroke="#6fa4d8" stroke-width="4"/>`,
    `<text x="${x + 164}" y="${y + 150}" text-anchor="middle" font-size="${abbreviation.length > 3 ? 45 : 58}" font-weight="900" fill="#ffffff">${escapeXml(abbreviation)}</text>`,
    teamLines.map((line, lineIndex) => `<text x="${x + 282}" y="${y + 84 + lineIndex * 58}" font-size="${teamFont}" font-weight="900" fill="#071943">${escapeXml(line)}</text>`).join(""),
    `<text x="${x + 284}" y="${y + 178}" font-size="32" font-weight="900" fill="#b10f24" letter-spacing="2">MONEYLINE</text>`,
    `<text x="${x + width - 42}" y="${y + 94}" text-anchor="end" font-size="74" font-weight="900" font-style="italic" fill="#071943">${escapeXml(formatOdds(snapshot.sportsbookOdds))}</text>`,
    `<line x1="${x + 612}" y1="${y + 148}" x2="${x + 612}" y2="${y + 216}" stroke="#c9ced8" stroke-width="3"/>`,
    reasonIcon(reasonIconType(reason), x + 638, y + 154),
    textLines(reason, x + 706, y + 176, 25, { maxChars: 20, maxLines: 2, weight: 900, fill: "#071943", lineHeight: 31 }),
    `</g>`
  ].join("");
}

function renderDaily3Story({ content, snapshots, width, height }) {
  const picks = snapshots.slice(0, 3);
  const slateDate = content.slateDate || picks[0]?.slateDate;
  return [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#stadiumBg)"/>`,
    `<path d="M0 660 C230 570 420 610 660 520 C850 450 982 342 1080 232 V${height} H0 Z" fill="url(#fieldDirt)" opacity="0.95"/>`,
    `<path d="M742 -60 L1080 -60 V600 C945 522 846 438 726 352 Z" fill="url(#redHeat)" opacity="0.95"/>`,
    `<path d="M718 0 L646 536" stroke="#ffffff" stroke-width="5" opacity="0.78"/>`,
    `<path d="M0 0 H${width} V${height} H0 Z" fill="url(#daily3Light)"/>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#daily3Grain)" opacity="0.76"/>`,
    `<text x="82" y="122" font-size="48" font-weight="900" letter-spacing="12" fill="#ffffff">SAME GAME HEAT</text>`,
    `<text x="72" y="308" font-size="160" font-weight="900" letter-spacing="2" fill="url(#distress)" stroke="#ffffff" stroke-width="2">DAILY 3</text>`,
    `<path d="M72 366 H170 M204 366 H246 M280 366 H322 M356 366 H454" stroke="#c90924" stroke-width="8"/>`,
    `<path d="M82 404 H438 L410 484 H52 Z" fill="#c90924"/>`,
    `<text x="128" y="458" font-size="48" font-weight="900" letter-spacing="4" fill="#ffffff">${escapeXml(shortDate(slateDate))}</text>`,
    renderDaily3BrandMark(width),
    picks.map((snapshot, index) => renderDaily3StoryCard(snapshot, index, 590 + index * 306)).join(""),
    `<text x="${width / 2}" y="${height - 200}" text-anchor="middle" font-size="42" font-weight="900" fill="#ffffff">@sg_heater</text>`,
    `<path d="M0 ${height - 132} C210 ${height - 92} 410 ${height - 138} 600 ${height - 104} C810 ${height - 70} 960 ${height - 100} ${width} ${height - 76} V${height} H0 Z" fill="#061733" opacity="0.96"/>`,
    `<path d="M820 ${height - 98} C910 ${height - 140} 1004 ${height - 158} 1080 ${height - 178} V${height} H760 Z" fill="#c90924" opacity="0.86"/>`,
    `<text x="92" y="${height - 54}" font-size="30" font-weight="900" fill="#ffffff">${escapeXml(RESPONSIBLE_FOOTER)}</text>`,
    `<line x1="440" y1="${height - 90}" x2="440" y2="${height - 34}" stroke="#c90924" stroke-width="4"/>`,
    `<text x="502" y="${height - 54}" font-size="30" font-weight="900" fill="#ffffff">Research, not a guarantee.</text>`
  ].join("");
}

function renderDaily3({ content, snapshots, width, height, format }) {
  if (format === "feed") return renderDaily3Feed({ content, snapshots, width, height });
  if (format === "story") return renderDaily3Story({ content, snapshots, width, height });
  return renderClassicDaily3({ content, snapshots, width, height, format });
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

function renderSocialGraphic({ content, snapshots, format = "feed", graphicType = "standard", pickStats = null }) {
  const normalizedFormat = normalizeGraphicFormat(format);
  const normalizedGraphicType = normalizeGraphicType(graphicType);
  if (normalizedGraphicType === GRAPHIC_TYPES.daily_3_stats && normalizedFormat !== "feed") {
    const error = new Error("Stats Board supports feed format only.");
    error.statusCode = 400;
    throw error;
  }
  const dimensions = GRAPHIC_FORMATS[normalizedFormat];
  const safeContent = content || {};
  const safeSnapshots = Array.isArray(snapshots) ? snapshots.filter(Boolean) : [];
  const templateVersion = normalizedGraphicType === GRAPHIC_TYPES.daily_3_stats
    ? STATS_GRAPHIC_TEMPLATE_VERSION
    : GRAPHIC_TEMPLATE_VERSION;
  const statsHash = normalizedGraphicType === GRAPHIC_TYPES.daily_3_stats && pickStats
    ? sha256(canonicalStringify(pickStats))
    : "";
  const renderInput = {
    content: safeContent,
    snapshots: safeSnapshots.map((snapshot) => normalizedGraphicType === GRAPHIC_TYPES.daily_3_stats
      ? {
          id: snapshot.id,
          snapshotHash: snapshot.snapshotHash,
          slateDate: snapshot.slateDate,
          selectedTeam: snapshot.selectedTeam,
          opponent: snapshot.opponent,
          gameLabel: snapshot.gameLabel,
          sportsbookOdds: snapshot.sportsbookOdds
        }
      : {
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
        }),
    format: normalizedFormat,
    graphicType: normalizedGraphicType,
    templateVersion,
    renderVersion: GRAPHIC_RENDER_VERSION,
    statsHash
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
      ${stadiumDefs(width, height)}
    </defs>`;
  const background = `<rect width="${width}" height="${height}" fill="#edf4ff"/><path d="M0 ${height * 0.68} L${width} ${height * 0.34} L${width} ${height} L0 ${height} Z" fill="#fff7f8" opacity="0.9"/>`;
  const contentType = safeContent.contentType || "DAILY_3";
  let body;
  if (normalizedGraphicType === GRAPHIC_TYPES.daily_3_stats) {
    if (contentType !== "DAILY_3") {
      const error = new Error("Stats Board is only available for Daily 3 content.");
      error.statusCode = 400;
      throw error;
    }
    body = renderDaily3StatsBoard({ content: safeContent, snapshots: safeSnapshots, pickStats, width, height });
  } else if (contentType === "BEST_BET") body = renderBestBet({ content: safeContent, snapshots: safeSnapshots, width, height, format: normalizedFormat });
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
    graphicType: normalizedGraphicType,
    mimeType: "image/svg+xml",
    templateVersion,
    renderVersion: GRAPHIC_RENDER_VERSION,
    renderedInputHash: sha256(canonicalStringify(renderInput)),
    statsHash,
    statsGeneratedAt: pickStats?.generatedAt || "",
    statsSource: pickStats?.source || "",
    snapshotHashes: safeSnapshots.map((snapshot) => snapshot.snapshotHash).filter(Boolean),
    snapshotIds: safeSnapshots.map((snapshot) => snapshot.id).filter(Boolean)
  };
}

module.exports = {
  GRAPHIC_TEMPLATE_VERSION,
  STATS_GRAPHIC_TEMPLATE_VERSION,
  GRAPHIC_RENDER_VERSION,
  GRAPHIC_TYPES,
  GRAPHIC_FORMATS,
  RESPONSIBLE_FOOTER,
  normalizeGraphicFormat,
  normalizeGraphicType,
  renderSocialGraphic,
  selectStatsBoardMetrics,
  STATS_BOARD_LAYOUT,
  estimateTextWidth,
  fitTextToWidth,
  wrapTextToWidth,
  formatStatsBoardWatchText,
  shortenStatsWatch,
  prohibitedHits,
  canonicalStringify,
  sha256
};

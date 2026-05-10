const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const root = __dirname;
const execFileAsync = promisify(execFile);
const savedBoardsFile = process.env.SAVED_BOARDS_FILE || path.join(root, ".saved-boards.json");

loadEnvFile();

const port = Number(process.env.PORT || 3999);
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const oddsApiKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || "";
const ballDontLieKey = process.env.BALL_DONT_LIE_API_KEY || process.env.BDL_API_KEY || "";
const defaultMarkets = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists"
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function loadEnvFile() {
  try {
    const envPath = path.join(root, ".env");
    const contents = require("node:fs").readFileSync(envPath, "utf8");

    contents.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index === -1) return;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {
    // .env is optional.
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function playerName(player) {
  return player?.displayName || `${player?.firstName || player?.first_name || ""} ${player?.lastName || player?.last_name || ""}`.trim();
}

function playerTeam(player) {
  const team = player?.teamRelationships?.find((relationship) => relationship.type === "team")?.core || player?.team || null;
  if (!team) return null;
  return {
    id: team.id || "",
    abbreviation: team.abbreviation || "",
    displayName: team.displayName || team.name || ""
  };
}

function bestPlayer(items, query) {
  const target = normalize(query);
  return (
    items.find((item) => normalize(playerName(item)) === target) ||
    items.find((item) => normalize(playerName(item)).includes(target) || target.includes(normalize(playerName(item)))) ||
    items[0] ||
    null
  );
}

async function fetchJson(url, options = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 PropLens/1.0",
    Accept: "application/json,text/plain,*/*",
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    if (options.method && options.method !== "GET") throw error;
    return fetchJsonWithCurl(url, headers, error);
  }
}

async function fetchJsonWithCurl(url, headers = {}, originalError) {
  const args = ["-sS", "-L", "--max-time", "20"];
  Object.entries(headers).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    args.push("-H", `${key}: ${value}`);
  });
  args.push(String(url));

  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (curlError) {
    throw new Error(`${originalError?.message || "fetch failed"}; curl fallback failed: ${curlError.message}`);
  }
}

function toOddsApiDateTime(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function dateBounds(dateValue) {
  // Use a broad US sports-day window instead of server-local midnight.
  // Render runs in UTC, and late US games often start after 00:00Z.
  const start = new Date(`${dateValue}T08:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return {
    from: toOddsApiDateTime(start),
    to: toOddsApiDateTime(end)
  };
}

async function fetchOddsSlate({ sport, date, region, markets }) {
  if (!oddsApiKey) {
    throw new Error("ODDS_API_KEY is not configured on the server");
  }

  const { from, to } = dateBounds(date);
  const eventUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events`);
  eventUrl.searchParams.set("apiKey", oddsApiKey);
  eventUrl.searchParams.set("dateFormat", "iso");
  eventUrl.searchParams.set("commenceTimeFrom", from);
  eventUrl.searchParams.set("commenceTimeTo", to);

  const events = await fetchJson(eventUrl);
  const eventPayloads = [];

  for (const event of (events || []).slice(0, 12)) {
    const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`);
    oddsUrl.searchParams.set("apiKey", oddsApiKey);
    oddsUrl.searchParams.set("regions", region || "us");
    oddsUrl.searchParams.set("markets", (markets?.length ? markets : defaultMarkets).join(","));
    oddsUrl.searchParams.set("oddsFormat", "american");
    oddsUrl.searchParams.set("dateFormat", "iso");

    eventPayloads.push({
      event,
      odds: await fetchJson(oddsUrl)
    });
  }

  return eventPayloads;
}

async function fetchBallDontLieInjuries() {
  if (!ballDontLieKey) {
    return { configured: false, injuries: [] };
  }

  const result = await fetchJson("https://api.balldontlie.io/v1/player_injuries", {
    headers: { Authorization: ballDontLieKey }
  });
  return { configured: true, injuries: result.data || [] };
}

function statValueByKey(keys = [], stats = [], key) {
  const index = keys.indexOf(key);
  return index >= 0 ? stats[index] : "";
}

function madeThrees(value) {
  const made = String(value || "").split("-")[0];
  const number = Number(made);
  return Number.isFinite(number) ? number : null;
}

function eventTeams(event) {
  const competitors = event?.competitions?.[0]?.competitors || [];
  const home = competitors.find((item) => item.homeAway === "home");
  const away = competitors.find((item) => item.homeAway === "away");
  return {
    home: home?.team?.displayName || event?.home_team || "",
    away: away?.team?.displayName || event?.away_team || ""
  };
}

function boxscorePlayerStats(summary, event) {
  const teams = eventTeams(event);
  const gameLabel = `${teams.away} @ ${teams.home}`;
  const eventDate = event?.date ? event.date.slice(0, 10) : "";

  return (summary.boxscore?.players || []).flatMap((teamBox) => {
    const team = teamBox.team?.displayName || teamBox.team?.abbreviation || "";
    return (teamBox.statistics || []).flatMap((group) => {
      const keys = group.keys || [];
      return (group.athletes || [])
        .filter((item) => !item.didNotPlay && item.stats?.length)
        .map((item) => {
          const player = item.athlete?.displayName || item.displayName || "";
          const stats = item.stats || [];
          return {
            eventId: event?.id || "",
            date: eventDate,
            gameLabel,
            homeTeam: teams.home,
            awayTeam: teams.away,
            team,
            player,
            min: statValueByKey(keys, stats, "minutes") || "--",
            pts: Number(statValueByKey(keys, stats, "points")),
            reb: Number(statValueByKey(keys, stats, "rebounds")),
            ast: Number(statValueByKey(keys, stats, "assists")),
            threes: madeThrees(statValueByKey(keys, stats, "threePointFieldGoalsMade-threePointFieldGoalsAttempted"))
          };
        });
    });
  }).filter((item) => item.player);
}

async function finalStatsForDate(dateValue) {
  const dateKey = String(dateValue || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  const scoreboardUrl = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard");
  scoreboardUrl.searchParams.set("dates", dateKey);
  const scoreboard = await fetchJson(scoreboardUrl);
  const finalEvents = (scoreboard.events || []).filter((event) => event.status?.type?.completed);
  const stats = [];

  for (const event of finalEvents) {
    const summaryUrl = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary");
    summaryUrl.searchParams.set("event", event.id);
    const summary = await fetchJson(summaryUrl);
    stats.push(...boxscorePlayerStats(summary, event));
  }

  return {
    date: dateValue,
    games: finalEvents.map((event) => {
      const teams = eventTeams(event);
      return {
        id: event.id,
        gameLabel: `${teams.away} @ ${teams.home}`,
        status: event.status?.type?.description || "Final"
      };
    }),
    stats
  };
}

function supabaseEnabled() {
  return Boolean(supabaseUrl && supabaseKey);
}

async function supabaseRequest(pathname, options = {}) {
  if (!supabaseEnabled()) return null;
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 160)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getCachedPlayerLogs(player, season, scope = "series") {
  if (!supabaseEnabled()) return null;
  const id = `${normalize(player)}-${season}-${scope}`;
  try {
    const rows = await supabaseRequest(`player_game_logs?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function cachePlayerLogs({ player, espnId, season, source, logs, scope = "series" }) {
  if (!supabaseEnabled()) return;
  const id = `${normalize(player)}-${season}-${scope}`;
  try {
    await supabaseRequest("player_game_logs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          id,
          player_name: player,
          espn_id: espnId,
          season,
          source,
          logs,
          updated_at: new Date().toISOString()
        }
      ])
    });
  } catch {
    // Supabase cache is optional; ESPN data should still render.
  }
}

async function cacheSlateProps(props) {
  if (!supabaseEnabled() || !props.length) return;
  try {
    await supabaseRequest("slate_props?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(props)
    });
  } catch {
    // Supabase cache is optional.
  }
}

async function cacheSavedBoard(board) {
  if (!board?.key) return false;
  const localCached = await cacheSavedBoardLocally(board);
  if (!supabaseEnabled()) return localCached;
  try {
    await supabaseRequest("saved_boards?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          id: board.key,
          slate_date: board.date,
          sport_key: board.sport || "basketball_nba",
          payload: board,
          updated_at: new Date().toISOString()
        }
      ])
    });
    return true;
  } catch {
    return localCached;
  }
}

async function readLocalSavedBoards() {
  try {
    const contents = await fs.readFile(savedBoardsFile, "utf8");
    const boards = JSON.parse(contents);
    return Array.isArray(boards) ? boards : [];
  } catch {
    return [];
  }
}

async function writeLocalSavedBoards(boards) {
  await fs.writeFile(savedBoardsFile, JSON.stringify(boards.slice(0, 60), null, 2));
}

async function cacheSavedBoardLocally(board) {
  try {
    const boards = await readLocalSavedBoards();
    const nextBoards = [
      board,
      ...boards.filter((item) => item?.key !== board.key)
    ].sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || "")));
    await writeLocalSavedBoards(nextBoards);
    return true;
  } catch {
    return false;
  }
}

async function getSavedBoards({ before, limit = 14 } = {}) {
  const localBoards = await readLocalSavedBoards();
  let remoteBoards = [];
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "slate_date.desc,updated_at.desc");
  params.set("limit", String(limit));
  if (before) params.set("slate_date", `lte.${before}`);
  if (supabaseEnabled()) {
    try {
      const rows = await supabaseRequest(`saved_boards?${params.toString()}`);
      remoteBoards = (rows || []).map((row) => row.payload).filter(Boolean);
    } catch {
      remoteBoards = [];
    }
  }
  const boards = [...remoteBoards, ...localBoards]
    .filter((board) => board?.key)
    .filter((board) => !before || String(board.date || "") <= String(before));
  const byKey = new Map();
  boards.forEach((board) => {
    if (!byKey.has(board.key)) byKey.set(board.key, board);
  });
  return Array.from(byKey.values())
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, limit);
}

async function supabaseHealth() {
  if (!supabaseEnabled()) {
    return {
      configured: false,
      ok: false,
      message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not configured"
    };
  }

  const tables = ["saved_boards", "slate_props", "player_game_logs"];
  const checks = [];

  for (const table of tables) {
    try {
      await supabaseRequest(`${table}?select=id&limit=1`, {
        headers: { Prefer: "" }
      });
      checks.push({ table, ok: true });
    } catch (error) {
      checks.push({ table, ok: false, error: error.message });
    }
  }

  return {
    configured: true,
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function espnPlayerSearch(query) {
  const url = new URL("https://site.web.api.espn.com/apis/common/v3/search");
  url.searchParams.set("region", "us");
  url.searchParams.set("lang", "en");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("mode", "prefix");
  url.searchParams.set("type", "player");
  const data = await fetchJson(url);
  const nbaItems = (data.items || []).filter((item) => {
    const text = JSON.stringify(item).toLowerCase();
    return text.includes('"nba"') || text.includes("national basketball association");
  });
  return bestPlayer(nbaItems.length ? nbaItems : data.items || [], query);
}

function seasonYear(dateValue) {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
  return date.getMonth() >= 9 ? date.getFullYear() + 1 : date.getFullYear();
}

function statAt(event, index) {
  return event?.stats?.[index] ?? "--";
}

function parseThreePointers(value) {
  const made = String(value || "").split("-")[0];
  return made || "--";
}

function espnLogEvent(data, event, index, seasonTypeName) {
  const meta = data.events?.[event.eventId] || {};
  return {
    date: meta.gameDate ? new Date(meta.gameDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `Game ${index + 1}`,
    sortDate: meta.gameDate || "",
    opponent: meta.opponent?.abbreviation || meta.opponent?.displayName || "Opponent",
    min: statAt(event, 0),
    pts: statAt(event, 13),
    reb: statAt(event, 7),
    ast: statAt(event, 8),
    threes: parseThreePointers(statAt(event, 3)),
    result: meta.gameResult || "",
    score: meta.score || "",
    seasonType: seasonTypeName || "",
    source: "ESPN"
  };
}

async function espnSeriesLogs(playerId, season, scope = "series") {
  const url = new URL(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`);
  url.searchParams.set("region", "us");
  url.searchParams.set("lang", "en");
  url.searchParams.set("season", season);
  const data = await fetchJson(url);

  if (scope === "all") {
    return (data.seasonTypes || [])
      .filter((seasonType) => !/pre/i.test(seasonType.displayName || seasonType.name || ""))
      .flatMap((seasonType) => {
        const eventCategory = seasonType?.categories?.find((category) => category.type === "event" && category.events?.length) || seasonType?.categories?.find((category) => category.events?.length);
        return (eventCategory?.events || []).map((event, index) => espnLogEvent(data, event, index, seasonType.displayName || seasonType.name || ""));
      })
      .sort((a, b) => new Date(b.sortDate || 0) - new Date(a.sortDate || 0));
  }

  const postseason = (data.seasonTypes || []).find((type) => /post/i.test(type.displayName || "")) || data.seasonTypes?.[0];
  const eventCategory = postseason?.categories?.find((category) => category.type === "event" && category.events?.length) || postseason?.categories?.find((category) => category.events?.length);
  const events = eventCategory?.events || [];

  return events.map((event, index) => espnLogEvent(data, event, index, postseason?.displayName || postseason?.name || ""));
}

function espnDate(dateValue) {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function espnTeamNames(competitor) {
  const team = competitor?.team || {};
  return [team.displayName, team.shortDisplayName, team.name, team.abbreviation, team.location].filter(Boolean);
}

function eventMatchesTeam(event, teamName) {
  const target = normalize(teamName);
  return event?.competitions?.[0]?.competitors?.some((competitor) =>
    espnTeamNames(competitor).some((name) => {
      const candidate = normalize(name);
      return candidate && (candidate === target || candidate.includes(target) || target.includes(candidate));
    })
  );
}

function gameTeamSituations(event) {
  const competition = event?.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const series = competition.series || {};
  const winsNeeded = series.totalCompetitions ? Math.floor(series.totalCompetitions / 2) + 1 : 4;

  return competitors.map((competitor) => {
    const seriesEntry = (series.competitors || []).find((item) => String(item.id) === String(competitor.id));
    const wins = Number(seriesEntry?.wins || 0);
    const opponentWins = Math.max(
      0,
      ...(series.competitors || [])
        .filter((item) => String(item.id) !== String(competitor.id))
        .map((item) => Number(item.wins || 0))
    );

    return {
      id: competitor.team?.id || competitor.id || "",
      name: competitor.team?.displayName || "",
      abbreviation: competitor.team?.abbreviation || "",
      isHome: competitor.homeAway === "home",
      wins,
      opponentWins,
      seriesSummary: series.summary || competitor.record || "",
      facingElimination: opponentWins === winsNeeded - 1 && wins < winsNeeded - 1
    };
  });
}

async function espnGameSummary({ home, away, date }) {
  const scoreboardUrl = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard");
  scoreboardUrl.searchParams.set("dates", espnDate(date));
  const scoreboard = await fetchJson(scoreboardUrl);
  const event = (scoreboard.events || []).find((item) => eventMatchesTeam(item, home) && eventMatchesTeam(item, away));

  if (!event?.id) {
    return { event: null, news: [], injuries: [], starters: [] };
  }

  const summaryUrl = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary");
  summaryUrl.searchParams.set("event", event.id);
  const summary = await fetchJson(summaryUrl);
  const competitors = event.competitions?.[0]?.competitors || [];
  const teamTerms = [
    home,
    away,
    ...competitors.flatMap((competitor) => espnTeamNames(competitor))
  ];

  return {
    event: {
      id: event.id,
      name: event.name || event.shortName || `${away} @ ${home}`,
      status: event.status?.type?.description || ""
    },
    teams: gameTeamSituations(event),
    news: extractGameNews(summary, teamTerms),
    injuries: extractGameInjuries(summary),
    starters: extractStarters(summary)
  };
}

function extractGameNews(summary, terms = []) {
  const items = Array.isArray(summary.news) ? summary.news : summary.news?.articles || summary.news?.items || [];
  const normalizedTerms = [...new Set(terms.map(normalize).filter((term) => term.length >= 3))];
  return items
    .map((item) => ({
      headline: item.headline || item.title || "",
      description: item.description || item.story || ""
    }))
    .filter((item) => {
      if (!item.headline) return false;
      const text = normalize(`${item.headline} ${item.description}`);
      return normalizedTerms.some((term) => text.includes(term));
    })
    .slice(0, 5);
}

function extractGameInjuries(summary) {
  return (summary.injuries || [])
    .flatMap((team) => {
      const teamName = team.team?.displayName || team.team?.abbreviation || "";
      return (team.injuries || team.athletes || []).map((injury) => ({
        team: teamName,
        player: injury.athlete?.displayName || injury.displayName || injury.name || "",
        status: injury.status || injury.type || injury.detail || injury.description || ""
      }));
    })
    .filter((item) => item.player)
    .slice(0, 12);
}

function extractStarters(summary) {
  return (summary.boxscore?.players || [])
    .map((team) => {
      const teamName = team.team?.displayName || team.team?.abbreviation || "";
      const starters = (team.statistics || [])
        .flatMap((group) => group.athletes || [])
        .filter((item) => item.starter || /starter/i.test(item.position?.displayName || item.position?.abbreviation || ""))
        .map((item) => item.athlete?.displayName || item.displayName || "")
        .filter(Boolean)
        .slice(0, 5);

      return { team: teamName, starters };
    })
    .filter((item) => item.starters.length);
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config") {
    json(res, 200, {
      oddsConfigured: Boolean(oddsApiKey),
      ballDontLieConfigured: Boolean(ballDontLieKey),
      supabase: supabaseEnabled()
    });
    return;
  }

  if (url.pathname === "/api/supabase-health") {
    try {
      const health = await supabaseHealth();
      json(res, health.ok ? 200 : 503, health);
    } catch (error) {
      json(res, 503, { configured: supabaseEnabled(), ok: false, error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/slate") {
    const sport = url.searchParams.get("sport") || "basketball_nba";
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const region = url.searchParams.get("region") || "us";
    const markets = (url.searchParams.get("markets") || "")
      .split(",")
      .map((market) => market.trim())
      .filter(Boolean);

    try {
      json(res, 200, {
        configured: Boolean(oddsApiKey),
        events: await fetchOddsSlate({ sport, date, region, markets })
      });
    } catch (error) {
      json(res, oddsApiKey ? 502 : 400, { error: error.message, configured: Boolean(oddsApiKey) });
    }
    return;
  }

  if (url.pathname === "/api/injuries") {
    try {
      json(res, 200, await fetchBallDontLieInjuries());
    } catch (error) {
      json(res, 502, { error: error.message, configured: Boolean(ballDontLieKey), injuries: [] });
    }
    return;
  }

  if (url.pathname === "/api/final-stats") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    try {
      json(res, 200, await finalStatsForDate(date));
    } catch (error) {
      json(res, 502, { error: error.message, date, stats: [] });
    }
    return;
  }

  if (url.pathname === "/api/saved-boards") {
    if (req.method === "GET") {
      try {
        const before = url.searchParams.get("before") || "";
        json(res, 200, {
          supabase: supabaseEnabled(),
          boards: await getSavedBoards({ before })
        });
      } catch (error) {
        json(res, 500, { error: error.message });
      }
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || "{}");
        const cached = await cacheSavedBoard(payload.board);
        json(res, 200, { cached });
      } catch (error) {
        json(res, 500, { error: error.message });
      }
      return;
    }

    json(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/cache-slate") {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || "{}");
      const rows = normalizeSlateRows(payload);
      await cacheSlateProps(rows);
      json(res, 200, { cached: supabaseEnabled(), count: rows.length });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/game-news") {
    const home = url.searchParams.get("home");
    const away = url.searchParams.get("away");
    const date = url.searchParams.get("date");

    if (!home || !away) {
      json(res, 400, { error: "Missing game teams" });
      return;
    }

    try {
      json(res, 200, await espnGameSummary({ home, away, date }));
    } catch (error) {
      json(res, 502, { error: error.message });
    }
    return;
  }

  if (url.pathname !== "/api/series-logs") {
    json(res, 404, { error: "Unknown API route" });
    return;
  }

  const player = url.searchParams.get("player");
  const date = url.searchParams.get("date");
  const scope = url.searchParams.get("scope") === "all" ? "all" : "series";

  if (!player) {
    json(res, 400, { error: "Missing player name" });
    return;
  }

  try {
    const season = seasonYear(date);
    const cached = await getCachedPlayerLogs(player, season, scope);
    if (cached?.logs?.length) {
      json(res, 200, {
        player: cached.player_name,
        espnId: cached.espn_id,
        team: null,
        source: `${cached.source} cache`,
        scope,
        logs: cached.logs
      });
      return;
    }

    const espnPlayer = await espnPlayerSearch(player);
    if (!espnPlayer?.id) {
      json(res, 404, { error: `No ESPN NBA player match for ${player}` });
      return;
    }

    const logs = await espnSeriesLogs(espnPlayer.id, String(season), scope);
    await cachePlayerLogs({
      player: playerName(espnPlayer),
      espnId: espnPlayer.id,
      season,
      source: scope === "all" ? "ESPN all opponents" : "ESPN",
      logs,
      scope
    });
    json(res, 200, {
      player: playerName(espnPlayer),
      espnId: espnPlayer.id,
      team: playerTeam(espnPlayer),
      source: scope === "all" ? "ESPN all opponents" : "ESPN",
      scope,
      logs
    });
  } catch (error) {
    json(res, 502, { error: error.message });
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeSlateRows(payload) {
  const slateDate = payload.slateDate;
  const sportKey = payload.sportKey || "basketball_nba";
  const games = payload.games || [];
  const rows = [];

  games.forEach((game) => {
    const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
    (game.candidates || []).forEach((prop) => {
      rows.push({
        id: `${slateDate}-${sportKey}-${game.id}-${prop.id}`,
        slate_date: slateDate,
        sport_key: sportKey,
        game_id: game.id,
        game_label: gameLabel,
        player_name: prop.player,
        market: prop.market,
        line: prop.line,
        odds: prop.odds,
        books: prop.books || [],
        payload: prop,
        updated_at: new Date().toISOString()
      });
    });
  });

  return rows;
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0"
    });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
});

server.listen(port, () => {
  console.log(`Prop Lens running at http://localhost:${port}`);
});

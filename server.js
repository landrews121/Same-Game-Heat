const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const root = __dirname;
const execFileAsync = promisify(execFile);
const savedBoardsFile = process.env.SAVED_BOARDS_FILE || path.join(root, ".saved-boards.json");
const appStateFile = process.env.APP_STATE_FILE || path.join(root, ".app-state.json");

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

async function fetchEventOdds({ sport, eventId, region, markets }) {
  const oddsUrl = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds`);
  oddsUrl.searchParams.set("apiKey", oddsApiKey);
  oddsUrl.searchParams.set("regions", region || "us");
  oddsUrl.searchParams.set("markets", (markets?.length ? markets : defaultMarkets).join(","));
  oddsUrl.searchParams.set("oddsFormat", "american");
  oddsUrl.searchParams.set("dateFormat", "iso");
  return fetchJson(oddsUrl);
}

function oddsPayloadHasMarket(payload, marketKey) {
  return (payload.bookmakers || []).some((bookmaker) =>
    (bookmaker.markets || []).some((market) => market.key === marketKey)
  );
}

function mergeOddsPayloadMarkets(primary, extra) {
  const merged = {
    ...primary,
    bookmakers: [...(primary.bookmakers || [])]
  };
  const byBook = new Map(merged.bookmakers.map((bookmaker) => [bookmaker.key, bookmaker]));

  (extra.bookmakers || []).forEach((extraBook) => {
    const existingBook = byBook.get(extraBook.key);
    if (!existingBook) {
      const clone = { ...extraBook, markets: [...(extraBook.markets || [])] };
      merged.bookmakers.push(clone);
      byBook.set(clone.key, clone);
      return;
    }

    const existingMarketKeys = new Set((existingBook.markets || []).map((market) => market.key));
    (extraBook.markets || []).forEach((market) => {
      if (!existingMarketKeys.has(market.key)) {
        existingBook.markets = [...(existingBook.markets || []), market];
        existingMarketKeys.add(market.key);
      }
    });
  });

  return merged;
}

function appendArrayParam(url, key, values) {
  values.forEach((value) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.append(`${key}[]`, value);
  });
}

async function fetchBdlMlbJson(url) {
  const headerOptions = [
    { Authorization: ballDontLieKey },
    { Authorization: `Bearer ${ballDontLieKey}` },
    { "X-API-Key": ballDontLieKey }
  ];
  let lastError = null;

  for (const headers of headerOptions) {
    try {
      return await fetchJson(url, { headers });
    } catch (error) {
      lastError = error;
      if (!String(error.message || "").includes("401")) throw error;
    }
  }

  throw lastError || new Error("Ball Don't Lie MLB request failed");
}

async function fetchBdlMlbGames(date) {
  const gamesUrl = new URL("https://api.balldontlie.io/mlb/v1/games");
  gamesUrl.searchParams.append("dates[]", date);
  gamesUrl.searchParams.set("per_page", "100");
  const result = await fetchBdlMlbJson(gamesUrl);
  return result.data || [];
}

async function fetchBdlMlbLineups(gameIds) {
  if (!gameIds.length) return [];
  const lineups = [];
  let cursor = "";

  do {
    const lineupsUrl = new URL("https://api.balldontlie.io/mlb/v1/lineups");
    appendArrayParam(lineupsUrl, "game_ids", gameIds);
    lineupsUrl.searchParams.set("per_page", "100");
    if (cursor) lineupsUrl.searchParams.set("cursor", cursor);
    const result = await fetchBdlMlbJson(lineupsUrl);
    lineups.push(...(result.data || []));
    cursor = result.meta?.next_cursor || "";
  } while (cursor);

  return lineups;
}

async function fetchBdlMlbPlayerProps(gameId, propType, vendors = []) {
  const propsUrl = new URL("https://api.balldontlie.io/mlb/v1/odds/player_props");
  propsUrl.searchParams.set("game_id", gameId);
  if (propType) propsUrl.searchParams.set("prop_type", propType);
  appendArrayParam(propsUrl, "vendors", vendors);
  const result = await fetchBdlMlbJson(propsUrl);
  return result.data || [];
}

function bdlTeamName(team) {
  if (!team) return "";
  if (typeof team === "string") return team;
  return team.display_name || team.full_name || team.name || team.abbreviation || "";
}

function bdlGameHomeTeam(game) {
  return (
    game.home_team_name ||
    bdlTeamName(game.home_team) ||
    bdlTeamName(game.homeTeam) ||
    bdlTeamName(game.home)
  );
}

function bdlGameAwayTeam(game) {
  return (
    game.away_team_name ||
    bdlTeamName(game.away_team) ||
    bdlTeamName(game.awayTeam) ||
    bdlTeamName(game.away)
  );
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function fetchBdlMlbPropsForDate({ date, propType = "home_runs", vendors = [] }) {
  if (!ballDontLieKey) {
    throw new Error("BALL_DONT_LIE_API_KEY is not configured on the server");
  }

  const games = await fetchBdlMlbGames(date);
  const gameIds = games.map((game) => game.id).filter(Boolean);
  const lineups = await fetchBdlMlbLineups(gameIds);
  const playersById = new Map();

  lineups.forEach((lineup) => {
    if (!lineup.player?.id) return;
    playersById.set(lineup.player.id, {
      id: lineup.player.id,
      fullName: lineup.player.full_name || `${lineup.player.first_name || ""} ${lineup.player.last_name || ""}`.trim(),
      team: lineup.team?.display_name || lineup.player.team?.display_name || "",
      battingOrder: lineup.batting_order || null,
      isProbablePitcher: Boolean(lineup.is_probable_pitcher)
    });
  });

  const gamesWithProps = [];
  for (const game of games) {
    const props = await fetchBdlMlbPlayerProps(game.id, propType, vendors);
    gamesWithProps.push({
      id: game.id,
      homeTeam: bdlGameHomeTeam(game),
      awayTeam: bdlGameAwayTeam(game),
      date: game.date,
      props: props.map((prop) => {
        const player = playersById.get(prop.player_id) || {};
        return {
          id: prop.id,
          playerId: prop.player_id,
          playerName: player.fullName || `Player ${prop.player_id}`,
          team: player.team || "",
          battingOrder: player.battingOrder,
          vendor: prop.vendor,
          propType: prop.prop_type,
          lineValue: firstFiniteNumber(prop.line_value, prop.line, prop.point),
          odds: firstFiniteNumber(prop.market?.odds, prop.odds, prop.price, prop.american_odds),
          overOdds: firstFiniteNumber(prop.market?.over_odds, prop.over_odds, prop.over_price),
          underOdds: firstFiniteNumber(prop.market?.under_odds, prop.under_odds, prop.under_price),
          market: prop.market,
          updatedAt: prop.updated_at
        };
      })
    });
  }

  return gamesWithProps;
}

function numericStatValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function fetchMlbPublicSchedule(date) {
  const scheduleUrl = new URL("https://statsapi.mlb.com/api/v1/schedule");
  scheduleUrl.searchParams.set("sportId", "1");
  scheduleUrl.searchParams.set("date", date);
  scheduleUrl.searchParams.set("hydrate", "team,probablePitcher");
  const result = await fetchJson(scheduleUrl);
  return (result.dates || []).flatMap((item) => item.games || []);
}

async function fetchMlbPublicRoster(teamId) {
  const rosterUrl = new URL(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster`);
  rosterUrl.searchParams.set("rosterType", "active");
  rosterUrl.searchParams.set("hydrate", "person(stats(group=[hitting],type=[season]))");
  const result = await fetchJson(rosterUrl);
  return result.roster || [];
}

function hitterSeasonStats(player) {
  const splits = player?.stats?.find((item) => item.group?.displayName === "hitting" || item.group?.displayName === "Hitting")?.splits || [];
  return splits[0]?.stat || {};
}

function publicHomerScore(stats, lineupBoostSeed) {
  const homeRuns = numericStatValue(stats.homeRuns);
  const atBats = Math.max(1, numericStatValue(stats.atBats));
  const slugging = numericStatValue(stats.slugging);
  const ops = numericStatValue(stats.ops);
  const isolatedPower = Math.max(0, slugging - numericStatValue(stats.avg));
  const hrRateScore = Math.min(45, (homeRuns / atBats) * 900);
  const powerScore = Math.min(30, slugging * 42 + isolatedPower * 25);
  const opsScore = Math.min(15, ops * 14);
  const lineupProxy = numericStatValue(lineupBoostSeed) % 10;
  return Math.round(Math.max(30, Math.min(96, 25 + hrRateScore + powerScore + opsScore + lineupProxy)));
}

async function fetchMlbPublicHomerCandidates(date) {
  const games = await fetchMlbPublicSchedule(date);
  const candidates = [];

  for (const game of games) {
    const sides = [
      { team: game.teams?.away?.team, opponent: game.teams?.home?.team },
      { team: game.teams?.home?.team, opponent: game.teams?.away?.team }
    ];

    for (const side of sides) {
      if (!side.team?.id) continue;
      const roster = await fetchMlbPublicRoster(side.team.id);
      roster
        .filter((item) => item.position?.type !== "Pitcher")
        .forEach((item) => {
          const stats = hitterSeasonStats(item.person);
          const atBats = numericStatValue(stats.atBats);
          const homeRuns = numericStatValue(stats.homeRuns);
          const slugging = numericStatValue(stats.slugging);
          if (atBats < 25 || (!homeRuns && slugging < 0.38)) return;
          const seed = String(item.person?.id || 0).split("").reduce((sum, char) => sum + Number(char || 0), 0);
          const score = publicHomerScore(stats, seed);
          const homerProbability = Math.min(0.125, Math.max(0.025, 0.025 + (score - 45) / 700));
          candidates.push({
            player: item.person?.fullName || item.person?.displayName || "",
            team: side.team.name || "",
            opponent: side.opponent?.name || "",
            gameLabel: `${side.team.name || ""} @ ${side.opponent?.name || ""}`,
            homeRuns,
            atBats,
            slugging,
            ops: numericStatValue(stats.ops),
            score,
            homerProbability,
            source: "MLB public season stats"
          });
        });
    }
  }

  return candidates
    .filter((candidate) => candidate.player)
    .sort((a, b) => b.homerProbability - a.homerProbability || b.score - a.score)
    .slice(0, 12);
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
  const eventList = (events || []).slice(0, 12);
  const concurrency = 3;
  const eventPayloads = [];

  for (let i = 0; i < eventList.length; i += concurrency) {
    const batch = eventList.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (event) => {
        let odds = await fetchEventOdds({ sport, eventId: event.id, region, markets });
        const shouldEnsureMlbMoneylines = sport === "baseball_mlb" && (markets || []).includes("h2h") && !oddsPayloadHasMarket(odds, "h2h");

        if (shouldEnsureMlbMoneylines) {
          const moneylineOdds = await fetchEventOdds({ sport, eventId: event.id, region, markets: ["h2h"] });
          odds = mergeOddsPayloadMarkets(odds, moneylineOdds);
        }

        return { event, odds };
      })
    );
    eventPayloads.push(...results);
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
  const existingLocalBoards = await readLocalSavedBoards();
  const existingLocal = existingLocalBoards.find((item) => item?.key === board.key);
  const localCached = existingLocal?.receiptLocked ? true : await cacheSavedBoardLocally(board);
  if (!supabaseEnabled()) return localCached;
  try {
    const existingRemote = await supabaseRequest(`saved_boards?id=eq.${encodeURIComponent(board.key)}&select=id,payload&limit=1`);
    if (Array.isArray(existingRemote) && existingRemote.some((row) => row?.payload?.receiptLocked)) return true;
    await supabaseRequest("saved_boards?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        {
          id: board.key,
          slate_date: board.date,
          sport_key: board.sport || "baseball_mlb",
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
    const existing = boards.find((item) => item?.key === board.key);
    if (existing?.receiptLocked) return true;
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

  const tables = ["saved_boards", "slate_props"];
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


async function handleApi(req, res, url) {
  if (url.pathname === "/api/config") {
    json(res, 200, {
      oddsConfigured: Boolean(oddsApiKey),
      ballDontLieConfigured: Boolean(ballDontLieKey),
      supabase: supabaseEnabled()
    });
    return;
  }

  if (url.pathname === "/api/ui-state") {
    if (req.method === "GET") {
      json(res, 200, { state: await readAppState() });
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || "{}");
        const state = await writeAppState(payload.state || payload);
        json(res, 200, { state });
      } catch (error) {
        json(res, 500, { error: error.message });
      }
      return;
    }

    json(res, 405, { error: "Method not allowed" });
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
    const sport = url.searchParams.get("sport") || "baseball_mlb";
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

  if (url.pathname === "/api/mlb/player-props") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const propType = url.searchParams.get("propType") || url.searchParams.get("prop_type") || "home_runs";
    const vendors = [
      ...url.searchParams.getAll("vendors[]"),
      ...url.searchParams.getAll("vendors"),
      ...(url.searchParams.get("vendor") || "").split(",")
    ]
      .map((vendor) => vendor.trim())
      .filter(Boolean);

    try {
      json(res, 200, {
        configured: Boolean(ballDontLieKey),
        games: await fetchBdlMlbPropsForDate({ date, propType, vendors })
      });
    } catch (error) {
      json(res, ballDontLieKey ? 502 : 400, {
        error: error.message,
        configured: Boolean(ballDontLieKey),
        games: []
      });
    }
    return;
  }

  if (url.pathname === "/api/mlb/public-homer-candidates") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    try {
      json(res, 200, {
        source: "MLB Stats API",
        candidates: await fetchMlbPublicHomerCandidates(date)
      });
    } catch (error) {
      json(res, 502, {
        error: error.message,
        source: "MLB Stats API",
        candidates: []
      });
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

  json(res, 404, { error: "Unknown API route" });
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

function cleanAppState(payload = {}) {
  const allowedSports = new Set(["baseball_mlb"]);
  const allowedRegions = new Set(["us", "us2", "uk", "eu"]);
  const allowedBooks = new Set(["fanatics", "draftkings", "fanduel", "betmgm", "caesars"]);
  const today = new Date().toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.slateDate || "")) ? String(payload.slateDate) : today;
  const sportKey = allowedSports.has(payload.sportKey) ? payload.sportKey : "baseball_mlb";
  const region = allowedRegions.has(payload.region) ? payload.region : "us";
  const bookFilter = allowedBooks.has(payload.bookFilter) ? payload.bookFilter : "fanatics";

  return {
    sportKey,
    slateDate: date,
    region,
    bookFilter,
    updatedAt: payload.updatedAt || new Date().toISOString()
  };
}

async function readAppState() {
  try {
    const raw = await fs.readFile(appStateFile, "utf8");
    return cleanAppState(JSON.parse(raw));
  } catch {
    return cleanAppState({});
  }
}

async function writeAppState(payload) {
  const state = cleanAppState({ ...payload, updatedAt: new Date().toISOString() });
  await fs.writeFile(appStateFile, JSON.stringify(state, null, 2));
  return state;
}

function normalizeSlateRows(payload) {
  const slateDate = payload.slateDate;
  const sportKey = payload.sportKey || "baseball_mlb";
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
    const isHtml = ext === ".html";
    const isVersioned = url.searchParams.has("v");
    const cacheControl = isHtml
      ? "no-store"
      : isVersioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300";
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": cacheControl
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

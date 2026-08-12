const MLB_STATS_API = "https://statsapi.mlb.com/api/v1";

function clean(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, places = 1) {
  const parsed = number(value);
  if (parsed === null) return null;
  const factor = 10 ** places;
  return Math.round(parsed * factor) / factor;
}

function previousDate(date) {
  const parsed = new Date(`${clean(date)}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function recentStartDate(date, days = 35) {
  const parsed = new Date(`${clean(date)}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function seasonStartDate(date) {
  const season = new Date(`${clean(date)}T12:00:00Z`).getUTCFullYear();
  return `${season}-01-01`;
}

function isFinalGame(game) {
  const status = clean(game?.status?.abstractGameState || game?.status?.detailedState).toLowerCase();
  return status === "final" || /final|completed|game over/.test(status);
}

function teamSide(game, teamId) {
  const home = game?.teams?.home || {};
  const away = game?.teams?.away || {};
  if (String(home.team?.id) === String(teamId)) return { key: "home", row: home, opponent: away };
  if (String(away.team?.id) === String(teamId)) return { key: "away", row: away, opponent: home };
  return null;
}

function inningsToOuts(value) {
  const text = clean(value);
  if (!text) return 0;
  const [whole, partial = "0"] = text.split(".");
  const innings = Number(whole);
  const outs = Number(partial);
  if (!Number.isFinite(innings) || !Number.isFinite(outs) || outs < 0 || outs > 2) return 0;
  return innings * 3 + outs;
}

function outsToInnings(outs) {
  const whole = Math.floor(outs / 3);
  const remainder = outs % 3;
  return `${whole}.${remainder}`;
}

function seasonStat(payload) {
  return payload?.stats?.[0]?.splits?.[0]?.stat || {};
}

function normalizeRecord(record = {}) {
  const wins = number(record.wins);
  const losses = number(record.losses);
  return wins === null || losses === null ? null : { wins, losses };
}

function summarizeRecentGames(games, teamId) {
  const chronological = games
    .filter(isFinalGame)
    .map((game) => ({ game, side: teamSide(game, teamId) }))
    .filter((entry) => entry.side && number(entry.side.row.score) !== null && number(entry.side.opponent.score) !== null)
    .sort((a, b) => String(b.game.gameDate || "").localeCompare(String(a.game.gameDate || "")));

  const summarize = (limit) => {
    const rows = chronological.slice(0, limit);
    const wins = rows.filter(({ side }) => Number(side.row.score) > Number(side.opponent.score)).length;
    const runsScored = rows.reduce((total, { side }) => total + Number(side.row.score), 0);
    const runsAllowed = rows.reduce((total, { side }) => total + Number(side.opponent.score), 0);
    return {
      games: rows.length,
      wins,
      losses: rows.length - wins,
      runsScored,
      runsAllowed,
      averageRunsScored: rows.length ? round(runsScored / rows.length) : null,
      averageRunsAllowed: rows.length ? round(runsAllowed / rows.length) : null
    };
  };

  return { last5: summarize(5), last10: summarize(10) };
}

function summarizeVenueRecord(games, teamId, venueKey) {
  const rows = games
    .filter(isFinalGame)
    .map((game) => ({ game, side: teamSide(game, teamId) }))
    .filter((entry) => entry.side?.key === venueKey && number(entry.side.row.score) !== null && number(entry.side.opponent.score) !== null);
  if (!rows.length) return null;
  const wins = rows.filter(({ side }) => Number(side.row.score) > Number(side.opponent.score)).length;
  return { wins, losses: rows.length - wins };
}

function summarizeHeadToHead(games, teamId, opponentTeamId) {
  const rows = games
    .filter(isFinalGame)
    .map((game) => ({ game, side: teamSide(game, teamId) }))
    .filter((entry) => entry.side && String(entry.side.opponent.team?.id) === String(opponentTeamId))
    .filter((entry) => number(entry.side.row.score) !== null && number(entry.side.opponent.score) !== null);
  if (!rows.length) return null;
  const wins = rows.filter(({ side }) => Number(side.row.score) > Number(side.opponent.score)).length;
  return { wins, losses: rows.length - wins, games: rows.length };
}

function normalizeOffense(stats = {}) {
  const gamesPlayed = number(stats.gamesPlayed, 0);
  const runs = number(stats.runs, 0);
  return {
    runs,
    homeRuns: number(stats.homeRuns),
    battingAverage: clean(stats.avg) || null,
    obp: clean(stats.obp) || null,
    slg: clean(stats.slg) || null,
    ops: clean(stats.ops) || null,
    runsPerGame: gamesPlayed ? round(runs / gamesPlayed) : null
  };
}

function normalizePitcher({ person = {}, stats = {}, gameLog = {}, fallbackName = "", slateDate = "" } = {}) {
  const pitcher = person?.people?.[0] || {};
  const season = seasonStat(stats);
  const starts = (gameLog?.stats?.[0]?.splits || [])
    .filter((split) => clean(split.date) && (!slateDate || split.date < slateDate))
    .filter((split) => number(split.stat?.gamesStarted, 0) > 0 || split.isStarter === true)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 3);
  const outs = starts.reduce((total, split) => total + inningsToOuts(split.stat?.inningsPitched), 0);
  const earnedRuns = starts.reduce((total, split) => total + (number(split.stat?.earnedRuns, 0) || 0), 0);
  const last3Starts = starts.length
    ? {
        starts: starts.length,
        era: outs ? round((earnedRuns * 27) / outs, 2) : null,
        inningsPitched: outsToInnings(outs),
        strikeouts: starts.reduce((total, split) => total + (number(split.stat?.strikeOuts, 0) || 0), 0),
        walks: starts.reduce((total, split) => total + (number(split.stat?.baseOnBalls, 0) || 0), 0),
        runsAllowed: starts.reduce((total, split) => total + (number(split.stat?.runs, number(split.stat?.earnedRuns, 0)) || 0), 0)
      }
    : null;

  if (!pitcher.id && !fallbackName) return { status: "tbd", name: "Starter TBD" };
  return {
    status: "available",
    id: pitcher.id || null,
    name: pitcher.fullName || fallbackName || "Starter TBD",
    handedness: pitcher.pitchHand?.code || null,
    season: {
      era: clean(season.era) || null,
      whip: clean(season.whip) || null,
      strikeouts: number(season.strikeOuts),
      walks: number(season.baseOnBalls),
      inningsPitched: clean(season.inningsPitched) || null,
      homeRunsAllowed: number(season.homeRuns)
    },
    last3Starts
  };
}

function buildSupportingStats({ selectedTeam, opponentTeam, selectedPitcher, opponentPitcher }) {
  const supporting = [];
  const selectedLast10 = selectedTeam.recentForm?.last10;
  const selectedLast5 = selectedTeam.recentForm?.last5;
  const relevantRecord = selectedTeam.relevantRecord;
  if (selectedLast10?.games) supporting.push(`${selectedTeam.name} is ${selectedLast10.wins}-${selectedLast10.losses} in its last ${selectedLast10.games}.`);
  if (supporting.length < 4 && relevantRecord) {
    supporting.push(`${selectedTeam.name} is ${relevantRecord.wins}-${relevantRecord.losses} ${selectedTeam.homeAway.toLowerCase()}.`);
  }
  if (supporting.length < 4 && selectedTeam.headToHead?.games) {
    supporting.push(`${selectedTeam.name} is ${selectedTeam.headToHead.wins}-${selectedTeam.headToHead.losses} against ${opponentTeam.name} this season.`);
  }
  if (supporting.length < 4 && selectedPitcher?.last3Starts?.era !== null) {
    supporting.push(`${selectedPitcher.name} has a ${selectedPitcher.last3Starts.era.toFixed(2)} ERA over ${selectedPitcher.last3Starts.starts} recent starts.`);
  }
  if (supporting.length < 4 && selectedPitcher?.season?.era) {
    supporting.push(`${selectedPitcher.name} owns a ${selectedPitcher.season.era} season ERA.`);
  }
  if (supporting.length < 4 && selectedLast5?.averageRunsScored !== null) {
    supporting.push(`${selectedTeam.name} has averaged ${selectedLast5.averageRunsScored} runs over its last ${selectedLast5.games} games.`);
  }

  const opponentLast10 = opponentTeam.recentForm?.last10;
  let riskStat = null;
  if (opponentLast10?.games) {
    riskStat = `${opponentTeam.name} is ${opponentLast10.wins}-${opponentLast10.losses} in its last ${opponentLast10.games}.`;
  } else if (opponentPitcher?.season?.era) {
    riskStat = `Opponent starter ${opponentPitcher.name} owns a ${opponentPitcher.season.era} season ERA.`;
  } else if (opponentTeam.relevantRecord) {
    riskStat = `${opponentTeam.name} is ${opponentTeam.relevantRecord.wins}-${opponentTeam.relevantRecord.losses} ${opponentTeam.homeAway.toLowerCase()}.`;
  }
  return { supporting: supporting.slice(0, 4), riskStat };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`MLB Stats API ${response.status}`);
  return response.json();
}

function makeUrl(path, params = {}) {
  const url = new URL(`${MLB_STATS_API}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchGameForSnapshot(snapshot, fetchImpl) {
  const gameId = clean(snapshot.gameId).replace(/^mlb-/, "");
  const payload = await fetchJson(fetchImpl, makeUrl("/schedule", {
    sportId: 1,
    gamePk: gameId,
    date: snapshot.slateDate,
    hydrate: "team,probablePitcher"
  }));
  const games = (payload.dates || []).flatMap((day) => day.games || []);
  return games.find((game) => String(game.gamePk) === gameId) || null;
}

async function fetchTeamContext({ team, opponentTeamId, homeAway, gameSide, snapshot, fetchImpl, cache }) {
  const teamId = team?.id;
  if (!teamId) throw new Error("MLB team identity unavailable");
  const cacheKey = `team:${teamId}:${snapshot.slateDate}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const season = new Date(`${snapshot.slateDate}T12:00:00Z`).getUTCFullYear();
      const [seasonStats, recentSchedule, seasonSchedule] = await Promise.all([
        fetchJson(fetchImpl, makeUrl(`/teams/${teamId}/stats`, { stats: "season", group: "hitting", season, gameType: "R" })),
        fetchJson(fetchImpl, makeUrl("/schedule", {
          sportId: 1,
          teamId,
          startDate: recentStartDate(snapshot.slateDate),
          endDate: previousDate(snapshot.slateDate),
          hydrate: "linescore,team",
          gameType: "R"
        })),
        fetchJson(fetchImpl, makeUrl("/schedule", {
          sportId: 1,
          teamId,
          startDate: seasonStartDate(snapshot.slateDate),
          endDate: previousDate(snapshot.slateDate),
          hydrate: "linescore,team",
          gameType: "R"
        }))
      ]);
      return {
        offense: normalizeOffense(seasonStat(seasonStats)),
        recentForm: summarizeRecentGames((recentSchedule.dates || []).flatMap((day) => day.games || []), teamId),
        seasonGames: (seasonSchedule.dates || []).flatMap((day) => day.games || [])
      };
    })());
  }
  const stats = await cache.get(cacheKey);
  return {
    name: team.name || "",
    id: teamId,
    homeAway,
    seasonRecord: normalizeRecord(gameSide?.leagueRecord),
    relevantRecord: summarizeVenueRecord(stats.seasonGames, teamId, homeAway.toLowerCase()) || normalizeRecord(gameSide?.leagueRecord),
    headToHead: opponentTeamId ? summarizeHeadToHead(stats.seasonGames, teamId, opponentTeamId) : null,
    recentForm: stats.recentForm,
    offense: stats.offense,
    bullpen: { status: "unavailable", message: "Bullpen data unavailable" }
  };
}

async function fetchPitcherContext(probablePitcher, snapshot, fetchImpl, cache) {
  if (!probablePitcher?.id) return { status: "tbd", name: "Starter TBD" };
  const pitcherId = probablePitcher.id;
  const cacheKey = `pitcher:${pitcherId}:${snapshot.slateDate}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const season = new Date(`${snapshot.slateDate}T12:00:00Z`).getUTCFullYear();
      const [person, stats, gameLog] = await Promise.all([
        fetchJson(fetchImpl, makeUrl(`/people/${pitcherId}`)),
        fetchJson(fetchImpl, makeUrl(`/people/${pitcherId}/stats`, { stats: "season", group: "pitching", season, gameType: "R" })),
        fetchJson(fetchImpl, makeUrl(`/people/${pitcherId}/stats`, { stats: "gameLog", group: "pitching", season, gameType: "R" }))
      ]);
      return normalizePitcher({ person, stats, gameLog, fallbackName: probablePitcher.fullName, slateDate: snapshot.slateDate });
    })());
  }
  return cache.get(cacheKey);
}

async function buildDailyPickStats({ contentId = "", snapshots = [], fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const cache = new Map();
  const picks = await Promise.all(snapshots.map(async (snapshot) => {
    try {
      const game = await fetchGameForSnapshot(snapshot, fetchImpl);
      if (!game) throw new Error("MLB game was not found for this frozen snapshot");
      const home = game.teams?.home || {};
      const away = game.teams?.away || {};
      const selectedName = clean(snapshot.selectedTeam).toLowerCase();
      const selectedIsHome = selectedName === clean(home.team?.name).toLowerCase() ||
        (selectedName !== clean(away.team?.name).toLowerCase() && clean(snapshot.homeOrAway).toLowerCase() === "home");
      const selectedSide = selectedIsHome ? home : away;
      const opponentSide = selectedIsHome ? away : home;
      const [selectedTeam, opponentTeam, selectedPitcher, opponentPitcher] = await Promise.all([
        fetchTeamContext({ team: selectedSide.team, opponentTeamId: opponentSide.team?.id, homeAway: selectedIsHome ? "HOME" : "AWAY", gameSide: selectedSide, snapshot, fetchImpl, cache }),
        fetchTeamContext({ team: opponentSide.team, opponentTeamId: selectedSide.team?.id, homeAway: selectedIsHome ? "AWAY" : "HOME", gameSide: opponentSide, snapshot, fetchImpl, cache }),
        fetchPitcherContext(selectedSide.probablePitcher, snapshot, fetchImpl, cache),
        fetchPitcherContext(opponentSide.probablePitcher, snapshot, fetchImpl, cache)
      ]);
      const callouts = buildSupportingStats({ selectedTeam, opponentTeam, selectedPitcher, opponentPitcher });
      return {
        snapshotId: snapshot.id,
        gameId: snapshot.gameId,
        selectedTeam,
        opponentTeam,
        selectedPitcher,
        opponentPitcher,
        supportingStats: callouts.supporting,
        riskStat: callouts.riskStat,
        dataSources: ["MLB Stats API"],
        unavailable: selectedTeam.bullpen.status === "unavailable" ? [selectedTeam.bullpen.message] : []
      };
    } catch (error) {
      return {
        snapshotId: snapshot.id,
        gameId: snapshot.gameId,
        selectedTeam: { name: snapshot.selectedTeam || "Frozen pick" },
        unavailable: ["Verified MLB statistics are unavailable for this pick right now."]
      };
    }
  }));
  return {
    contentId,
    slateDate: snapshots[0]?.slateDate || "",
    generatedAt: now,
    source: "MLB Stats API",
    picks
  };
}

module.exports = {
  MLB_STATS_API,
  summarizeRecentGames,
  summarizeVenueRecord,
  normalizeOffense,
  normalizePitcher,
  buildSupportingStats,
  buildDailyPickStats
};

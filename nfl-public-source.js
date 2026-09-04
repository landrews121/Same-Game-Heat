"use strict";

const ESPN_NFL_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

function normalizeDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!match) throw new Error("NFL date must use YYYY-MM-DD format");
  return `${match[1]}${match[2]}${match[3]}`;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function teamName(competitor) {
  return competitor?.team?.displayName || competitor?.team?.shortDisplayName || competitor?.team?.name || "";
}

function competitorMoneyline(competitor, competitionOdds) {
  const odds = Array.isArray(competitor?.odds) ? competitor.odds[0] : competitor?.odds;
  const marketMoneyline = competitionOdds?.moneyline;
  const teamKey = competitor?.team?.displayName || competitor?.team?.abbreviation || competitor?.team?.id;
  return firstNumber(
    competitor?.moneyline,
    competitor?.moneyLine,
    odds?.moneyline,
    odds?.moneyLine,
    odds?.price,
    typeof marketMoneyline === "object" ? marketMoneyline?.[teamKey] : null
  );
}

function parseEspnNflScoreboard(payload) {
  if (!Array.isArray(payload?.events)) return [];

  return payload.events.map((event) => {
    const competition = event.competitions?.[0] || {};
    const competitors = competition.competitors || [];
    const homeCompetitor = competitors.find((competitor) => competitor.homeAway === "home") || competitors[0] || {};
    const awayCompetitor = competitors.find((competitor) => competitor.homeAway === "away") || competitors[1] || {};
    const odds = competition.odds?.[0] || {};
    const homeTeam = teamName(homeCompetitor);
    const awayTeam = teamName(awayCompetitor);
    const homeMoneyline = competitorMoneyline(homeCompetitor, odds);
    const awayMoneyline = competitorMoneyline(awayCompetitor, odds);

    return {
      id: `espn-${event.id}`,
      commenceTime: event.date || "",
      homeTeam,
      awayTeam,
      moneylines: {
        ...(homeMoneyline === null ? {} : { [homeTeam]: homeMoneyline }),
        ...(awayMoneyline === null ? {} : { [awayTeam]: awayMoneyline })
      },
      home: {
        name: homeTeam,
        abbreviation: homeCompetitor.team?.abbreviation || "",
        moneyline: homeMoneyline
      },
      away: {
        name: awayTeam,
        abbreviation: awayCompetitor.team?.abbreviation || "",
        moneyline: awayMoneyline
      },
      spread: odds.details || odds.spread || null,
      total: firstNumber(odds.overUnder, odds.total),
      status: event.status?.type?.name || competition.status?.type?.name || "scheduled",
      candidates: [],
      source: "ESPN public scoreboard"
    };
  }).filter((game) => game.homeTeam && game.awayTeam);
}

function espnNflScoreboardUrl(date) {
  const url = new URL(ESPN_NFL_SCOREBOARD_URL);
  url.searchParams.set("dates", normalizeDate(date));
  return url.toString();
}

module.exports = {
  ESPN_NFL_SCOREBOARD_URL,
  normalizeDate,
  espnNflScoreboardUrl,
  parseEspnNflScoreboard
};

'use strict';

const { TICKERS, FETCH_TICKERS } = require('./db');

function orderSuffix(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: parse game scoreboard response
// ─────────────────────────────────────────────────────────────────────────────
function parseESPNGames(data, sport = 'NBA') {
  return (data.events || []).map(ev => {
    const comp = ev.competitions[0];
    const home = comp.competitors.find(c => c.homeAway === 'home') || {};
    const away = comp.competitors.find(c => c.homeAway === 'away') || {};
    const homeWon = home.winner === true;
    return {
      id: ev.id,
      name: ev.name,
      shortName: ev.shortName,
      status: comp.status?.type?.description || 'Final',
      statusState: ev.status?.type?.state || 'post',
      note: comp.notes?.[0]?.headline || '',
      seriesNote: comp.series?.summary || '',
      sport,
      home: {
        team: home.team?.displayName || '',
        abbrev: home.team?.abbreviation || '',
        score: home.score || '0',
        winner: homeWon,
      },
      away: {
        team: away.team?.displayName || '',
        abbrev: away.team?.abbreviation || '',
        score: away.score || '0',
        winner: !homeWon,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: NBA scores — tries ONLY yesterday to prevent repeating stale games
// ─────────────────────────────────────────────────────────────────────────────
async function fetchNBA(dateStr) {
  const tryDate = async (ds) => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ds}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return parseESPNGames(data, 'NBA').filter(g => g.status === 'Final');
  };

  if (dateStr) return tryDate(dateStr);

  // Only try yesterday — avoids repeating a game that aired 2-3 days ago
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
  return tryDate(ds);
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: upcoming NBA games (today + next 2 days) for preview/schedule context
// ─────────────────────────────────────────────────────────────────────────────
async function fetchNBAUpcoming() {
  const scheduled = [];
  for (let daysAhead = 0; daysAhead <= 2; daysAhead++) {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${ds}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      const games = parseESPNGames(data, 'NBA').filter(g => g.status !== 'Final');
      games.forEach(g => scheduled.push({ ...g, daysAhead }));
    } catch (_) {}
  }
  return scheduled;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: game highlights meta — featured image + recap URL for any sport
// Returns { imageUrl, recapUrl, headlineText } or null
// ─────────────────────────────────────────────────────────────────────────────
async function fetchGameMeta(gameId, sport = 'nba') {
  const sportPath = sport === 'nba' ? 'basketball/nba' : 'baseball/mlb';
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${gameId}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();

    // Featured image from header
    const comp = data.header?.competitions?.[0];
    const headlines = comp?.headlines || data.gameInfo?.venue?.headlines || [];
    const imageUrl = headlines[0]?.image?.href || null;

    // ESPN recap URL
    const recapUrl = `https://www.espn.com/${sport}/recap/_/gameId/${gameId}`;

    // Key headline text
    const headlineText = headlines[0]?.shortLinkText || headlines[0]?.description || null;

    return { imageUrl, recapUrl, headlineText };
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: NBA box score — player stats for a completed game
// Returns top performers sorted by points
// ─────────────────────────────────────────────────────────────────────────────
async function fetchNBABoxScore(gameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();

    const performers = [];
    (data.boxscore?.players || []).forEach(teamStats => {
      const teamName = teamStats.team?.shortDisplayName || teamStats.team?.displayName || '';
      (teamStats.statistics || []).forEach(statGroup => {
        const labels = statGroup.labels || [];
        const ptsIdx = labels.indexOf('PTS');
        const rebIdx = labels.indexOf('REB');
        const astIdx = labels.indexOf('AST');
        if (ptsIdx < 0) return;
        (statGroup.athletes || []).forEach(a => {
          const stats = a.stats || [];
          const pts = parseInt(stats[ptsIdx]) || 0;
          if (pts >= 10) {
            performers.push({
              name: a.athlete?.displayName || '',
              team: teamName,
              pts: stats[ptsIdx] || '0',
              reb: rebIdx >= 0 ? (stats[rebIdx] || '0') : '',
              ast: astIdx >= 0 ? (stats[astIdx] || '0') : '',
            });
          }
        });
      });
    });

    performers.sort((a, b) => parseInt(b.pts) - parseInt(a.pts));
    return performers.length ? performers.slice(0, 6) : null;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: MLB scores for yesterday (fallback when no NBA)
// Returns top 3 highest-scoring games
// ─────────────────────────────────────────────────────────────────────────────
async function fetchMLB() {
  for (let daysBack = 1; daysBack <= 2; daysBack++) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${ds}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      const games = parseESPNGames(data, 'MLB');
      if (games.length) {
        return games
          .sort((a, b) => (parseInt(b.home.score) + parseInt(b.away.score)) - (parseInt(a.home.score) + parseInt(a.away.score)))
          .slice(0, 3);
      }
    } catch (_) {}
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: F1 scoreboard — most recent race or upcoming grand prix
// ─────────────────────────────────────────────────────────────────────────────
async function fetchF1() {
  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard';
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const ev = data.events?.[0];
    if (!ev) return null;

    // SAFEGUARD: current season only — never publish a stale/cached cross-season race.
    const CURRENT_YEAR = new Date().getUTCFullYear();
    const year = ev.season?.year || data.leagues?.[0]?.season?.year;
    if (year && year !== CURRENT_YEAR) return null;

    // An F1 event has 5 sessions (FP1, FP2, FP3, Qualifying, Race). competitions[0]
    // is Free Practice 1 — NOT the race. Select the correct session, and only ever
    // report RESULTS when the actual Race is live or final (never practice/qualifying
    // order presented as race results).
    const comps = (ev.competitions || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const stateOf = (c) => c?.status?.type?.state;
    const race = comps.find((c) => c.type?.abbreviation === 'Race') || comps[comps.length - 1];
    const liveSession = comps.find((c) => stateOf(c) === 'in');
    const raceIsLive = liveSession && (liveSession === race || liveSession.type?.abbreviation === 'Race');

    let board = null, statusState = 'pre', statusDesc = 'Upcoming';
    if (raceIsLive) {
      board = race; statusState = 'in';
      statusDesc = race.status?.type?.description || 'Race in progress';
    } else if (race && stateOf(race) === 'post') {
      board = race; statusState = 'post';
      statusDesc = race.status?.type?.description || 'Final';
    } else {
      // Upcoming (or only practice/qualifying complete) — do NOT present as results.
      board = null; statusState = 'pre';
      statusDesc = race?.status?.type?.shortDetail || ev.status?.type?.description || 'Upcoming';
    }

    const results = board
      ? (board.competitors || [])
          .sort((a, b) => (a.order || 99) - (b.order || 99))
          .slice(0, 5)
          .map((c, i) => ({
            pos: c.order || i + 1,
            driver: c.athlete?.displayName || 'Unknown',
            team: c.team?.shortDisplayName || c.team?.displayName || '',
            time: c.time || c.score || '',
          }))
          .filter((c) => c.driver !== 'Unknown')
      : [];

    return {
      name: ev.name || 'Formula 1',
      shortName: ev.shortName || ev.name || 'F1',
      venue: ev.venue?.fullName || ev.circuit?.fullName || '',
      status: statusDesc,
      statusState,
      results,
    };
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: FIFA World Cup scoreboard (active during tournament)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWorldCup() {
  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const events = (data.events || []).slice(0, 4);
    if (!events.length) return null;

    return events.map(ev => {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home') || {};
      const away = comp?.competitors?.find(c => c.homeAway === 'away') || {};
      return {
        name: ev.name,
        shortName: ev.shortName || ev.name,
        status: comp?.status?.type?.description || '',
        statusState: ev.status?.type?.state || 'pre',
        date: ev.date,
        home: { team: home.team?.displayName || '', score: home.score || '' },
        away: { team: away.team?.displayName || '', score: away.score || '' },
      };
    });
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finnhub: market quotes with weekly change
// ─────────────────────────────────────────────────────────────────────────────
async function fetchMarkets() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key || key.includes('your_') || key.includes('_here')) return null;

  const results = {};
  const now = Math.floor(Date.now() / 1000);
  const tenDaysAgo = now - 10 * 24 * 60 * 60;

  for (const sym of FETCH_TICKERS) {
    const cfg = TICKERS[sym];
    if (!cfg?.finnhub) continue;

    try {
      const encoded = encodeURIComponent(cfg.finnhub);
      const isCrypto = cfg.finnhub.includes(':');

      const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encoded}&token=${key}`);
      const q = quoteRes.ok ? await quoteRes.json() : {};

      await new Promise(r => setTimeout(r, 120));
      const candleBase = isCrypto ? 'crypto/candle' : 'stock/candle';
      const candleRes = await fetch(
        `https://finnhub.io/api/v1/${candleBase}?symbol=${encoded}&resolution=D&from=${tenDaysAgo}&to=${now}&token=${key}`
      );
      let weekChangePct = null;
      if (candleRes.ok) {
        const c = await candleRes.json();
        if (c.s === 'ok' && c.c?.length >= 2) {
          const closes = c.c;
          const weekStart = closes[Math.max(0, closes.length - 6)];
          const latest = closes[closes.length - 1];
          if (weekStart && weekStart !== 0) {
            weekChangePct = ((latest - weekStart) / weekStart) * 100;
          }
        }
      }

      results[sym] = {
        price: q.c ?? null,
        prevClose: q.pc ?? null,
        dayChange: q.d ?? null,
        dayChangePct: q.dp ?? null,
        weekChangePct,
      };
    } catch (_) {
      results[sym] = null;
    }

    await new Promise(r => setTimeout(r, 220));
  }

  // 10Y Treasury yield via Yahoo Finance (^TNX) — no API key required
  try {
    const yRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=6d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (yRes.ok) {
      const yj = await yRes.json();
      const result = yj?.chart?.result?.[0];
      const closes = result?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
      const meta = result?.meta || {};
      const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
      const prevClose = meta.previousClose ?? closes[closes.length - 2] ?? null;
      const dayChangePct = (price && prevClose) ? ((price - prevClose) / prevClose) * 100 : null;
      const weekStart = closes[Math.max(0, closes.length - 6)];
      const weekChangePct = (weekStart && price) ? ((price - weekStart) / weekStart) * 100 : null;
      results['10Y'] = { price, prevClose, dayChange: price && prevClose ? price - prevClose : null, dayChangePct, weekChangePct };
    }
  } catch (_) {}

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: active PGA Tour leaderboard
// ─────────────────────────────────────────────────────────────────────────────
async function fetchGolf() {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const ev = data.events?.[0];
    if (!ev) return null;

    const comp = ev.competitions?.[0];
    const statusDetail = comp?.status?.type?.detail || ev.status?.type?.description || '';
    const statusState = ev.status?.type?.state || 'pre';

    const leaders = (comp?.competitors || [])
      .sort((a, b) => (a.order || 99) - (b.order || 99))
      .slice(0, 10)
      .map((c, i) => ({
        name: c.athlete?.displayName || 'Unknown',
        espnId: c.athlete?.id,
        score: c.score || 'E',
        pos: orderSuffix(c.order || i + 1),
      }))
      .filter(c => c.name !== 'Unknown');

    return {
      name: ev.name || 'PGA Tour',
      venue: ev.venue?.fullName || '',
      status: statusDetail,
      statusState,
      leaders,
    };
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Culture/trending: Reddit hot posts + optional NewsAPI headlines
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTrending() {
  const items = [];

  const subs = ['nba', 'formula1', 'soccer', 'investing', 'golf', 'baseball', 'movies', 'entertainment'];
  for (const sub of subs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=5`, {
        headers: { 'User-Agent': 'GuyTalk-Brief-Generator/1.0 (guytalkdaily@gmail.com)' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.data?.children || []).forEach(p => {
        items.push({
          title: p.data.title,
          url: `https://reddit.com${p.data.permalink}`,
          score: p.data.score,
          source: `r/${sub}`,
        });
      });
    } catch (_) {}
    await new Promise(r => setTimeout(r, 350));
  }

  const newsKey = process.env.NEWS_API_KEY;
  if (newsKey) {
    for (const cat of ['entertainment', 'sports']) {
      try {
        const res = await fetch(
          `https://newsapi.org/v2/top-headlines?country=us&category=${cat}&pageSize=5&apiKey=${newsKey}`
        );
        if (!res.ok) continue;
        const data = await res.json();
        (data.articles || []).forEach(a => {
          items.push({
            title: a.title,
            url: a.url,
            description: a.description,
            source: a.source?.name,
          });
        });
      } catch (_) {}
    }
  }

  return items;
}

module.exports = { fetchNBA, fetchNBAUpcoming, fetchNBABoxScore, fetchGameMeta, fetchMLB, fetchF1, fetchWorldCup, fetchMarkets, fetchGolf, fetchTrending };

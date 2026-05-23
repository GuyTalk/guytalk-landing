'use strict';

const { TICKERS, FETCH_TICKERS } = require('./db');

function orderSuffix(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: NBA scores for a given date (YYYYMMDD string, defaults to yesterday)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchNBA(dateStr) {
  if (!dateStr) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
  if (!res.ok) throw new Error(`ESPN NBA ${res.status}`);
  const data = await res.json();

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
      note: comp.notes?.[0]?.headline || '',
      seriesNote: comp.series?.summary || '',   // e.g. "OKC leads series 2-1"
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
// Finnhub: current quote for each ticker in FETCH_TICKERS
// Returns { SPY: { price, dayChange, dayChangePct, prevClose }, ... }
// ─────────────────────────────────────────────────────────────────────────────
async function fetchMarkets() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key || key.includes('your_') || key.includes('_here')) return null;

  const results = {};

  for (const sym of FETCH_TICKERS) {
    const cfg = TICKERS[sym];
    if (!cfg?.finnhub) continue;

    try {
      const encoded = encodeURIComponent(cfg.finnhub);
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encoded}&token=${key}`);
      if (!res.ok) { results[sym] = null; continue; }
      const q = await res.json();
      results[sym] = {
        price:        q.c  ?? null,
        prevClose:    q.pc ?? null,
        dayChange:    q.d  ?? null,
        dayChangePct: q.dp ?? null,
      };
    } catch (_) {
      results[sym] = null;
    }

    // Stay well under Finnhub's 60 req/min free-tier limit
    await new Promise(r => setTimeout(r, 220));
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: active PGA Tour leaderboard
// ─────────────────────────────────────────────────────────────────────────────
async function fetchGolf() {
  const endpoints = [
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard',
    'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
  ];

  // Only try the scoreboard — leaderboard endpoint consistently returns 404
  const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const ev = data.events?.[0];
    if (!ev) return null;

    // Competitors live under competitions[0], sorted by order (1 = leader)
    const comp = ev.competitions?.[0];
    const statusDetail = comp?.status?.type?.detail || ev.status?.type?.description || '';
    const statusState  = ev.status?.type?.state || 'pre';

    const leaders = (comp?.competitors || [])
      .sort((a, b) => (a.order || 99) - (b.order || 99))
      .slice(0, 10)
      .map((c, i) => ({
        name:   c.athlete?.displayName || 'Unknown',
        espnId: c.athlete?.id,
        score:  c.score || 'E',
        pos:    orderSuffix(c.order || i + 1),
      }))
      .filter(c => c.name !== 'Unknown');

    return {
      name:        ev.name || 'PGA Tour',
      venue:       ev.venue?.fullName || '',
      status:      statusDetail,
      statusState,                                // 'pre' | 'in' | 'post'
      leaders,
    };
  } catch (_) {
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Culture/trending: Reddit hot posts + optional NewsAPI headlines
// Used only as editorial suggestions (shown in HTML comments).
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTrending() {
  const items = [];

  const subs = ['nba', 'golf', 'investing', 'entertainment'];
  for (const sub of subs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=5`, {
        headers: { 'User-Agent': 'GuyTalk-Brief-Generator/1.0 (guytalkdaily@gmail.com)' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      (data.data?.children || []).forEach(p => {
        items.push({
          title:  p.data.title,
          url:    `https://reddit.com${p.data.permalink}`,
          score:  p.data.score,
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
            title:       a.title,
            url:         a.url,
            description: a.description,
            source:      a.source?.name,
          });
        });
      } catch (_) {}
    }
  }

  return items;
}

module.exports = { fetchNBA, fetchMarkets, fetchGolf, fetchTrending };

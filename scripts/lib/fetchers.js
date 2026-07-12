'use strict';

const { TICKERS, FETCH_TICKERS, CORE_TICKERS, MOVERS_WATCHLIST, MOVERS_COUNT, LARGECAP_UNIVERSE, CRYPTO_UNIVERSE } = require('./db');

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
      date: ev.date || comp.date || null,   // ISO start time (for tip-off / first-pitch)
      venue: comp.venue?.fullName || '',
      venueCity: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(', '),
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
// ESPN: NHL — most recent final + next upcoming game (with venue/date)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchNHL() {
  const get = async (ds) => {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard${ds ? `?dates=${ds}` : ''}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
      if (!res.ok) return [];
      return parseESPNGames(await res.json(), 'NHL');
    } catch (_) { return []; }
  };
  const d = new Date(); d.setDate(d.getDate() - 1);
  const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
  const yfinals = (await get(ds)).filter(g => g.status === 'Final');
  const cur = await get();
  const final = yfinals[0] || cur.find(g => g.status === 'Final') || null;
  const next = cur.find(g => g.statusState === 'pre') || null;
  if (!final && !next) return null;
  return { final, next };
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPN: UFC — most recent completed card's main event + full fight card, or the
// next scheduled card if nothing has happened yet. Cards run Fri/Sat night US
// time and can straddle a UTC day boundary, so check yesterday then today.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchUFC() {
  const get = async (ds) => {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard${ds ? `?dates=${ds}` : ''}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
      if (!res.ok) return [];
      const data = await res.json();
      return data.events || [];
    } catch (_) { return []; }
  };
  const d = new Date(); d.setDate(d.getDate() - 1);
  const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
  const events = [...(await get(ds)), ...(await get())];
  const ev = events.find(e => e.status?.type?.state === 'post') || events.find(e => e.status?.type?.state === 'pre');
  if (!ev) return null;

  const isPost = ev.status?.type?.state === 'post';
  const comps = (ev.competitions || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  // Main event is scheduled last (the headliner walks out last).
  const mainComp = comps[comps.length - 1];
  if (!mainComp) return null;

  const toFight = (c) => {
    const fighters = (c.competitors || []).slice().sort((a, b) => (a.order || 9) - (b.order || 9));
    const winner = fighters.find(f => f.winner === true);
    const loser  = fighters.find(f => f.winner === false);
    if (!winner || !loser) return null;
    const scheduledRounds = c.format?.regulation?.periods || null;
    const round = c.status?.period ?? null;
    // Went the full scheduled distance = decision. Otherwise it finished early
    // (KO/TKO/submission) — ESPN's feed doesn't expose the exact method.
    const wentToDecision = !!(scheduledRounds && round && round >= scheduledRounds);
    return {
      weightClass: c.type?.text || c.type?.abbreviation || '',
      winner: winner.athlete?.displayName || null,
      loser: loser.athlete?.displayName || null,
      round, time: c.status?.displayClock || null,
      scheduledRounds, wentToDecision,
    };
  };

  const mainEvent = isPost ? toFight(mainComp) : null;
  const card = isPost ? comps.slice(0, -1).map(toFight).filter(Boolean) : [];
  const venue = mainComp.venue || comps[0]?.venue || {};

  return {
    name: ev.name || ev.shortName || 'UFC',
    shortName: ev.shortName || ev.name || 'UFC',
    date: ev.date || null,
    venue: venue.fullName || '',
    venueCity: [venue.address?.city, venue.address?.state].filter(Boolean).join(', '),
    statusState: isPost ? 'post' : 'pre',
    status: ev.status?.type?.description || (isPost ? 'Final' : 'Upcoming'),
    mainEvent,
    card,
  };
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

    // ESPN's F1 feed has no constructor or season stats, so enrich from Jolpica:
    // real team + real season wins + championship position. This both prevents
    // team hallucination and gives the copy a genuine, sourced "bring up" stat.
    let champLeader = null;
    try {
      const sres = await fetch('https://api.jolpi.ca/ergast/f1/current/driverStandings.json', { headers: { 'User-Agent': 'GuyTalk/1.0' } });
      if (sres.ok) {
        const sd = await sres.json();
        const list = sd?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
        const byLast = {};
        for (const d of list) {
          const last = (d.Driver?.familyName || '').toLowerCase();
          if (last) byLast[last] = {
            team: d.Constructors?.[0]?.name || '',
            wins: d.wins != null ? Number(d.wins) : null,
            pos: d.position != null ? Number(d.position) : null,
            points: d.points != null ? Number(d.points) : null,
          };
        }
        for (const r of results) {
          const last = r.driver.split(' ').pop().toLowerCase();
          const s = byLast[last];
          if (s) {
            if (!r.team && s.team) r.team = s.team;
            r.seasonWins = s.wins;        // real season win count (not a streak)
            r.champPos = s.pos;           // championship position
            r.champPoints = s.points;     // championship points
          }
        }
        const L = list[0];
        if (L) champLeader = {
          name: `${L.Driver?.givenName || ''} ${L.Driver?.familyName || ''}`.trim(),
          points: L.points != null ? Number(L.points) : null,
          lead: list[1]?.points != null && L.points != null ? Number(L.points) - Number(list[1].points) : null,
        };
      }
    } catch (_) { /* leave stats blank rather than guess */ }

    // Next race on the calendar (so a completed weekend can pivot to a preview).
    // Best-effort: the scoreboard exposes the season schedule under leagues[].calendar.
    let nextRace = null;
    try {
      const cal = data.leagues?.[0]?.calendar || [];
      const now = Date.now();
      const entries = cal
        .map((c) => (typeof c === 'string'
          ? { label: '', startDate: c }
          : { label: c.label || c.event?.shortName || '', startDate: c.startDate || c.event?.date || c.date, endDate: c.endDate }))
        .filter((c) => c.startDate)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      // First weekend whose end (or start) is still ahead of the current event.
      const curEnd = race?.date ? new Date(race.date).getTime() : now;
      const nxt = entries.find((c) => new Date(c.endDate || c.startDate).getTime() > Math.max(now, curEnd));
      if (nxt && nxt.label && nxt.label !== (ev.name || '')) {
        const daysAway = Math.max(0, Math.round((new Date(nxt.startDate).getTime() - now) / 86400000));
        nextRace = { name: nxt.label, date: nxt.startDate, daysAway };
      }
    } catch (_) { /* leave nextRace null — section behaves as before */ }

    return {
      name: ev.name || 'Formula 1',
      shortName: ev.shortName || ev.name || 'F1',
      venue: ev.venue?.fullName || ev.circuit?.fullName || '',
      status: statusDesc,
      statusState,
      champLeader,
      results,
      nextRace,
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
    const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

    function parseEvents(events) {
      return events.map(ev => {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find(c => c.homeAway === 'home') || {};
        const away = comp?.competitors?.find(c => c.homeAway === 'away') || {};
        // Extract goal scorers from competition details
        const details = comp?.details || [];
        const goals = details
          .filter(d => (d.type?.text || '').toLowerCase().includes('goal') || (d.type?.text || '').toLowerCase().includes('penalty'))
          .map(d => ({
            player: d.athletes?.[0]?.displayName || d.athletesInvolved?.[0]?.displayName || '',
            team: d.team?.displayName || '',
            clock: d.clock?.displayValue || '',
            type: d.type?.text || '',
          }))
          .filter(g => g.player);
        const headline = comp?.notes?.[0]?.headline || comp?.headlines?.[0]?.description || '';
        return {
          name: ev.name,
          shortName: ev.shortName || ev.name,
          status: comp?.status?.type?.description || '',
          statusState: ev.status?.type?.state || 'pre',
          date: ev.date,
          home: { team: home.team?.displayName || '', score: home.score || '' },
          away: { team: away.team?.displayName || '', score: away.score || '' },
          goals,
          espnNote: headline,
        };
      });
    }

    // Fetch today's AND yesterday's scoreboards so the brief can recap completed games
    const today     = new Date();
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

    const [todayRes, yestRes] = await Promise.all([
      fetch(BASE, { headers: { 'User-Agent': 'GuyTalk/1.0' } }),
      fetch(`${BASE}?dates=${fmt(yesterday)}`, { headers: { 'User-Agent': 'GuyTalk/1.0' } }),
    ]);

    const todayEvents    = todayRes.ok    ? parseEvents((await todayRes.json()).events    || []) : [];
    const yesterdayEvents = yestRes.ok   ? parseEvents((await yestRes.json()).events     || []) : [];

    // Completed games from yesterday are the most actionable — put them first
    const completed  = yesterdayEvents.filter(e => e.statusState === 'post');
    const scheduled  = todayEvents.filter(e => e.statusState === 'pre' || e.statusState === 'in');

    const all = [...completed, ...scheduled].slice(0, 8);
    return all.length ? all : null;
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Market session timing (US/ET) — so the brief never calls a stale close "today".
// Returns an honest table label + a framing instruction for the copy model.
// ─────────────────────────────────────────────────────────────────────────────
function marketTiming(d = new Date()) {
  const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...opts });
  const wd = fmt({ weekday: 'short' }).format(d);
  const hour = Number(fmt({ hour: '2-digit', hour12: false }).format(d)) % 24;
  const minute = Number(fmt({ minute: '2-digit' }).format(d));
  const longDate = (dt) => fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(dt);
  const isWeekend = wd === 'Sat' || wd === 'Sun';
  const mins = hour * 60 + minute;
  const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;

  const prevTradingDay = () => {
    const dt = new Date(d);
    do { dt.setUTCDate(dt.getUTCDate() - 1); } while (['Sat', 'Sun'].includes(fmt({ weekday: 'short' }).format(dt)));
    return dt;
  };

  if (isWeekend) {
    const fri = prevTradingDay();
    return { state: 'weekend', tableTitle: 'Last close', tableSub: `${longDate(fri)} · markets closed for the weekend`,
      framing: `US stock markets are CLOSED (weekend). Figures are last Friday's close (${longDate(fri)}). NEVER say "today" for the move — say "closed Friday at" and you may frame "heading into next week". No invented direction.` };
  }
  if (mins < OPEN) {
    const prev = prevTradingDay();
    return { state: 'preopen', tableTitle: 'Last close', tableSub: `${longDate(prev)} · U.S. markets open 9:30 AM ET`,
      framing: `US stock markets have NOT opened yet today. Figures are the prior session's close (${longDate(prev)}). NEVER say "today" for the move — say "closed [that day] at". You may say markets are "looking to open" today, but do NOT predict a direction (no futures data provided).` };
  }
  if (mins >= CLOSE) {
    return { state: 'closed_today', tableTitle: "Today's close", tableSub: longDate(d),
      framing: `US stock markets have CLOSED for today. You may say "today" and describe today's close.` };
  }
  return { state: 'open', tableTitle: 'Markets open', tableSub: `as of ${fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).format(d)} ET today`,
    framing: `US stock markets are OPEN right now (intraday). Use present tense — "is trading", "up/down on the day so far". Do NOT say "closed".` };
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

  // Core indices get the full treatment (price + day + week change). Movers
  // only need a quote (price + day %) — keeps the call count well under the
  // Finnhub free-tier rate limit across the ~17-symbol watchlist.
  const coreSet = new Set(CORE_TICKERS);

  for (const sym of FETCH_TICKERS) {
    const cfg = TICKERS[sym];
    if (!cfg?.finnhub) continue;
    const wantWeek = coreSet.has(sym);

    try {
      const encoded = encodeURIComponent(cfg.finnhub);
      const isCrypto = cfg.finnhub.includes(':');

      const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encoded}&token=${key}`);
      const q = quoteRes.ok ? await quoteRes.json() : {};

      let weekChangePct = null;
      if (wantWeek) {
        await new Promise(r => setTimeout(r, 120));
        const candleBase = isCrypto ? 'crypto/candle' : 'stock/candle';
        const candleRes = await fetch(
          `https://finnhub.io/api/v1/${candleBase}?symbol=${encoded}&resolution=D&from=${tenDaysAgo}&to=${now}&token=${key}`
        );
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

    await new Promise(r => setTimeout(r, wantWeek ? 220 : 130));
  }

  // Pick the day's biggest movers from the watchlist (by absolute % move) so the
  // featured individual names rotate day to day instead of being a fixed list.
  results.__dynamicMovers = (MOVERS_WATCHLIST || [])
    .map(sym => ({ sym, pct: results[sym]?.dayChangePct }))
    .filter(m => m.pct !== null && m.pct !== undefined && Number.isFinite(m.pct))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, MOVERS_COUNT || 5)
    .map(m => m.sym);

  // Sparklines + reliable week % for the equity indices (Yahoo, keyless).
  // Finnhub's candle endpoint is premium, so we source the series from Yahoo.
  for (const sym of ['SPY', 'DIA', 'QQQ', 'IWM']) {
    if (!results[sym]) continue;
    const sp = await fetchYahooSpark(sym);
    if (sp) {
      results[sym].spark = sp.closes;
      if (results[sym].weekChangePct == null) results[sym].weekChangePct = sp.weekChangePct;
      if (results[sym].price == null) results[sym].price = sp.price;
    }
  }

  // Real index levels via Yahoo Finance (^GSPC, ^DJI, ^IXIC, ^RUT) — keyless.
  // Stored as results[sym].indexPrice / indexDisplay / indexDayChangePct so all
  // sections (market tiles, Rundown bullet, Sharp Take) use the same true index
  // values — never ETF dollar prices or independently calculated moves.
  for (const sym of ['SPY', 'DIA', 'QQQ', 'IWM']) {
    const cfg = TICKERS[sym];
    if (!cfg?.indexYahoo || !results[sym]) continue;
    try {
      const sp = await fetchYahooSpark(cfg.indexYahoo);
      if (sp?.price) {
        results[sym].indexPrice = sp.price;
        results[sym].indexDisplay = cfg.indexDisplay;
        // True index day % — same source as the index level card.
        // All prose sections must use this; never the ETF's dayChangePct.
        if (sp.prevClose && sp.price) {
          results[sym].indexDayChangePct = ((sp.price - sp.prevClose) / sp.prevClose) * 100;
        }
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 120));
  }

  // 10Y Treasury yield via Yahoo Finance (^TNX) — no API key required
  try {
    const yRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=1mo',
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
      results['10Y'] = { price, prevClose, dayChange: price && prevClose ? price - prevClose : null, dayChangePct, weekChangePct, spark: closes.slice(-22) };
    }
  } catch (_) {}

  // Honest session label + copy framing (non-iterable meta key).
  results.__meta = marketTiming();

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Yahoo Finance daily series (keyless) — for index sparklines + accurate week %.
// Returns { closes:[...], price, prevClose, weekChangePct } or null.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchYahooSpark(yahooSymbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    if (closes.length < 2) return null;
    const meta = result?.meta || {};
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prevClose = meta.previousClose ?? closes[closes.length - 2];
    const weekStart = closes[Math.max(0, closes.length - 6)];
    const weekChangePct = (weekStart && price) ? ((price - weekStart) / weekStart) * 100 : null;
    return { closes: closes.slice(-22), price, prevClose, weekChangePct };
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Modeling Prep: market-WIDE screeners — Top Gainers, Top Losers,
// Most Active. This is the real thing (whole market), not a curated watchlist.
// Free tier covers these endpoints. Returns null (caller falls back) if no key.
// ─────────────────────────────────────────────────────────────────────────────
// Builds Top Gainers / Losers / Most Active from a curated LARGE-CAP + CRYPTO
// universe (recognizable names only, never penny stocks) using FMP per-symbol
// quotes (free-tier; batch is paid). Gainers/losers by % move, most-active by
// volume. Crypto is mixed in so there's always a coin in the running.
async function fetchMarketScreeners(limit = 4) {
  const key = process.env.FMP_API_KEY;
  if (!key || key.includes('your_') || key.includes('_here')) return null;

  const symbols = [...(LARGECAP_UNIVERSE || []), ...(CRYPTO_UNIVERSE || [])];
  const isCrypto = (s) => /USD$/.test(s) && (CRYPTO_UNIVERSE || []).includes(s);
  const disp = (s) => isCrypto(s) ? s.replace(/USD$/, '') : s;

  const quote = async (sym) => {
    try {
      const res = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(sym)}&apikey=${key}`);
      if (!res.ok) return null;
      const r = (await res.json())?.[0];
      if (!r) return null;
      const pct = r.changePercentage ?? r.changesPercentage;
      return {
        symbol: disp(sym),
        name: r.name || disp(sym),
        price: typeof r.price === 'number' ? r.price : parseFloat(r.price),
        changePct: Number.isFinite(pct) ? pct : null,
        volume: r.volume ?? 0,
        crypto: isCrypto(sym),
      };
    } catch (_) { return null; }
  };

  // Bounded concurrency so we stay polite on the free tier.
  const rows = [];
  const POOL = 6;
  for (let i = 0; i < symbols.length; i += POOL) {
    const batch = await Promise.all(symbols.slice(i, i + POOL).map(quote));
    rows.push(...batch.filter(r => r && r.changePct !== null));
  }
  if (!rows.length) return null;

  const byPctDesc = [...rows].sort((a, b) => b.changePct - a.changePct);
  const strip = (r) => ({ symbol: r.symbol, name: r.name, price: r.price, changePct: r.changePct });

  // Gainers/losers from the full universe (a coin shows up when it's a big mover).
  // Most Active = top stocks by volume + one crypto, so it stays recognizable
  // (crypto volume otherwise dwarfs every stock) while guaranteeing crypto presence.
  const stocksByVol = rows.filter(r => !r.crypto).sort((a, b) => (b.volume || 0) - (a.volume || 0));
  const cryptoByVol = rows.filter(r => r.crypto).sort((a, b) => (b.volume || 0) - (a.volume || 0));
  const actives = [...stocksByVol.slice(0, Math.max(1, limit - 1)), ...cryptoByVol.slice(0, 1)];

  return {
    gainers: byPctDesc.filter(r => r.changePct > 0).slice(0, limit).map(strip),
    losers:  byPctDesc.filter(r => r.changePct < 0).slice(-limit).reverse().map(strip),
    actives: actives.map(strip),
  };
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

    const addr = comp?.venue?.address || ev.venue?.address || {};
    const location = [addr.city, addr.state || addr.country].filter(Boolean).join(', ');

    // Detect if competitive play has actually started: at least one player has
    // a score that is not E (even par). If everyone is at E, the tournament field
    // has been announced but no rounds have been played yet.
    const hasStarted = leaders.some(l => {
      const s = (l.score || '').trim();
      return s !== '' && s !== 'E' && s !== '0' && s !== '+0';
    });

    return {
      name: ev.name || 'PGA Tour',
      venue: comp?.venue?.fullName || ev.venue?.fullName || '',
      location,
      date: ev.date || comp?.date || null,
      endDate: ev.endDate || null,
      status: statusDetail,
      statusState: hasStarted ? statusState : (statusState === 'post' ? 'post' : 'pre'),
      hasStarted,
      leaders: hasStarted ? leaders : [],
    };
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tennis (ATP + WTA). Tournaments carry a `major` flag = Grand Slam. Singles
// results live under groupings. Real data only — no fabricated matches.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTennis() {
  const tours = [['atp', 'ATP'], ['wta', 'WTA']];
  const out = [];
  for (const [slug, label] of tours) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${slug}/scoreboard`, { headers: { 'User-Agent': 'GuyTalk/1.0' } });
      if (!res.ok) continue;
      const data = await res.json();
      const events = data.events || [];
      if (!events.length) continue;
      // Prefer a Grand Slam; otherwise the featured event of the week.
      const ev = events.find(e => e.major) || events[0];
      const addr = ev.venue?.address || {};
      // Match the tour's own draw (combined events expose both Men's & Women's
      // Singles, so the wrong one would attribute men's results under WTA).
      const wantGender = label === 'WTA' ? /women/i : /\bmen/i;
      const groupings = ev.groupings || [];
      const singles = groupings.find(g => {
        const n = g.grouping?.displayName || g.grouping?.name || '';
        return /singles/i.test(n) && wantGender.test(n);
      }) || groupings.find(g => /singles/i.test(g.grouping?.displayName || g.grouping?.name || ''));

      const results = [];
      for (const c of (singles?.competitions || [])) {
        if (c.status?.type?.state !== 'post') continue; // completed only
        const comp = c.competitors || [];
        const w = comp.find(x => x.winner), l = comp.find(x => !x.winner);
        if (!w || !l) continue;
        const score = (w.linescores || [])
          .map((ls, i) => `${ls.value}-${l.linescores?.[i]?.value ?? ''}`)
          .filter(s => s !== '-').join(' ');
        results.push({
          winner: w.athlete?.displayName || w.athlete?.shortName || 'Unknown',
          loser:  l.athlete?.displayName || l.athlete?.shortName || 'Unknown',
          score,
        });
      }

      out.push({
        tour: label,
        name: ev.shortName || ev.name || `${label} Tour`,
        isMajor: !!ev.major,
        venue: ev.venue?.fullName || '',
        location: [addr.city, addr.state || addr.country].filter(Boolean).join(', '),
        date: ev.date || null,
        endDate: ev.endDate || null,
        status: ev.status?.type?.description || ev.status?.type?.shortDetail || '',
        results: results.slice(-3).filter(r => r.winner !== 'Unknown'),
      });
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!out.length) return null;
  return { anyMajor: out.some(t => t.isMajor), tours: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trending headlines: NewsAPI top-headlines (optional context layer).
// Reddit hot.json was removed (Change 5) — Culture now comes entirely from the
// per-section web_search calls in research.js (fetchSectionStories). This feed
// remains only as a light trending-context signal for non-Culture sections.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTrending() {
  const items = [];

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

module.exports = { fetchNBA, fetchNBAUpcoming, fetchNBABoxScore, fetchNHL, fetchUFC, fetchGameMeta, fetchMLB, fetchF1, fetchWorldCup, fetchMarkets, fetchMarketScreeners, fetchGolf, fetchTennis, fetchTrending };

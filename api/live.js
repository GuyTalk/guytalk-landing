'use strict';

/**
 * GuyTalk Live — data aggregator.
 *
 * Pulls real-time data from public/free sources:
 *   - Markets        → Finnhub (FINNHUB_API_KEY)
 *   - Scoreboard     → ESPN public scoreboard API (logos, postseason flags)
 *   - Formula 1      → ESPN racing scoreboard (per-SESSION) + Jolpica standings
 *   - Golf           → ESPN golf scoreboard (country flags)
 *   - Live Now       → derived + importance-ranked across the above
 *
 * DATA-SOURCE CONTRACT
 *   Every section is REAL API data or `null`. We never return fabricated
 *   "live" scores from the server. When a section is null the client decides
 *   what to show (honest empty state in prod; clearly-labelled mock in dev).
 *
 * F1 SAFEGUARDS (see fetchF1)
 *   - The event's season year MUST equal the current year, or we drop it.
 *   - We read the correct SESSION (Race / Qualifying / Practice), never
 *     competitions[0] blindly (that is Free Practice 1).
 *   - "Final / result" framing is only used when the race session is actually
 *     completed; otherwise the race is treated as upcoming (grid + next time).
 */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const CURRENT_YEAR = new Date().getUTCFullYear();

const SCOREBOARD_LEAGUES = [
  { key: 'nba', label: 'NBA',                base: 5, sport: 'basketball', league: 'nba' },
  { key: 'nhl', label: 'NHL',                base: 5, sport: 'hockey',     league: 'nhl' },
  { key: 'nfl', label: 'NFL',                base: 6, sport: 'football',   league: 'nfl' },
  { key: 'mlb', label: 'MLB',                base: 3, sport: 'baseball',   league: 'mlb' },
  { key: 'cfb', label: 'College Football',   base: 4, sport: 'football',   league: 'college-football' },
  { key: 'cbb', label: 'College Basketball', base: 3, sport: 'basketball', league: 'mens-college-basketball' },
];

const MARKET_SYMBOLS = [
  { key: 'spx',  label: 'S&P 500',        sub: 'SPY',     api: 'SPY' },
  { key: 'dow',  label: 'Dow Jones',      sub: 'DIA',     api: 'DIA' },
  { key: 'ndq',  label: 'Nasdaq',         sub: 'QQQ',     api: 'QQQ' },
  { key: 'rut',  label: 'Russell 2000',   sub: 'IWM',     api: 'IWM' },
  { key: 'btc',  label: 'Bitcoin',        sub: 'BTC/USD', api: 'BINANCE:BTCUSDT' },
  { key: 'gold', label: 'Gold',           sub: 'GLD',     api: 'GLD' },
  { key: 'oil',  label: 'Crude Oil',      sub: 'USO',     api: 'USO' },
  { key: 'tnx',  label: '10-Yr Treasury', sub: 'IEF',     api: 'IEF' },
];

const BIG_GAME_RE = /final|finals|championship|cup|playoff|conference|series|bowl|classic/i;
const MAJOR_GOLF_RE = /masters|u\.?s\.? open|open championship|pga championship|players|fedex|tour championship|memorial|genesis|arnold palmer|signature/i;

const json = (url) =>
  fetch(url, { headers: { 'User-Agent': 'GuyTalkLive/1.0' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

/* ----------------------------------------------------------------- Scoreboard */

function parseGame(event, lg) {
  const comp = event?.competitions?.[0];
  if (!comp) return null;
  const competitors = comp.competitors || [];
  if (competitors.length < 2) return null;

  const status = comp.status?.type || {};
  const state = status.state; // 'pre' | 'in' | 'post'
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1];
  const isPost = event.season?.type === 3;
  const headline = comp.notes?.[0]?.headline || '';
  const isBig = isPost || BIG_GAME_RE.test(headline);

  const team = (c) => ({
    name: c.team?.shortDisplayName || c.team?.abbreviation || c.team?.name || '',
    abbr: (c.team?.abbreviation || '').toUpperCase(),
    score: c.score != null ? String(c.score) : '',
    record: c.records?.[0]?.summary || '',
    logo: c.team?.logo || '',
    color: c.team?.color ? `#${c.team.color}` : '',
    winner: !!c.winner,
  });

  let importance = lg.base;
  if (isPost) importance += 40;
  if (BIG_GAME_RE.test(headline)) importance += 40;
  if (state === 'in') importance += 12; // live games lead within a league

  return {
    league: lg.label,
    state,
    statusText: status.shortDetail || status.detail || '',
    headline,            // e.g. "NBA Finals - Game 3"  (real, from ESPN notes)
    isBig,
    importance,
    home: team(home),
    away: team(away),
    startDate: comp.date || null,
  };
}

async function fetchScoreboards() {
  const results = await Promise.all(
    SCOREBOARD_LEAGUES.map(async (lg) => {
      const data = await json(`${ESPN}/${lg.sport}/${lg.league}/scoreboard`);
      const games = (data?.events || []).map((e) => parseGame(e, lg)).filter(Boolean);
      const order = { in: 0, post: 1, pre: 2 };
      games.sort((a, b) =>
        (order[a.state] ?? 3) - (order[b.state] ?? 3) || b.importance - a.importance
      );
      return { key: lg.key, label: lg.label, games: games.slice(0, 8) };
    })
  );
  const withGames = results.filter((r) => r.games.length > 0);
  return withGames.length ? withGames : null;
}

/* ------------------------------------------------------------------ Formula 1 */

const F1_DATE = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' };
const fmtET = (iso) => {
  try { return new Intl.DateTimeFormat('en-US', F1_DATE).format(new Date(iso)) + ' ET'; }
  catch { return ''; }
};

function f1Positions(comp, teamByDriver) {
  return (comp.competitors || [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, 10)
    .map((c) => {
      const name = c.athlete?.displayName || c.athlete?.shortName || '';
      const last = name.split(' ').pop();
      return {
        pos: c.order ?? null,
        driver: name,
        team: teamByDriver[name] || teamByDriver[c.athlete?.shortName] || teamByDriver[last] || '',
        flag: c.athlete?.flag?.href || '',
        winner: !!c.winner,
      };
    });
}

async function fetchF1() {
  const data = await json(`${ESPN}/racing/f1/scoreboard`);
  const event = data?.events?.[0];
  if (!event || !event.competitions?.length) return null;

  // SAFEGUARD 1 — must be the current season, else treat as stale and drop.
  const year = event.season?.year || data?.leagues?.[0]?.season?.year;
  if (year !== CURRENT_YEAR) return null;

  // Standings first so we can map driver → constructor on the session board.
  const [drv, con] = await Promise.all([
    json('https://api.jolpi.ca/ergast/f1/current/driverStandings.json'),
    json('https://api.jolpi.ca/ergast/f1/current/constructorStandings.json'),
  ]);
  const driverList = drv?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const teamByDriver = {};
  for (const d of driverList) {
    const full = `${d.Driver?.givenName || ''} ${d.Driver?.familyName || ''}`.trim();
    const team = d.Constructors?.[0]?.name || '';
    if (full) teamByDriver[full] = team;
    if (d.Driver?.familyName) teamByDriver[d.Driver.familyName] = team;
  }

  const driverStandings = driverList.slice(0, 10).map((d) => ({
    pos: Number(d.position),
    name: `${d.Driver?.givenName || ''} ${d.Driver?.familyName || ''}`.trim(),
    team: d.Constructors?.[0]?.name || '',
    points: Number(d.points),
  }));
  const constructorStandings =
    (con?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [])
      .slice(0, 10).map((c) => ({
        pos: Number(c.position),
        name: c.Constructor?.name || '',
        points: Number(c.points),
      }));

  // Identify sessions. ESPN orders competitions FP1, FP2, FP3, Qual, Race.
  const comps = event.competitions.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const stateOf = (c) => c?.status?.type?.state;
  const byAbbr = (abbr) => comps.find((c) => c.type?.abbreviation === abbr);
  const race = byAbbr('Race') || comps[comps.length - 1];
  const qual = byAbbr('Qual');
  const liveSession = comps.find((c) => stateOf(c) === 'in');
  const nextUpcoming = comps.filter((c) => stateOf(c) === 'pre')
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  // SAFEGUARD 2 — only ever render results from a completed/live session.
  let phase, board, sessionLabel, statusText, nextSession = null;

  if (liveSession) {
    phase = 'live';
    board = liveSession;
    const t = liveSession.type?.text || liveSession.type?.abbreviation || 'Session';
    sessionLabel = `${t} · Live`;
    statusText = liveSession.status?.type?.detail || 'In progress';
  } else if (race && stateOf(race) === 'post') {
    phase = 'result';
    board = race;
    sessionLabel = 'Race Result';
    statusText = `Final · ${fmtET(race.date)}`;
  } else if (qual && stateOf(qual) === 'post' && race && stateOf(race) === 'pre') {
    phase = 'upcoming';
    board = qual;
    sessionLabel = 'Starting Grid · from Qualifying';
    statusText = `Race ${fmtET(race.date)}`;
    nextSession = { name: 'Race', date: race.date };
  } else if (nextUpcoming) {
    phase = 'upcoming';
    // Show the most recent completed session as a preview board, if any.
    board = comps.filter((c) => stateOf(c) === 'post').pop() || null;
    sessionLabel = board ? `${board.type?.text || board.type?.abbreviation || 'Latest'} result` : 'Up next';
    statusText = `Next: ${nextUpcoming.type?.text || nextUpcoming.type?.abbreviation || 'Session'} ${fmtET(nextUpcoming.date)}`;
    nextSession = { name: nextUpcoming.type?.text || nextUpcoming.type?.abbreviation || 'Session', date: nextUpcoming.date };
  } else {
    phase = 'result';
    board = comps.filter((c) => stateOf(c) === 'post').pop() || race;
    sessionLabel = 'Latest result';
    statusText = board ? `Final · ${fmtET(board.date)}` : '';
  }

  return {
    event: event.name || event.shortName || 'Formula 1',
    season: year,
    phase,                 // 'live' | 'result' | 'upcoming'
    sessionLabel,
    statusText,
    nextSession,           // {name, date} | null
    positions: board ? f1Positions(board, teamByDriver) : [],
    driverStandings: driverStandings.length ? driverStandings : null,
    constructorStandings: constructorStandings.length ? constructorStandings : null,
  };
}

/* ----------------------------------------------------------------------- Golf */

async function fetchGolf() {
  const data = await json(`${ESPN}/golf/pga/scoreboard`);
  const event = data?.events?.[0];
  const comp = event?.competitions?.[0];
  if (!comp) return null;

  const status = comp.status?.type || {};
  const leaderboard = (comp.competitors || [])
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 10)
    .map((c) => ({
      pos: c.status?.position?.displayName || (c.order != null ? String(c.order) : ''),
      name: c.athlete?.displayName || '',
      flag: c.athlete?.flag?.href || '',
      score: c.score != null ? String(c.score) : 'E',
      thru: c.status?.thru != null ? String(c.status.thru) : (c.status?.displayValue || ''),
    }));

  const leader = leaderboard[0] || null;
  return {
    event: event.name || event.shortName || 'PGA Tour',
    isMajor: MAJOR_GOLF_RE.test(event.name || ''),
    state: status.state,
    statusText: status.detail || status.shortDetail || '',
    leaderScore: leader ? leader.score : null,
    cutLine: comp.status?.cutLine != null ? String(comp.status.cutLine) : null,
    leaderboard,
  };
}

/* -------------------------------------------------------------------- Markets */

async function fetchMarkets(key) {
  if (!key) return null;
  const rows = await Promise.all(
    MARKET_SYMBOLS.map(async (m) => {
      const data = await json(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(m.api)}&token=${key}`
      );
      if (!data || data.dp == null || data.c == null) return null;
      return {
        key: m.key, label: m.label, sub: m.sub,
        value: Number(data.c), change: Number(data.d),
        changePercent: Number(data.dp), direction: data.dp >= 0 ? 'up' : 'down',
      };
    })
  );
  const filled = rows.filter(Boolean);
  return filled.length ? filled : null;
}

/* ----------------------------------------------------------------- Live Now */

// Importance-ranked: F1 live > golf live (major boosted) > postseason/big games
// > ordinary live games. Only genuinely in-progress events appear here.
function deriveLiveNow({ scoreboard, f1, golf }) {
  const cards = [];

  if (f1 && f1.phase === 'live') {
    cards.push({
      kind: 'f1', importance: 100, title: f1.event, status: 'live',
      statusText: `Formula 1 · ${f1.sessionLabel}`,
      lines: f1.positions.slice(0, 3).map((p) => ({ left: `P${p.pos} ${p.driver}`, right: p.team || '' })),
      leader: f1.positions[0] ? `${f1.positions[0].driver} leads` : '',
    });
  }

  if (golf && golf.state === 'in') {
    const top = golf.leaderboard[0];
    cards.push({
      kind: 'golf', importance: 85 + (golf.isMajor ? 10 : 0), title: golf.event, status: 'live',
      statusText: `Golf · ${golf.statusText}`,
      lines: golf.leaderboard.slice(0, 3).map((p) => ({ left: `${p.pos} ${p.name}`, right: p.score })),
      leader: top ? `${top.name} ${top.score}` : '',
    });
  }

  if (scoreboard) {
    for (const lg of scoreboard) {
      for (const g of lg.games) {
        if (g.state !== 'in') continue;
        cards.push({
          kind: 'game', importance: g.importance, title: `${g.away.abbr} @ ${g.home.abbr}`, status: 'live',
          statusText: `${g.headline || lg.label} · ${g.statusText}`,
          lines: [
            { left: g.away.name, right: g.away.score },
            { left: g.home.name, right: g.home.score },
          ],
          leader: '',
        });
      }
    }
  }

  cards.sort((a, b) => b.importance - a.importance);
  return cards.length ? cards.slice(0, 8) : null;
}

/* ------------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  const finnhubKey = process.env.FINNHUB_API_KEY;

  try {
    const [scoreboard, f1, golf, markets] = await Promise.all([
      fetchScoreboards(), fetchF1(), fetchGolf(), fetchMarkets(finnhubKey),
    ]);

    const liveNow = deriveLiveNow({ scoreboard, f1, golf });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.json({
      updatedAt: new Date().toISOString(),
      // Per-section provenance so the client/devs know what's real vs absent.
      sources: {
        liveNow:    liveNow    ? 'espn'    : null,
        f1:         f1         ? 'espn+jolpica' : null,
        golf:       golf       ? 'espn'    : null,
        scoreboard: scoreboard ? 'espn'    : null,
        markets:    markets    ? 'finnhub' : null,
        trending:     'editorial',   // no live source yet
        talkingAbout: 'editorial',   // no live source yet
      },
      liveNow, f1, golf, scoreboard, markets,
      trending: null,
      talkingAbout: null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to aggregate live data' });
  }
};

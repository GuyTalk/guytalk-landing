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

const fs   = require('fs');
const path = require('path');

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const CURRENT_YEAR = new Date().getUTCFullYear();

// Live Culture/Trending headlines — refreshed every 4h by api/refresh-culture.js
// (committed to brief/data/live-culture.json). Read-only here; empty array if the
// file is missing or unreadable so the Live page degrades to its empty state.
function loadLiveCulture() {
  try {
    const p = path.join(process.cwd(), 'brief', 'data', 'live-culture.json');
    if (!fs.existsSync(p)) return [];
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const stories = Array.isArray(d) ? d : (Array.isArray(d.stories) ? d.stories : []);
    return stories.filter(s => s && s.headline);
  } catch (_) {
    return [];
  }
}

const SCOREBOARD_LEAGUES = [
  // World Cup gets top priority (base 9) while the tournament runs — it outranks
  // every domestic league. Sits above the rest so it always leads the scoreboard.
  { key: 'worldcup', label: 'World Cup',        base: 9, sport: 'soccer',     league: 'fifa.world' },
  { key: 'mls', label: 'MLS',                base: 3, sport: 'soccer',     league: 'usa.1' },
  { key: 'nba', label: 'NBA',                base: 5, sport: 'basketball', league: 'nba' },
  { key: 'wnba', label: 'WNBA',              base: 3, sport: 'basketball', league: 'wnba' },
  { key: 'nhl', label: 'NHL',                base: 5, sport: 'hockey',     league: 'nhl' },
  { key: 'nfl', label: 'NFL',                base: 6, sport: 'football',   league: 'nfl' },
  { key: 'mlb', label: 'MLB',                base: 3, sport: 'baseball',   league: 'mlb' },
  { key: 'cfb', label: 'College Football',   base: 4, sport: 'football',   league: 'college-football' },
  { key: 'cbb', label: 'College Basketball', base: 3, sport: 'basketball', league: 'mens-college-basketball' },
  // Big international soccer. Each only renders when ESPN returns games for it
  // (withGames filter), so off-season leagues never show an empty section.
  { key: 'epl',      label: 'Premier League',   base: 5, sport: 'soccer', league: 'eng.1' },
  { key: 'ucl',      label: 'Champions League', base: 6, sport: 'soccer', league: 'uefa.champions' },
  { key: 'concacaf', label: 'CONCACAF',         base: 5, sport: 'soccer', league: 'concacaf.champions' },
];

const MARKET_SYMBOLS = [
  { key: 'spx',  label: 'S&P 500',        sub: 'SPY',     api: 'SPY' },
  { key: 'dow',  label: 'Dow Jones',      sub: 'DIA',     api: 'DIA' },
  { key: 'ndq',  label: 'Nasdaq',         sub: 'QQQ',     api: 'QQQ' },
  { key: 'rut',  label: 'Russell 2000',   sub: 'IWM',     api: 'IWM' },
  { key: 'btc',  label: 'Bitcoin',        sub: 'BTC/USD', api: 'BINANCE:BTCUSDT' },
  { key: 'gold', label: 'Gold',           sub: 'GLD',     api: 'GLD' },
  { key: 'oil',  label: 'Crude Oil',      sub: 'USO',     api: 'USO' },
  // 10-Yr Treasury is sourced as a YIELD from Yahoo ^TNX (see fetchTnxYield),
  // not a bond-price ETF. `api: null` tells fetchMarkets to skip Finnhub for it.
  { key: 'tnx',  label: '10-Yr Treasury', sub: 'US10Y',   api: null, unit: '%' },
];

const BIG_GAME_RE = /final|finals|championship|cup|playoff|conference|series|bowl|classic/i;
const MAJOR_GOLF_RE = /masters|u\.?s\.? open|open championship|pga championship|players|fedex|tour championship|memorial|genesis|arnold palmer|signature/i;

const json = (url) =>
  fetch(url, { headers: { 'User-Agent': 'GuyTalkLive/1.0' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

// Pick a usable (https, non-dark) logo href from an ESPN logos[] array.
const pickLogo = (logos) => {
  const l = (logos || []).find((x) => /^https/.test(x.href || '') && !/dark/i.test(x.href));
  return l ? l.href : '';
};

// Extract a highlight / recap / event link from an ESPN links[] array.
// Returns {label, url, rel} or null — never invents a link.
function espnLink(links) {
  if (!Array.isArray(links)) return null;
  const pref = [
    ['highlights', 'Watch highlights'],
    ['recap', 'Recap'],
    ['summary', 'View on ESPN'],
    ['gamecast', 'Gamecast'],
  ];
  for (const [rel, label] of pref) {
    const m = links.find((l) => (l.rel || []).includes(rel) && /^https/.test(l.href || ''));
    if (m) return { label, url: m.href, rel };
  }
  const f = links.find((l) => /^https/.test(l.href || ''));
  return f ? { label: 'View on ESPN', url: f.href, rel: 'web' } : null;
}

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
    link: (c.team?.links || []).find((l) => /^https/.test(l.href || ''))?.href || '',
    winner: !!c.winner,
  });

  let importance = lg.base;
  if (isPost) importance += 40;
  if (BIG_GAME_RE.test(headline)) importance += 40;
  if (state === 'in') importance += 12; // live games lead within a league

  const game = {
    id: event.id,        // ESPN event id — used to fetch verified game facts
    leagueKey: lg.league, // 'nba' | 'mlb' | ...
    league: lg.label,
    state,
    statusText: status.shortDetail || status.detail || '',
    headline,            // e.g. "NBA Finals - Game 3"  (real, from ESPN notes)
    isBig,
    importance,
    eventLink: espnLink(event.links),   // {label,url,rel} | null
    home: team(home),
    away: team(away),
    startDate: comp.date || null,
  };
  // MLB facts come free from the scoreboard payload (no extra fetch).
  if (lg.league === 'mlb') game.facts = mlbFacts(competitors, state);
  return game;
}

// Top scorer of a finished/live NBA game, from the box score. Stats array is
// positional, mapped via the statistics[].keys header. Verified, not guessed.
function nbaTopPerformer(summary) {
  try {
    const teams = summary?.boxscore?.players || [];
    let best = null;
    for (const tm of teams) {
      const abbr = (tm.team?.abbreviation || '').toUpperCase();
      const st = (tm.statistics || [])[0] || {};
      const keys = st.keys || st.labels || [];
      const pi = keys.indexOf('points'), ri = keys.indexOf('rebounds'), ai = keys.indexOf('assists');
      if (pi < 0) continue;
      for (const a of (st.athletes || [])) {
        const s = a.stats || [];
        const pts = parseInt(s[pi], 10);
        if (!Number.isFinite(pts)) continue;
        if (!best || pts > best.pts) {
          best = {
            abbr, name: a.athlete?.displayName || '', pts,
            reb: ri >= 0 ? parseInt(s[ri], 10) : null,
            ast: ai >= 0 ? parseInt(s[ai], 10) : null,
          };
        }
      }
    }
    return best && Number.isFinite(best.pts) ? best : null;
  } catch (_) { return null; }
}

// Best highlight clip from a game summary — prefer a recap/finish, else the first
// clip. Returns the ESPN video-page link + thumbnail (+ direct mp4 for later use).
function pickHighlight(summary) {
  const vids = (summary && summary.videos) || [];
  if (!vids.length) return null;
  const v = vids.find((x) => /recap|highlight|final|stun|classic|clinch|win|beat|comeback|buzzer|overtime|walk-?off/i.test(x.headline || '')) || vids[0];
  const links = v.links || {};
  const src = links.source || {};
  const mp4 = (src.HD && src.HD.href) || (typeof src.href === 'string' ? src.href : '') || (src.full && src.full.href) || '';
  const thumb = v.thumbnail || (v.posterImages && (v.posterImages.default || {}).href) || '';
  const web = (links.web && links.web.href) || (links.mobile && links.mobile.href) || '';
  if (!thumb && !web) return null;
  return { title: v.headline || 'Highlights', web, mp4, thumb, duration: v.duration || null };
}

// For an UPCOMING/LIVE series game, the previous completed game: score, the
// standout performer, and a highlight video. This is the "what just happened"
// that makes a Game 5 feel like a Game 5. One extra summary fetch.
async function lastSeriesGame(summary, sport, league) {
  try {
    const groups = (summary && summary.seasonseries) || [];
    const play = groups.find((g) => g.type === 'playoff') || groups.find((g) => /playoff/i.test(g.seriesLabel || ''));
    if (!play) return null;
    const events = play.events || [];
    let idx = -1;
    events.forEach((e, i) => { if ((e.statusType || {}).completed) idx = i; });
    if (idx < 0) return null;
    const comps = events[idx].competitors || [];
    const win = comps.find((c) => c.winner) || comps[0];
    const lose = comps.find((c) => c !== win) || comps[1];
    if (!win || !lose) return null;
    const ab = (c) => ((c.team || {}).abbreviation || '').toUpperCase();
    const gd = await json(`${ESPN}/${sport}/${league}/summary?event=${events[idx].id}`);
    let performer = null;
    if (league === 'nba') {
      const p = nbaTopPerformer(gd);
      if (p) performer = { name: p.name, line: `${p.pts} pts${p.reb != null ? `, ${p.reb} reb` : ''}${p.ast != null ? `, ${p.ast} ast` : ''}` };
    } else {
      const L = summaryLeaders(gd, league === 'nhl' ? ['points', 'goals', 'assists'] : ['passingYards', 'rushingYards', 'receivingYards'])[0];
      if (L) performer = { name: L.name, line: `${L.line}${L.cat ? ` ${L.cat.toLowerCase()}` : ''}` };
    }
    return {
      gameLabel: `Game ${idx + 1}`,
      winner: { abbr: ab(win), score: String(win.score) },
      loser: { abbr: ab(lose), score: String(lose.score) },
      performer,
      video: pickHighlight(gd),
    };
  } catch (_) { return null; }
}

// ESPN's summary returns BOTH a "Regular Season Series" (season head-to-head,
// e.g. two October meetings → "Series tied 1-1") and the actual "Playoff Series"
// (e.g. "NY leads series 3-1") in the same `series` array — sometimes both with
// description "NBA Finals". We only ever want the postseason one; the regular-
// season head-to-head is meaningless mid-playoffs and was showing a stale record.
function pickPlayoffSeries(hc) {
  const ser = (hc && hc.series) || [];
  const s = ser.find((x) => x.type === 'playoff' || /playoff/i.test(x.title || ''));
  if (!s || !s.summary) return null;
  const name = (s.description && !/regular\s*season/i.test(s.description)) ? s.description : (s.title || 'The series');
  return { name, summary: s.summary };
}

// Verified facts for one NBA game from the ESPN summary endpoint:
// series state, team records (with the split that matters for this venue),
// scoring leaders (season avg pre-game, game leaders once it tips), and the
// box-score top performer when live/final. Null on any failure.
async function nbaGameFacts(eventId) {
  try {
    const d = await json(`${ESPN}/basketball/nba/summary?event=${eventId}`);
    const hc = d?.header?.competitions?.[0];
    if (!hc) return null;
    const state = hc.status?.type?.state;
    const series = pickPlayoffSeries(hc);
    const teams = (hc.competitors || []).map((c) => {
      const recs = c.record || [];
      const g = (t) => (recs.find((r) => r.type === t) || {}).summary || '';
      return {
        abbr: (c.team?.abbreviation || '').toUpperCase(),
        homeAway: c.homeAway,
        total: g('total'),
        split: c.homeAway === 'home' ? g('home') : g('road'),
      };
    });
    const topScorers = (d.leaders || []).map((tm) => {
      const abbr = (tm.team?.abbreviation || '').toUpperCase();
      const cat = (tm.leaders || []).find((c) => c.name === 'pointsPerGame' || c.name === 'points');
      const L = cat?.leaders?.[0];
      return L ? { abbr, name: L.athlete?.displayName || '', val: L.displayValue } : null;
    }).filter(Boolean);
    const topPerformer = (state === 'in' || state === 'post') ? nbaTopPerformer(d) : null;
    const facts = { league: 'nba', state, series, teams, topScorers, topPerformer };
    // Upcoming/live playoff game: enrich with the previous game (score, hero, video).
    if (series && state !== 'post') facts.lastGame = await lastSeriesGame(d, 'basketball', 'nba');
    return facts;
  } catch (_) { return null; }
}

// One standout per team from the ESPN summary `leaders` block. Pre-game these
// are season leaders; once the game tips they become game lines. `priority` is
// the ordered list of stat categories to prefer (e.g. QB passing for NFL). All
// values come straight from ESPN — never computed or guessed.
function summaryLeaders(d, priority) {
  return (d?.leaders || []).map((tm) => {
    const abbr = (tm.team?.abbreviation || '').toUpperCase();
    let cat = null;
    for (const p of priority) { cat = (tm.leaders || []).find((c) => c.name === p); if (cat) break; }
    if (!cat) cat = (tm.leaders || [])[0];
    const L = cat?.leaders?.[0];
    if (!L?.athlete) return null;
    return {
      abbr,
      name: L.athlete.displayName || L.athlete.shortName || '',
      line: L.displayValue || '',
      cat: cat.displayName || cat.shortDisplayName || '',
    };
  }).filter(Boolean);
}

// Verified facts for one NFL/NHL game from the ESPN summary endpoint: playoff
// series state (NHL/postseason), team records with the venue split, and a
// standout performer per side. Same fail-closed contract as the NBA builder —
// null on any error so the section degrades gracefully.
async function summaryGameFacts(league, sport, eventId, leaderPriority) {
  try {
    const d = await json(`${ESPN}/${sport}/${league}/summary?event=${eventId}`);
    const hc = d?.header?.competitions?.[0];
    if (!hc) return null;
    const state = hc.status?.type?.state;
    // ESPN returns a head-to-head "Regular Season Series" alongside the playoff
    // series; that's not the playoff stakes we mean, so keep only the post-season
    // one (e.g. "Stanley Cup Final", "First Round").
    const series = pickPlayoffSeries(hc);
    const teams = (hc.competitors || []).map((c) => {
      const recs = c.record || [];
      const g = (t) => (recs.find((r) => r.type === t) || {}).summary || '';
      return {
        abbr: (c.team?.abbreviation || '').toUpperCase(),
        homeAway: c.homeAway,
        total: g('total'),
        split: c.homeAway === 'home' ? g('home') : g('road'),
      };
    });
    const facts = { league, state, series, teams, leaders: summaryLeaders(d, leaderPriority) };
    if (series && state !== 'post') facts.lastGame = await lastSeriesGame(d, sport, league);
    return facts;
  } catch (_) { return null; }
}

// MLB verified facts — computed straight from the scoreboard event (no extra
// fetch): probable pitchers + W/L/ERA pre-game, and each side's standout
// performer (ESPN's per-game leader) once final. Never invented.
function mlbFacts(competitors, state) {
  const team = (c) => {
    const recs = c.records || [];
    const g = (t) => (recs.find((r) => r.type === t) || {}).summary || '';
    const prob = (c.probables || [])[0];
    let probable = null;
    if (prob?.athlete) {
      const st = prob.statistics || [];
      const v = (n) => (st.find((s) => s.name === n) || {}).displayValue;
      const w = v('wins'), l = v('losses'), era = v('ERA');
      const bits = [];
      if (w != null && l != null) bits.push(`${w}-${l}`);
      if (era != null) bits.push(`${era} ERA`);
      probable = { name: prob.athlete.displayName || prob.athlete.shortName || '', line: bits.join(', ') };
    }
    // Per-game standout only makes sense once the game is live/final (pre-game
    // these leaders are season-rating numbers, not a box-score line).
    let perf = null;
    if (state === 'in' || state === 'post') {
      const byName = (n) => (c.leaders || []).find((L) => L.name === n);
      const lead = byName('MLBRating') || byName('RBIs') || byName('avg');
      const top = lead && (lead.leaders || [])[0];
      perf = top?.athlete ? { name: top.athlete.displayName || '', line: top.displayValue || '' } : null;
    }
    return {
      abbr: (c.team?.abbreviation || '').toUpperCase(),
      homeAway: c.homeAway,
      total: g('total'),
      split: c.homeAway === 'home' ? g('home') : g('road'),
      probable, perf,
    };
  };
  return { league: 'mlb', state, teams: (competitors || []).map(team) };
}

async function fetchScoreboards() {
  const results = await Promise.all(
    SCOREBOARD_LEAGUES.map(async (lg) => {
      const data = await json(`${ESPN}/${lg.sport}/${lg.league}/scoreboard`);
      const games = (data?.events || []).map((e) => parseGame(e, lg)).filter(Boolean);
      const order = { in: 0, post: 1, pre: 2 };
      games.sort((a, b) => {
        const byState = (order[a.state] ?? 3) - (order[b.state] ?? 3);
        if (byState) return byState;
        const byImp = b.importance - a.importance;
        if (byImp) return byImp;
        // Same state + importance (e.g. several completed Finals games in one
        // payload): break by time so we feature the MOST RECENT result — never a
        // stale game whose series state has since changed (e.g. "tied 1-1" when
        // the series is actually 3-1). Upcoming games tie-break to the soonest.
        const ta = a.startDate ? +new Date(a.startDate) : 0;
        const tb = b.startDate ? +new Date(b.startDate) : 0;
        return a.state === 'pre' ? ta - tb : tb - ta;
      });
      return { key: lg.key, label: lg.label, games: games.slice(0, 8) };
    })
  );
  const withGames = results.filter((r) => r.games.length > 0);
  if (!withGames.length) return null;

  // Attach a GuyTalk Read to the TOP game of each supported league (games are
  // pre-sorted live > final > upcoming, then importance, so games[0] is it).
  // MLB facts are already on the game (free, from the scoreboard); NBA needs a
  // summary fetch. We keep facts ONLY on each league's top game.
  await Promise.all(withGames.map(async (r) => {
    const top = r.games[0];
    if (!top || !top.id) return;
    if (r.key === 'nba') top.facts = await nbaGameFacts(top.id);
    else if (r.key === 'nhl') top.facts = await summaryGameFacts('nhl', 'hockey', top.id, ['points', 'goals', 'assists']);
    else if (r.key === 'nfl') top.facts = await summaryGameFacts('nfl', 'football', top.id, ['passingYards', 'rushingYards', 'receivingYards']);
  }));
  for (const r of withGames) {
    for (let i = 1; i < r.games.length; i++) {
      if (r.games[i].facts) delete r.games[i].facts;
    }
  }
  return withGames;
}

/* ------------------------------------------------------------------ Formula 1 */

const F1_DATE = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' };
const fmtET = (iso) => {
  try { return new Intl.DateTimeFormat('en-US', F1_DATE).format(new Date(iso)) + ' ET'; }
  catch { return ''; }
};

function f1Positions(comp, teamByDriver, profileByDriver) {
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
        profileUrl: f1DriverProfile(name) || profileByDriver[name] || profileByDriver[last] || '',
        winner: !!c.winner,
      };
    });
}

// Verified historical facts for the most recent race winner, computed straight
// from Jolpica/Ergast results — NEVER guessed. Powers fun "what to say" lines
// (win streaks, season win count, youngest-winner-at-this-circuit records).
// Returns null on any failure so the section degrades gracefully.
async function f1WinnerFacts() {
  try {
    const MS_YR = 365.25 * 864e5;
    // Season race winners (position 1) — carries each winner's Driver + Circuit,
    // so the latest entry doubles as "last race" (no extra call needed).
    const resJson = await json('https://api.jolpi.ca/ergast/f1/current/results/1.json?limit=100');
    const allRaces = (resJson?.MRData?.RaceTable?.Races || [])
      .slice()
      .sort((a, b) => Number(a.round) - Number(b.round));
    const races = allRaces
      .map((r) => ({ round: Number(r.round), last: r.Results?.[0]?.Driver?.familyName || '' }))
      .filter((r) => r.last);
    const lastRace = allRaces[allRaces.length - 1];
    const wd = lastRace?.Results?.[0]?.Driver;
    if (!lastRace || !wd) return null;

    const winnerLast = wd.familyName;
    // Consecutive wins ending at the latest round.
    let streak = 0;
    for (let i = races.length - 1; i >= 0; i--) {
      if (races[i].last === winnerLast) streak++; else break;
    }
    const seasonWins = races.filter((r) => r.last === winnerLast).length;

    // Youngest-ever winner at THIS circuit?
    let youngest = null;
    const circuitId = lastRace.Circuit?.circuitId;
    if (circuitId && wd.dateOfBirth && lastRace.date) {
      const cj = await json(`https://api.jolpi.ca/ergast/f1/circuits/${circuitId}/results/1.json?limit=100`);
      const ages = (cj?.MRData?.RaceTable?.Races || [])
        .map((r) => {
          const d = r.Results?.[0]?.Driver;
          if (!d?.dateOfBirth) return null;
          return {
            age: (new Date(r.date) - new Date(d.dateOfBirth)) / MS_YR,
            last: d.familyName, season: r.season,
            name: `${d.givenName || ''} ${d.familyName || ''}`.trim(),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.age - b.age);
      const winAge = (new Date(lastRace.date) - new Date(wd.dateOfBirth)) / MS_YR;
      if (ages.length && ages[0].last === winnerLast && Math.abs(ages[0].age - winAge) < 0.02) {
        const prev = ages.find((a) => a.last !== winnerLast) || null;
        youngest = {
          circuit: lastRace.raceName.replace(/\s+Grand Prix$/i, ''),
          age: Math.floor(winAge),
          prev: prev ? { name: prev.name, age: Math.floor(prev.age), season: prev.season } : null,
        };
      }
    }
    return { winnerLast, streak, seasonWins, youngest };
  } catch (_) { return null; }
}

async function fetchF1() {
  const data = await json(`${ESPN}/racing/f1/scoreboard`);
  const event = data?.events?.[0];
  if (!event || !event.competitions?.length) return null;

  // SAFEGUARD 1 — must be the current season, else treat as stale and drop.
  const year = event.season?.year || data?.leagues?.[0]?.season?.year;
  if (year !== CURRENT_YEAR) return null;

  // Standings first so we can map driver → constructor on the session board.
  const [drv, con, sched] = await Promise.all([
    json('https://api.jolpi.ca/ergast/f1/current/driverStandings.json'),
    json('https://api.jolpi.ca/ergast/f1/current/constructorStandings.json'),
    json('https://api.jolpi.ca/ergast/f1/current.json'),
  ]);

  // Next race on the calendar (for the "Up next" box) — reliable from Jolpica.
  const races = sched?.MRData?.RaceTable?.Races || [];
  const nowMs = Date.now();
  const nx = races.find((r) => new Date(`${r.date}T${r.time || '12:00:00Z'}`).getTime() > nowMs);
  const nextRace = nx ? {
    name: nx.raceName,
    circuit: nx.Circuit?.circuitName || '',
    location: [nx.Circuit?.Location?.locality, nx.Circuit?.Location?.country].filter(Boolean).join(', '),
    date: nx.date,
    time: nx.time || null,
  } : null;
  const driverList = drv?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const teamByDriver = {};
  const profileByDriver = {}; // reliable Wikipedia profile URL from Jolpica
  for (const d of driverList) {
    const full = `${d.Driver?.givenName || ''} ${d.Driver?.familyName || ''}`.trim();
    const team = d.Constructors?.[0]?.name || '';
    const url = d.Driver?.url || '';
    if (full) { teamByDriver[full] = team; if (url) profileByDriver[full] = url; }
    if (d.Driver?.familyName) { teamByDriver[d.Driver.familyName] = team; if (url) profileByDriver[d.Driver.familyName] = url; }
  }

  const driverStandings = driverList.slice(0, 10).map((d) => ({
    pos: Number(d.position),
    name: `${d.Driver?.givenName || ''} ${d.Driver?.familyName || ''}`.trim(),
    team: d.Constructors?.[0]?.name || '',
    points: Number(d.points),
    profileUrl: f1DriverProfile(`${d.Driver?.givenName || ''} ${d.Driver?.familyName || ''}`.trim()) || d.Driver?.url || '',
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

  const positions = board ? f1Positions(board, teamByDriver, profileByDriver) : [];

  // Normalize standings names to ESPN's broadcast short form (by surname) so
  // the championship/standings names match the race board everywhere
  // (e.g. Jolpica "Andrea Kimi Antonelli" → ESPN "Kimi Antonelli").
  const espnNameByLast = {};
  for (const p of positions) {
    const last = p.driver.split(' ').pop().toLowerCase();
    if (last) espnNameByLast[last] = p.driver;
  }
  for (const d of driverStandings) {
    const last = d.name.split(' ').pop().toLowerCase();
    if (espnNameByLast[last]) d.name = espnNameByLast[last];
  }

  // Verified historical facts only matter once a race is in the books.
  const winnerFacts = phase === 'result' ? await f1WinnerFacts() : null;

  return {
    event: event.name || event.shortName || 'Formula 1',
    season: year,
    phase,                 // 'live' | 'result' | 'upcoming'
    sessionLabel,
    statusText,
    nextSession,           // {name, date} | null
    nextRace,              // {name, circuit, location, date, time} | null
    leagueLogo: pickLogo(data?.leagues?.[0]?.logos),
    circuit: event.circuit?.fullName || '',
    circuitCountry: event.circuit?.address?.country || '',
    eventLink: espnLink(event.links),
    positions,
    driverStandings: driverStandings.length ? driverStandings : null,
    constructorStandings: constructorStandings.length ? constructorStandings : null,
    winnerFacts,           // {winnerLast, streak, seasonWins, youngest} | null
  };
}

/* ----------------------------------------------------------------------- Golf */

// ESPN's golf feed carries no course/purse, so we keep a small map of public,
// stable tournament facts. Winner's share defaults to the PGA-standard ~18% of
// purse when not given. Add rows here as the schedule turns over.
const GOLF_EVENTS = [
  { re: /rbc canadian/i,      course: 'TPC Toronto at Osprey Valley', location: 'Ontario, Canada', purse: 9800000 },
  { re: /memorial/i,          course: 'Muirfield Village Golf Club',  location: 'Dublin, Ohio',     purse: 20000000 },
  { re: /masters/i,           course: 'Augusta National Golf Club',   location: 'Augusta, Georgia', purse: 20000000, winnerShare: 3600000 },
  { re: /pga championship/i,  course: 'Quail Hollow Club',            location: 'Charlotte, N.C.',  purse: 19000000, winnerShare: 3420000 },
  { re: /u\.?s\.? open/i,      course: 'Oakmont Country Club',         location: 'Oakmont, Pa.',     purse: 21500000, winnerShare: 4300000 },
  { re: /the open|open championship/i, course: 'Royal Portrush',      location: 'Northern Ireland', purse: 17000000, winnerShare: 3100000 },
  { re: /players championship/i, course: 'TPC Sawgrass',              location: 'Ponte Vedra Beach, Fla.', purse: 25000000, winnerShare: 4500000 },
  { re: /travelers/i,         course: 'TPC River Highlands',          location: 'Cromwell, Conn.',  purse: 20000000 },
  { re: /john deere/i,        course: 'TPC Deere Run',                location: 'Silvis, Ill.',     purse: 8400000 },
  { re: /genesis scottish/i,  course: 'The Renaissance Club',         location: 'North Berwick, Scotland', purse: 9000000 },
];
function golfEventMeta(name) {
  const m = GOLF_EVENTS.find((e) => e.re.test(name || ''));
  if (!m) return null;
  return {
    course: m.course, location: m.location, purse: m.purse,
    winnerShare: m.winnerShare || (m.purse ? Math.round(m.purse * 0.18) : null),
  };
}
const usd = (n) => (n == null ? null : '$' + Number(n).toLocaleString('en-US'));

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
      link: golfPlayerLink(c),
      score: c.score != null ? String(c.score) : 'E',
      thru: (c.status?.thru != null ? String(c.status.thru) : '') || golfThru(c),
    }));

  const leader = leaderboard[0] || null;
  const meta = golfEventMeta(event.name || event.shortName || '');
  return {
    event: event.name || event.shortName || 'PGA Tour',
    isMajor: MAJOR_GOLF_RE.test(event.name || ''),
    state: status.state,
    statusText: status.detail || status.shortDetail || '',
    leagueLogo: pickLogo(data?.leagues?.[0]?.logos),
    eventLink: espnLink(event.links),
    leaderScore: leader ? leader.score : null,
    cutLine: comp.status?.cutLine != null ? String(comp.status.cutLine) : null,
    // Public tournament facts (course/purse/winner's share) — not in ESPN feed.
    course: meta?.course || '',
    location: meta?.location || '',
    purse: meta ? usd(meta.purse) : null,
    winnerShare: meta ? usd(meta.winnerShare) : null,
    leaderboard,
  };
}

/* --------------------------------------------------------------------- Tennis */

// The four majors define the season. Hardcoded calendar (with public total purses)
// so we can always answer "does this matter / when's the next one" — ESPN's feed
// doesn't carry purse or a reliable forward schedule.
const GRAND_SLAMS = [
  { name: 'Australian Open', start: '2026-01-12', loc: 'Melbourne',  purse: '$60M' },
  { name: 'French Open',     start: '2026-05-24', loc: 'Paris',      purse: '$64M' },
  { name: 'Wimbledon',       start: '2026-06-29', loc: 'London',     purse: '$67M' },
  { name: 'US Open',         start: '2026-08-31', loc: 'New York',   purse: '$90M' },
];
function nextGrandSlam() {
  const now = Date.now();
  return GRAND_SLAMS.find((s) => Date.parse(s.start) >= now)
    || { name: 'Australian Open', start: '2027-01-11', loc: 'Melbourne', purse: '$60M' };
}
function slamPurse(name) {
  const m = GRAND_SLAMS.find((s) => new RegExp(s.name.replace(/\s+/g, '\\s*'), 'i').test(name || ''));
  return m ? m.purse : null;
}
// Generic ESPN athlete → player-profile link (works for tennis, golf, etc.).
function athleteLink(athlete) {
  const links = athlete?.links || [];
  const pc = links.find((l) => (l.rel || []).includes('playercard'))
    || links.find((l) => (l.rel || []).includes('athlete'))
    || links.find((l) => /^https/.test(l.href || ''));
  return pc?.href || '';
}

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Official F1.com driver profile — what fans expect from an F1 driver link (not
// Wikipedia). Slugs are first-last; a few drivers go by a common name.
const F1_SLUG_OVERRIDE = { 'andrea kimi antonelli': 'kimi-antonelli' };
function f1DriverProfile(name) {
  if (!name) return '';
  const slug = F1_SLUG_OVERRIDE[name.toLowerCase().trim()] || slugify(name);
  return slug ? `https://www.formula1.com/en/drivers/${slug}` : '';
}

// ESPN golf scoreboard puts the athlete id on the COMPETITOR (type 'athlete'),
// not inside athlete.links — so build the player profile from it.
function golfPlayerLink(c) {
  const direct = athleteLink(c && c.athlete);
  if (direct) return direct;
  const id = c && c.id;
  if (!id || c.type !== 'athlete') return '';
  const slug = slugify(c.athlete && c.athlete.displayName);
  return `https://www.espn.com/golf/player/_/id/${id}${slug ? '/' + slug : ''}`;
}

// Holes played in the current round, from ESPN's per-round linescores. Returns
// 'F' for a completed round, '' when play hasn't started.
function golfThru(c) {
  let holes = 0;
  for (const r of (c && c.linescores) || []) {
    if (Array.isArray(r.linescores) && r.linescores.length) holes = r.linescores.length;
  }
  return holes ? (holes >= 18 ? 'F' : String(holes)) : '';
}

// Tennis (ATP + WTA). Tournaments carry a `major` flag = Grand Slam. Results are
// gender-matched to the tour (combined events expose both draws). Real data only.
async function fetchTennis() {
  const tours = [['atp', 'ATP'], ['wta', 'WTA']];
  const out = [];
  for (const [slug, label] of tours) {
    const [data, rk] = await Promise.all([
      json(`${ESPN}/tennis/${slug}/scoreboard`),
      json(`${ESPN}/tennis/${slug}/rankings`).catch(() => null),
    ]);
    const events = data?.events || [];
    if (!events.length) continue;
    const ev = events.find((e) => e.major) || events[0];
    const wantGender = label === 'WTA' ? /women/i : /\bmen/i;
    const groupings = ev.groupings || [];
    const singles = groupings.find((g) => {
      const n = g.grouping?.displayName || g.grouping?.name || '';
      return /singles/i.test(n) && wantGender.test(n);
    }) || groupings.find((g) => /singles/i.test(g.grouping?.displayName || g.grouping?.name || ''));

    const results = [];
    for (const c of (singles?.competitions || [])) {
      if (c.status?.type?.state !== 'post') continue;
      const comp = c.competitors || [];
      const w = comp.find((x) => x.winner), l = comp.find((x) => !x.winner);
      if (!w || !l) continue;
      const score = (w.linescores || [])
        .map((ls, i) => `${ls.value}-${l.linescores?.[i]?.value ?? ''}`)
        .filter((s) => s !== '-').join(' ');
      results.push({
        winner: w.athlete?.displayName || w.athlete?.shortName || '',
        winnerFlag: w.athlete?.flag?.href || '',
        winnerLink: athleteLink(w.athlete),
        loser: l.athlete?.displayName || l.athlete?.shortName || '',
        loserFlag: l.athlete?.flag?.href || '',
        loserLink: athleteLink(l.athlete),
        score,
      });
    }

    const topRanked = (rk?.rankings?.[0]?.ranks || []).slice(0, 5).map((r) => ({
      rank: r.current,
      name: r.athlete?.displayName || r.athlete?.shortName || '',
      link: athleteLink(r.athlete),
    })).filter((p) => p.name);

    out.push({
      tour: label,
      name: ev.shortName || ev.name || `${label} Tour`,
      isMajor: !!ev.major,
      purse: ev.major ? slamPurse(ev.name || ev.shortName) : null,
      statusText: ev.status?.type?.description || ev.status?.type?.shortDetail || '',
      eventLink: espnLink(ev.links),
      topRanked,
      results: results.slice(-5),
    });
  }
  if (!out.length) return null;
  return { anyMajor: out.some((t) => t.isMajor), nextMajor: nextGrandSlam(), tours: out };
}

/* -------------------------------------------------------------------- Markets */

// 10-Year Treasury YIELD via Yahoo Finance (^TNX) — keyless. Returns the actual
// yield percentage (e.g. 4.43), not a bond-price ETF. We compute day change from
// the price vs previousClose so the card shows the yield move, not a price move.
async function fetchTnxYield() {
  const yj = await json(
    'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d'
  );
  const result = yj?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  const value = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  const prev = meta.previousClose ?? meta.chartPreviousClose ?? closes[closes.length - 2] ?? null;
  if (value == null || prev == null) return null;
  const change = value - prev;
  const changePercent = prev ? (change / prev) * 100 : 0;
  return {
    key: 'tnx', label: '10-Yr Treasury', sub: 'US10Y', unit: '%',
    value: Number(value), change: Number(change),
    changePercent: Number(changePercent), direction: change >= 0 ? 'up' : 'down',
  };
}

async function fetchMarkets(key) {
  if (!key) return null;
  const rows = await Promise.all(
    MARKET_SYMBOLS.map(async (m) => {
      // 10-Yr Treasury yield comes from Yahoo ^TNX, not Finnhub.
      if (m.api == null) return m.key === 'tnx' ? fetchTnxYield() : null;
      const data = await json(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(m.api)}&token=${key}`
      );
      if (!data || data.dp == null || data.c == null) return null;
      return {
        key: m.key, label: m.label, sub: m.sub, unit: m.unit || null,
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
      link: f1.eventLink ? f1.eventLink.url : '',
      lines: f1.positions.slice(0, 3).map((p) => ({ left: `P${p.pos} ${p.driver}`, right: p.team || '' })),
      leader: f1.positions[0] ? `${f1.positions[0].driver} leads` : '',
    });
  }

  if (golf && golf.state === 'in') {
    const top = golf.leaderboard[0];
    cards.push({
      kind: 'golf', importance: 85 + (golf.isMajor ? 10 : 0), title: golf.event, status: 'live',
      statusText: `Golf · ${golf.statusText}`,
      link: golf.eventLink ? golf.eventLink.url : '',
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
          link: g.eventLink ? g.eventLink.url : '',
          lines: [
            { left: g.away.name, right: g.away.score, logo: g.away.logo },
            { left: g.home.name, right: g.home.score, logo: g.home.logo },
          ],
          leader: '',
        });
      }
    }
  }

  if (cards.length) {
    cards.sort((a, b) => b.importance - a.importance);
    return cards.slice(0, 8);
  }

  // Nothing live right now → show what's ON THE SLATE so this is never blank:
  // tonight's scheduled games + any upcoming F1/golf, tagged as upcoming.
  const sched = [];
  if (f1 && f1.phase === 'upcoming' && f1.event) {
    sched.push({
      kind: 'f1', importance: 100, title: f1.event, status: 'upcoming',
      statusText: `Formula 1 · ${f1.statusText || 'Upcoming'}`,
      link: f1.eventLink ? f1.eventLink.url : '',
      lines: f1.grid ? [{ left: `Pole: ${f1.grid.driver}`, right: f1.grid.team || '' }] : [], leader: '',
    });
  }
  if (golf && (golf.state === 'pre' || golf.state === 'upcoming') && golf.event) {
    sched.push({
      kind: 'golf', importance: 80, title: golf.event, status: 'upcoming',
      statusText: `Golf · ${golf.statusText || 'Tees off soon'}`,
      link: golf.eventLink ? golf.eventLink.url : '', lines: [], leader: '',
    });
  }
  if (scoreboard) {
    for (const lg of scoreboard) {
      for (const g of lg.games) {
        if (g.state !== 'pre') continue;
        sched.push({
          kind: 'game', importance: g.importance, title: `${g.away.abbr} @ ${g.home.abbr}`, status: 'upcoming',
          statusText: `${g.headline || lg.label} · ${g.statusText}`,
          link: g.eventLink ? g.eventLink.url : '',
          lines: [{ left: g.away.name, right: '', logo: g.away.logo }, { left: g.home.name, right: '', logo: g.home.logo }], leader: '',
        });
      }
    }
  }
  sched.sort((a, b) => b.importance - a.importance);
  return sched.length ? sched.slice(0, 6) : null;
}

/* ------------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  const finnhubKey = process.env.FINNHUB_API_KEY;

  try {
    const [scoreboard, f1, golf, tennis, markets] = await Promise.all([
      fetchScoreboards(), fetchF1(), fetchGolf(), fetchTennis(), fetchMarkets(finnhubKey),
    ]);

    const liveNow = deriveLiveNow({ scoreboard, f1, golf });
    const trending = loadLiveCulture();   // NewsAPI headlines, refreshed every 4h

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.json({
      updatedAt: new Date().toISOString(),
      // Per-section provenance so the client/devs know what's real vs absent.
      sources: {
        liveNow:    liveNow    ? 'espn'    : null,
        f1:         f1         ? 'espn+jolpica' : null,
        golf:       golf       ? 'espn'    : null,
        tennis:     tennis     ? 'espn'    : null,
        scoreboard: scoreboard ? 'espn'    : null,
        markets:    markets    ? 'finnhub' : null,
        trending:     trending.length ? 'NewsAPI' : null,
        talkingAbout: 'editorial',   // no live source yet
      },
      liveNow, f1, golf, tennis, scoreboard, markets,
      trending: trending.length ? trending : null,
      talkingAbout: null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to aggregate live data' });
  }
};

/* =============================================================================
 * GuyTalk Live — front-end app
 *
 * Hydrates the /live dashboard from /api/live.
 *
 * DATA-SOURCE POLICY (important — see tasks 1 & 6)
 *   - Real API data is rendered as-is.
 *   - In DEVELOPMENT (localhost / *.vercel.app / ?dev) a missing section falls
 *     back to MOCK data and is tagged with a coloured source badge so it can
 *     never be mistaken for real live data:
 *         LIVE  (green)  = real API
 *         MOCK  (amber)  = placeholder, NOT real
 *         EDIT  (blue)   = editorial (trending / talking-about; no live feed)
 *   - In PRODUCTION we NEVER fabricate live scores. A missing sports/markets
 *     section renders an honest empty state instead of mock data.
 *
 * Architecture: 1) interfaces  2) mock  3) components  4) app
 * ===========================================================================*/

/* =============================================================================
 * 1. DATA INTERFACES  (shape returned by /api/live — kept in sync with live.js)
 * ===========================================================================*/

/**
 * @typedef {Object} LivePayload
 * @property {string} updatedAt
 * @property {Object} sources                  per-section provenance string|null
 * @property {LiveEvent[]|null} liveNow
 * @property {F1Payload|null} f1
 * @property {GolfPayload|null} golf
 * @property {LeagueScoreboard[]|null} scoreboard
 * @property {MarketRow[]|null} markets
 * @property {TrendingStory[]|null} trending
 * @property {TalkingPoint[]|null} talkingAbout
 */

/**
 * @typedef {Object} F1Payload
 * @property {string} event
 * @property {number} season                    must equal current year (server-validated)
 * @property {'live'|'result'|'upcoming'} phase
 * @property {string} sessionLabel              e.g. "Race Result" / "Starting Grid"
 * @property {string} statusText
 * @property {{name:string,date:string}|null} nextSession
 * @property {{pos:number,driver:string,team:string,flag:string,winner:boolean}[]} positions
 * @property {{pos:number,name:string,team:string,points:number}[]|null} driverStandings
 * @property {{pos:number,name:string,points:number}[]|null} constructorStandings
 */

/**
 * @typedef {Object} GolfPayload
 * @property {string} event @property {boolean} isMajor
 * @property {'pre'|'in'|'post'} state @property {string} statusText
 * @property {string|null} leaderScore @property {string|null} cutLine
 * @property {{pos:string,name:string,flag:string,score:string,thru:string}[]} leaderboard
 */

/** @typedef {Object} LeagueScoreboard @property {string} key @property {string} label @property {GameCard[]} games */
/**
 * @typedef {Object} GameCard
 * @property {'pre'|'in'|'post'} state @property {string} statusText
 * @property {string} headline @property {boolean} isBig @property {number} importance
 * @property {TeamSide} home @property {TeamSide} away
 */
/** @typedef {Object} TeamSide @property {string} name @property {string} abbr @property {string} score
 *  @property {string} record @property {string} logo @property {string} color @property {boolean} winner */

/** @typedef {Object} MarketRow @property {string} label @property {string} sub @property {number} value
 *  @property {number} change @property {number} changePercent @property {'up'|'down'} direction */
/** @typedef {Object} TrendingStory @property {string} category @property {string} headline @property {string} summary @property {string} why */
/** @typedef {Object} TalkingPoint @property {string} topic @property {string} matters @property {string} say */

/* =============================================================================
 * 2. MOCK DATA  — DEVELOPMENT-ONLY fallbacks (never shown as live in prod).
 *    Trending + Talking-About have no live source and are editorial in all envs.
 * ===========================================================================*/

const MOCK = {
  /** @type {F1Payload} — a completed race, with no flags so the initials fallback shows. */
  f1: {
    event: 'Sample Grand Prix', season: new Date().getFullYear(), phase: 'result',
    sessionLabel: 'Race Result', statusText: 'Final · (sample)', nextSession: null,
    positions: [
      { pos: 1, driver: 'Driver One', team: 'Team A', flag: '', winner: true },
      { pos: 2, driver: 'Driver Two', team: 'Team B', flag: '', winner: false },
      { pos: 3, driver: 'Driver Three', team: 'Team A', flag: '', winner: false },
    ],
    driverStandings: [
      { pos: 1, name: 'Driver One', team: 'Team A', points: 160 },
      { pos: 2, name: 'Driver Two', team: 'Team B', points: 120 },
      { pos: 3, name: 'Driver Three', team: 'Team A', points: 95 },
    ],
    constructorStandings: [
      { pos: 1, name: 'Team A', points: 255 },
      { pos: 2, name: 'Team B', points: 198 },
    ],
  },

  /** @type {GolfPayload} */
  golf: {
    event: 'Sample Invitational', isMajor: false, state: 'in', statusText: 'Round 4 (sample)',
    leaderScore: '-10', cutLine: '+1',
    leaderboard: [
      { pos: '1', name: 'Golfer One', flag: '', score: '-10', thru: '14' },
      { pos: 'T2', name: 'Golfer Two', flag: '', score: '-8', thru: '15' },
      { pos: 'T2', name: 'Golfer Three', flag: '', score: '-8', thru: '13' },
    ],
  },

  /** @type {TrendingStory[]} — editorial */
  trending: [
    { category: 'Sports', headline: 'NBA Finals tip toward a Game 7',
      summary: 'A road win swung the series and guaranteed at least one more game.',
      why: 'The team everyone wrote off is suddenly a couple wins from a title.' },
    { category: 'Business', headline: 'Big Tech keeps setting market-cap records',
      summary: 'AI demand continues to push the largest names to new highs.',
      why: "It's the story driving every portfolio and every water-cooler 'did you see this?'" },
    { category: 'Technology', headline: 'On-device AI takes center stage',
      summary: 'New features run locally for privacy, with cloud fallback for heavy lifting.',
      why: 'It ships to the phone in your pocket this fall.' },
    { category: 'Culture', headline: 'A summer blockbuster smashes the opening record',
      summary: 'The biggest domestic debut of the year so far.',
      why: 'Proof audiences still show up for the right theatrical event.' },
    { category: 'Entertainment', headline: 'A surprise album drop breaks streaming records',
      summary: 'No rollout, no single — just a midnight release that lit up the charts.',
      why: "It's the album your group chat is arguing about all week." },
  ],

  /** @type {TalkingPoint[]} — the uniquely-GuyTalk section; editorial */
  talkingAbout: [
    { topic: 'The NBA Finals are actually good this year',
      matters: 'A tight series with real stars means even casual fans are locked in.',
      say: '"Whoever wins the next one wins the series — road team has all the momentum."' },
    { topic: "Everyone's suddenly a tech-stock expert",
      matters: 'The relentless run has made it the default desk-and-dinner conversation.',
      say: '"I\'m not chasing it up here, but you can\'t argue with the demand."' },
    { topic: 'Dominance in golf is reshaping how people watch',
      matters: "When one guy is this far ahead, the debate becomes 'is this boring or historic?'",
      say: '"We\'re watching an all-timer. Enjoy it while it lasts."' },
    { topic: 'Summer movies are back',
      matters: 'After years of "theaters are dead," a record weekend flipped the script.',
      say: '"Turns out people just want a reason to show up. Give them an event and they come."' },
  ],
};

/* =============================================================================
 * 3. COMPONENTS  — pure functions returning HTML strings.
 * ===========================================================================*/

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shortEvent = (s) => String(s || '').replace(/\s+(pres\.?|presented).*/i, '').replace(/^the\s+/i, 'the ').trim();

// Deterministic colour for an initials avatar (used when no logo/flag exists).
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 45% 42%)`;
}
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase() || '–';
}
const flagOrAvatar = (flag, name) =>
  flag
    ? `<img class="flag" src="${esc(flag)}" alt="" loading="lazy">`
    : `<span class="avatar" style="background:${hashColor(name || '')}">${esc(initials(name))}</span>`;
const teamMark = (logo, abbr, color) =>
  logo
    ? `<img class="team-logo" src="${esc(logo)}" alt="" loading="lazy">`
    : `<span class="avatar" style="width:22px;height:22px;background:${color || hashColor(abbr || '')}">${esc((abbr || '').slice(0, 3))}</span>`;

// F1 has no team-logo feed from ESPN, so we identify constructors with their
// well-known brand colours (stable, local — no external image dependency).
const CONSTRUCTOR_COLORS = [
  [/red bull/i, '#3671C6'], [/ferrari/i, '#E8002D'], [/mercedes/i, '#27F4D2'],
  [/mclaren/i, '#FF8000'], [/aston martin/i, '#229971'], [/alpine/i, '#0093CC'],
  [/williams/i, '#64C4FF'], [/(^|\b)rb\b|racing bulls|alphatauri/i, '#6692FF'],
  [/haas/i, '#B6BABD'], [/sauber|audi|kick/i, '#52E252'], [/cadillac/i, '#C8102E'],
];
const constructorColor = (name) => {
  for (const [re, c] of CONSTRUCTOR_COLORS) if (re.test(name || '')) return c;
  return name ? hashColor(name) : 'var(--text-3)';
};

// Constructor identity badge: brand colour + monogram. ESPN/Jolpica provide no
// F1 team logos, and the real logos are trademarked wordmarks — so we render our
// own clean, trademark-safe badge. Image-ready: add a `logo` URL to a row below
// and it renders the image with the badge as a graceful fallback.
const CONSTRUCTORS = [
  { re: /red bull/i,                            abbr: 'RBR', bg: '#3671C6', fg: '#fff',     logo: '/assets/f1/redbull.png' },
  { re: /ferrari/i,                             abbr: 'FER', bg: '#E8002D', fg: '#fff',     logo: '/assets/f1/ferrari.png' },
  { re: /mercedes/i,                            abbr: 'MER', bg: '#00D7B6', fg: '#06251F',  logo: '/assets/f1/mercedes.png' },
  { re: /mclaren/i,                             abbr: 'MCL', bg: '#FF8000', fg: '#fff',     logo: '/assets/f1/mclaren.png' },
  { re: /aston martin/i,                        abbr: 'AMR', bg: '#229971', fg: '#fff',     logo: '/assets/f1/astonmartin.png' },
  { re: /alpine/i,                              abbr: 'ALP', bg: '#0093CC', fg: '#fff',     logo: '/assets/f1/alpine.png' },
  { re: /williams/i,                            abbr: 'WIL', bg: '#1868DB', fg: '#fff',     logo: '/assets/f1/williams.png' },
  { re: /racing bulls|alphatauri|(^|\b)rb\b/i,  abbr: 'RB',  bg: '#6692FF', fg: '#0A1B3D',  logo: '/assets/f1/rb.png' },
  { re: /haas/i,                                abbr: 'HAA', bg: '#9CA3A8', fg: '#111',     logo: '/assets/f1/haas.png' },
  { re: /sauber|audi|kick/i,                    abbr: 'SAU', bg: '#52E252', fg: '#0A2E12',  logo: '/assets/f1/sauber.png' },
  { re: /cadillac/i,                            abbr: 'CAD', bg: '#C8102E', fg: '#fff' },
];
const constructorMeta = (name) => CONSTRUCTORS.find((c) => c.re.test(name || '')) || null;
function constructorBadge(name) {
  if (!name) return '';
  const m = constructorMeta(name);
  const bg = m ? m.bg : constructorColor(name);
  const fg = m ? m.fg : '#fff';
  const abbr = m ? m.abbr : name.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase();
  if (m && m.logo) {
    // White plate so the full-colour team emblem reads cleanly; monogram shows
    // if the image ever fails to load.
    return `<span class="team-badge team-badge-logo" title="${esc(name)}"><img class="tb-logo" src="${esc(m.logo)}" alt="${esc(name)}" loading="lazy" onerror="var s=this.parentNode;s.classList.remove('team-badge-logo');s.style.background='${bg}';s.style.color='${fg}';s.textContent='${esc(abbr)}'"></span>`;
  }
  return `<span class="team-badge" style="background:${bg};color:${fg}" title="${esc(name)}">${esc(abbr)}</span>`;
}
const teamChip = (name) =>
  name ? `<span class="team-chip">${constructorBadge(name)}${esc(name)}</span>` : '';

const STATUS_PILL = {
  live:     '<span class="pill pill-live"><span class="nav-live-dot"></span>Live</span>',
  in:       '<span class="pill pill-live"><span class="nav-live-dot"></span>Live</span>',
  result:   '<span class="pill pill-final">Final</span>',
  final:    '<span class="pill pill-final">Final</span>',
  post:     '<span class="pill pill-final">Final</span>',
  upcoming: '<span class="pill pill-upcoming">Upcoming</span>',
  pre:      '<span class="pill pill-upcoming">Upcoming</span>',
};

/** LiveEventCard — Section 1 */
function LiveEventCard(ev) {
  const lines = ev.lines.map(
    (l) => `<div class="ev-line"><span class="l">${l.logo ? `<img class="ev-logo" src="${esc(l.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}${esc(l.left)}</span><span class="r">${esc(l.right)}</span></div>`
  ).join('');
  return `<div class="card">
    <div class="ev-head">
      <div><div class="ev-title">${esc(ev.title)}</div><div class="ev-status">${esc(ev.statusText)}</div></div>
      ${STATUS_PILL[ev.status] || ''}
    </div>
    ${lines}
    ${ev.leader ? `<div class="ev-foot">${esc(ev.leader)}</div>` : ''}
  </div>`;
}

/** LiveLeaderboard — ranked table (F1 + golf).
 *  rows: {pos,name,flag,sub,chip:{text},val,valClass,winner} */
function LiveLeaderboard(cfg) {
  const rows = cfg.rows.map((r, i) => {
    const leader = cfg.leaderHighlight && i === 0;
    const mark = cfg.showMarks
      ? flagOrAvatar(r.flag, r.name)
      : (r.badge ? constructorBadge(r.badge)
        : (r.dotColor ? `<span class="tc-dot" style="background:${r.dotColor};width:10px;height:10px"></span>` : ''));
    const detail = r.chip ? teamChip(r.chip) : (r.sub ? `<span class="sub">${esc(r.sub)}</span>` : '');
    const nameHtml = r.href
      ? `<a class="lb-link" href="${esc(r.href)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
      : esc(r.name);
    return `<div class="lb-row${leader ? ' is-leader' : ''}">
      <span class="lb-pos">${esc(r.pos)}</span>
      <span class="lb-name-row">${mark}<span class="lb-name-block"><span class="lb-name">${nameHtml}</span>${detail}</span></span>
      <span class="lb-val${r.valClass ? ' ' + r.valClass : ''}">${esc(r.val || '')}</span>
    </div>`;
  }).join('');
  return `<div class="lb">
    <div class="lb-head">
      <div><div class="lb-event">${esc(cfg.event)}</div><div class="lb-status">${esc(cfg.statusText)}</div></div>
      ${STATUS_PILL[cfg.state] || ''}
    </div>
    ${cfg.subHead ? `<div class="lb-sub-head">${esc(cfg.subHead)}</div>` : ''}
    ${rows}
  </div>`;
}

/** ContextCard — "The GuyTalk Read": signature why-it-matters / watch-for / what-to-say. */
function ContextCard(rows, live, tag) {
  const body = rows.filter((r) => r && r.text).map((r) => {
    const text = r.take
      ? `<div class="ctx-take"><span class="ctx-text">${esc(r.text)}</span></div>`
      : r.say
        ? `<div class="ctx-say"><span class="ctx-text">${esc(r.text)}</span></div>`
        : r.key
          ? `<div class="ctx-keystat"><span class="ctx-text">${esc(r.text)}</span></div>`
          : `<span class="ctx-text">${esc(r.text)}</span>`;
    return `<div class="ctx-row${r.key ? ' is-key' : ''}${r.take ? ' is-take' : ''}"><span class="ctx-label">${esc(r.label)}</span>${text}</div>`;
  }).join('');
  return `<div class="ctx-card${live ? ' live-accent' : ''}">
    <div class="ctx-head"><span class="gt">The GuyTalk Read<span class="dot">.</span></span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div>
    <div class="ctx-body">${body}</div>
  </div>`;
}

/** EventSpotlight — editorial hero card: colour-block hero + one strong visual
 *  (flag/initials) + up to three key stats. Premium, image-light, no scraping.
 *  @param {{eyebrow,icon,flag,name,subText,subColor,accent,watermark,
 *           stats:{num,label,neg}[]}} c */
function EventSpotlight(c) {
  const mark = c.flag
    ? `<img class="spot-flag" src="${esc(c.flag)}" alt="" loading="lazy">`
    : `<span class="spot-avatar">${esc(initials(c.name))}</span>`;
  const wm = c.watermark ? `<img class="spot-wm" src="${esc(c.watermark)}" alt="" loading="lazy">` : '';
  const stats = (c.stats || []).filter((s) => s && s.num != null && s.num !== '').map(
    (s) => `<div class="spot-stat"><div class="spot-stat-num${s.neg ? ' neg' : ''}">${esc(s.num)}</div><div class="spot-stat-lbl">${esc(s.label)}</div></div>`
  ).join('');
  return `<div class="spot">
    <div class="spot-hero" style="--c:${c.accent || '#2B6FFF'}">
      ${wm}
      <div class="spot-eyebrow"><span class="fx">${c.icon || ''}</span>${esc(c.eyebrow)}</div>
      <div class="spot-main">
        ${mark}
        <div>
          <div class="spot-name">${esc(c.name)}</div>
          ${c.subText ? `<div class="spot-team">${c.subColor ? `<span class="tc-dot" style="background:${c.subColor}"></span>` : ''}${esc(c.subText)}</div>` : ''}
        </div>
      </div>
      ${c.link ? `<div class="spot-link-row"><a class="hl-btn" href="${esc(c.link.url)}" target="_blank" rel="noopener"><span class="pl">▶</span> ${esc(c.link.label)}</a></div>` : ''}
    </div>
    ${stats ? `<div class="spot-stats">${stats}</div>` : ''}
  </div>`;
}

/** Marquee — premium matchup banner for the single biggest game. */
function Marquee(g) {
  const teamMark = (t, cls) =>
    t.logo
      ? `<img class="mq-logo" src="${esc(t.logo)}" alt="" loading="lazy">`
      : `<span class="mq-avatar" style="background:${t.color || hashColor(t.abbr)}">${esc((t.abbr || '').slice(0, 3))}</span>`;
  const showScore = g.state !== 'pre' && g.away.score !== '' && g.home.score !== '';
  const tname = (t) => t.link
    ? `<a class="nm-link" href="${esc(t.link)}" target="_blank" rel="noopener" style="color:#fff">${esc(t.abbr || t.name)}</a>`
    : esc(t.abbr || t.name);
  const side = (t, cls) => `<div class="mq-team ${cls}">
      ${teamMark(t, cls)}
      <div class="mq-tn"><div class="mq-abbr">${tname(t)}</div>${t.record ? `<div class="mq-rec">${esc(t.record)}</div>` : ''}</div>
      ${showScore ? `<div class="mq-score">${esc(t.score)}</div>` : ''}
    </div>`;
  const mid = g.state === 'pre' ? 'vs' : '–';
  const status = g.state === 'in'
    ? `<span class="pill pill-live"><span class="nav-live-dot"></span>Live</span> ${esc(g.statusText)}`
    : esc(g.statusText);
  const hl = g.eventLink ? ` &nbsp;·&nbsp; <a class="nm-link" href="${esc(g.eventLink.url)}" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.9)">${esc(g.eventLink.label)} →</a>` : '';
  return `<div class="marquee" style="--ca:${g.away.color || 'var(--accent)'};--ch:${g.home.color || 'var(--accent)'}">
    <div class="marquee-accent"></div>
    <div class="marquee-tag">${esc(g.headline || g.league)}</div>
    <div class="marquee-body">
      ${side(g.away, 'away')}
      <div class="mq-mid">${mid}</div>
      ${side(g.home, 'home')}
    </div>
    <div class="marquee-foot">${status}${hl}</div>
  </div>`;
}

/** ScoreboardCard — Section 4 (one game) */
function ScoreboardCard(g) {
  const side = (t, otherScore) => {
    const losing = g.state === 'post' && t.score !== '' && Number(t.score) < Number(otherScore);
    const abbr = t.link
      ? `<a class="nm-link sc-abbr" href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.abbr || t.name)}</a>`
      : `<span class="sc-abbr">${esc(t.abbr || t.name)}</span>`;
    return `<div class="sc-team${losing ? ' loser' : ''}">
      <span class="nm">${teamMark(t.logo, t.abbr, t.color)}${abbr}${t.record ? `<span class="sc-rec">${esc(t.record)}</span>` : ''}</span>
      <span class="sc-score">${esc(t.score !== '' ? t.score : '—')}</span>
    </div>`;
  };
  const statusBit = g.state === 'in'
    ? `<span class="pill pill-live"><span class="nav-live-dot"></span>Live</span> ${esc(g.statusText)}`
    : esc(g.statusText);
  return `<div class="sc-card">
    ${g.isBig && g.headline ? `<div class="sc-tag">${esc(g.headline)}</div>` : ''}
    ${side(g.away, g.home.score)}
    ${side(g.home, g.away.score)}
    <div class="sc-foot">${statusBit}</div>
  </div>`;
}

// Map a market tile to the Yahoo symbol its value represents, so a click opens
// the matching security (the proxy/yield actually shown, not a mismatched index).
const MARKET_YAHOO = { spx: 'SPY', dow: 'DIA', ndq: 'QQQ', rut: 'IWM', btc: 'BTC-USD', gold: 'GLD', oil: 'USO', tnx: '^TNX' };
function marketYahooSymbol(m) { return MARKET_YAHOO[m.key] || (m.sub && /^[A-Z.\-^]+$/.test(m.sub) ? m.sub : null); }

/** MarketCard — Section 5 */
function MarketCard(m) {
  const fmt = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const arrow = m.direction === 'up' ? '▲' : '▼';
  const sign = m.change >= 0 ? '+' : '';
  const unit = m.unit || ''; // e.g. '%' for the 10-Yr Treasury yield
  const sym = marketYahooSymbol(m);
  const clickAttrs = sym ? ` is-clickable" data-symbol="${esc(sym)}" role="button" tabindex="0` : '';
  return `<div class="mk-card${clickAttrs}">
    <div class="mk-label">${esc(m.label)}</div><div class="mk-sub">${esc(m.sub)}</div>
    <div class="mk-value">${fmt(m.value)}${esc(unit)}</div>
    <div class="mk-move ${m.direction}"><span class="mk-arrow">${arrow}</span>${sign}${fmt(m.change)} (${sign}${m.changePercent.toFixed(2)}%)</div>
  </div>`;
}

/** TrendingStoryCard — Section 6 (live headlines w/ source links) */
function TrendingStoryCard(s, i) {
  const head = s.url
    ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.headline)}</a>`
    : esc(s.headline);
  return `<div class="story">
    <div class="story-num">${String(i + 1).padStart(2, '0')}</div>
    <div>
      <div class="story-cat">${esc(s.category)}</div>
      <div class="story-head">${head}</div>
      ${s.summary ? `<p class="story-sum">${esc(s.summary)}</p>` : ''}
      ${s.why ? `<p class="story-why"><b>Why it matters:</b> ${esc(s.why)}</p>` : ''}
      ${s.url ? `<div class="story-src">${esc(s.source || 'Source')} · <a href="${esc(s.url)}" target="_blank" rel="noopener">Read →</a></div>` : ''}
    </div>
  </div>`;
}

/** TalkingPointCard — Section 7 (topic / why / what to say + source) */
function TalkingPointCard(t) {
  return `<div class="talk-card">
    <div class="talk-topic">${esc(t.topic)}</div>
    <p class="talk-field"><b>Why it matters</b>${esc(t.matters)}</p>
    ${t.stat ? `<p class="talk-field talk-stat"><b>Key stat</b>${esc(t.stat)}</p>` : ''}
    <p class="talk-field talk-say"><b>What to say</b>${esc(t.say)}</p>
    ${t.url ? `<p class="talk-src"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.source || 'Source')} →</a></p>` : ''}
  </div>`;
}

/* ---- data-derived context builders (factual, from the live payload) ----
 * GoalTalk content standard, every card answers: what happened, why it matters
 * (consequence, not a result-restate), the single most interesting REAL stat,
 * and a quotable line built on that stat. Only verified payload numbers are
 * used — no invented records/streaks/superlatives (compliance). */

// Map a race/circuit name to a track photo we ship in /assets/circuits.
const CIRCUIT_IMG = [
  [/monaco|monte carlo/i, 'monaco'],
  [/bahrain|sakhir/i, 'bahrain'],
  [/spanish|barcelona|catalunya|madrid/i, 'barcelona'],
  [/united states|austin|cota|texas/i, 'cota'],
  [/brazil|s[aã]o paulo|sao paulo|interlagos/i, 'interlagos'],
  [/las vegas|vegas/i, 'lasvegas'],
  [/austral|melbourne|albert park/i, 'melbourne'],
  [/canad|montr[eé]al|gilles/i, 'montreal'],
  [/ital|monza/i, 'monza'],
  [/austria|red ?bull ?ring|spielberg|styria/i, 'redbullring'],
  [/british|silverstone/i, 'silverstone'],
  [/singapore|marina bay/i, 'singapore'],
  [/belgian|spa|francorchamps/i, 'spa'],
  [/japan|suzuka/i, 'suzuka'],
  [/dutch|zandvoort|netherlands/i, 'zandvoort'],
];
function circuitImage(f1) {
  const hay = `${f1.event || ''} ${(f1.nextRace && (f1.nextRace.circuit || f1.nextRace.name)) || ''}`;
  for (const [re, file] of CIRCUIT_IMG) if (re.test(hay)) return `/assets/circuits/${file}.jpg`;
  return '';
}
// Full-width circuit photo banner that heads the F1 section.
function F1CircuitBanner(f1) {
  const src = circuitImage(f1);
  if (!src) return '';
  return `<div class="f1-banner">
    <img src="${src}" alt="${esc(f1.event || 'Formula 1')} circuit" loading="lazy">
    <div class="f1-banner-cap">
      <span class="f1-banner-event">${esc(f1.event || 'Formula 1')}</span>
      <span class="f1-banner-sub">${esc(f1.sessionLabel || '')}</span>
    </div>
  </div>`;
}

// Championship picture from Jolpica driver standings.
function f1Champ(f1) {
  const d = f1.driverStandings || [];
  if (!d.length) return null;
  const leader = d[0];
  const second = d[1] || null;
  const gap = second ? leader.points - second.points : null;
  return { leader, second, gap };
}
// Standing row for a given driver (matched by last name).
function f1Standing(f1, name) {
  const last = (name || '').split(' ').pop().toLowerCase();
  return (f1.driverStandings || []).find((d) => d.name.toLowerCase().endsWith(last)) || null;
}
function f1OneTwo(f1) {
  const p = f1.positions || [];
  return p[0] && p[1] && p[0].team && p[0].team === p[1].team ? p[0].team : null;
}
const plural = (n, w) => `${n} ${w}${Math.abs(n) === 1 ? '' : 's'}`;

// Verified-fact conversation starter for the race winner, built from
// f1.winnerFacts (computed server-side from Jolpica history — never invented).
// Guarded: facts are only used if they match the spotlighted winner.
function f1FunFact(f1, winner) {
  const wf = f1.winnerFacts;
  if (!wf || !winner) return null;
  const wl = winner.driver.split(' ').pop().toLowerCase();
  if (wf.winnerLast && wf.winnerLast.toLowerCase() !== wl) return null;
  if (wf.youngest) {
    const y = wf.youngest;
    const prev = y.prev ? ` Next-youngest: ${y.prev.name} at ${y.prev.age} (${y.prev.season}).` : '';
    return {
      stat: `Youngest ${y.circuit} GP winner in F1 history — at ${y.age}.${prev}`,
      say: `"At ${y.age}, ${winner.driver} is the youngest ${y.circuit} winner ever${wf.streak >= 2 ? ` — and that's ${wf.streak} straight now` : ''}."`,
      missed: `Youngest ${y.circuit} winner ever (age ${y.age})`,
    };
  }
  if (wf.streak >= 2) {
    return {
      stat: `${plural(wf.streak, 'win')} in a row — ${plural(wf.seasonWins, 'win')} on the season.`,
      say: `"That's ${wf.streak} straight for ${winner.driver} — this title's turning into a runaway."`,
      missed: `${wf.streak} straight wins`,
    };
  }
  if (wf.seasonWins >= 2) {
    return {
      stat: `${plural(wf.seasonWins, 'win')} already this season.`,
      say: `"${winner.driver} is up to ${wf.seasonWins} wins on the year — he's the man to beat."`,
      missed: `${wf.seasonWins} wins this season`,
    };
  }
  return null;
}

function f1Context(f1) {
  const p = f1.positions || [];
  const ev = shortEvent(f1.event);
  const champ = f1Champ(f1);
  const gapTxt = champ && champ.gap != null
    ? `${champ.leader.name} leads the title by ${plural(champ.gap, 'point')}${champ.second ? ` over ${champ.second.name}` : ''}`
    : null;

  if (f1.phase === 'live') {
    const p0 = p[0], p1 = p[1];
    return [
      { label: 'Why it matters', text: p0
        ? `${p0.driver} controls ${ev} from the front${p1 ? `, and ${p1.driver} is the only car within range` : ''} — at this track, leading usually means winning.`
        : `${ev} is running live right now.` },
      champ && { label: 'Key stat', key: true, text: `${gapTxt} coming into today.` },
      { label: 'What to say', say: true, text: p0
        ? `"${p0.driver} is managing this from P1 — ${p1 ? `${p1.driver} can see him but can't reel him in` : 'the field has no answer'}."`
        : `"${ev} is live — worth a look."` },
    ];
  }

  if (f1.phase === 'upcoming') {
    const grid = p[0];
    return [
      { label: 'Why it matters', text: champ && champ.gap != null
        ? `${ev} can swing the championship — ${champ.leader.name} carries a ${plural(champ.gap, 'point')} lead into the weekend.`
        : `${ev} is up next on the calendar.` },
      grid && { label: 'Key stat', key: true, text: `${grid.driver} starts on pole${grid.team ? ` for ${grid.team}` : ''}.` },
      { label: 'What to say', say: true, text: grid
        ? `"${grid.driver} on pole, but ${champ ? `${champ.leader.name}'s ${champ.gap}-point cushion` : 'the title race'} is the story this weekend."`
        : `"Big one coming up at ${ev}."` },
    ];
  }

  // result
  const winner = p[0];
  const wStand = winner ? f1Standing(f1, winner.driver) : null;
  const leads = !!(champ && winner &&
    champ.leader.name.toLowerCase().endsWith(winner.driver.split(' ').pop().toLowerCase()));
  const oneTwo = f1OneTwo(f1);
  let why;
  if (winner && champ && champ.gap != null) {
    why = leads
      ? `${winner.driver}'s win stretches his championship lead to ${plural(champ.gap, 'point')}${champ.second ? ` over ${champ.second.name}` : ''}.`
      : `${winner.driver} takes the win, but ${champ.leader.name} still leads the title by ${plural(champ.gap, 'point')}.`;
  } else { why = winner ? `${winner.driver} wins ${ev}.` : `${ev} is in the books.`; }

  const fun = f1FunFact(f1, winner);
  const take = winner && champ && champ.gap != null && champ.gap >= 40
    ? `${winner.driver} has this title wrapped up — the rest of the grid is racing for second.`
    : (winner ? `${winner.driver} is the best driver on the grid right now, and it isn't particularly close.` : '');
  return [
    { label: 'Why it matters', text: why },
    { label: 'Key stat', key: true, text: fun ? fun.stat
        : (oneTwo
            ? `${oneTwo} finish 1-2${gapTxt ? `; ${gapTxt}` : ''}.`
            : (gapTxt ? `${gapTxt}.` : (wStand ? `${winner.driver} sits P${wStand.pos} on ${wStand.points} points.` : null))) },
    { label: 'What to say', say: true, text: fun ? fun.say
        : (winner && champ && champ.gap != null
            ? (leads
                ? `"${winner.driver} is up ${champ.gap} now — this title's starting to look like a runaway."`
                : `"Strong win for ${winner.driver}, but ${champ.leader.name} is still ${champ.gap} clear in the standings."`)
            : (winner ? `"${winner.driver} taking ${ev} is a statement."` : `"Results are in for ${ev}."`)) },
    take && { label: 'Hot take', take: true, text: take },
  ];
}

// Parse a golf score string ("-12", "E", "+3") to a number of strokes vs par.
function golfScoreNum(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (/^e$/i.test(t)) return 0;
  const n = parseInt(t.replace('+', ''), 10);
  return Number.isFinite(n) ? n : null;
}

function golfContext(g) {
  const lb = g.leaderboard || [];
  const ev = shortEvent(g.event);
  const lead = lb[0], second = lb[1];
  if (!lead) {
    return [
      { label: 'Why it matters', text: `${ev} is underway.` },
      { label: 'What to say', say: true, text: `"${ev} is one to watch this week."` },
    ];
  }
  const ls = golfScoreNum(lead.score), ss = golfScoreNum(second && second.score);
  const margin = (ls != null && ss != null) ? ss - ls : null; // strokes leader is ahead
  const clear = margin != null && margin > 0 ? `${plural(margin, 'stroke')} clear` : null;
  const post = g.state === 'post';
  // A finished win where the leader tied the runner-up on score = playoff.
  const playoff = post && second && ls != null && ss != null && ls === ss;
  if (playoff) {
    return [
      { label: 'Why it matters', text: `${lead.name} wins ${ev} in a playoff over ${second.name} — both finished ${lead.score}, settled on extra holes.` },
      { label: 'Key stat', key: true, text: `Won a sudden-death playoff over ${second.name} (both at ${lead.score}).` },
      { label: 'What to say', say: true, text: `"${lead.name} took ${ev} in a playoff over ${second.name} — about as clutch as it gets."` },
      { label: 'Hot take', take: true, text: `Winning a playoff under that pressure tells you more about a player than any wire-to-wire cruise ever could.` },
    ];
  }
  return [
    { label: 'Why it matters', text: post
        ? `${lead.name} wins ${ev} at ${lead.score}${clear ? `, ${clear} of the field` : ''} — a result that reshuffles the season's pecking order.`
        : `${lead.name} ${clear ? `is ${clear}` : 'leads'} at ${ev}${lead.thru ? ` through ${lead.thru}` : ''}, and a lead like this is hard to hand back.` },
    { label: 'Key stat', key: true, text: clear
        ? `${lead.name} at ${lead.score}, ${clear}${second ? ` of ${second.name}` : ''}.`
        : (g.cutLine ? `Cut line sitting at ${g.cutLine}.` : `${lead.name} leads at ${lead.score}.`) },
    { label: 'What to say', say: true, text: post
        ? `"${lead.name} closing out ${ev} at ${lead.score}${margin > 0 ? ` by ${margin}` : ''} — that's how you finish a tournament."`
        : `"${lead.name} at ${lead.score}${clear ? `, ${clear}` : ''} — he's the man to beat."` },
    (post && margin > 2) && { label: 'Hot take', take: true, text: `A ${margin}-shot win isn't a tournament, it's a statement — nobody else showed up.` },
  ];
}

/** WhatYouMissed — quick recap block for a completed major event.
 *  Winner · Biggest storyline · Best performance · Key takeaway. */
function WhatYouMissed(items) {
  const rows = (items || []).filter((i) => i && i.v).map((i) =>
    `<div class="wym-row"><span class="wym-k">${esc(i.k)}</span><span class="wym-v">${esc(i.v)}</span></div>`
  ).join('');
  if (!rows) return '';
  return `<div class="wym-card">
    <div class="wym-head"><span class="wym-dot"></span>What You Missed</div>
    <div class="wym-body">${rows}</div>
  </div>`;
}

function f1WhatYouMissed(f1) {
  if (!f1 || f1.phase !== 'result') return '';
  const p = f1.positions || [];
  const winner = p[0];
  if (!winner) return '';
  const champ = f1Champ(f1);
  const podium = p.slice(1, 3).map((x) => `P${x.pos} ${x.driver}`).join(', ');
  const oneTwo = f1OneTwo(f1);
  const fun = f1FunFact(f1, winner);
  return WhatYouMissed([
    { k: 'Winner', v: `${winner.driver}${winner.team ? ` · ${winner.team}` : ''}` },
    { k: 'Biggest storyline', v: fun ? fun.missed
        : (champ && champ.gap != null ? `${champ.leader.name} leads the title by ${champ.gap} pts` : '') },
    { k: 'Best performance', v: oneTwo ? `${oneTwo} lock out a 1-2` : podium },
    { k: 'Key takeaway', v: champ && champ.gap != null ? `${champ.gap}-point gap at the top with the season rolling on` : `${winner.driver} adds another win` },
  ]);
}

/* ---- NBA marquee-game context (from g.facts, computed server-side) ---- */

function nbaContext(g) {
  const f = g.facts;
  if (!f) return null;
  const homeRec = (f.teams || []).find((t) => t.homeAway === 'home') || {};
  const awayRec = (f.teams || []).find((t) => t.homeAway === 'away') || {};
  const seriesLow = f.series ? f.series.summary.replace(/^Series\s+/i, '').toLowerCase() : ''; // "tied 1-1"

  if (f.state === 'post') {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const tp = f.topPerformer;
    const line = tp ? `${tp.pts}${tp.reb != null ? `/${tp.reb}` : ''}${tp.ast != null ? `/${tp.ast}` : ''}` : '';
    return [
      { label: 'Why it matters', text: `${w.name} beat ${l.name} ${w.score}-${l.score}${f.series ? ` — ${f.series.name} now ${seriesLow}` : ''}.` },
      tp && { label: 'Key stat', key: true, text: `${tp.name} led all scorers with ${tp.pts}${tp.reb != null && tp.ast != null ? ` (${tp.reb} reb, ${tp.ast} ast)` : ''}.` },
      { label: 'What to say', say: true, text: tp
        ? `"${tp.name} went for ${line} and ${w.name} took it ${w.score}-${l.score}."`
        : `"${w.name} got it done, ${w.score}-${l.score}."` },
      { label: 'Hot take', take: true, text: `${w.name} are the better team here — ${f.series ? 'this series is theirs to lose' : 'and it showed'}.` },
    ];
  }

  // pre / live
  const ts = f.topScorers || [];
  const matchup = ts.length >= 2 ? `${ts[0].name} (${ts[0].val}) vs ${ts[1].name} (${ts[1].val})` : '';
  const recLine = (homeRec.total || awayRec.total)
    ? `${g.home.name} ${homeRec.total}${homeRec.split ? ` (${homeRec.split} home)` : ''} · ${g.away.name} ${awayRec.total}${awayRec.split ? ` (${awayRec.split} away)` : ''}`
    : '';
  return [
    { label: 'Why it matters', text: f.series
        ? `${g.headline || 'Tonight'}: the ${f.series.name} is ${seriesLow} — every game swings it now.`
        : `${g.away.name} visit ${g.home.name} with real stakes.` },
    recLine && { label: 'Key stat', key: true, text: `${recLine}.` },
    { label: 'What to say', say: true, text: matchup
        ? `"${f.series ? `${f.series.name} ${seriesLow}` : (g.headline || 'Big one tonight')} — ${matchup} on points per game."`
        : `"${g.home.name}–${g.away.name} should be a good one."` },
    f.series && { label: 'Hot take', take: true, text: `Series ${seriesLow} means tonight basically is the series — whoever blinks first goes home.` },
  ];
}

function nbaWhatYouMissed(g) {
  const f = g.facts;
  if (!f || f.state !== 'post') return '';
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  const tp = f.topPerformer;
  return WhatYouMissed([
    { k: 'Winner', v: `${w.name} ${w.score}–${l.score}` },
    { k: 'Biggest storyline', v: f.series ? `${f.series.name}: ${f.series.summary}` : (g.headline || '') },
    { k: 'Best performance', v: tp ? `${tp.name} — ${tp.pts} pts${tp.reb != null ? `, ${tp.reb} reb` : ''}${tp.ast != null ? `, ${tp.ast} ast` : ''}` : '' },
    { k: 'Key takeaway', v: f.series ? `${f.series.name} now ${seriesLowOf(f)}` : `${w.name} get the W` },
  ]);
}
function seriesLowOf(f) { return f.series ? f.series.summary.replace(/^Series\s+/i, '').toLowerCase() : ''; }

/* ---- MLB game context (from g.facts; data comes free off the scoreboard) ---- */

function mlbContext(g) {
  const f = g.facts;
  if (!f) return null;
  const homeF = (f.teams || []).find((t) => t.homeAway === 'home') || {};
  const awayF = (f.teams || []).find((t) => t.homeAway === 'away') || {};

  if (f.state === 'post') {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const wF = g.home.winner ? homeF : awayF;
    const perf = wF.perf || homeF.perf || awayF.perf;
    return [
      { label: 'Why it matters', text: `${w.name} beat ${l.name} ${w.score}-${l.score}.` },
      perf && { label: 'Key stat', key: true, text: `${perf.name} led the way: ${perf.line}.` },
      { label: 'What to say', say: true, text: perf
        ? `"${perf.name} went ${perf.line} as ${w.name} took down ${l.name} ${w.score}-${l.score}."`
        : `"${w.name} beat ${l.name} ${w.score}-${l.score}."` },
      { label: 'Hot take', take: true, text: `${w.name} are quietly the team nobody wants to face right now.` },
    ];
  }

  // pre / live — lead with the pitching matchup, the most useful pre-game fact.
  const hp = homeF.probable, ap = awayF.probable;
  const matchup = (hp && hp.name && ap && ap.name) ? `${ap.name} (${ap.line}) vs ${hp.name} (${hp.line})` : '';
  const recLine = (homeF.total || awayF.total)
    ? `${g.home.name} ${homeF.total}${homeF.split ? ` (${homeF.split} home)` : ''} · ${g.away.name} ${awayF.total}${awayF.split ? ` (${awayF.split} away)` : ''}`
    : '';
  return [
    { label: 'Why it matters', text: matchup
        ? `${g.away.name} at ${g.home.name} — ${ap.name} and ${hp.name} get the ball.`
        : `${g.away.name} visit ${g.home.name}.` },
    (matchup || recLine) && { label: 'Key stat', key: true, text: matchup ? `${matchup}.` : `${recLine}.` },
    { label: 'What to say', say: true, text: matchup
        ? `"${ap.name} (${ap.line}) on the mound against ${hp.name} (${hp.line}) — should be a good one."`
        : `"${g.home.name}–${g.away.name} tonight."` },
    matchup && { label: 'Hot take', take: true, text: `Pitching wins this one — whoever's starter blinks first loses.` },
  ];
}

function mlbWhatYouMissed(g) {
  const f = g.facts;
  if (!f || f.state !== 'post') return '';
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  const wF = (f.teams || []).find((t) => t.abbr === w.abbr) || {};
  const perf = wF.perf || (f.teams || []).map((t) => t.perf).find(Boolean);
  return WhatYouMissed([
    { k: 'Winner', v: `${w.name} ${w.score}–${l.score}` },
    { k: 'Biggest storyline', v: g.headline || `${w.name} take down ${l.name}` },
    { k: 'Best performance', v: perf ? `${perf.name} — ${perf.line}` : '' },
    { k: 'Key takeaway', v: `${w.name} get the W` },
  ]);
}

/* ---- NFL / NHL game context (from g.facts via the ESPN summary endpoint) ----
   Same fact shape for both: records + venue split, a standout per side, and a
   playoff series when present (NHL post-season). Phrasing stays sport-neutral. */

function summaryReadContext(g) {
  const f = g.facts;
  if (!f) return null;
  const homeF = (f.teams || []).find((t) => t.homeAway === 'home') || {};
  const awayF = (f.teams || []).find((t) => t.homeAway === 'away') || {};
  const seriesLow = f.series ? f.series.summary.replace(/^Series\s+/i, '').toLowerCase() : '';
  const leaderBy = (abbr) => (f.leaders || []).find((l) => l.abbr === abbr);

  if (f.state === 'post') {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const wl = leaderBy(w.abbr);
    return [
      { label: 'Why it matters', text: `${w.name} beat ${l.name} ${w.score}-${l.score}${f.series ? ` — ${f.series.name} now ${seriesLow}` : ''}.` },
      wl && { label: 'Key stat', key: true, text: `${wl.name} led the way${wl.cat ? ` (${wl.cat.toLowerCase()})` : ''}: ${wl.line}.` },
      { label: 'What to say', say: true, text: wl
        ? `"${wl.name} put up ${wl.line} and ${w.name} took it ${w.score}-${l.score}."`
        : `"${w.name} got it done, ${w.score}-${l.score}."` },
      { label: 'Hot take', take: true, text: `${w.name} are the better team here — ${f.series ? 'this series is theirs to lose' : 'and it showed'}.` },
    ];
  }

  // pre / live
  const recLine = (homeF.total || awayF.total)
    ? `${g.home.name} ${homeF.total}${homeF.split ? ` (${homeF.split} home)` : ''} · ${g.away.name} ${awayF.total}${awayF.split ? ` (${awayF.split} away)` : ''}`
    : '';
  const hl = leaderBy(g.home.abbr), al = leaderBy(g.away.abbr);
  const matchup = (hl && al) ? `${al.name} (${al.line}) vs ${hl.name} (${hl.line})` : '';
  return [
    { label: 'Why it matters', text: f.series
        ? `${g.headline || 'Tonight'}: the ${f.series.name} is ${seriesLow} — every game swings it now.`
        : `${g.away.name} visit ${g.home.name} with real stakes.` },
    recLine && { label: 'Key stat', key: true, text: `${recLine}.` },
    { label: 'What to say', say: true, text: matchup
        ? `"Keep an eye on ${matchup} — that's the matchup that decides it."`
        : `"${g.home.name}–${g.away.name} should be a good one."` },
    f.series && { label: 'Hot take', take: true, text: `Series ${seriesLow} means tonight basically is the series — whoever blinks first goes home.` },
  ];
}

function summaryWhatYouMissed(g) {
  const f = g.facts;
  if (!f || f.state !== 'post') return '';
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  const wl = (f.leaders || []).find((x) => x.abbr === w.abbr);
  return WhatYouMissed([
    { k: 'Winner', v: `${w.name} ${w.score}–${l.score}` },
    { k: 'Biggest storyline', v: f.series ? `${f.series.name}: ${f.series.summary}` : (g.headline || `${w.name} take down ${l.name}`) },
    { k: 'Best performance', v: wl ? `${wl.name} — ${wl.line}` : '' },
    { k: 'Key takeaway', v: f.series ? `${f.series.name} now ${seriesLowOf(f)}` : `${w.name} get the W` },
  ]);
}

/* Dispatch the right builder for a game that carries server-computed facts. */
function gameRead(g, cls) {
  if (!g || !g.facts) return '';
  const lg = g.facts.league;
  let rows, wym;
  if (lg === 'mlb') { rows = mlbContext(g); wym = mlbWhatYouMissed(g); }
  else if (lg === 'nhl' || lg === 'nfl') { rows = summaryReadContext(g); wym = summaryWhatYouMissed(g); }
  else { rows = nbaContext(g); wym = nbaWhatYouMissed(g); }
  if (!rows) return '';
  return `<div class="stack ${cls || 'marquee-read'}">${ContextCard(rows, g.state === 'in', g.league)}${wym}</div>`;
}

function golfWhatYouMissed(g) {
  if (!g || g.state !== 'post') return '';
  const lb = g.leaderboard || [];
  const lead = lb[0];
  if (!lead) return '';
  const second = lb[1];
  const ls = golfScoreNum(lead.score), ss = golfScoreNum(second && second.score);
  const margin = (ls != null && ss != null) ? ss - ls : null;
  const playoff = second && ls != null && ss != null && ls === ss;
  return WhatYouMissed([
    { k: 'Winner', v: `${lead.name} · ${lead.score}` },
    { k: 'Biggest storyline', v: playoff ? `Won a playoff over ${second.name}`
        : (margin && margin > 0 ? `Won by ${plural(margin, 'stroke')}` : 'Down-to-the-wire finish at the top') },
    { k: 'Best performance', v: second ? `${second.name} runner-up at ${second.score}` : '' },
    { k: 'Key takeaway', v: `${lead.name} takes ${shortEvent(g.event)}` },
  ]);
}

/** FeaturedF1Card — winner/leader/pole spotlight for the F1 section. */
function FeaturedF1Card(f1) {
  const p0 = (f1.positions || [])[0];
  if (!p0) return '';
  const meta = {
    result:   { eyebrow: 'Race Winner', icon: '🏁' },
    live:     { eyebrow: 'Race Leader', icon: '🏎️' },
    upcoming: { eyebrow: 'On Pole',     icon: '⏱️' },
  }[f1.phase] || { eyebrow: 'Top Spot', icon: '🏁' };

  // Championship points for the spotlighted driver (matched by last name).
  const last = p0.driver.split(' ').pop().toLowerCase();
  const champ = (f1.driverStandings || []).find((d) => d.name.toLowerCase().endsWith(last));
  const posLabel = f1.phase === 'result' ? 'Finish' : f1.phase === 'live' ? 'Running' : 'Grid';

  return EventSpotlight({
    eyebrow: meta.eyebrow, icon: meta.icon, flag: p0.flag, name: p0.driver,
    subText: p0.team || '', subColor: p0.team ? constructorColor(p0.team) : '',
    accent: constructorColor(p0.team), watermark: f1.leagueLogo,
    link: f1.eventLink || null,
    stats: [
      { num: `P${p0.pos}`, label: posLabel },
      champ && { num: champ.points, label: 'Season pts' },
      champ ? { num: `P${champ.pos}`, label: 'Championship' } : { num: shortEvent(f1.event).replace(/^the /i, ''), label: 'Event' },
    ],
  });
}

/** FeaturedGolfCard — leader/champion spotlight for the golf section. */
function FeaturedGolfCard(g) {
  const lead = (g.leaderboard || [])[0];
  if (!lead) return '';
  const meta = {
    post: { eyebrow: 'Champion', icon: '🏆' },
    in:   { eyebrow: 'Tournament Leader', icon: '⛳' },
    pre:  { eyebrow: 'Top of the Field', icon: '⛳' },
  }[g.state] || { eyebrow: 'Tournament Leader', icon: '⛳' };

  const negScore = String(lead.score).trim().startsWith('-');
  return EventSpotlight({
    eyebrow: meta.eyebrow, icon: meta.icon, flag: lead.flag, name: lead.name,
    subText: g.state === 'post' ? `Won at ${lead.score}` : `Leads at ${lead.score}`,
    accent: '#15803D', watermark: g.leagueLogo, link: g.eventLink || null,
    stats: [
      { num: lead.score, label: 'Score', neg: negScore },
      { num: lead.thru ? lead.thru : (g.state === 'post' ? 'F' : '—'), label: 'Thru' },
      { num: lead.pos, label: 'Position' },
    ],
  });
}

/* =============================================================================
 * 4. APP
 * ===========================================================================*/

(function () {
  const REFRESH_MS = 60 * 1000;        // scoreboard / F1 / golf / markets
  const TALK_MS = 10 * 60 * 1000;      // trending stories / talking points
  const IS_DEV =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname) ||
    location.hostname.endsWith('.vercel.app') ||
    location.search.includes('dev');

  const $ = (id) => document.getElementById(id);

  // source: 'live'|'mock'|'editorial'|'ai'|'derived'|null. Badges show in dev only.
  function setBadge(id, source) {
    const el = $(id);
    if (!el) return;
    if (!IS_DEV || !source) { el.innerHTML = ''; return; }
    const map = {
      live: ['src-live', 'Live API'], mock: ['src-mock', 'Mock Data'],
      editorial: ['src-edit', 'Editorial'], ai: ['src-ai', 'Claude AI'], derived: ['src-derived', 'Derived'],
    };
    const [cls, label] = map[source] || ['', ''];
    el.innerHTML = cls ? `<span class="src-badge ${cls}">${label}</span>` : '';
  }

  function relTime(iso) {
    if (!iso) return '';
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ago`;
    return `${Math.floor(m / 60)}h ago`;
  }

  // Trust signal per section: "Updated Xm ago · ESPN". Source label is subtle in
  // all envs; the dev-only coloured LIVE/MOCK/EDITORIAL badge is separate.
  function paintMeta(el) {
    const src = el.dataset.src || '';
    const iso = el.dataset.iso || window.__liveIso;
    if (!iso && !src) { el.innerHTML = ''; return; }
    const rel = iso ? `Updated ${relTime(iso)}` : '';
    el.innerHTML = `${rel}${rel && src ? ' · ' : ''}${src ? `<span class="section-src">${esc(src)}</span>` : ''}`;
  }
  function setMeta(id, source, iso) {
    const el = $(id);
    if (!el) return;
    el.dataset.src = source || '';
    if (iso) el.dataset.iso = iso;
    paintMeta(el);
  }
  const paintAllMetas = () => document.querySelectorAll('.section-meta').forEach(paintMeta);

  const emptyBox = (msg) => `<div class="empty">${esc(msg)}</div>`;

  /* ---- section renderers. `real` = the live payload field (may be null). ---- */

  function renderLiveNow(real) {
    const el = $('liveNow');
    const anyLive = !!(real && real.some((c) => c.status === 'live'));
    setBadge('badge-live', anyLive ? 'live' : null);
    const desc = $('desc-live');
    if (!real || !real.length) {
      if (desc) desc.textContent = 'Quiet on the schedule right now — scroll for the latest results, standings, and what’s next.';
      el.innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing live and nothing on tonight’s slate yet. Scroll for the latest results, standings, and what’s next.</div>`;
      return;
    }
    if (desc) desc.textContent = anyLive
      ? 'The biggest events happening right now, ranked by what matters.'
      : 'Nothing’s live this second — here’s what’s on the slate next, ranked by what matters.';
    el.innerHTML = real.map(LiveEventCard).join('');
  }

  function renderF1(real) {
    const f1 = real || (IS_DEV ? MOCK.f1 : null);
    setBadge('badge-f1', real ? 'live' : (f1 ? 'mock' : null));
    const el = $('f1Wrap');
    if (!f1) { el.innerHTML = emptyBox('No current Formula 1 session.'); return; }

    const isLive = f1.phase === 'live';
    const board = LiveLeaderboard({
      event: f1.event, statusText: f1.statusText, state: f1.phase,
      leaderHighlight: f1.phase !== 'upcoming', showMarks: true,
      subHead: f1.sessionLabel,
      rows: (f1.positions || []).map((p) => ({
        pos: `P${p.pos}`, name: p.driver, flag: p.flag, chip: p.team || '', href: p.profileUrl || '',
      })),
    });

    const standings = f1.driverStandings ? LiveLeaderboard({
      event: 'Championship', statusText: `Driver standings · ${f1.season}`, state: '',
      leaderHighlight: true, showMarks: false, subHead: 'Drivers',
      rows: f1.driverStandings.slice(0, 8).map((d) => ({ pos: d.pos, name: d.name, chip: d.team, val: `${d.points} pts`, href: d.profileUrl || '' })),
    }) : '';

    const constructors = f1.constructorStandings ? LiveLeaderboard({
      event: 'Constructors', statusText: 'Team standings', state: '',
      leaderHighlight: true, showMarks: false, subHead: 'Constructors',
      rows: f1.constructorStandings.slice(0, 8).map((c) => ({ pos: c.pos, name: c.name, badge: c.name, val: `${c.points} pts` })),
    }) : '';

    const f1Rows = f1Context(f1);
    if (f1.nextRace) {
      const nr = f1.nextRace;
      const d = nr.date ? new Date(nr.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      f1Rows.push({ label: 'Next race', text: `${nr.name}${nr.circuit ? ` · ${nr.circuit}` : ''}${nr.location ? ` · ${nr.location}` : ''}${d ? ` · ${d}` : ''}` });
    }
    el.innerHTML =
      F1CircuitBanner(f1) +
      `<div class="stack">${board}${FeaturedF1Card(f1)}${f1WhatYouMissed(f1)}</div>` +
      `<div class="stack">${ContextCard(f1Rows, isLive, 'Formula 1')}${standings}${constructors}</div>`;
  }

  function renderGolf(real) {
    const golf = real || (IS_DEV ? MOCK.golf : null);
    setBadge('badge-golf', real ? 'live' : (golf ? 'mock' : null));
    const el = $('golfWrap');
    if (!golf) { el.innerHTML = emptyBox('No tournament in progress.'); return; }
    const cut = golf.cutLine ? ` · Cut ${golf.cutLine}` : '';
    const board = LiveLeaderboard({
      event: golf.event,
      statusText: golf.statusText + (golf.leaderScore ? ` · Leader ${golf.leaderScore}` : '') + cut,
      state: golf.state, leaderHighlight: true, showMarks: true, subHead: 'Leaderboard',
      rows: (golf.leaderboard || []).map((p) => ({
        pos: p.pos, name: p.name, flag: p.flag, sub: p.thru ? `Thru ${p.thru}` : '',
        val: p.score, valClass: String(p.score).trim().startsWith('-') ? 'neg' : '',
      })),
    });
    const golfRows = golfContext(golf);
    const golfExtra = [];
    if (golf.course) golfExtra.push({ label: 'Course', text: `${golf.course}${golf.location ? ` · ${golf.location}` : ''}` });
    if (golf.purse) golfExtra.push({ label: 'Purse', text: `${golf.purse}${golf.winnerShare ? ` · Winner takes ${golf.winnerShare}` : ''}` });
    golfRows.unshift(...golfExtra);
    el.innerHTML = `<div class="grid-golf">${board}<div class="stack">${ContextCard(golfRows, golf.state === 'in', 'Golf')}${FeaturedGolfCard(golf)}${golfWhatYouMissed(golf)}</div></div>`;
  }

  function renderScoreboard(real) {
    setBadge('badge-scores', real ? 'live' : null);
    const el = $('scoreboardWrap');
    if (!real || !real.length) { el.innerHTML = emptyBox('No games on the board right now.'); return; }

    // Marquee: spotlight the single biggest game (live > upcoming > final, then importance).
    const all = real.flatMap((lg) => lg.games);
    const rank = { in: 0, pre: 1, post: 2 };
    const big = all.filter((g) => g.isBig)
      .sort((a, b) => (rank[a.state] - rank[b.state]) || (b.importance - a.importance))[0];
    const marquee = big ? Marquee(big) : '';

    // GuyTalk Read under the marquee for the overall biggest game...
    const bigRead = big ? gameRead(big, 'marquee-read') : '';

    // ...and for each league's top game in its own block (skip the marquee game
    // so it isn't shown twice). Only renders where the server attached facts.
    el.innerHTML = marquee + bigRead + real.map((lg) => {
      const top = lg.games[0];
      const read = (top && top !== big) ? gameRead(top, 'game-read') : '';
      return `
      <div class="league-block">
        <div class="league-name">${esc(lg.label)}</div>
        ${read}
        <div class="grid grid-scores">${lg.games.map(ScoreboardCard).join('')}</div>
      </div>`;
    }).join('');
  }

  function renderMarkets(real) {
    setBadge('badge-markets', real ? 'live' : null);
    const el = $('marketsWrap');
    if (!real || !real.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1">Market data unavailable right now.</div>`; return; }
    el.innerHTML = real.map(MarketCard).join('') +
      `<p class="mk-disclaimer">Market data is informational only and is not investment advice. Values via index-tracking proxies; figures may be delayed.</p>`;
  }

  // Sections 6 & 7 — driven by the separate, slower /api/talk feed.
  // COMPLIANCE: live data is rendered as-is. When it's missing we show an honest
  // empty state in PRODUCTION (never fabricated content); MOCK is dev-only and
  // always carries a visible badge.
  function renderTalk(p) {
    // The Rundown (AI hero) — only shows when real AI synthesis is present.
    const band = $('rundownBand');
    if (band) {
      const hasRd = !!(p && p.rundown);
      band.hidden = !hasRd;
      if (hasRd) {
        $('rundownText').textContent = p.rundown;
        $('rundownSrc').textContent = 'GuyTalk AI · grounded in live data';
      }
    }

    const trendLive = !!(p && p.trending && p.trending.length);
    const talkLive = !!(p && p.talkingAbout && p.talkingAbout.length);
    const stories = trendLive ? p.trending : (IS_DEV ? MOCK.trending : null);
    const talks = talkLive ? p.talkingAbout : (IS_DEV ? MOCK.talkingAbout : null);

    $('trendingWrap').innerHTML = (stories && stories.length)
      ? stories.map(TrendingStoryCard).join('')
      : `<div class="empty" style="grid-column:1/-1">Live stories are refreshing — check back in a few minutes.</div>`;
    $('talkingWrap').innerHTML = (talks && talks.length)
      ? talks.map(TalkingPointCard).join('')
      : `<div class="empty" style="grid-column:1/-1">Talking points update through the day — check back shortly.</div>`;

    const iso = (p && p.updatedAt) || new Date().toISOString();
    setBadge('badge-trending', trendLive ? 'live' : (IS_DEV ? 'editorial' : null));
    setMeta('meta-trending', trendLive ? (p.sources?.trending || 'Live') : (IS_DEV ? 'Editorial' : ''), iso);

    const ts = talkLive ? p.sources?.talkingAbout : null; // 'ai' | 'derived'
    setBadge('badge-talking', talkLive ? (ts === 'ai' ? 'ai' : 'derived') : (IS_DEV ? 'editorial' : null));
    setMeta('meta-talking', talkLive ? (ts === 'ai' ? 'Claude AI' : 'Derived') : (IS_DEV ? 'Editorial' : ''), iso);
  }

  function paintSkeletons() {
    const sk = (n) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
    $('liveNow').innerHTML = sk(4);
    $('f1Wrap').innerHTML = sk(2);
    $('golfWrap').innerHTML = sk(1);
    $('scoreboardWrap').innerHTML = sk(2);
    $('marketsWrap').innerHTML = sk(8);
    // Rundown band stays hidden until real AI synthesis arrives (no fake placeholder).
  }

  // Engagement tracking via PostHog (paid) — clicks on profiles, highlights, stories.
  function trackClicks() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a || !window.posthog) return;
      let ev = null;
      if (a.classList.contains('hl-btn')) ev = 'live_highlight_click';
      else if (a.classList.contains('lb-link') || a.classList.contains('nm-link')) ev = 'live_profile_click';
      else if (a.closest('.story-head') || a.closest('.story-src') || a.closest('.talk-src')) ev = 'live_story_click';
      if (ev) posthog.capture(ev, { href: a.href, text: (a.textContent || '').trim().slice(0, 60) });
    }, { capture: true });
  }

  function render(payload) {
    const p = payload || {};
    renderLiveNow(p.liveNow);
    renderF1(p.f1);
    renderGolf(p.golf);
    renderScoreboard(p.scoreboard);
    renderMarkets(p.markets);
    // Sections 6 & 7 are handled by refreshTalk() / renderTalk() (separate feed).

    const stamp = p.updatedAt || new Date().toISOString();
    window.__liveIso = stamp;
    $('updatedLabel').textContent = `Updated ${relTime(stamp)}`;
    $('updatedLabel').dataset.iso = stamp;

    // Per-section trust signals (source + freshness).
    setMeta('meta-live',     p.liveNow    ? 'ESPN' : '');
    setMeta('meta-f1',       p.f1         ? 'ESPN · Jolpica' : '');
    setMeta('meta-golf',     p.golf       ? 'ESPN' : '');
    setMeta('meta-scores',   p.scoreboard ? 'ESPN' : '');
    setMeta('meta-markets',  p.markets    ? 'Finnhub' : '');
    // meta-trending / meta-talking are owned by renderTalk() (separate feed).

    // Section identity: surface the live event name under each header.
    const setText = (id, t) => { const e = $(id); if (e && t) e.textContent = t; };
    const liveN = (p.liveNow || []).length;
    if (liveN) setText('desc-live', `${liveN} event${liveN > 1 ? 's' : ''} in focus right now, ranked by what matters.`);
    if (p.f1) setText('desc-f1', `${p.f1.event} · ${p.f1.sessionLabel}`);
    if (p.golf) setText('desc-golf', `${shortEvent(p.golf.event)} · ${p.golf.statusText}`);
    if (p.scoreboard) {
      const liveG = p.scoreboard.reduce((n, lg) => n + lg.games.filter((g) => g.state === 'in').length, 0);
      setText('desc-scores', liveG
        ? `${liveG} game${liveG > 1 ? 's' : ''} live now across ${p.scoreboard.length} leagues.`
        : `Latest scores across ${p.scoreboard.length} leagues.`);
    }
  }

  let timer = null, talkTimer = null;
  async function refresh(manual) {
    const btn = $('refreshBtn');
    if (manual) { btn.disabled = true; btn.textContent = 'Refreshing…'; if (window.posthog) posthog.capture('live_manual_refresh'); }
    try {
      const res = await fetch('/api/live', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status ' + res.status);
      render(await res.json());
    } catch (err) {
      // API unreachable. In prod this yields honest empty states (no fake live data).
      render(null);
    } finally {
      if (manual) { btn.disabled = false; btn.textContent = 'Refresh'; }
    }
    if (manual) refreshTalk();
  }

  // Sections 6 & 7 — slower feed (news moves slower than scores).
  async function refreshTalk() {
    try {
      const res = await fetch('/api/talk', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad status ' + res.status);
      renderTalk(await res.json());
    } catch (err) {
      renderTalk(null); // editorial fallback, clearly labelled
    }
  }

  function startClock() {
    setInterval(() => {
      const lbl = $('updatedLabel');
      if (lbl && lbl.dataset.iso) lbl.textContent = `Updated ${relTime(lbl.dataset.iso)}`;
      paintAllMetas();
    }, 15 * 1000);
  }

  function startAutoRefresh() {
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
      if (talkTimer) { clearInterval(talkTimer); talkTimer = null; }
    };
    const start = () => {
      stop();
      timer = setInterval(() => refresh(false), REFRESH_MS);     // scores/markets: 60s
      talkTimer = setInterval(refreshTalk, TALK_MS);             // news/talk: 10 min
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else { refresh(false); refreshTalk(); start(); }
    });
    start();
  }

  // ── Securities search + detail modal ───────────────────────────────────────
  function sdFmt(n, isYield) {
    if (n == null || isNaN(n)) return '—';
    if (isYield) return Number(n).toFixed(2) + '%';
    const abs = Math.abs(n);
    return abs >= 1000
      ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
      : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Minimal line chart from a price series, colored by net direction.
  function lineChart(series, up) {
    if (!Array.isArray(series) || series.length < 2) return '<div class="sd-range-label">Chart unavailable.</div>';
    const w = 520, h = 140, pad = 6;
    const min = Math.min(...series), max = Math.max(...series), span = (max - min) || 1;
    const stepX = (w - pad * 2) / (series.length - 1);
    const xy = (v, i) => [pad + i * stepX, pad + (h - pad * 2) * (1 - (v - min) / span)];
    const pts = series.map((v, i) => xy(v, i).map(n => n.toFixed(1)).join(',')).join(' ');
    const [lx, ly] = xy(series[series.length - 1], series.length - 1);
    const color = up ? 'var(--green)' : 'var(--red)';
    return '<svg class="sd-chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<polyline fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"></polyline>'
      + '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3" fill="' + color + '"></circle></svg>';
  }

  const modal = $('stockModal');
  const modalBody = $('stockModalBody');
  let lastFocus = null;

  function closeStock() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
  }

  function openStock(symbol, presetName) {
    if (!modal || !symbol) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modalBody.innerHTML = '<div class="sd-loading">Loading ' + esc(presetName || symbol) + '…</div>';
    if (window.posthog) posthog.capture('live_stock_view', { symbol });
    fetch('/api/quote?symbol=' + encodeURIComponent(symbol), { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        if (!d || !d.quote) throw new Error((d && d.error) || 'No data');
        const q = d.quote;
        const up = (q.change || 0) >= 0;
        const sign = up ? '+' : '';
        const cur = (!q.isYield && q.currency === 'USD') ? '$' : '';
        const chg = q.change != null ? sign + sdFmt(q.change, q.isYield) : '';
        const pct = q.changePercent != null ? ' (' + sign + Number(q.changePercent).toFixed(2) + '%)' : '';
        const stat = (k, v) => (v == null || v === '') ? '' :
          '<div class="sd-stat"><div class="sd-stat-k">' + esc(k) + '</div><div class="sd-stat-v">' + esc(typeof v === 'number' ? (cur + sdFmt(v, q.isYield)) : v) + '</div></div>';
        const range = (q.dayLow != null && q.dayHigh != null) ? (cur + sdFmt(q.dayLow, q.isYield) + ' – ' + cur + sdFmt(q.dayHigh, q.isYield)) : '';
        modalBody.innerHTML =
          '<div class="sd-name">' + esc(q.name || symbol) + '</div>'
          + '<div class="sd-sym">' + esc(q.symbol || symbol) + (q.exchange ? ' · ' + esc(q.exchange) : '') + '</div>'
          + '<div class="sd-price-row"><span class="sd-price">' + cur + sdFmt(q.price, q.isYield) + '</span>'
          + '<span class="sd-move ' + (up ? 'up' : 'down') + '">' + esc(chg + pct) + '</span></div>'
          + '<div class="sd-range-label">' + esc(q.rangeLabel ? (q.rangeLabel === 'Today' ? 'Today, intraday' : 'Last ' + q.rangeLabel) : '') + '</div>'
          + lineChart(d.series, up)
          + '<div class="sd-stats">'
            + stat('Prev close', q.prevClose)
            + (range ? '<div class="sd-stat"><div class="sd-stat-k">Day range</div><div class="sd-stat-v">' + esc(range) + '</div></div>' : '')
            + stat('52-wk high', q.yearHigh)
            + stat('52-wk low', q.yearLow)
          + '</div>'
          + '<div class="sd-foot">Data via Yahoo Finance; may be delayed. Informational only — not investment advice.</div>';
      })
      .catch(() => { modalBody.innerHTML = '<div class="sd-loading">Couldn’t load that security. Please try again.</div>'; });
  }

  const searchInput = $('mkSearchInput');
  const searchResults = $('mkSearchResults');
  let searchTimer = null, lastQ = '';
  function hideResults() { if (searchResults) { searchResults.hidden = true; searchResults.innerHTML = ''; } }
  function renderResults(list) {
    if (!searchResults) return;
    searchResults.innerHTML = (list && list.length)
      ? list.map(r => '<div class="mk-result" data-symbol="' + esc(r.symbol) + '" data-name="' + esc(r.name) + '">'
          + '<span class="mk-result-sym">' + esc(r.symbol) + '</span>'
          + '<span class="mk-result-name">' + esc(r.name) + '</span>'
          + '<span class="mk-result-ex">' + esc(r.exchange || r.type || '') + '</span></div>').join('')
      : '<div class="mk-result-empty">No matches.</div>';
    searchResults.hidden = false;
  }
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (searchTimer) clearTimeout(searchTimer);
      if (q.length < 1) { hideResults(); lastQ = ''; return; }
      searchTimer = setTimeout(() => {
        if (q === lastQ) return; lastQ = q;
        fetch('/api/quote?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
          .then(r => r.json()).then(d => renderResults(d && d.results)).catch(hideResults);
      }, 220);
    });
  }

  document.addEventListener('click', (e) => {
    const res = e.target.closest('.mk-result');
    if (res) { openStock(res.getAttribute('data-symbol'), res.getAttribute('data-name')); hideResults(); if (searchInput) searchInput.value = ''; lastQ = ''; return; }
    const card = e.target.closest('.mk-card[data-symbol]');
    if (card) { openStock(card.getAttribute('data-symbol'), card.querySelector('.mk-label') ? card.querySelector('.mk-label').textContent : ''); return; }
    if (e.target.closest('[data-close]')) { closeStock(); return; }
    if (searchResults && !searchResults.hidden && !e.target.closest('.mk-search')) hideResults();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (modal && !modal.hidden) closeStock(); else hideResults(); return; }
    const el = document.activeElement;
    if ((e.key === 'Enter' || e.key === ' ') && el && el.classList && el.classList.contains('mk-card') && el.dataset && el.dataset.symbol) {
      e.preventDefault(); openStock(el.dataset.symbol, el.querySelector('.mk-label') ? el.querySelector('.mk-label').textContent : '');
    }
  });

  window.GuyTalkLive = { refresh, MOCK, openStock, components: {
    LiveEventCard, LiveLeaderboard, ScoreboardCard, MarketCard, TrendingStoryCard,
    TalkingPointCard, ContextCard, EventSpotlight, Marquee,
  }};

  paintSkeletons();
  renderTalk(null);   // instant editorial paint for sections 6 & 7 before the feed lands
  refresh(false);
  refreshTalk();
  startClock();
  startAutoRefresh();
  trackClicks();
})();

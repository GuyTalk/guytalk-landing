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
/**
 * @typedef {Object} MMAPayload
 * @property {string} event           e.g. "UFC 317: Pantoja vs. Royval 2"
 * @property {'pre'|'in'|'post'} state
 * @property {string} statusText
 * @property {{label:string,url:string}|null} eventLink
 * @property {string} leagueLogo
 * @property {{name:string,flag:string,record:string,winner:boolean,link:string}|null} fighter1
 * @property {{name:string,flag:string,record:string,winner:boolean,link:string}|null} fighter2
 * @property {string} weightClass
 * @property {{fighter1:string,fighter2:string,winner:string,loser:string,method:string,state:string}[]} bouts
 */

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

  /** @type {MMAPayload} — upcoming UFC event (dev placeholder) */
  mma: {
    event: 'UFC Fight Night: Main Event',
    state: 'pre',
    statusText: 'Saturday · 10 PM ET',
    eventLink: null,
    leagueLogo: '',
    fighter1: { name: 'Dustin Poirier', flag: '', record: '30-9', winner: false, link: '' },
    fighter2: { name: 'Charles Oliveira', flag: '', record: '34-10', winner: false, link: '' },
    weightClass: 'Lightweight Bout',
    bouts: [
      { fighter1: 'Dustin Poirier', fighter2: 'Charles Oliveira', winner: '', loser: '', method: '', state: 'pre' },
      { fighter1: 'Dan Hooker', fighter2: 'Beneil Dariush', winner: '', loser: '', method: '', state: 'pre' },
      { fighter1: 'Kevin Holland', fighter2: 'Michel Pereira', winner: '', loser: '', method: '', state: 'pre' },
    ],
  },

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

// Strip OpenAI markdown citations from AI-generated text before rendering.
// Server also strips these (cleanCommentary in live.js) but keep as client safety net.
const cleanAI = (s) => {
  if (!s) return '';
  return String(s)
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\s*\(https?:\/\/[^\s)]+\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

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
  const tpHtml = (ev.talkingPoints && ev.talkingPoints.length)
    ? `<div class="ev-talk"><div class="ev-talk-label">🗣️ People are talking about</div><ul class="ev-talk-list">${ev.talkingPoints.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`
    : '';
  const inner = `
    <div class="ev-head">
      <div><div class="ev-title">${esc(ev.title)}</div><div class="ev-status">${esc(ev.statusText)}</div></div>
      ${STATUS_PILL[ev.status] || ''}
    </div>
    ${lines}
    ${tpHtml}
    ${ev.leader ? `<div class="ev-foot">${esc(ev.leader)}</div>` : `<div class="ev-foot ev-foot-cta">View on ESPN →</div>`}`;
  // Whole card links to the game on ESPN when we have a real link.
  return ev.link
    ? `<a class="card card-link" href="${esc(ev.link)}" target="_blank" rel="noopener" data-livecard="1">${inner}</a>`
    : `<div class="card">${inner}</div>`;
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

/** HighlightLink — standalone "Watch highlights" button for light-bg sections. */
function HighlightLink(href, label) {
  if (!href) return '';
  return `<a class="hl-link" href="${esc(href)}" target="_blank" rel="noopener"><span class="pl">▶</span> ${esc(label || 'Watch highlights →')}</a>`;
}

/** EventSpotlight — editorial hero card: colour-block hero + one strong visual
 *  (flag/initials) + up to three key stats. Premium, image-light, no scraping.
 *  @param {{eyebrow,icon,flag,name,subText,subColor,accent,watermark,
 *           stats:{num,label,neg}[]}} c */
function EventSpotlight(c) {
  const mark = c.photo
    ? `<img class="spot-photo" src="${esc(c.photo)}" alt="${esc(c.name)}" loading="lazy" onerror="this.style.display='none'">`
    : c.flag
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
  const gameUrl = g.eventLink?.url || null;
  const side = (t, otherScore) => {
    const losing = g.state === 'post' && t.score !== '' && Number(t.score) < Number(otherScore);
    return `<div class="sc-team${losing ? ' loser' : ''}">
      <span class="nm">${teamMark(t.logo, t.abbr, t.color)}<span class="sc-abbr">${esc(t.abbr || t.name)}</span>${t.record ? `<span class="sc-rec">${esc(t.record)}</span>` : ''}</span>
      <span class="sc-score">${esc(t.score !== '' ? t.score : '—')}</span>
    </div>`;
  };
  const statusBit = g.state === 'in'
    ? `<span class="pill pill-live"><span class="nav-live-dot"></span>Live</span> ${esc(g.statusText)}`
    : esc(g.statusText);
  const showBreakdown = g.state === 'post';
  const foot = showBreakdown
    ? `${statusBit} · <span class="sc-breakdown-hint">GuyTalk breakdown →</span>`
    : (gameUrl
      ? `${statusBit} · <a href="${esc(gameUrl)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600" onclick="event.stopPropagation()">Gamecast →</a>`
      : statusBit);

  const sport = g.sportType || g.sport || g.league?.toLowerCase().replace(/\s+/g,'') || '';
  const league = g.league || '';
  const headline = g.headline || '';
  const dataAttrs = [
    `data-sport="${esc(sport)}"`,
    `data-home="${esc(g.home?.name || '')}"`,
    `data-away="${esc(g.away?.name || '')}"`,
    `data-home-score="${esc(String(g.home?.score ?? ''))}"`,
    `data-away-score="${esc(String(g.away?.score ?? ''))}"`,
    `data-league="${esc(league)}"`,
    `data-headline="${esc(headline.replace(/"/g,'&quot;'))}"`,
  ].join(' ');

  return `<div class="sc-card" ${showBreakdown ? dataAttrs + ' role="button" tabindex="0"' : ''}>
    ${g.isBig && g.headline ? `<div class="sc-tag">${esc(g.headline)}</div>` : ''}
    ${side(g.away, g.home.score)}
    ${side(g.home, g.away.score)}
    <div class="sc-foot">${foot}</div>
  </div>`;
}

// Map each market tile to its Yahoo Finance symbol for click-through to Yahoo quotes.
const MARKET_YAHOO = { spx: '^GSPC', dow: '^DJI', ndq: '^IXIC', rut: '^RUT', btc: 'BTC-USD', gold: 'GC=F', oil: 'CL=F', tnx: '^TNX' };
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

/** TalkingPointCard — ctx-card format: monospace header + labeled rows */
function TalkingPointCard(t) {
  return `<div class="talk2-card">
    <div class="talk2-head">What Everyone's Talking About</div>
    <div class="talk2-body">
      <div class="talk2-topic">${esc(t.topic)}</div>
      <div class="talk2-field">
        <div class="talk2-lbl">Why people care</div>
        <div class="talk2-val">${esc(t.matters)}</div>
      </div>
      ${t.stat ? `<div class="talk2-field">
        <div class="talk2-lbl">Key stat</div>
        <div class="talk2-val">${esc(t.stat)}</div>
      </div>` : ''}
      <div class="talk2-field talk2-say">
        <div class="talk2-lbl">What to bring up</div>
        <div class="talk2-val">${esc(t.say)}</div>
      </div>
      ${t.url ? `<p class="talk-src" style="margin-top:10px"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.source || 'Source')} →</a></p>` : ''}
    </div>
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
  const oneTwo = f1OneTwo(f1);
  const champLeaderRacePos = f1.champLeaderRacePos;
  const winnerIsChampLeader = !!(champ && winner &&
    champ.leader.name.split(' ').pop().toLowerCase() === winner.driver.split(' ').pop().toLowerCase());

  let why;
  if (winner && champ && champ.gap != null) {
    if (winnerIsChampLeader) {
      why = `${winner.driver} wins ${ev} AND leads the championship by ${plural(champ.gap, 'point')}${champ.second ? ` over ${champ.second.name}` : ''} — a dominant weekend.`;
    } else if (champLeaderRacePos && champLeaderRacePos > 8) {
      why = `${winner.driver} wins ${ev}, but the bigger story is ${champ.leader.name} finishing P${champLeaderRacePos}. With ${champ.second?.name || 'the runner-up'} scoring P2 points today, the gap is down to ${plural(champ.gap, 'point')}.`;
    } else if (champLeaderRacePos && champLeaderRacePos > 5) {
      why = `${winner.driver} wins ${ev}, but ${champ.leader.name} struggled to P${champLeaderRacePos} while ${champ.second?.name || 'the runner-up'} closed the gap. The title lead is ${plural(champ.gap, 'point')} now.`;
    } else {
      why = `${winner.driver} takes ${ev}, but ${champ.leader.name} still leads the title by ${plural(champ.gap, 'point')}.`;
    }
  } else { why = winner ? `${winner.driver} wins ${ev}.` : `${ev} is in the books.`; }

  const fun = f1FunFact(f1, winner);
  const take = (() => {
    if (!winner) return '';
    if (winnerIsChampLeader && champ?.gap != null && champ.gap >= 30) {
      return `${winner.driver} wins the race AND leads the championship — at this pace, the title is his to lose.`;
    }
    if (champLeaderRacePos && champLeaderRacePos > 8 && champ?.second) {
      return `${champ.leader.name} finishing P${champLeaderRacePos} is the real headline — ${champ.second.name} grabbed points today and this title race just tightened significantly.`;
    }
    if (champLeaderRacePos && champLeaderRacePos > 5 && champ) {
      return `${champ.leader.name} had a tough one at P${champLeaderRacePos} — when the championship leader underperforms, you take notice.`;
    }
    if (oneTwo) return `${oneTwo} locking out a 1-2 is a constructor's dream — their rivals lost ground on both fronts today.`;
    if (fun?.say) return fun.say.replace(/^"(.+)"$/, '$1');
    return `${winner.driver} drove a clean race from front to back — that's not luck, that's execution.`;
  })();

  return [
    { label: 'Why it matters', text: why },
    { label: 'Key stat', key: true, text: fun ? fun.stat
        : (oneTwo
            ? `${oneTwo} finish 1-2${gapTxt ? `; ${gapTxt}` : ''}.`
            : (gapTxt ? `${gapTxt}.` : (wStand ? `${winner.driver} sits P${wStand.pos} on ${wStand.points} points.` : null))) },
    { label: 'What to say', say: true, text: fun ? fun.say
        : (winner && champ && champ.gap != null
            ? (winnerIsChampLeader
                ? `"${winner.driver} is up ${champ.gap} now — this title's starting to look like a runaway."`
                : (champLeaderRacePos && champLeaderRacePos > 8
                    ? `"${champ.leader.name} finished P${champLeaderRacePos} while ${winner.driver} won — that's a championship shift."`
                    : `"Strong win for ${winner.driver}, but ${champ.leader.name} is still ${champ.gap} clear in the standings."`))
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
  const champLeaderRacePos = f1.champLeaderRacePos;
  const winnerIsChampLeader = !!(champ && champ.leader.name.split(' ').pop().toLowerCase() === winner.driver.split(' ').pop().toLowerCase());
  const fun = f1FunFact(f1, winner);

  let storyline;
  if (champLeaderRacePos && champLeaderRacePos > 6 && !winnerIsChampLeader) {
    storyline = `${champ?.leader?.name || 'Championship leader'} finished P${champLeaderRacePos} — title gap shrunk`;
  } else if (fun?.missed) {
    storyline = fun.missed;
  } else {
    storyline = champ ? `${champ.leader.name} leads the title by ${champ.gap} pts` : '';
  }

  return WhatYouMissed([
    { k: 'Winner', v: `${winner.driver}${winner.team ? ` · ${winner.team}` : ''}` },
    { k: 'Biggest storyline', v: storyline },
    { k: 'Podium', v: podium || '—' },
    { k: 'Next race', v: f1.nextRace ? `${f1.nextRace.name} · ${f1.nextRace.date}` : (champ && champ.gap != null ? `${champ.gap}-point gap with the season rolling on` : '') },
  ]);
}

/* ---- NBA marquee-game context (from g.facts, computed server-side) ---- */

function nbaContext(g) {
  const f = g.facts;
  if (!f) return null;
  const homeRec = (f.teams || []).find((t) => t.homeAway === 'home') || {};
  const awayRec = (f.teams || []).find((t) => t.homeAway === 'away') || {};

  if (f.state === 'post') {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const tp = f.topPerformer;
    // Each line earns its place: the score + series go in Why it matters, the
    // box line in Key stat, the human angle in What to say — no restating the
    // same number twice.
    return [
      { label: 'Why it matters', text: `${w.name} beat ${l.name} ${w.score}-${l.score}.${f.series ? ` ${seriesClean(f)} in the ${seriesLabel(f, g)}.` : ''}` },
      tp && { label: 'Key stat', key: true, text: `${tp.name} led all scorers with ${tp.pts}${tp.reb != null && tp.ast != null ? ` (${tp.reb} reb, ${tp.ast} ast)` : ''}.` },
      { label: 'What to say', say: true, text: tp
        ? `"${tp.name} was the difference — ${w.name} look like the team to beat."`
        : `"${w.name} took care of business and look the part."` },
      { label: 'Hot take', take: true, text: tp
        ? `${tp.name} with ${tp.pts} is the whole story — when he's locked in like that, ${w.name} are a different team.`
        : `${w.name} looked like the better team at both ends — ${l.name} didn't have an answer.` },
    ];
  }

  // pre / live
  const ts = f.topScorers || [];
  const matchup = ts.length >= 2 ? `${ts[0].name} (${ts[0].val}) vs ${ts[1].name} (${ts[1].val})` : '';
  const recLine = (homeRec.total || awayRec.total)
    ? `${g.home.name} ${homeRec.total}${homeRec.split ? ` (${homeRec.split} home)` : ''} · ${g.away.name} ${awayRec.total}${awayRec.split ? ` (${awayRec.split} away)` : ''}`
    : '';
  const st = seriesStakes(f, g);
  let why, take;
  if (st && st.canClinch && st.leader) {
    why = `${st.leader.name} can close out the ${seriesLabel(f, g)} tonight — win and they're champions; ${st.trailer.name} are a loss away from going home.`;
    take = `${st.leader.name} have controlled this series and they finish it tonight — no need for a Game ${st.gamesPlayed + 2}.`;
  } else if (st && st.tied) {
    why = `${seriesLabel(f, g)} dead even at ${st.hi}-${st.hi} — tonight's winner grabs the series lead with everything still to play for.`;
    take = `A coin-flip series comes down to whoever owns the fourth quarter — give me the home crowd to swing it.`;
  } else if (st && st.leader) {
    why = `${st.leader.name} lead the ${seriesLabel(f, g)} ${st.hi}-${st.lo} and can tighten the screws tonight; ${st.trailer.name} have to answer or it's nearly over.`;
    take = `${st.leader.name} are the better team right now — they don't give a lead like this back.`;
  } else if (f.series) {
    why = `${g.headline || 'Tonight'} — ${seriesClean(f)}, and every game swings it now.`;
  } else {
    why = `${g.away.name} visit ${g.home.name} with real stakes.`;
  }
  const lgp = f.lastGame && f.lastGame.performer;
  return [
    { label: 'Why it matters', text: why },
    { label: 'Key stat', key: true, text: lgp
        ? `${lgp.name} led all scorers with ${lgp.line} in ${f.lastGame.gameLabel}.`
        : (recLine ? `${recLine}.` : '') },
    { label: 'What to say', say: true, text: matchup
        ? `"${f.series ? seriesClean(f) : (g.headline || 'Big one tonight')} — ${matchup} on points per game."`
        : `"${g.home.name}–${g.away.name} should be a good one."` },
    take && { label: 'Hot take', take: true, text: take },
  ];
}

function nbaWhatYouMissed(g) {
  const f = g.facts;
  if (!f || f.state !== 'post') return '';
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  const tp = f.topPerformer;
  // Four distinct rows: result, the series state (stated once, here), the standout
  // line, and a forward-looking takeaway — never the same series record twice.
  const storyline = f.series ? `${seriesLabel(f, g)} — ${seriesClean(f)}` : (g.headline || `${w.name} take down ${l.name}`);
  return WhatYouMissed([
    { k: 'Winner', v: `${w.name} ${w.score}–${l.score}` },
    { k: 'Biggest storyline', v: storyline },
    { k: 'Best performance', v: tp ? `${tp.name} — ${tp.pts} pts${tp.reb != null ? `, ${tp.reb} reb` : ''}${tp.ast != null ? `, ${tp.ast} ast` : ''}` : '' },
    { k: 'Key takeaway', v: seriesTakeaway(f, w) },
  ]);
}
function seriesLowOf(f) { return f.series ? f.series.summary.replace(/^Series\s+/i, '').toLowerCase() : ''; }
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// Clean, case-PRESERVED series record straight from ESPN: "Tied 1-1",
// "New York leads 3-1". Used wherever the record reads as its own clause so we
// never lowercase a team name into "new york leads 3-1".
function seriesClean(f) {
  if (!f.series) return '';
  // "Series tied 1-1" → "Tied 1-1"; "NY leads series 3-1" → "NY leads 3-1".
  const s = f.series.summary.replace(/^Series\s+/i, '').replace(/\bseries\s+(?=\d)/i, '');
  return capFirst(s);
}
// A forward-looking takeaway derived from the series score — distinct from the
// bare record so it never just repeats the storyline line.
function seriesTakeaway(f, w) {
  if (!f.series) return `${w.name} grab the win and the momentum.`;
  const nums = (f.series.summary.match(/\d+/g) || []).map(Number);
  if (nums.length >= 2) {
    const hi = Math.max(nums[0], nums[1]), lo = Math.min(nums[0], nums[1]);
    if (hi === lo) return `All square at ${hi}-${hi} — the next game tilts the whole series.`;
    if (hi >= 3 && hi - lo >= 2) return `A 3-${lo} stranglehold — the next win closes it out.`;
    if (hi >= 3) return `Up 3-${lo} with a chance to close it out next game.`;
    return `${hi}-${lo} in the series, with the momentum swinging.`;
  }
  return `${w.name} take control of the series.`;
}

// Parse a playoff series into stakes for an UPCOMING/LIVE game: who leads, who
// trails, whether it's level, and whether tonight is a potential close-out
// (best-of-seven → a 3-win lead can clinch). Drives the "why it matters" punch.
function seriesStakes(f, g) {
  if (!f.series) return null;
  const nums = (f.series.summary.match(/\d+/g) || []).map(Number);
  if (nums.length < 2) return null;
  const hi = Math.max(nums[0], nums[1]), lo = Math.min(nums[0], nums[1]);
  const tied = hi === lo;
  const cand = [g.home, g.away];
  const leader = tied ? null : (
    cand.find((t) => t.abbr && new RegExp(`\\b${t.abbr}\\b`, 'i').test(f.series.summary))
    || cand.find((t) => t.name && f.series.summary.toLowerCase().includes(t.name.toLowerCase()))
    || null);
  const trailer = leader ? (leader === g.home ? g.away : g.home) : null;
  return { hi, lo, tied, leader, trailer, canClinch: hi === 3, gamesPlayed: hi + lo };
}

// A clean series name. ESPN's playoff-series label can be generic ("Playoff
// Series"), so prefer the game headline ("Stanley Cup Final - Game 5" →
// "Stanley Cup Final"), which is reliably specific.
function seriesLabel(f, g) {
  const h = (g.headline || '').replace(/\s*[-–]\s*Game\s*\d+\b.*$/i, '').trim();
  return h || (f.series && f.series.name) || 'the series';
}

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
        ? `"${perf.name} was the difference — ${w.name} are rolling."`
        : `"${w.name} took care of business against ${l.name}."` },
      { label: 'Hot take', take: true, text: perf
        ? `${perf.name} was the difference today — when your best player shows up in a must-contribute spot, the lineup looks different.`
        : `${w.name} took care of ${l.name} when they needed it — that's what good teams do.` },
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
  const leaderBy = (abbr) => (f.leaders || []).find((l) => l.abbr === abbr);

  if (f.state === 'post') {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const wl = leaderBy(w.abbr);
    return [
      { label: 'Why it matters', text: `${w.name} beat ${l.name} ${w.score}-${l.score}.${f.series ? ` ${seriesClean(f)} in the ${seriesLabel(f, g)}.` : ''}` },
      wl && { label: 'Key stat', key: true, text: `${wl.name} led the way${wl.cat ? ` (${wl.cat.toLowerCase()})` : ''}: ${wl.line}.` },
      { label: 'What to say', say: true, text: wl
        ? `"${wl.name} was the difference — ${w.name} look like the team to beat."`
        : `"${w.name} took care of business and look the part."` },
      { label: 'Hot take', take: true, text: `${w.name} are the better team here${f.series ? ' — this series is theirs to lose' : ''}.` },
    ];
  }

  // pre / live
  const recLine = (homeF.total || awayF.total)
    ? `${g.home.name} ${homeF.total}${homeF.split ? ` (${homeF.split} home)` : ''} · ${g.away.name} ${awayF.total}${awayF.split ? ` (${awayF.split} away)` : ''}`
    : '';
  const hl = leaderBy(g.home.abbr), al = leaderBy(g.away.abbr);
  const matchup = (hl && al) ? `${al.name} (${al.line}) vs ${hl.name} (${hl.line})` : '';
  const st = seriesStakes(f, g);
  const hockey = f.league === 'nhl';
  let why, take;
  if (st && st.canClinch && st.leader) {
    why = `${st.leader.name} can close out the ${seriesLabel(f, g)} tonight — win and ${hockey ? 'they lift the Cup' : "it's over"}; ${st.trailer.name} are a loss from elimination.`;
    take = hockey
      ? `${st.leader.name} have the goaltending edge — they slam the door tonight rather than give ${st.trailer.name} life.`
      : `${st.leader.name} have controlled this series and they close it out tonight.`;
  } else if (st && st.tied) {
    why = `${seriesLabel(f, g)} knotted at ${st.hi}-${st.hi} — tonight's winner ${hockey ? 'skates off with' : 'grabs'} control of the series.`;
    take = hockey
      ? `A series this even comes down to whichever goalie steals a game — and someone's about to.`
      : `Dead even, so tonight is effectively the swing game of the series.`;
  } else if (st && st.leader) {
    why = `${st.leader.name} lead the ${seriesLabel(f, g)} ${st.hi}-${st.lo}; ${st.trailer.name} need an answer tonight or it slips away.`;
    take = `${st.leader.name} are the better team and they're playing like it.`;
  } else if (f.series) {
    why = `${g.headline || 'Tonight'} — ${seriesClean(f)}, and every game swings it now.`;
  } else {
    why = `${g.away.name} visit ${g.home.name} with real stakes.`;
  }
  const lgp = f.lastGame && f.lastGame.performer;
  return [
    { label: 'Why it matters', text: why },
    { label: 'Key stat', key: true, text: lgp
        ? `${lgp.name} led the way with ${lgp.line} in ${f.lastGame.gameLabel}.`
        : (recLine ? `${recLine}.` : '') },
    { label: 'What to say', say: true, text: matchup
        ? `"Keep an eye on ${matchup} — that's the matchup that decides it."`
        : `"${g.home.name}–${g.away.name} should be a good one."` },
    take && { label: 'Hot take', take: true, text: take },
  ];
}

function summaryWhatYouMissed(g) {
  const f = g.facts;
  if (!f || f.state !== 'post') return '';
  const w = g.home.winner ? g.home : g.away;
  const l = g.home.winner ? g.away : g.home;
  const wl = (f.leaders || []).find((x) => x.abbr === w.abbr);
  const storyline = f.series ? `${seriesLabel(f, g)} — ${seriesClean(f)}` : (g.headline || `${w.name} take down ${l.name}`);
  return WhatYouMissed([
    { k: 'Winner', v: `${w.name} ${w.score}–${l.score}` },
    { k: 'Biggest storyline', v: storyline },
    { k: 'Best performance', v: wl ? `${wl.name} — ${wl.line}` : '' },
    { k: 'Key takeaway', v: f.series ? seriesTakeaway(f, w) : `${w.name} grab the win and the momentum.` },
  ]);
}

/* ChampionHighlightCard — fills the blank left column when a championship series
 * has finished and there are no overflow games to show. Renders the winner's color
 * + logo watermark as a clickable YouTube highlights card. */
function ChampionHighlightCard(featured, tag) {
  const winner = featured.home?.winner ? featured.home : featured.away?.winner ? featured.away : null;
  if (!winner) return '';
  const q = encodeURIComponent(`${winner.name} ${tag} champions highlights 2026`);
  const hlUrl = featured.eventLink?.url || `https://www.youtube.com/results?search_query=${q}`;
  const color = winner.color || '#2B6FFF';
  const logo = winner.logo || '';
  const seriesLine = featured.seriesText || featured.statusText || '';
  const logoHtml = logo
    ? `<div class="champ-logo-wrap"><img class="champ-card-logo" src="${esc(logo)}" alt="${esc(winner.name)}" onerror="this.parentElement.style.display='none'"></div>`
    : '';
  return `<a class="champ-card" href="${esc(hlUrl)}" target="_blank" rel="noopener" style="--cc:${esc(color)}">
    <div class="champ-banner">🏆 ${esc(tag)} CHAMPIONS</div>
    <div class="champ-card-inner">
      ${logoHtml}
      <div class="champ-card-body">
        <div class="champ-name">${esc(winner.name)}</div>
        ${seriesLine ? `<div class="champ-sub">${esc(seriesLine)}</div>` : ''}
      </div>
    </div>
    <div class="champ-play">▶ Watch Highlights</div>
  </a>`;
}

/* RecentChampCard — renders a champion from the recentChampions API field.
 * Used when today's scoreboard has no games (series already over) but a team
 * clinched in the last 14 days. Takes the server-structured winner object. */
function RecentChampCard(champ) {
  const { label, winner, headline, seriesText, eventLink } = champ;
  const color = winner.color || '#2B6FFF';
  const logo  = winner.logo  || '';
  const hlUrl = eventLink?.url
    || `https://www.youtube.com/results?search_query=${encodeURIComponent(winner.name + ' ' + label + ' champions highlights')}`;
  const logoHtml = logo
    ? `<div class="champ-logo-wrap"><img class="champ-card-logo" src="${esc(logo)}" alt="${esc(winner.name)}" onerror="this.parentElement.style.display='none'"></div>`
    : '';
  const sub = seriesText || headline || '';
  return `<a class="champ-card" href="${esc(hlUrl)}" target="_blank" rel="noopener" style="--cc:${esc(color)}">
    <div class="champ-banner">🏆 ${esc(label)} CHAMPIONS</div>
    <div class="champ-card-inner">
      ${logoHtml}
      <div class="champ-card-body">
        <div class="champ-name">${esc(winner.name)}</div>
        ${sub ? `<div class="champ-sub">${esc(sub)}</div>` : ''}
      </div>
    </div>
    <div class="champ-play">▶ Watch Highlights</div>
  </a>`;
}

/* LastGameCard — for an upcoming/live playoff game, a visual recap of the
 * previous game: score, the standout line, and a highlight clip you can watch. */
function LastGameCard(lg) {
  if (!lg || !lg.winner || !lg.loser) return '';
  const score = `<span class="lg-win">${esc(lg.winner.abbr)} ${esc(lg.winner.score)}</span><span class="lg-sep">·</span>${esc(lg.loser.abbr)} ${esc(lg.loser.score)}`;
  const perf = lg.performer ? `<div class="lg-perf"><span class="lg-perf-name">${esc(lg.performer.name)}</span> ${esc(lg.performer.line)}</div>` : '';
  const v = lg.video;
  const video = (v && (v.thumb || v.web))
    ? `<a class="lg-video" href="${esc(v.web || '#')}" target="_blank" rel="noopener" aria-label="Watch highlights">
        ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <span class="lg-play" aria-hidden="true">▶</span>
        ${v.title ? `<span class="lg-vtitle">${esc(v.title)}</span>` : ''}
      </a>`
    : '';
  return `<div class="lastgame-card">
    <div class="lg-head"><span class="lg-kicker">Last game${lg.gameLabel ? ` · ${esc(lg.gameLabel)}` : ''}</span><span class="lg-score">${score}</span></div>
    ${video}${perf}
  </div>`;
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
  return `<div class="stack ${cls || 'marquee-read'}">${ContextCard(rows, g.state === 'in', g.league)}${wym}${LastGameCard(g.facts.lastGame)}</div>`;
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

/* ---- MMA/UFC context (main event) ---- */

function mmaContext(mma) {
  const rows = [];
  const f1 = mma.fighter1, f2 = mma.fighter2;
  const mainFight = (f1 && f2) ? `${f1.name} vs. ${f2.name}` : (mma.event || 'UFC');

  if (mma.state === 'post') {
    const winner = (f1 && f1.winner) ? f1 : (f2 && f2.winner ? f2 : null);
    const loser  = winner === f1 ? f2 : f1;
    rows.push({ label: 'Main event result', text: winner
      ? `${winner.name} defeats ${loser?.name || '—'}${mma.weightClass ? ` — ${mma.weightClass}` : ''}.`
      : `${mainFight} is in the books.` });
    if (winner?.record) rows.push({ label: 'Record', key: true, text: `${winner.name} moves to ${winner.record}.` });
    rows.push({ label: 'What to say', say: true, text: winner
      ? `"${winner.name} looked elite tonight — that's a title-contender performance."`
      : `"${mainFight} delivered. That's why UFC is the best combat sport on the planet."` });
    rows.push({ label: 'Hot take', take: true, text: winner
      ? `${winner.name} is the next in line for a title shot after that.`
      : `Both fighters left everything in the octagon — the rematch writes itself.` });
  } else if (mma.state === 'in') {
    rows.push({ label: "It's happening now", text: `${mainFight} is live right now${mma.weightClass ? ` — ${mma.weightClass}` : ''}.` });
    if (f1?.record && f2?.record) rows.push({ label: 'Records', key: true, text: `${f1.name} (${f1.record}) · ${f2.name} (${f2.record}).` });
    rows.push({ label: 'What to say', say: true, text: `"${mainFight} is going right now — one punch and this whole card changes."` });
  } else {
    rows.push({ label: 'Why it matters', text: `${mainFight}${mma.weightClass ? ` (${mma.weightClass})` : ''} — a high-stakes fight with real implications at the top of the division.` });
    if (f1?.record && f2?.record) rows.push({ label: 'Records', key: true, text: `${f1.name} ${f1.record} vs. ${f2.name} ${f2.record}.` });
    rows.push({ label: 'What to say', say: true, text: `"${f1?.name || 'One'} vs. ${f2?.name || 'the other'} — two guys who can end it at any second. That's the purest kind of fight."` });
    rows.push({ label: 'Hot take', take: true, text: `This is the matchup the division needed — the winner is one fight away from the belt.` });
  }
  return rows;
}

function mmaWhatYouMissed(mma) {
  if (!mma || mma.state !== 'post') return '';
  const f1 = mma.fighter1, f2 = mma.fighter2;
  const winner = (f1 && f1.winner) ? f1 : (f2 && f2.winner ? f2 : null);
  if (!winner) return '';
  const loser = winner === f1 ? f2 : f1;
  return WhatYouMissed([
    { k: 'Winner',        v: winner.name },
    { k: 'Record',        v: winner.record ? `Improved to ${winner.record}` : '' },
    { k: 'Opponent',      v: loser?.name || '' },
    { k: 'Key takeaway',  v: `${winner.name} takes the win${mma.weightClass ? ` — ${mma.weightClass}` : ''}.` },
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
    eyebrow: meta.eyebrow, icon: meta.icon,
    photo: lead.headshot || null,
    flag: lead.flag, name: lead.name,
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
    // Parity with golf/tennis "purse" — F1 pays no per-race cash purse, so the
    // real "winning amount" is the championship points the win is worth.
    if (f1.phase !== 'result') {
      f1Rows.push({ label: 'On the line', text: '25 points to the race winner — the biggest single-race haul in the championship, and a real swing in the title race.' });
    }
    if (f1.nextRace) {
      const nr = f1.nextRace;
      const d = nr.date ? new Date(nr.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      f1Rows.push({ label: 'Next race', text: `${nr.name}${nr.circuit ? ` · ${nr.circuit}` : ''}${nr.location ? ` · ${nr.location}` : ''}${d ? ` · ${d}` : ''}` });
    }
    // Balance the two columns. An upcoming race with no grid/field set yet leaves
    // the left stack nearly empty (no positions → no board rows, no spotlight, no
    // recap), so anchor it with the championship standings instead of stranding
    // everything on the right.
    const f1HlUrl = (f1.eventLink?.url) || (() => {
      const q = encodeURIComponent(`${f1.event} ${f1.phase === 'result' ? 'race highlights' : 'highlights'}`);
      return `https://www.youtube.com/results?search_query=${q}`;
    })();

    const hasField = (f1.positions || []).length > 0;
    const leftCards = [board, FeaturedF1Card(f1), f1WhatYouMissed(f1)];
    const rightCards = [ContextCard(f1Rows, isLive, 'Formula 1'), standings, constructors, HighlightLink(f1HlUrl, f1.eventLink ? 'Watch on ESPN →' : 'Watch highlights →')];
    if (!hasField && standings) {
      leftCards.push(standings);
      rightCards.splice(rightCards.indexOf(standings), 1);
    }
    el.innerHTML =
      F1CircuitBanner(f1) +
      `<div class="stack">${leftCards.join('')}</div>` +
      `<div class="stack">${rightCards.join('')}</div>`;
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
        pos: p.pos, name: p.name, flag: p.flag, href: p.link, sub: p.thru ? `Thru ${p.thru}` : '',
        val: p.score, valClass: String(p.score).trim().startsWith('-') ? 'neg' : '',
      })),
    });
    const golfRows = golfContext(golf);
    const golfExtra = [];
    if (golf.course) golfExtra.push({ label: 'Course', text: `${golf.course}${golf.location ? ` · ${golf.location}` : ''}` });
    if (golf.purse) golfExtra.push({ label: 'Purse', text: `${golf.purse}${golf.winnerShare ? ` · Winner takes ${golf.winnerShare}` : ''}` });
    golfRows.unshift(...golfExtra);
    const golfHlUrl = (golf.eventLink?.url) || (() => {
      const q = encodeURIComponent(`${golf.event || 'PGA Tour'} highlights`);
      return `https://www.youtube.com/results?search_query=${q}`;
    })();
    el.innerHTML = `<div class="grid-golf">${board}<div class="stack">${ContextCard(golfRows, golf.state === 'in', 'Golf')}${FeaturedGolfCard(golf)}${golfWhatYouMissed(golf)}${HighlightLink(golfHlUrl, golf.eventLink ? 'Watch on ESPN →' : 'Watch highlights →')}</div></div>`;
  }

  // "The GuyTalk Read" for tennis — ranks, stakes, next major, what to say.
  function tennisContext(tennis) {
    const rows = [];
    const major = tennis.tours.find((x) => x.isMajor);
    const atp = tennis.tours.find((x) => x.tour === 'ATP');
    const wta = tennis.tours.find((x) => x.tour === 'WTA');
    const primary = tennis.tours[0];

    rows.push({ label: 'Why it matters', text: major
      ? `${major.name} is a Grand Slam — one of the four majors that decide careers and the rankings.${major.purse ? ` ${major.purse} on the line.` : ''}`
      : `${primary.name} is a regular tour stop — a tune-up, not a major. The real stakes come at the Slams.` });

    const no1 = [];
    if (atp?.topRanked?.[0]) no1.push(`${atp.topRanked[0].name} (ATP)`);
    if (wta?.topRanked?.[0]) no1.push(`${wta.topRanked[0].name} (WTA)`);
    if (no1.length) rows.push({ label: 'World #1', key: true, text: `${no1.join(' · ')} top the rankings right now.` });

    if (tennis.nextMajor) {
      const nm = tennis.nextMajor;
      const d = new Date(nm.start + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      rows.push({ label: 'Next major', text: `${nm.name} — ${nm.loc}, starts ${d}${nm.purse ? ` · ${nm.purse} purse` : ''}.` });
    }

    rows.push({ label: 'What to say', say: true, text: major
      ? `"Every round at ${major.name} matters now — this is where the season actually gets decided."`
      : `"Just tune-up tennis before ${tennis.nextMajor ? tennis.nextMajor.name : 'the next Slam'} — watch who's finding form early."` });
    return rows;
  }

  function renderMMA(real) {
    const mma = real || (IS_DEV ? MOCK.mma : null);
    setBadge('badge-mma', real ? 'live' : (mma ? 'mock' : null));
    const el = $('mmaWrap');
    if (!el) return;
    if (!mma) { el.innerHTML = emptyBox('No UFC event on the schedule right now.'); return; }

    const isLive = mma.state === 'in';
    const f1 = mma.fighter1, f2 = mma.fighter2;

    // Fight card list: main event first, most-recent results at top.
    const boutRows = (mma.bouts || []).map((b) => {
      const isResult = b.state === 'post';
      const nameHtml = isResult && b.winner
        ? `<span class="lb-name"><strong>${esc(b.winner)}</strong> def. ${esc(b.loser)}${b.method ? ` <em style="font-size:12px;color:var(--text-3)">· ${esc(b.method)}</em>` : ''}</span>`
        : `<span class="lb-name">${esc(b.fighter1)} vs. ${esc(b.fighter2)}</span>`;
      return `<div class="lb-row">
        <span class="lb-pos" style="min-width:20px;text-align:center">${isResult ? '✓' : '–'}</span>
        <span class="lb-name-row" style="flex:1">${nameHtml}</span>
        <span class="lb-val" style="font-size:11px">${esc(isResult ? 'Final' : 'On card')}</span>
      </div>`;
    }).join('');

    const fightCard = `<div class="lb">
      <div class="lb-head">
        <div><div class="lb-event">${esc(mma.event || 'UFC')}</div><div class="lb-status">${esc(mma.statusText || '')}</div></div>
        ${STATUS_PILL[mma.state] || ''}
      </div>
      <div class="lb-sub-head">Fight Card</div>
      ${boutRows || '<div style="padding:12px 0;color:var(--text-3);font-size:14px">Bouts updating…</div>'}
    </div>`;

    // Spotlight the winner (post) or main event headliner (pre/live).
    const featFighter = (mma.state === 'post' && (f1?.winner ? f1 : f2)) || f1;
    const spotHtml = featFighter ? EventSpotlight({
      eyebrow: mma.state === 'post' ? 'Main Event Winner' : isLive ? 'Main Event — Live' : 'Main Event',
      icon: '🥊',
      photo:   featFighter.headshot || null,
      flag:    featFighter.flag,
      name:    featFighter.name,
      subText: mma.weightClass || (f2 ? `vs. ${f2.name}` : ''),
      accent:  '#DC2626',
      watermark: mma.leagueLogo,
      link:    mma.eventLink || null,
      stats:   [
        { num: featFighter.record || '—', label: 'Record' },
        mma.state === 'post'
          ? { num: mma.bouts?.filter((b) => b.state === 'post').length || '—', label: 'Results in' }
          : { num: mma.bouts?.length || '—', label: 'Bouts on card' },
      ],
    }) : '';

    const hlUrl = (mma.eventLink?.url) || (() => {
      const q = encodeURIComponent(`${mma.event || 'UFC'} highlights`);
      return `https://www.youtube.com/results?search_query=${q}`;
    })();

    el.innerHTML = `<div class="grid-golf">
      <div class="stack">${fightCard}${spotHtml}</div>
      <div class="stack">${ContextCard(mmaContext(mma), isLive, 'UFC')}${mmaWhatYouMissed(mma)}${HighlightLink(hlUrl, mma.eventLink ? 'Watch on ESPN →' : 'Watch highlights →')}</div>
    </div>`;
  }

  // ── Soccer / World Cup context ─────────────────────────────────────────────
  function soccerContext(g) {
    const isWC = /world.?cup|fifa/i.test(g.league || g.headline || '');
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    const c = g.commentary; // AI-generated commentary from live.js, may be undefined

    if (g.state === 'post') {
      // Strip "National Soccer: " prefix and ESPN suffix from headline
      const rawHl = (g.headline || '').replace(/^[^:]+:\s*/, '').replace(/\s*[-–]\s*ESPN.*$/i, '').trim();
      // Only show if it adds info beyond a bare "X beat Y" restate
      const hlAddsInfo = rawHl && !new RegExp(`^${(w?.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+(beat|defeat|win)`, 'i').test(rawHl);
      return [
        { label: 'Why it matters', text: cleanAI(c?.whyItMatters) || (isWC
          ? `${w?.name} take three crucial points in World Cup 2026 group play — ${l?.name} now faces pressure to respond in their next match.`
          : `${w?.name} beat ${l?.name} ${w?.score}–${l?.score}.`) },
        hlAddsInfo && { label: 'Key moment', key: true, text: rawHl.endsWith('.') ? rawHl : rawHl + '.' },
        { label: 'What to say', say: true, text: cleanAI(c?.whatToSay) || `"${w?.name} ${w?.score}–${l?.score}${isWC ? ' at the World Cup' : ''} — that's a statement result."` },
        { label: 'Hot take', take: true, text: cleanAI(c?.hotTake) || (isWC
          ? `${l?.name} needed a point here and got nothing — their path to the knockout rounds just got harder.`
          : `${w?.name} deserved it — ${l?.name} had no answer when it mattered.`) },
      ];
    }
    return [
      { label: 'What to watch', text: `${g.away?.name} vs. ${g.home?.name}${isWC ? ' — FIFA World Cup 2026' : ''}.` },
      { label: 'What to say', say: true, text: `"${g.away?.name}–${g.home?.name} is on${isWC ? ' at the World Cup' : ''} — worth watching."` },
    ];
  }

  function soccerWhatYouMissed(g) {
    if (g.state !== 'post') return '';
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    const c = g.commentary;
    const isWC = /world.?cup|fifa/i.test(g.league || g.headline || '');
    const cleanHl = (g.headline || '').replace(/^[^:]+:\s*/, '').replace(/\s*[-–]\s*ESPN.*$/i, '').trim();
    return WhatYouMissed([
      { k: 'Final', v: `${w?.name} ${w?.score}–${l?.score}` },
      { k: 'Key moment', v: cleanAI(c?.biggestMoment) || cleanHl || `${w?.name} controlled the match` },
      { k: 'What it means', v: cleanAI(c?.keyTakeaway) || (isWC ? `${w?.name} move into the top half of their group — ${l?.name} must respond` : `${w?.name} take all three points`) },
    ]);
  }

  // ── Dedicated sport section renderers (NBA / MLB / NHL / Soccer) ───────────
  // Each follows the F1/Golf pattern: left = marquee + overflow cards, right =
  // ContextCard + WhatYouMissed + LastGameCard + HighlightLink.
  function _renderLeague(opts) {
    const { elId, badgeId, metaId, games, contextFn, wymFn, tag, emptyMsg } = opts;
    const el = $(elId);
    if (!el) return;
    const live = games.some(g => g.state === 'in');
    setBadge(badgeId, games.length ? (live ? 'live' : 'live') : null);
    setMeta(metaId, games.length ? 'ESPN' : '', new Date().toISOString());
    if (!games.length) { el.innerHTML = emptyBox(emptyMsg); return; }

    const featured = games.slice().sort((a, b) =>
      ({ in: 0, post: 1 }[a.state] ?? 2) - ({ in: 0, post: 1 }[b.state] ?? 2) ||
      (b.importance || 0) - (a.importance || 0)
    )[0];

    const isLive = featured.state === 'in';
    const others = games.filter(g => g !== featured);
    const rows = (contextFn(featured) || []).filter(Boolean);
    const wym = wymFn ? wymFn(featured) : '';
    const last = LastGameCard(featured.facts?.lastGame);
    const hlUrl = featured.eventLink?.url || (() => {
      const q = encodeURIComponent(`${featured.headline || tag} highlights`);
      return `https://www.youtube.com/results?search_query=${q}`;
    })();
    const hlLabel = featured.eventLink ? 'Watch on ESPN →' : 'Watch highlights →';

    const champCard = (!others.length && featured.state === 'post') ? ChampionHighlightCard(featured, tag) : '';
    const useWide = others.length > 4;
    const leftOthers = useWide ? [] : others;
    const wideOthers = useWide ? others : [];
    // Left column: game highlight photo, or team-logo matchup card as fallback.
    const gameThumb = featured.facts?.gameThumb;
    const needsLeftFill = !champCard && !leftOthers.length;
    const gamePhotoHtml = (gameThumb && needsLeftFill)
      ? `<a class="game-photo-card" href="${esc(hlUrl)}" target="_blank" rel="noopener"><img src="${esc(gameThumb)}" alt="" loading="lazy" onerror="this.closest('.game-photo-card').style.display='none'"></a>`
      : (needsLeftFill && featured.home?.logo && featured.away?.logo)
        ? `<div class="matchup-card sc-card">
            <img class="matchup-logo" src="${esc(featured.away.logo)}" alt="${esc(featured.away.name)}" loading="lazy" onerror="this.style.display='none'">
            <span class="matchup-vs">vs</span>
            <img class="matchup-logo" src="${esc(featured.home.logo)}" alt="${esc(featured.home.name)}" loading="lazy" onerror="this.style.display='none'">
           </div>`
        : '';
    el.innerHTML =
      `<div class="stack">${Marquee(featured)}${gamePhotoHtml}${champCard}${leftOthers.length ? `<div class="grid grid-scores">${leftOthers.map(ScoreboardCard).join('')}</div>` : ''}</div>` +
      `<div class="stack">${ContextCard(rows, isLive, tag)}${wym}${last}${HighlightLink(hlUrl, hlLabel)}</div>` +
      (wideOthers.length ? `<div class="grid grid-three" style="grid-column:1/-1">${wideOthers.map(ScoreboardCard).join('')}</div>` : '');
  }

  function renderNBA(scoreboard, news) {
    const games = ((scoreboard || []).find(lg => lg.key === 'nba')?.games || [])
      .filter(g => g.state === 'in' || g.state === 'post');
    if (!games.length && news && news.length) {
      const el = $('nbaWrap');
      if (!el) return;
      setBadge('badge-nba', null);
      setMeta('meta-nba', 'ESPN News', new Date().toISOString());
      el.innerHTML = `<div class="league-intel">${news.slice(0, 4).map(n =>
        `<div class="intel-item">${n.imageUrl ? `<img class="intel-img" src="${esc(n.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}${n.link ? `<a class="intel-headline" href="${esc(n.link)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit">${esc(n.headline)}</a>` : `<div class="intel-headline">${esc(n.headline)}</div>`}${n.description ? `<div class="intel-desc">${esc(n.description)}</div>` : ''}${n.link ? `<a class="intel-link" href="${esc(n.link)}" target="_blank" rel="noopener">Read on ESPN →</a>` : ''}</div>`
      ).join('')}</div>`;
      return;
    }
    _renderLeague({ elId: 'nbaWrap', badgeId: 'badge-nba', metaId: 'meta-nba', games,
      contextFn: nbaContext, wymFn: nbaWhatYouMissed, tag: 'NBA', emptyMsg: 'No NBA games today — check back for trade news and injury updates.' });
  }

  function renderMLB(scoreboard, news) {
    const allGames = (scoreboard || []).find(lg => lg.key === 'mlb')?.games || [];
    // Live/finished games take priority; if none, surface today's scheduled games
    const liveOrPost = allGames.filter(g => g.state === 'in' || g.state === 'post');
    const upcoming   = allGames.filter(g => g.state === 'pre').slice(0, 4);
    const games = liveOrPost.length ? liveOrPost : upcoming;

    // If no games at all today, show MLB news intel (same pattern as NHL)
    if (!games.length && news && news.length) {
      const el = $('mlbWrap');
      if (!el) return;
      setBadge('badge-mlb', null);
      setMeta('meta-mlb', 'ESPN News', new Date().toISOString());
      el.innerHTML = `<div class="league-intel">${news.slice(0, 4).map(n =>
        `<div class="intel-item">${n.imageUrl ? `<img class="intel-img" src="${esc(n.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}${n.link ? `<a class="intel-headline" href="${esc(n.link)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit">${esc(n.headline)}</a>` : `<div class="intel-headline">${esc(n.headline)}</div>`}${n.description ? `<div class="intel-desc">${esc(n.description)}</div>` : ''}${n.link ? `<a class="intel-link" href="${esc(n.link)}" target="_blank" rel="noopener">Read on ESPN →</a>` : ''}</div>`
      ).join('')}</div>`;
      return;
    }
    _renderLeague({ elId: 'mlbWrap', badgeId: 'badge-mlb', metaId: 'meta-mlb', games,
      contextFn: mlbContext, wymFn: mlbWhatYouMissed, tag: 'MLB', emptyMsg: 'No MLB games today.' });
  }

  function renderNHL(scoreboard, news) {
    const games = ((scoreboard || []).find(lg => lg.key === 'nhl')?.games || [])
      .filter(g => g.state === 'in' || g.state === 'post');
    if (!games.length && news && news.length) {
      const el = $('nhlWrap');
      if (!el) return;
      setBadge('badge-nhl', null);
      setMeta('meta-nhl', 'ESPN News', new Date().toISOString());
      el.innerHTML = `<div class="league-intel">${news.slice(0, 4).map(n =>
        `<div class="intel-item">${n.imageUrl ? `<img class="intel-img" src="${esc(n.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}${n.link ? `<a class="intel-headline" href="${esc(n.link)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit">${esc(n.headline)}</a>` : `<div class="intel-headline">${esc(n.headline)}</div>`}${n.description ? `<div class="intel-desc">${esc(n.description)}</div>` : ''}${n.link ? `<a class="intel-link" href="${esc(n.link)}" target="_blank" rel="noopener">Read on ESPN →</a>` : ''}</div>`
      ).join('')}</div>`;
      return;
    }
    _renderLeague({ elId: 'nhlWrap', badgeId: 'badge-nhl', metaId: 'meta-nhl', games,
      contextFn: summaryReadContext, wymFn: summaryWhatYouMissed, tag: 'NHL', emptyMsg: 'No NHL games today — check back for trade news and injury updates.' });
  }

  // World Cup gets its own dedicated section at the top of Soccer
  function renderWorldCup(scoreboard, yesterdayScores) {
    const el = $('worldcupWrap');
    if (!el) return;
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const isRecent = (g) => {
      if (!g.startDate) return true;
      const gDate = new Date(g.startDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      // show today's games + yesterday's finals
      return gDate >= new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    };
    const wcLeague = (board) => (board || []).find(lg => lg.key === 'worldcup');
    const todayGames = (wcLeague(scoreboard)?.games || []).filter(g => (g.state === 'in' || g.state === 'post') && isRecent(g));
    const lastNightGames = (wcLeague(yesterdayScores)?.games || []).filter(g => g.state === 'post');
    const games = [...todayGames];
    // Merge in yesterday's games that aren't already in today's data
    lastNightGames.forEach(g => { if (!games.some(x => x.id === g.id)) games.push(g); });
    games.sort((a, b) => {
      const ord = { in: 0, post: 1, pre: 2 };
      return ((ord[a.state] ?? 3) - (ord[b.state] ?? 3)) || ((b.importance || 0) - (a.importance || 0));
    });
    setBadge('badge-worldcup', games.length ? (games.some(g => g.state === 'in') ? 'live' : 'live') : null);
    setMeta('meta-worldcup', games.length ? 'ESPN' : '', new Date().toISOString());
    if (!games.length) { el.innerHTML = emptyBox('No World Cup matches right now.'); return; }
    _renderLeague({ elId: 'worldcupWrap', badgeId: 'badge-worldcup', metaId: 'meta-worldcup', games,
      contextFn: soccerContext, wymFn: soccerWhatYouMissed, tag: 'World Cup', emptyMsg: 'No World Cup matches right now.' });
  }

  function renderSoccer(scoreboard) {
    // Excludes worldcup — that has its own dedicated section above
    const SOCCER_KEYS = ['mls', 'epl', 'ucl', 'concacaf'];
    const games = (scoreboard || [])
      .filter(lg => SOCCER_KEYS.includes(lg.key))
      .flatMap(lg => lg.games.filter(g => g.state === 'in' || g.state === 'post'));
    _renderLeague({ elId: 'soccerWrap', badgeId: 'badge-soccer', metaId: 'meta-soccer', games,
      contextFn: soccerContext, wymFn: soccerWhatYouMissed, tag: 'Soccer', emptyMsg: 'No soccer league matches right now.' });
  }

  function renderTennis(real) {
    const tennis = real || (IS_DEV ? MOCK.tennis : null);
    setBadge('badge-tennis', real ? 'live' : (tennis ? 'mock' : null));
    const el = $('tennisWrap');
    if (!el) return;
    if (!tennis || !tennis.tours || !tennis.tours.length) { el.innerHTML = emptyBox('No tennis events right now.'); return; }
    const player = (name, link) => link
      ? `<a class="nm-link" href="${esc(link)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name);
    const cards = tennis.tours.map((t) => {
      const slam = t.isMajor ? '<span class="tns-slam">Grand Slam</span>' : '';
      const rows = (t.results || []).slice().reverse().map((r) => `
        <div class="tns-row">
          <span class="tns-match">
            ${r.winnerFlag ? `<img class="tns-flag" src="${esc(r.winnerFlag)}" alt="" loading="lazy">` : ''}
            <span class="tns-w">${player(r.winner, r.winnerLink)}</span>
            <span class="tns-def">def.</span>
            ${r.loserFlag ? `<img class="tns-flag" src="${esc(r.loserFlag)}" alt="" loading="lazy">` : ''}
            <span class="tns-l">${player(r.loser, r.loserLink)}</span>
          </span>
          <span class="tns-score">${esc(r.score || '')}</span>
        </div>`).join('') || '<div class="tns-none">No completed matches yet.</div>';
      const ranks = (t.topRanked || []).slice(0, 3).map((p) => `#${esc(p.rank)} ${player(p.name, p.link)}`).join(' · ');
      return `<div class="tns-card sc-card">
        <div class="tns-head">
          <div class="tns-title"><span class="tns-tour">${esc(t.tour)}</span> ${esc(t.name)} ${slam}</div>
          <span class="tns-status">${esc(t.statusText || '')}</span>
        </div>
        ${ranks ? `<div class="tns-ranks"><span class="tns-ranks-lbl">Top ranked</span> ${ranks}</div>` : ''}
        ${rows}
      </div>`;
    }).join('');
    el.innerHTML = `<div class="grid-golf"><div class="stack">${cards}</div><div class="stack">${ContextCard(tennisContext(tennis), false, 'Tennis')}</div></div>`;
  }

  // ── Recap — completed games from yesterday AND today ────────────────────────
  function renderRecap(scoreboard, yesterdayScores) {
    const el = $('recapWrap');
    if (!el) return;

    const RECAP_SOCCER_KEYS = ['worldcup', 'mls', 'epl', 'ucl', 'concacaf'];
    const LEAGUE_META = {
      nba: { tag: 'NBA', contextFn: nbaContext, wymFn: nbaWhatYouMissed },
      mlb: { tag: 'MLB', contextFn: mlbContext, wymFn: mlbWhatYouMissed },
      nhl: { tag: 'NHL', contextFn: summaryReadContext, wymFn: summaryWhatYouMissed },
      nfl: { tag: 'NFL', contextFn: summaryReadContext, wymFn: summaryWhatYouMissed },
    };
    const SOCCER_META = { tag: 'Soccer', contextFn: soccerContext, wymFn: soccerWhatYouMissed };

    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const isToday = (g) => {
      if (!g.startDate) return true;
      return new Date(g.startDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === todayET;
    };
    const isChampionshipGame = (g) => {
      if (!(g.home?.winner || g.away?.winner)) return false;
      const seriesNums = (g.facts?.series?.summary?.match(/\d+/g) || []).map(Number);
      return seriesNums.some(n => n >= 4) || !!g.facts?.seriesComplete;
    };

    function collectGames(board) {
      const out = [];
      Object.entries(LEAGUE_META).forEach(([key, meta]) => {
        ((board || []).find(lg => lg.key === key)?.games || [])
          .filter(g => g.state === 'post' && !isChampionshipGame(g))
          .forEach(g => out.push({ ...g, ...meta }));
      });
      (board || [])
        .filter(lg => RECAP_SOCCER_KEYS.includes(lg.key))
        .flatMap(lg => lg.games.filter(g => g.state === 'post'))
        .forEach(g => out.push({ ...g, ...SOCCER_META }));
      out.sort((a, b) => (b.importance || 0) - (a.importance || 0));
      return out;
    }

    // Games from yesterday (from /api's ?dates= fetch) vs today (today's scoreboard)
    const lastNight = collectGames(yesterdayScores || []);
    const todayGames = collectGames(scoreboard || []).filter(g => isToday(g));

    const hasLastNight = lastNight.length > 0;
    const hasToday = todayGames.length > 0;

    setBadge('badge-recap', (hasLastNight || hasToday) ? 'live' : null);
    setMeta('meta-recap', (hasLastNight || hasToday) ? 'ESPN' : '', new Date().toISOString());

    if (!hasLastNight && !hasToday) {
      el.innerHTML = emptyBox('No completed games yet. Check back after the first final whistle.');
      return;
    }

    function renderGameGroup(games, groupLabel) {
      if (!games.length) return '';
      const featured = games[0];
      const others = games.slice(1, 5);
      const rows = (featured.contextFn(featured) || []).filter(Boolean);
      const wym = featured.wymFn ? featured.wymFn(featured) : '';
      const hlUrl = featured.eventLink?.url || `https://www.youtube.com/results?search_query=${encodeURIComponent((featured.headline || featured.tag) + ' highlights')}`;

      return `<div class="recap-group">
        <div class="recap-group-label">${esc(groupLabel)}</div>
        <div class="grid grid-two">
          <div class="stack">${Marquee(featured)}${others.length ? `<div class="grid grid-scores">${others.map(ScoreboardCard).join('')}</div>` : ''}</div>
          <div class="stack">${ContextCard(rows, false, featured.tag)}${wym}${HighlightLink(hlUrl, 'Watch highlights →')}</div>
        </div>
      </div>`;
    }

    el.innerHTML =
      renderGameGroup(lastNight, 'Last Night') +
      renderGameGroup(todayGames, "Today's Results");
  }

  // ── Champions — teams/players that have clinched a title this season ─────────
  function renderChampions(scoreboard, recentChampions) {
    const el    = $('championsWrap');
    const sec   = $('champions');
    if (!el || !sec) return;

    const CHAMP_LEAGUES = [
      { key: 'nba',  tag: 'NBA' },
      { key: 'nhl',  tag: 'NHL' },
      { key: 'mlb',  tag: 'MLB' },
    ];

    const cards = [];
    CHAMP_LEAGUES.forEach(({ key, tag }) => {
      const lgGames  = (scoreboard || []).find(lg => lg.key === key)?.games || [];
      const postGames = lgGames.filter(g => g.state === 'post');
      const liveGames = lgGames.filter(g => g.state === 'in');

      // Championship detected from today's scoreboard: no live games, a completed
      // game exists with a winner, and series record shows one team at 4 wins.
      if (!liveGames.length && postGames.length > 0) {
        const featured = postGames.sort((a, b) => (b.importance || 0) - (a.importance || 0))[0];
        const hasWinner  = featured.home?.winner || featured.away?.winner;
        const seriesNums = (featured.facts?.series?.summary?.match(/\d+/g) || []).map(Number);
        const isFinal    = seriesNums.some(n => n >= 4) || featured.facts?.seriesComplete;
        if (hasWinner && isFinal) {
          const card = ChampionHighlightCard(featured, tag);
          if (card) cards.push(card);
        }
      }
    });

    // Fallback: if scoreboard is empty or didn't detect champions (series already over),
    // use recentChampions which looks back 14 days. Dedup by league key.
    if (recentChampions && recentChampions.length) {
      const existingKeys = new Set(CHAMP_LEAGUES
        .filter(({ key, tag }) => {
          const lg = (scoreboard || []).find(l => l.key === key);
          return lg && lg.games.some(g => g.state === 'post' && (g.home?.winner || g.away?.winner));
        })
        .map(l => l.key));
      recentChampions.forEach(champ => {
        if (!existingKeys.has(champ.key)) {
          const card = RecentChampCard(champ);
          if (card) cards.push(card);
        }
      });
    }

    if (!cards.length) { sec.hidden = true; return; }
    sec.hidden = false;
    el.innerHTML = `<div class="grid-champ">${cards.join('')}</div>`;
  }

  function renderScoreboard(real) {
    setBadge('badge-scores', real ? 'live' : null);
    const el = $('scoreboardWrap');

    // Sports with dedicated sections are excluded — only overflow leagues here.
    const DEDICATED = new Set(['nba', 'mlb', 'nhl', 'worldcup', 'mls', 'epl', 'ucl', 'concacaf']);
    const leagues = (real || [])
      .filter((lg) => !DEDICATED.has(lg.key))
      .map((lg) => ({ ...lg, games: lg.games.filter((g) => g.state === 'in' || g.state === 'post') }))
      .filter((lg) => lg.games.length > 0);
    if (!leagues.length) { el.innerHTML = emptyBox('No games in progress right now.'); return; }

    // The single biggest game across every league (live > final, then importance).
    const all = leagues.flatMap((lg) => lg.games);
    const rank = { in: 0, post: 1 };
    const big = all.filter((g) => g.isBig)
      .sort((a, b) => ((rank[a.state] ?? 2) - (rank[b.state] ?? 2)) || (b.importance - a.importance))[0];

    // Each sport gets one clear, prominent heading. The hero game's marquee +
    // Read live INSIDE their league's block (no floating card, no duplication),
    // and the hero game isn't repeated as a small card below — keeps it condensed.
    el.innerHTML = leagues.map((lg) => {
      const isHero = big && lg.games.includes(big);
      const readGame = isHero ? big : lg.games[0];
      const hero = isHero ? Marquee(big) : '';
      const read = (readGame && readGame.facts) ? gameRead(readGame, isHero ? 'marquee-read' : 'game-read') : '';
      const cards = lg.games.filter((gm) => !(isHero && gm === big)).map(ScoreboardCard).join('');
      return `
      <div class="league-block">
        <div class="league-name">${esc(lg.label)}</div>
        ${hero}${read}
        ${cards ? `<div class="grid grid-scores">${cards}</div>` : ''}
      </div>`;
    }).join('');
  }

  // Plain-English "why it matters" for the markets section — built from live numbers,
  // no AI. Mirrors the ContextCard format used across every sports section.
  function marketsContext(rows) {
    if (!rows || !rows.length) return null;
    const by = {};
    rows.forEach(r => { if (r && r.key) by[r.key] = r; });
    const spx = by.spx, btc = by.btc, gold = by.gold, tnx = by.tnx;
    const idx = ['spx', 'dow', 'ndq'].map(k => by[k]).filter(Boolean);
    const pos = idx.filter(r => r.changePercent > 0.05).length;
    const neg = idx.filter(r => r.changePercent < -0.05).length;

    let why;
    if (spx) {
      const mv = Math.abs(spx.changePercent);
      const dir = spx.changePercent >= 0 ? 'up' : 'down';
      if (mv >= 1.5) {
        why = `The S&P 500 is ${dir} ${mv.toFixed(1)}% — a significant move that shows up in 401(k)s and brokerage accounts. Something is moving the market today and it's worth knowing what.`;
      } else if (mv >= 0.5) {
        why = `Stocks are ${dir} ${mv.toFixed(1)}% on the S&P 500. A meaningful daily move, but not a market event — normal range for a directional session.`;
      } else {
        why = `Markets are essentially flat — the S&P 500 at ${spx.changePercent >= 0 ? '+' : ''}${spx.changePercent.toFixed(2)}%. A quiet tape day with no major catalyst.`;
      }
    } else {
      why = pos > neg ? 'Stocks are broadly higher across major indices.' : neg > pos ? 'Stocks are broadly lower today.' : 'Markets are mixed — no clear directional trend.';
    }

    let stat = null;
    if (tnx) {
      const yv = Number(tnx.value).toFixed(2);
      const ctx = Number(tnx.value) > 4.5 ? 'elevated — still a headwind for valuations' : Number(tnx.value) < 4.0 ? 'below 4% — relief for rate-sensitive assets' : 'in the mid-4s';
      stat = `10-year Treasury yield at ${yv}% — ${ctx}. This is the benchmark rate that every other asset prices off.`;
    } else if (btc && Math.abs(btc.changePercent) > 2) {
      stat = `Bitcoin ${btc.changePercent >= 0 ? '+' : ''}${btc.changePercent.toFixed(1)}% today — crypto is the story this session and usually reflects broader risk appetite.`;
    } else if (gold && Math.abs(gold.changePercent) > 0.8) {
      stat = `Gold ${gold.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(gold.changePercent).toFixed(1)}% — a signal about ${gold.changePercent > 0 ? 'risk-off sentiment or inflation concerns' : 'calmer macro conditions'}.`;
    }

    let say;
    if (spx) {
      const mv = Math.abs(spx.changePercent);
      if (mv >= 1) {
        say = spx.changePercent >= 0
          ? `"Market ripped ${mv.toFixed(1)}% today — somebody big was buying."`
          : `"Market sold off ${mv.toFixed(1)}% today — worth knowing what drove it."`;
      } else if (btc && Math.abs(btc.changePercent) > 3) {
        say = `"Crypto is having a day — Bitcoin's ${btc.changePercent >= 0 ? '+' : ''}${btc.changePercent.toFixed(1)}% while stocks are relatively quiet."`;
      } else {
        say = `"Markets are ${pos > neg ? 'green' : neg > pos ? 'red' : 'mixed'} but nothing dramatic — just a normal ${pos > neg ? 'up' : neg > pos ? 'down' : 'quiet'} day."`;
      }
    } else {
      say = `"The tape is ${pos > neg ? 'moving up' : neg > pos ? 'moving down' : 'quiet'} today — nothing out of the ordinary."`;
    }

    return [
      { label: 'Why it matters', text: why },
      stat && { label: 'Key stat', key: true, text: stat },
      { label: 'What to say', say: true, text: say },
    ];
  }

  // Today's biggest individual stock movers from Yahoo Finance screener.
  function MarketMovers(stockMovers) {
    if (!stockMovers) return '';
    const { gainers = [], losers = [] } = stockMovers;
    if (!gainers.length && !losers.length) return '';
    const fmtPct = pct => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    const moverRow = r => `<div class="mover-item">
      <div>
        <span class="mover-name">${esc(r.symbol)}</span>
        <span class="mover-sub">${esc(r.name)}</span>
      </div>
      <span class="mover-pct ${r.changePercent >= 0 ? 'up' : 'down'}">${fmtPct(r.changePercent)}</span>
    </div>`;
    return `<div class="mk-movers" style="grid-column:1/-1">
      ${gainers.length ? `<div class="mover-col"><div class="mover-col-head up">▲ Today's Gainers</div>${gainers.map(moverRow).join('')}</div>` : ''}
      ${losers.length ? `<div class="mover-col"><div class="mover-col-head down">▼ Today's Laggards</div>${losers.map(moverRow).join('')}</div>` : ''}
    </div>`;
  }

  function renderMarkets(real, marketNews, stockMovers, marketClosed, marketSectors, earningsCalendar) {
    setBadge('badge-markets', real ? 'live' : null);
    const el = $('marketsWrap');
    if (marketClosed) {
      el.innerHTML = `<div class="empty" style="grid-column:1/-1;text-align:center;padding:32px 16px">
        <div style="font-size:1.5rem;margin-bottom:8px">🔒</div>
        <strong style="display:block;font-size:1.1rem;margin-bottom:6px">Markets Closed</strong>
        <span style="opacity:.7;font-size:.9rem">US markets are closed today. Data shown reflects the last trading session.</span>
      </div>`;
      if (real && real.length) {
        el.innerHTML += real.map(MarketCard).join('');
        el.innerHTML += `<p class="mk-disclaimer">Index and crypto data via Yahoo Finance. Markets closed — figures reflect last session close.</p>`;
      }
      return;
    }
    if (!real || !real.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1">Market data unavailable right now.</div>`; return; }
    const synopsis = marketsSynopsis(real);
    const ctxRows = (marketsContext(real) || []).filter(Boolean);
    const ctxHtml = ctxRows.length ? `<div style="grid-column:1/-1">${ContextCard(ctxRows, false, 'Markets')}</div>` : '';
    const movHtml = MarketMovers(stockMovers);

    // Sector performance tiles
    let sectorsHtml = '';
    if (marketSectors && marketSectors.length) {
      const tiles = marketSectors.map(s => {
        const up = s.direction === 'up';
        const pctStr = s.changePercent != null
          ? `${up ? '+' : ''}${Number(s.changePercent).toFixed(2)}%`
          : '—';
        const ticker = s.key ? s.key.toUpperCase() : '';
        const yhUrl = ticker ? `https://finance.yahoo.com/quote/${ticker}/` : null;
        const inner = `<div class="sector-tile-name">${esc(s.label || s.key)}</div>
          ${ticker ? `<div class="sector-tile-ticker">${esc(ticker)}</div>` : ''}
          <div class="sector-tile-pct">${esc(pctStr)}</div>`;
        return yhUrl
          ? `<a class="sector-tile ${up ? 'sector-up' : 'sector-dn'}" href="${yhUrl}" target="_blank" rel="noopener" title="${esc(ticker)} on Yahoo Finance">${inner}</a>`
          : `<div class="sector-tile ${up ? 'sector-up' : 'sector-dn'}">${inner}</div>`;
      }).join('');
      sectorsHtml = `<div class="mk-section-head" style="grid-column:1/-1"><span class="mk-section-title">Sectors</span><span class="mk-section-sub">SPDR ETF performance today — click any tile to view on Yahoo Finance</span></div>
        <div class="sector-grid" style="grid-column:1/-1">${tiles}</div>`;
    }

    // Earnings calendar
    let earningsHtml = '';
    if (earningsCalendar && earningsCalendar.length) {
      const rows = earningsCalendar.map(e => {
        const d = new Date(e.date + 'T12:00:00Z');
        const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `<div class="earnings-row">
          <span class="earnings-symbol">${esc(e.symbol)}</span>
          <span class="earnings-date">${esc(dateStr)}</span>
          ${e.epsEst != null ? `<span class="earnings-eps">EPS est. ${e.epsEst >= 0 ? '' : ''}${Number(e.epsEst).toFixed(2)}</span>` : ''}
        </div>`;
      }).join('');
      earningsHtml = `<div class="mk-section-head" style="grid-column:1/-1"><span class="mk-section-title">Earnings This Week</span><span class="mk-section-sub">Notable reports coming up</span></div>
        <div class="earnings-list" style="grid-column:1/-1">${rows}</div>`;
    }

    el.innerHTML =
      `<div class="mk-section-head" style="grid-column:1/-1"><span class="mk-section-title">Market Snapshot</span><span class="mk-section-sub">Indices, crypto &amp; commodities</span></div>` +
      buildTapeCard(real, synopsis) +
      real.map(MarketCard).join('') +
      ctxHtml +
      sectorsHtml +
      (movHtml ? `<div class="mk-section-head" style="grid-column:1/-1"><span class="mk-section-title">Movers</span><span class="mk-section-sub">Biggest gainers &amp; losers today</span></div>${movHtml}` : '') +
      earningsHtml +
      `<p class="mk-disclaimer">Index and crypto data via Yahoo Finance; sector data via ETF proxies; index quotes near real-time during market hours. Informational only — not investment advice.</p>`;
    renderMarketNews(marketNews);
  }

  function buildTapeCard(rows, synopsis) {
    const by = {};
    rows.forEach(r => { if (r && r.key) by[r.key] = r; });
    const tapeRows = [
      ['spx', 'S&P 500'], ['ndq', 'Nasdaq'], ['tnx', '10Y Yield'], ['btc', 'Bitcoin'],
    ].map(([key, label]) => {
      const r = by[key];
      if (!r) return '';
      let val, dir;
      if (key === 'tnx') {
        val = `${Number(r.value).toFixed(2)}%`;
        dir = 'neutral';
      } else if (key === 'btc') {
        val = `$${Number(r.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
        dir = r.changePercent > 0.1 ? 'up' : r.changePercent < -0.1 ? 'down' : 'neutral';
      } else {
        const pct = r.changePercent.toFixed(2);
        val = `${r.changePercent >= 0 ? '+' : ''}${pct}%`;
        dir = r.changePercent > 0.05 ? 'up' : r.changePercent < -0.05 ? 'down' : 'neutral';
      }
      return `<div class="tape-row" data-tape-key="${key}"><span class="tape-row-label">${esc(label)}</span><span class="tape-row-val ${dir}">${esc(val)}</span></div>`;
    }).join('');
    if (!tapeRows.replace(/<[^>]+>/g, '').trim()) return '';
    return `<div class="tape-card" style="grid-column:1/-1">
      <div class="tape-label">The Tape</div>
      <div class="tape-rows">${tapeRows}</div>
      ${synopsis ? `<div class="tape-read"><b>Read</b>${esc(synopsis)}</div>` : ''}
    </div>`;
  }

  // Plain-English read on the tape — describes what moved and by how much. Purely
  // descriptive (no advice), built only from the live figures already on screen.
  function marketsSynopsis(rows) {
    const by = {};
    rows.forEach((r) => { if (r && r.key) by[r.key] = r; });
    const idx = ['spx', 'dow', 'ndq', 'rut'].map((k) => by[k]).filter(Boolean);
    if (!idx.length) return '';
    const pos = idx.filter((r) => r.changePercent > 0.05).length;
    const neg = idx.filter((r) => r.changePercent < -0.05).length;
    let mood;
    if (pos && !neg) mood = 'Stocks are broadly higher';
    else if (neg && !pos) mood = 'Stocks are broadly lower';
    else if (pos > neg) mood = 'Stocks are mostly higher';
    else if (neg > pos) mood = 'Stocks are mostly lower';
    else mood = 'Stocks are mixed';
    const pct = (r) => `${r.changePercent >= 0 ? '+' : ''}${r.changePercent.toFixed(2)}%`;
    const lead = idx.slice().sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))[0];
    let s = mood;
    const spx = by.spx;
    if (spx) {
      s += Math.abs(spx.changePercent) <= 0.05
        ? ' — the S&P 500 essentially flat'
        : ` — the S&P 500 ${spx.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(spx.changePercent).toFixed(2)}%`;
    }
    if (lead && (!spx || lead.key !== 'spx')) s += `, with the ${lead.label} ${lead.changePercent >= 0 ? 'leading' : 'lagging'} at ${pct(lead)}`;
    s += '.';
    const extras = [];
    if (by.gold) extras.push(`gold ${by.gold.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(by.gold.changePercent).toFixed(1)}%`);
    if (by.oil) extras.push(`crude ${by.oil.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(by.oil.changePercent).toFixed(1)}%`);
    if (by.tnx) extras.push(`the 10-year yield at ${Number(by.tnx.value).toFixed(2)}%`);
    if (extras.length) s += ` ${capFirst(extras.join(', '))}.`;
    return s;
  }

  // Sections 6 & 7 — driven by the separate, slower /api/talk feed.
  // COMPLIANCE: live data is rendered as-is. When it's missing we show an honest
  // empty state in PRODUCTION (never fabricated content); MOCK is dev-only and
  // always carries a visible badge.
  function renderSocial(data) {
    const el = $('socialWrap');
    if (!el) return;
    const moments = data && Array.isArray(data.moments) ? data.moments : null;
    if (!moments || !moments.length) {
      el.innerHTML = '<p class="social-empty">Social Pulse refreshes every 2 hours — check back shortly.</p>';
      const sec = el.closest('section');
      if (sec) sec.hidden = false;
      setBadge('badge-social', null);
      setMeta('meta-social', '', '');
      return;
    }
    el.innerHTML = moments.map((m) => {
      const platClass = m.platform === 'X' ? 'sp-x'
        : m.platform === 'Instagram' ? 'sp-instagram'
        : m.platform === 'LinkedIn' ? 'sp-linkedin' : 'sp-x';
      return `<div class="social-card">
  <div class="social-top">
    <span class="social-platform ${platClass}">${m.platform || 'X'}</span>
    <span class="social-author">${esc(m.author)}</span>
    <span class="social-handle">${esc(m.handle || '')}</span>
  </div>
  <p class="social-quote">${esc(m.quote)}</p>
  <p class="social-why"><b>Why it matters:</b> ${esc(m.why)}</p>
  ${m.url && m.url.includes('/status/') ? `<a class="social-link" href="${esc(m.url)}" target="_blank" rel="noopener">See post →</a>` : (m.handle ? `<a class="social-link" href="https://x.com/search?q=${encodeURIComponent((m.quote||'').slice(0,50))}" target="_blank" rel="noopener">Search on X →</a>` : '')}
</div>`;
    }).join('');
    const sec = el.closest('section');
    if (sec) sec.hidden = false;
    setBadge('badge-social', 'ai');
    setMeta('meta-social', 'OpenAI Search', data.fetchedAt || new Date().toISOString());
  }

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
    renderSocial(p && p.social);

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
    if ($('recapWrap'))     $('recapWrap').innerHTML = sk(2);
    $('f1Wrap').innerHTML = sk(2);
    $('golfWrap').innerHTML = sk(1);
    if ($('tennisWrap')) $('tennisWrap').innerHTML = sk(2);
    if ($('mmaWrap'))    $('mmaWrap').innerHTML = sk(2);
    if ($('nbaWrap'))    $('nbaWrap').innerHTML = sk(2);
    if ($('mlbWrap'))    $('mlbWrap').innerHTML = sk(2);
    if ($('nhlWrap'))    $('nhlWrap').innerHTML = sk(2);
    if ($('worldcupWrap')) $('worldcupWrap').innerHTML = sk(2);
    if ($('soccerWrap')) $('soccerWrap').innerHTML = sk(2);
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
      else if (a.classList.contains('card-link')) ev = 'live_event_click';
      else if (a.classList.contains('lb-link') || a.classList.contains('nm-link')) ev = 'live_profile_click';
      else if (a.closest('.story-head') || a.closest('.story-src') || a.closest('.talk-src')) ev = 'live_story_click';
      if (ev) posthog.capture(ev, { href: a.href, text: (a.textContent || '').trim().slice(0, 60) });
    }, { capture: true });
  }

  function render(payload) {
    const p = payload || {};
    renderLiveNow(p.liveNow);
    renderRecap(p.scoreboard, p.yesterdayScores);
    renderChampions(p.scoreboard, p.recentChampions);
    renderF1(p.f1);
    renderGolf(p.golf);
    renderTennis(p.tennis);
    renderMMA(p.mma);
    renderNBA(p.scoreboard, p.nbaNews);
    renderMLB(p.scoreboard, p.mlbNews);
    renderNHL(p.scoreboard, p.nhlNews);
    renderWorldCup(p.scoreboard, p.yesterdayScores);
    renderSoccer(p.scoreboard);
    renderMarkets(p.markets, p.marketNews, p.stockMovers, p.marketClosed, p.marketSectors, p.earningsCalendar);
    observeChampCards();
    // Sections 6 & 7 are handled by refreshTalk() / renderTalk() (separate feed).

    const stamp = p.updatedAt || new Date().toISOString();
    window.__liveIso = stamp;
    $('updatedLabel').textContent = `Updated ${relTime(stamp)}`;
    $('updatedLabel').dataset.iso = stamp;

    // Per-section trust signals (source + freshness).
    setMeta('meta-live',     p.liveNow    ? 'ESPN' : '');
    setMeta('meta-f1',       p.f1         ? 'ESPN · Jolpica' : '');
    setMeta('meta-golf',     p.golf       ? 'ESPN' : '');
    setMeta('meta-tennis',   p.tennis     ? 'ESPN' : '');
    setMeta('meta-mma',      p.mma        ? 'ESPN' : '');
    setMeta('meta-scores',   p.scoreboard ? 'ESPN' : '');
    setMeta('meta-markets',  p.markets    ? 'Yahoo Finance' : '');
    // meta-nba / mlb / nhl / soccer set inside _renderLeague(); meta-trending/talking by renderTalk().

    // Section identity: surface the live event name under each header.
    const setText = (id, t) => { const e = $(id); if (e && t) e.textContent = t; };
    const liveN = (p.liveNow || []).length;
    if (liveN) setText('desc-live', `${liveN} event${liveN > 1 ? 's' : ''} in focus right now, ranked by what matters.`);
    if (p.f1) setText('desc-f1', `${p.f1.event} · ${p.f1.sessionLabel}`);
    if (p.golf) setText('desc-golf', `${shortEvent(p.golf.event)} · ${p.golf.statusText}`);
    if (p.mma) setText('desc-mma', `${shortEvent(p.mma.event)} · ${p.mma.statusText || p.mma.state}`);
    if (p.tennis && p.tennis.tours && p.tennis.tours.length) {
      setText('desc-tennis', p.tennis.tours.map((t) => `${t.tour} ${t.name}`).join(' · ') + (p.tennis.anyMajor ? ' · GRAND SLAM' : ''));
    }
    if (p.scoreboard) {
      // Update desc for each dedicated sport section
      const lg = (key) => p.scoreboard.find(l => l.key === key);
      const liveCount = (key) => (lg(key)?.games || []).filter(g => g.state === 'in').length;
      const gameCount = (key) => (lg(key)?.games || []).filter(g => g.state === 'in' || g.state === 'post').length;
      if (lg('nba')) setText('desc-nba', liveCount('nba') ? `${liveCount('nba')} game${liveCount('nba') > 1 ? 's' : ''} live now` : `${gameCount('nba')} game${gameCount('nba') !== 1 ? 's' : ''} today`);
      if (lg('mlb')) setText('desc-mlb', liveCount('mlb') ? `${liveCount('mlb')} game${liveCount('mlb') > 1 ? 's' : ''} live now` : `${gameCount('mlb')} game${gameCount('mlb') !== 1 ? 's' : ''} today`);
      if (lg('nhl')) setText('desc-nhl', liveCount('nhl') ? `${liveCount('nhl')} game${liveCount('nhl') > 1 ? 's' : ''} live now` : `Stanley Cup Playoffs`);
      // World Cup section desc
      const wc = lg('worldcup');
      if (wc) {
        const wcLive = (wc.games || []).filter(g => g.state === 'in').length;
        const wcTotal = (wc.games || []).filter(g => g.state === 'in' || g.state === 'post').length;
        setText('desc-worldcup', wcLive ? `${wcLive} match${wcLive > 1 ? 'es' : ''} live now` : wcTotal ? `${wcTotal} match${wcTotal !== 1 ? 'es' : ''} today` : 'World Cup 2026');
      }
      // Soccer Leagues section desc (excludes worldcup)
      const soccerGames = ['mls','epl','ucl','concacaf'].flatMap(k => (lg(k)?.games || []).filter(g => g.state === 'in' || g.state === 'post'));
      const soccerLive = soccerGames.filter(g => g.state === 'in').length;
      if (soccerGames.length) setText('desc-soccer', soccerLive ? `${soccerLive} match${soccerLive > 1 ? 'es' : ''} live now` : `${soccerGames.length} match${soccerGames.length !== 1 ? 'es' : ''} today`);
      // Overflow scoreboard
      const DEDICATED = new Set(['nba','mlb','nhl','worldcup','mls','epl','ucl','concacaf']);
      const overflowLeagues = p.scoreboard.filter(l => !DEDICATED.has(l.key));
      const liveG = overflowLeagues.reduce((n, l) => n + l.games.filter(g => g.state === 'in').length, 0);
      if (overflowLeagues.length) setText('desc-scores', liveG
        ? `${liveG} game${liveG > 1 ? 's' : ''} live now`
        : `Latest scores across ${overflowLeagues.length} league${overflowLeagues.length !== 1 ? 's' : ''}.`);
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

  // Patch market tiles in-place with fresh /api/quote data — bypasses CDN cache
  // so tiles always show current price regardless of /api/live stale-while-revalidate.
  const MK_REFRESH_MS = 30 * 1000;
  let mkTimer = null;
  // Maps MARKET_YAHOO key → tape row key (only the 4 keys shown in the tape)
  const TAPE_KEYS = { spx: 'spx', ndq: 'ndq', tnx: 'tnx', btc: 'btc' };

  function patchMarketTiles() {
    const entries = Object.entries(MARKET_YAHOO); // [['spx','^GSPC'], ...]
    entries.forEach(([key, sym]) => {
      fetch('/api/quote?symbol=' + encodeURIComponent(sym), { headers: { Accept: 'application/json' } })
        .then(r => r.json())
        .then(d => {
          if (!d || !d.quote) return;
          const q = d.quote;
          const isYield = sym === '^TNX';
          const isBtc = key === 'btc';
          const fmtVal = (n) => {
            if (isYield) return Number(n).toFixed(2);
            const abs = Math.abs(n);
            return abs >= 1000
              ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
              : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          };
          const up = (q.change || 0) >= 0;
          const dir = up ? 'up' : 'down';
          const arrow = up ? '▲' : '▼';
          const sign = up ? '+' : '';
          const unit = isYield ? '%' : '';

          // Patch the market card tile
          const card = document.querySelector('.mk-card[data-symbol="' + sym + '"]');
          if (card) {
            const valEl = card.querySelector('.mk-value');
            const moveEl = card.querySelector('.mk-move');
            if (valEl) valEl.textContent = fmtVal(q.price) + unit;
            if (moveEl) {
              moveEl.className = 'mk-move ' + dir;
              moveEl.innerHTML = '<span class="mk-arrow">' + arrow + '</span>'
                + sign + fmtVal(q.change) + ' (' + sign + Number(q.changePercent).toFixed(2) + '%)';
            }
          }

          // Also patch the corresponding tape row so it never lags the cards
          const tapeKey = TAPE_KEYS[key];
          if (tapeKey) {
            const tapeRow = document.querySelector('.tape-row[data-tape-key="' + tapeKey + '"]');
            if (tapeRow) {
              const valSpan = tapeRow.querySelector('.tape-row-val');
              if (valSpan) {
                let tapeVal, tapeDir;
                if (isYield) {
                  tapeVal = Number(q.price).toFixed(2) + '%';
                  tapeDir = 'neutral';
                } else if (isBtc) {
                  tapeVal = '$' + Number(q.price).toLocaleString('en-US', { maximumFractionDigits: 0 });
                  tapeDir = q.changePercent > 0.1 ? 'up' : q.changePercent < -0.1 ? 'down' : 'neutral';
                } else {
                  tapeVal = (q.changePercent >= 0 ? '+' : '') + Number(q.changePercent).toFixed(2) + '%';
                  tapeDir = q.changePercent > 0.05 ? 'up' : q.changePercent < -0.05 ? 'down' : 'neutral';
                }
                valSpan.className = 'tape-row-val ' + tapeDir;
                valSpan.textContent = tapeVal;
              }
            }
          }
        })
        .catch(() => {});
    });
  }

  function startMarketRefresh() {
    if (mkTimer) clearInterval(mkTimer);
    patchMarketTiles();
    mkTimer = setInterval(patchMarketTiles, MK_REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (mkTimer) { clearInterval(mkTimer); mkTimer = null; } }
      else { patchMarketTiles(); mkTimer = setInterval(patchMarketTiles, MK_REFRESH_MS); }
    });
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

        // Propagate fresh quote data back to the market card + tape so they
        // immediately reflect the same value the modal just fetched.
        if (q.changePercent != null) {
          const card = document.querySelector('.mk-card[data-symbol="' + esc(symbol) + '"]');
          if (card) {
            const isYield = symbol === '^TNX';
            const fmtVal = (n) => {
              const abs = Math.abs(n);
              return abs >= 1000
                ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
                : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            };
            const valEl = card.querySelector('.mk-value');
            const moveEl = card.querySelector('.mk-move');
            const cardSign = (q.change || 0) >= 0 ? '+' : '';
            const cardDir = (q.change || 0) >= 0 ? 'up' : 'down';
            const cardArrow = (q.change || 0) >= 0 ? '▲' : '▼';
            if (valEl) valEl.textContent = (isYield ? Number(q.price).toFixed(2) + '%' : fmtVal(q.price));
            if (moveEl) {
              moveEl.className = 'mk-move ' + cardDir;
              moveEl.innerHTML = '<span class="mk-arrow">' + cardArrow + '</span>'
                + cardSign + fmtVal(q.change || 0) + ' (' + cardSign + Number(q.changePercent).toFixed(2) + '%)';
            }
            // Sync tape row for this ticker
            const tapeKeyMap = { '^GSPC': 'spx', '^IXIC': 'ndq', '^TNX': 'tnx', 'BTC-USD': 'btc' };
            const tk = tapeKeyMap[symbol];
            if (tk) {
              const tapeRow = document.querySelector('.tape-row[data-tape-key="' + tk + '"]');
              if (tapeRow) {
                const valSpan = tapeRow.querySelector('.tape-row-val');
                if (valSpan) {
                  let tapeVal, tapeDir;
                  if (isYield) { tapeVal = Number(q.price).toFixed(2) + '%'; tapeDir = 'neutral'; }
                  else if (tk === 'btc') { tapeVal = '$' + Number(q.price).toLocaleString('en-US', { maximumFractionDigits: 0 }); tapeDir = q.changePercent > 0.1 ? 'up' : q.changePercent < -0.1 ? 'down' : 'neutral'; }
                  else { tapeVal = (q.changePercent >= 0 ? '+' : '') + Number(q.changePercent).toFixed(2) + '%'; tapeDir = q.changePercent > 0.05 ? 'up' : q.changePercent < -0.05 ? 'down' : 'neutral'; }
                  valSpan.className = 'tape-row-val ' + tapeDir;
                  valSpan.textContent = tapeVal;
                }
              }
            }
          }
        }
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

  // ── Confetti burst — fires once per page session when any .champ-card scrolls in
  let _confettiFired = false;
  function launchConfetti(fromEl) {
    if (_confettiFired) return;
    _confettiFired = true;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const rect = fromEl.getBoundingClientRect();
    const ox = rect.left + rect.width / 2, oy = rect.top + rect.height / 2;
    const COLS = ['#FF6B6B','#FFD700','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#FF8CC8','#A8D8EA'];
    const ps = Array.from({ length: 110 }, () => ({
      x: ox + (Math.random() - 0.5) * 80,
      y: oy + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -14 - 4,
      sz: Math.random() * 10 + 5,
      c: COLS[Math.floor(Math.random() * COLS.length)],
      rot: Math.random() * 360, vr: (Math.random() - 0.5) * 9,
      shape: Math.random() > 0.4 ? 'r' : 'c',
    }));
    const t0 = Date.now(), dur = 3200;
    (function draw() {
      const t = (Date.now() - t0) / dur;
      if (t > 1) { canvas.remove(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ps.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.rot += p.vr;
        const alpha = t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
        ctx.globalAlpha = alpha; ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
        if (p.shape === 'r') ctx.fillRect(-p.sz / 2, -p.sz / 4, p.sz, p.sz / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.sz / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      });
      requestAnimationFrame(draw);
    })();
  }

  function observeChampCards() {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) launchConfetti(e.target); });
    }, { threshold: 0.35 });
    document.querySelectorAll('.champ-card').forEach(el => obs.observe(el));
  }

  // ── Market news wire — financial headlines from the live payload ─────────────
  function renderMarketNews(marketNews) {
    const el = $('marketNewsWrap');
    if (!el) return;
    const picks = (marketNews || []).filter(s => s && s.headline).slice(0, 2);
    if (!picks.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = picks.map(s => {
      const head = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="mk-wire-link">${esc(s.headline)}</a>`
        : esc(s.headline);
      return `<div class="mk-wire-card">
        <div class="mk-wire-cat">${esc(s.category || 'Markets')}</div>
        <div class="mk-wire-head">${head}</div>
        ${s.summary ? `<p class="mk-wire-sum">${esc(s.summary)}</p>` : ''}
        ${s.source && s.url ? `<div class="mk-wire-src">${esc(s.source)} →</div>` : ''}
      </div>`;
    }).join('');
  }

  window.GuyTalkLive = { refresh, MOCK, openStock, components: {
    LiveEventCard, LiveLeaderboard, ScoreboardCard, MarketCard, TrendingStoryCard,
    TalkingPointCard, ContextCard, EventSpotlight, Marquee,
  }};

  // ── Section background tints — shifts as you scroll through Sports/Markets/Culture ──
  (function () {
    const MAP = [
      { id: 'umb-sports',  bg: '#EEF4FF' },
      { id: 'umb-markets', bg: '#EAF8EF' },
      { id: 'umb-culture', bg: '#FEF4E8' },
    ];
    const DEFAULT = '#F9F8F5';
    let current = DEFAULT;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const hit = MAP.find(m => m.id === e.target.id);
          const next = hit ? hit.bg : DEFAULT;
          if (next !== current) { current = next; document.body.style.backgroundColor = next; }
        }
      });
    }, { threshold: 0.15 });
    MAP.forEach(m => { const el = document.getElementById(m.id); if (el) obs.observe(el); });
  })();

  // ── Game breakdown slide-over panel ──────────────────────────────────────────
  function initGamePanel() {
    const panel   = document.getElementById('gamePanel');
    const body    = document.getElementById('gamePanelBody');
    const titleEl = document.getElementById('gamePanelTitle');
    if (!panel) return;

    function closePanel() {
      panel.hidden = true;
      document.body.style.overflow = '';
    }
    document.getElementById('gamePanelClose')?.addEventListener('click', closePanel);
    document.getElementById('gamePanelOverlay')?.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

    async function openBreakdown(card) {
      const sport    = card.dataset.sport    || '';
      const home     = card.dataset.home     || '';
      const away     = card.dataset.away     || '';
      const hs       = card.dataset.homeScore || '';
      const as_      = card.dataset.awayScore || '';
      const league   = card.dataset.league   || '';
      const headline = card.dataset.headline || '';
      if (!home || !away) return;

      titleEl.textContent = `${away} vs ${home}`;
      body.innerHTML = `<div class="game-panel-loading">Looking up the game breakdown…</div>`;
      panel.hidden = false;
      document.body.style.overflow = 'hidden';

      try {
        const params = new URLSearchParams({ action: 'game-context', sport, home, away, homeScore: hs, awayScore: as_, league, headline });
        const resp = await fetch(`/api/live?${params}`);
        if (!resp.ok) throw new Error('api error');
        const d = await resp.json();

        const homeWon = Number(hs) > Number(as_);
        const awayWon = Number(as_) > Number(hs);
        body.innerHTML = `
          <div class="game-panel-score">${esc(away)} <span style="opacity:.4;font-size:18px">vs</span> ${esc(home)}</div>
          <div class="game-panel-teams">
            <span style="font-weight:${awayWon?'800':'400'};opacity:${awayWon?'1':'.6'}">${esc(away)} ${esc(as_)}</span>
            <span style="opacity:.35">–</span>
            <span style="font-weight:${homeWon?'800':'400'};opacity:${homeWon?'1':'.6'}">${esc(home)} ${esc(hs)}</span>
            ${league ? `<span class="game-panel-league">${esc(league || sport.toUpperCase())}</span>` : ''}
          </div>
          ${d.whyItMatters ? `<div class="game-panel-section"><div class="game-panel-label">Why It Matters</div><div class="game-panel-text">${esc(cleanAI(d.whyItMatters))}</div></div>` : ''}
          ${d.biggestMoment ? `<div class="game-panel-section"><div class="game-panel-label">Biggest Moment</div><div class="game-panel-text">${esc(cleanAI(d.biggestMoment))}</div></div>` : ''}
          ${d.hotTake ? `<div class="game-panel-section"><div class="game-panel-label">Hot Take</div><div class="game-panel-hot">${esc(cleanAI(d.hotTake))}</div></div>` : ''}
          ${d.whatToSay ? `<div class="game-panel-section"><div class="game-panel-label">What To Say</div><div class="game-panel-say">"${esc(cleanAI(d.whatToSay))}"</div></div>` : ''}
          ${d.keyTakeaway ? `<div class="game-panel-section"><div class="game-panel-label">What It Means</div><div class="game-panel-text">${esc(cleanAI(d.keyTakeaway))}</div></div>` : ''}
          ${d.contextFacts?.length ? `<div class="game-panel-section"><div class="game-panel-label">Fast Facts</div><ul class="game-panel-facts">${d.contextFacts.map(f => `<li>${esc(cleanAI(f))}</li>`).join('')}</ul></div>` : ''}
          <div class="game-panel-meta">Powered by ${d.source === 'openai-search' ? 'OpenAI Search' : 'GuyTalk AI'} · Live data</div>
        `;
      } catch (_) {
        body.innerHTML = `<div class="game-panel-loading">Couldn't load breakdown — try searching ${esc(home)} vs ${esc(away)} on ESPN.</div>`;
      }
    }

    // Event delegation — capture clicks and Enter/Space on score cards
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.sc-card[data-home]');
      if (card) openBreakdown(card);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.sc-card[data-home]');
        if (card) { e.preventDefault(); openBreakdown(card); }
      }
    });
  }

  // ── Section scroll nav — shown on all three tabs, styled like the homepage ───
  function initScrollNav() {
    const nav     = document.getElementById('ssnNav');
    const ssnList = document.getElementById('ssnList');
    if (!nav || !ssnList) return;

    const TAB_CFG = {
      'tab-sports': {
        ids: ['live-now','recap','worldcup','champions','f1','golf','tennis','mma','nba','mlb','nhl','soccer'],
        labels: { 'live-now':'Live Now', recap:'Recap', worldcup:'World Cup', champions:'Champions',
          f1:'F1', golf:'Golf', tennis:'Tennis', mma:'UFC/MMA', nba:'NBA', mlb:'MLB', nhl:'NHL', soccer:'Soccer' }
      },
      'tab-markets': {
        ids: ['markets'],
        labels: { markets:'Markets' }
      },
      'tab-culture': {
        ids: ['social-pulse','trending'],
        labels: { 'social-pulse':'Social Pulse', trending:'Trending' }
      }
    };

    let activeObserver = null;

    function buildNav(tabId) {
      if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
      const cfg = TAB_CFG[tabId];
      if (!cfg) { nav.hidden = true; return; }
      const present = cfg.ids.filter(id => !!document.getElementById(id));
      if (!present.length) { nav.hidden = true; return; }

      ssnList.innerHTML = present.map(id =>
        `<li class="ssn-item">
          <button class="ssn-dot" data-target="${id}" title="${cfg.labels[id] || id}"></button>
          <span class="ssn-label">${cfg.labels[id] || id}</span>
        </li>`
      ).join('');

      ssnList.querySelectorAll('[data-target]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById(btn.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      const dotMap = new Map(present.map(id => [id, ssnList.querySelector(`[data-target="${id}"]`)]));
      activeObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => dotMap.get(e.target.id)?.classList.toggle('is-active', e.isIntersecting));
      }, { rootMargin: '-25% 0px -65% 0px' });
      present.forEach(id => { const el = document.getElementById(id); if (el) activeObserver.observe(el); });

      nav.hidden = false;
    }

    // Build nav for initial tab (Sports is default)
    setTimeout(() => buildNav('tab-sports'), 80);

    // Rebuild when tab switches
    document.addEventListener('guytalk:tabchange', (e) => {
      buildNav(e.detail?.tab || 'tab-sports');
    });
  }

  paintSkeletons();
  renderTalk(null);   // instant editorial paint for sections 6 & 7 before the feed lands
  refresh(false);
  refreshTalk();
  startClock();
  startAutoRefresh();
  startMarketRefresh();
  trackClicks();
  initGamePanel();
  initScrollNav();
})();

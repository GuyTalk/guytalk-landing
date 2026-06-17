'use strict';

const { BRIEF_ROWS, TICKERS, CORE_TICKERS, PRODUCTS, RECS, esc, playerLink, tickerLink, fmtPrice, fmtPct, ENTITY_LINKS, entityLink, linkifyEntities } = require('./db');

// Render AI prose (possibly multi-paragraph) into proper <p> tags
function renderParas(text, fallback = '') {
  if (!text) return fallback ? `<p>${fallback}</p>` : '';
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`)
    .join('\n    ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point — returns the full HTML string for a brief issue
// ─────────────────────────────────────────────────────────────────────────────
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ESPN CDN logo URL for a team abbreviation + sport
function espnLogo(abbrev, sport) {
  if (!abbrev) return null;
  const a = abbrev.toLowerCase().replace(/[^a-z]/g, '');
  const sportKey = { mlb: 'mlb', nhl: 'nhl', nfl: 'nfl' }[(sport || '').toLowerCase()] || 'nba';
  return `https://a.espncdn.com/i/teamlogos/${sportKey}/500/${a}.png`;
}

// Venue/stadium image for notable MLB and NBA venues
function venueImage(abbrev, sport) {
  const key = (abbrev || '').toUpperCase();
  const MLB_VENUES = {
    DET: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/Comerica_Park_Detroit_2014.jpg/1280px-Comerica_Park_Detroit_2014.jpg', alt: 'Comerica Park', cap: 'Comerica Park · Detroit, Michigan' },
    TB:  { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Tropicana_Field.jpg/1280px-Tropicana_Field.jpg', alt: 'Tropicana Field', cap: 'Tropicana Field · St. Petersburg, Florida' },
    MIL: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/American_Family_Field.jpg/1280px-American_Family_Field.jpg', alt: 'American Family Field', cap: 'American Family Field · Milwaukee, Wisconsin' },
    SF:  { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Oracle_Park_2019.jpg/1280px-Oracle_Park_2019.jpg', alt: 'Oracle Park', cap: 'Oracle Park · San Francisco, California' },
    LAD: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Dodger_Stadium_2020.jpg/1280px-Dodger_Stadium_2020.jpg', alt: 'Dodger Stadium', cap: 'Dodger Stadium · Los Angeles, California' },
    NYY: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Yankee_Stadium_2012.jpg/1280px-Yankee_Stadium_2012.jpg', alt: 'Yankee Stadium', cap: 'Yankee Stadium · Bronx, New York' },
    BOS: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Fenway_from_air_05.jpg/1280px-Fenway_from_air_05.jpg', alt: 'Fenway Park', cap: 'Fenway Park · Boston, Massachusetts' },
    CHC: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Wrigley_Field_2013.jpg/1280px-Wrigley_Field_2013.jpg', alt: 'Wrigley Field', cap: 'Wrigley Field · Chicago, Illinois' },
    CLE: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Progressive_Field_2014.jpg/1280px-Progressive_Field_2014.jpg', alt: 'Progressive Field', cap: 'Progressive Field · Cleveland, Ohio' },
    PIT: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/PNC_Park_2011.jpg/1280px-PNC_Park_2011.jpg', alt: 'PNC Park', cap: 'PNC Park · Pittsburgh, Pennsylvania' },
    ATL: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Truist_Park_2017.jpg/1280px-Truist_Park_2017.jpg', alt: 'Truist Park', cap: 'Truist Park · Cumberland, Georgia' },
    HOU: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Minute_Maid_Park_2015.jpg/1280px-Minute_Maid_Park_2015.jpg', alt: 'Minute Maid Park', cap: 'Minute Maid Park · Houston, Texas' },
  };
  const NBA_VENUES = {
    SA:  { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/AT%26T_Center_2019.jpg/1280px-AT%26T_Center_2019.jpg', alt: 'AT&T Center', cap: 'AT&T Center · San Antonio, Texas · Home of the Spurs' },
    NY:  { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Madison_Square_Garden_2020.jpg/1280px-Madison_Square_Garden_2020.jpg', alt: 'Madison Square Garden', cap: 'Madison Square Garden · New York City · The World\'s Most Famous Arena' },
    NYK: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Madison_Square_Garden_2020.jpg/1280px-Madison_Square_Garden_2020.jpg', alt: 'Madison Square Garden', cap: 'Madison Square Garden · New York City · The World\'s Most Famous Arena' },
    BOS: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/TD_Garden_Boston.jpg/1280px-TD_Garden_Boston.jpg', alt: 'TD Garden', cap: 'TD Garden · Boston, Massachusetts' },
    MIL: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/Fiserv_Forum_2018.jpg/1280px-Fiserv_Forum_2018.jpg', alt: 'Fiserv Forum', cap: 'Fiserv Forum · Milwaukee, Wisconsin' },
    GSW: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Chase_Center_San_Francisco_2019.jpg/1280px-Chase_Center_San_Francisco_2019.jpg', alt: 'Chase Center', cap: 'Chase Center · San Francisco, California' },
    LAL: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Crypto.com_Arena_2021.jpg/1280px-Crypto.com_Arena_2021.jpg', alt: 'Crypto.com Arena', cap: 'Crypto.com Arena · Los Angeles, California' },
    MIN: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Target_Center_2019.jpg/1280px-Target_Center_2019.jpg', alt: 'Target Center', cap: 'Target Center · Minneapolis, Minnesota' },
    OKC: { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Paycom_Center_2021.jpg/1280px-Paycom_Center_2021.jpg', alt: 'Paycom Center', cap: 'Paycom Center · Oklahoma City, Oklahoma' },
  };
  if (sport === 'mlb') return MLB_VENUES[key] || null;
  if (sport === 'nba') return NBA_VENUES[key] || null;
  return null;
}

// F1 circuit photos — self-hosted in /assets/circuits/ (reliable, relevant).
function f1CircuitImage(raceName) {
  const name = (raceName || '').toLowerCase();
  const circuits = [
    [/monaco/,                              'monaco',      'Circuit de Monaco · Monte Carlo · The most iconic 3.3 miles in motorsport'],
    [/british|silverstone/,                 'silverstone', 'Silverstone Circuit · Northamptonshire, England'],
    [/italian|monza/,                       'monza',       'Autodromo Nazionale Monza · Monza, Italy · Temple of Speed'],
    [/belgian|spa/,                         'spa',         'Circuit de Spa-Francorchamps · Belgium'],
    [/japanese|suzuka/,                     'suzuka',      'Suzuka Circuit · Suzuka, Japan'],
    [/united states|austin|americas|cota/,  'cota',        'Circuit of the Americas · Austin, Texas'],
    [/bahrain/,                             'bahrain',     'Bahrain International Circuit · Sakhir'],
    [/australian|melbourne|albert park/,    'melbourne',   'Albert Park Circuit · Melbourne, Australia'],
    [/canadian|montreal|villeneuve/,        'montreal',    'Circuit Gilles Villeneuve · Montreal, Canada'],
    [/spanish|barcelona|catalun/,           'barcelona',   'Circuit de Barcelona-Catalunya · Spain'],
    [/dutch|zandvoort/,                     'zandvoort',   'Circuit Zandvoort · Netherlands'],
    [/singapore|marina bay/,                'singapore',   'Marina Bay Street Circuit · Singapore'],
    [/las vegas/,                           'lasvegas',    'Las Vegas Strip Circuit · Las Vegas, Nevada'],
    [/austrian|red bull ring|spielberg/,    'redbullring', 'Red Bull Ring · Spielberg, Austria'],
    [/brazil|paulo|interlagos/,             'interlagos',  'Interlagos (Autodromo Jose Carlos Pace) · Sao Paulo, Brazil'],
  ];
  for (const [re, key, cap] of circuits) {
    if (re.test(name)) return { urls: [`/assets/circuits/${key}.jpg`], cap };
  }
  return null;
}

// Hero banner game selection — feature the day's MARQUEE event, not whatever
// game happens to be first in the array. Ranks completed + upcoming games by
// importance so a postseason/Finals matchup (even tonight's, still upcoming)
// always beats a random regular-season game.
const HERO_BIG_RE = /final|finals|championship|\bcup\b|playoff|conference|series|elimination|game\s*\d/i;
const HERO_SPORT_BASE = { nfl: 6, nba: 5, nhl: 5, f1: 4, golf: 3, mlb: 3 };

function heroScore(g, { upcoming = false } = {}) {
  if (!g) return -1;
  const sport = (g.sport || 'nba').toLowerCase();
  let score = HERO_SPORT_BASE[sport] ?? 3;
  const tags = `${g.note || ''} ${g.seriesNote || ''} ${g.shortName || ''}`;
  if (HERO_BIG_RE.test(tags)) score += 50;        // postseason / Finals / Cup
  if (upcoming) score += 2;                         // a marquee event still to come leads the day
  return score;
}

// Returns { game, upcoming } for the single best hero candidate, or null.
function pickHeroGame(sports, upcoming) {
  const candidates = [
    ...(sports || []).map((g) => ({ game: g, upcoming: false })),
    ...(upcoming || []).map((g) => ({ game: g, upcoming: true })),
  ];
  if (!candidates.length) return null;
  candidates.sort((a, b) => heroScore(b.game, { upcoming: b.upcoming }) - heroScore(a.game, { upcoming: a.upcoming }));
  return candidates[0];
}

// Honest fallback take for a "More Sports" game when no AI context exists.
// Uses ONLY the final score + series note — never invents anything.
function deriveOtherTake(g, w, l) {
  const ws = parseInt(w.score, 10), ls = parseInt(l.score, 10);
  const margin = Number.isFinite(ws) && Number.isFinite(ls) ? ws - ls : null;
  let qualifier = '';
  if (margin != null) {
    if (margin === 0) qualifier = '';
    else if (margin <= 2) qualifier = ' in a tight one';
    else if (margin >= 10) qualifier = ', and it wasn’t close';
  }
  const series = g.seriesNote ? ` ${g.seriesNote}.` : '';
  return `${w.team} beat ${l.team} ${w.score}–${l.score}${qualifier}.${series}`.trim();
}

// ESPN recap URL from game ID + sport
function espnRecapUrl(gameId, sport) {
  const s = sport === 'mlb' ? 'mlb' : 'nba';
  return `https://www.espn.com/${s}/recap/_/gameId/${gameId}`;
}

function isoDate(dateStr) {
  try { return new Date(dateStr).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
}

function buildSeoTitle(issue) {
  const { title, sports, upcoming, golf, f1, worldCup } = issue;
  // Pull 2-3 real event names for a richer page title
  const parts = [];
  if (upcoming?.length) parts.push(`${upcoming[0].note || upcoming[0].shortName}`);
  else if (sports?.length) {
    const g = sports[0];
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    parts.push(`${w.team} ${w.score}-${l.score}`);
  }
  if (f1?.name) parts.push(f1.shortName || f1.name.split(' ').slice(0, 3).join(' '));
  if (golf?.leaders?.[0]) parts.push(golf.leaders[0].name + (golf.statusState === 'post' ? ' wins' : ' leads'));
  if (parts.length) return `${parts.slice(0, 2).join(' · ')} — GuyTalk Daily Brief`;
  return title ? `${title.slice(0, 70)} — GuyTalk` : `GuyTalk Daily Brief`;
}

function buildSeoDesc(issue) {
  const { title, sports, upcoming, golf, f1, worldCup, markets, date } = issue;
  const pieces = [];
  if (upcoming?.length) pieces.push(`${upcoming[0].note || upcoming[0].shortName} ${upcoming[0].daysAhead <= 1 ? 'tomorrow' : 'this week'}.`);
  if (sports?.length) {
    const g = sports[0];
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    pieces.push(`${w.team} ${w.score}-${l.score} ${l.team}.`);
  }
  if (f1?.name) pieces.push(`${f1.shortName || f1.name} ${f1.statusState === 'post' ? 'results' : 'preview'}.`);
  if (golf?.leaders?.[0]) pieces.push(`${golf.leaders[0].name} ${golf.statusState === 'post' ? 'wins' : 'leads'} ${(golf.name || '').replace(/pres\. by .*/i,'').trim()}.`);
  if (worldCup?.length) pieces.push('World Cup 2026 coverage.');
  pieces.push('Markets, culture, and more. Free daily brief from GuyTalk.');
  return pieces.slice(0, 4).join(' ');
}

function buildMoreIssues(relatedIssues) {
  if (!relatedIssues?.length) return '';
  const items = relatedIssues.slice(0, 3).map(r => {
    const rSlug  = r.slug || `issue-${String(r.num).padStart(3, '0')}`;
    const rLabel = `#${String(r.num).padStart(3, '0')}`;
    const rTitle = r.title || 'GuyTalk Brief';
    const rDate  = r.date  || '';
    return `  <a href="/brief/${esc(rSlug)}/" class="more-issue-card">
    <span class="mi-num">${esc(rLabel)}</span>
    <span class="mi-title">${esc(rTitle)}</span>
    <span class="mi-date">${esc(rDate)}</span>
  </a>`;
  }).join('\n');
  return `<div class="more-issues-block">
  <div class="more-issues-label">More issues</div>
${items}
  <a href="/briefs/" class="more-issues-all">Browse all issues →</a>
</div>`;
}

// Stable anchor id from a sport/event label (for the nested sidebar + sections).
function slugId(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sport';
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNDOWN — dark navy gradient card at the top of each brief.
// Replaces "Today at a Glance" with a narrative summary + 3 category bullets
// (Sports / Markets / Culture) derived from the issue's own section data.
// ─────────────────────────────────────────────────────────────────────────────
function buildRundown(issue) {
  const copy = issue.copy || {};

  // Narrative: use AI-provided copy.rundownNarrative when set; else assemble
  // from the top market story + sports lead + culture lead.
  const narrative = (() => {
    if (copy.rundownNarrative) return copy.rundownNarrative;
    const parts = [];
    const moodHead = (Array.isArray(copy.markets?.headlines) && copy.markets.headlines[0]?.head)
      || copy.markets?.mood || '';
    if (moodHead) parts.push(moodHead.replace(/\.$/, '') + '.');
    const sportsLead = (issue.dynamicSports || [])[0];
    if (sportsLead?.headline) parts.push(sportsLead.headline.replace(/\[.*$/g, '').trim().replace(/\.$/, '') + '.');
    const cultureHead = copy.culture?.[0]?.head;
    if (cultureHead) parts.push(cultureHead.replace(/\.$/, '') + '.');
    return parts.filter(Boolean).join(' ');
  })();

  // Sports bullet — dynamic sports leads, F1 result, golf preview headline
  const sportsBullet = (() => {
    const parts = [];
    (issue.dynamicSports || []).slice(0, 2).forEach(s => {
      if (s.headline) parts.push(s.headline.replace(/\[.*$/g, '').trim());
    });
    if (issue.f1?.results?.[0]) {
      const p1 = issue.f1.results[0];
      parts.push(`${p1.driver} wins the ${issue.f1.shortName || issue.f1.name || 'race'}`);
    }
    if (copy.golf?.headline) parts.push(copy.golf.headline.replace(/—.*/g, '').trim());
    return parts.slice(0, 3).join(' · ') || 'Scores and results inside.';
  })();

  // Markets bullet — market mood + broad index move summary.
  // Prefers indexDayChangePct (true ^GSPC / ^IXIC day %) over the ETF's
  // dayChangePct. This is the same data the market-card tiles use — no section
  // may independently calculate or invent S&P/Nasdaq/Dow moves.
  const marketsBullet = (() => {
    const parts = [];
    const m = copy.markets || {};
    if (m.mood) parts.push(m.mood.split(/[.—–]/)[0].trim());
    const qs = issue.markets || {};
    const spyPct = qs.SPY?.indexDayChangePct ?? qs.SPY?.dayChangePct;
    const qqqPct = qs.QQQ?.indexDayChangePct ?? qs.QQQ?.dayChangePct;
    const changes = [
      spyPct != null && `S&P 500 ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(1)}%`,
      qqqPct != null && `Nasdaq ${qqqPct >= 0 ? '+' : ''}${qqqPct.toFixed(1)}%`,
    ].filter(Boolean).join(', ');
    if (changes) parts.push(changes);
    return parts.slice(0, 2).join(' · ') || 'Market data inside.';
  })();

  // Culture bullet — top 2 culture item headlines, stripped after em-dash
  const cultureBullet = (() => {
    return (copy.culture || [])
      .slice(0, 2)
      .map(c => (c.head || c.topic || '').replace(/\s*[—–].*/g, '').trim())
      .filter(Boolean)
      .join(' · ') || 'Culture picks inside.';
  })();

  if (!narrative && !sportsBullet && !marketsBullet) return '';

  return `  <div class="rundown-band">
    <div class="rundown-label"><span class="rundown-dot"></span>The Rundown</div>
    <p class="rundown-text">${esc(narrative)}</p>
    <div class="rbd-bullets">
      <a class="rbd-bullet rbd-sports" href="#sports">
        <span class="rbd-cat">Sports</span>
        <span class="rbd-line">${esc(sportsBullet)}</span>
      </a>
      <a class="rbd-bullet rbd-markets" href="#markets">
        <span class="rbd-cat">Markets</span>
        <span class="rbd-line">${esc(marketsBullet)}</span>
      </a>
      <a class="rbd-bullet rbd-culture" href="#culture">
        <span class="rbd-cat">Culture</span>
        <span class="rbd-line">${esc(cultureBullet)}</span>
      </a>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation-intelligence blocks: The GuyTalk Read + Conversation Ammo.
// Shared by sports cards, markets, golf, F1, and culture items.
// ─────────────────────────────────────────────────────────────────────────────
function convoBlocks(s) {
  if (!s) return '';
  const read = s.theRead || '';
  const ammo = Array.isArray(s.ammo) ? s.ammo.filter(Boolean) : [];
  const readHtml = read
    ? `      <li><span><span class="dl-label">The GuyTalk Read:</span> ${esc(read)}</span></li>`
    : '';
  const ammoHtml = ammo.length
    ? `      <li class="ammo-item"><span class="dl-label">What to Know:</span><ul class="ammo-list">${ammo.map(a => `<li>${esc(a)}</li>`).join('')}</ul></li>`
    : '';
  return [readHtml, ammoHtml].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic sports card. Every sports section — The Lead and every subsection —
// uses the three-label text (What happened / Why it matters / What to bring up),
// grounded in sourced facts. The card STYLE is set by discovery's category:
//   individual → athlete action photo on top, text, then an optional
//                "Watch the moment →" highlight link (only if a real videoUrl).
//   team       → text first, then one optional game photo. No video, no spotlight.
// Text is always required: if there's no text we never ship an image-only card,
// and `facts` (always sourced) backs the "What happened" line so that can't happen.
// ─────────────────────────────────────────────────────────────────────────────
function buildSportsCard(s, isLead) {
  if (!s) return '';
  const cat = s.category === 'individual' ? 'individual' : 'team';
  const whatHappened  = s.whatHappened || s.facts || '';
  const whyItMatters  = s.whyItMatters || '';
  const whatToBringUp = s.whatToBringUp || '';
  if (!whatHappened && !whyItMatters && !whatToBringUp) return ''; // never image-only

  const imgHtml = s.imageUrl
    ? `    <div class="brief-img sport-card-img"><img src="${esc(s.imageUrl)}" alt="${esc(s.label || s.name)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"></div>`
    : '';
  const videoHtml = (cat === 'individual' && s.videoUrl)
    ? `    <a class="watch-moment" href="${esc(s.videoUrl)}" target="_blank" rel="noopener">Watch the moment →</a>`
    : '';
  const label = isLead ? 'The Lead' : (s.label || s.name);
  const id    = isLead ? 'the-lead' : slugId(s.label || s.name);

  const detail = `    <ul class="detail-list">
      ${whatHappened  ? `<li><span><span class="dl-label">What happened:</span> ${esc(whatHappened)}</span></li>`   : ''}
      ${whyItMatters  ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(whyItMatters)}</span></li>`   : ''}
${convoBlocks(s)}
      ${whatToBringUp ? `<li><span><span class="dl-label">What to bring up:</span> ${esc(whatToBringUp)}</span></li>` : ''}
    </ul>`;

  const body = cat === 'individual'
    ? `${imgHtml}
    <h3>${esc(s.headline || label)}</h3>
${detail}
${videoHtml}`
    : `    <h3>${esc(s.headline || label)}</h3>
${detail}
${imgHtml}`;

  return `  <section class="brief-section sport-card sport-${cat}${isLead ? ' sport-lead' : ''}" id="${esc(id)}">
    <div class="section-label sl-sports">${esc(label)}</div>
${body}
  </section>`;
}

// Sports umbrella body: dynamic discovery (preferred) → The Lead + subsections.
// Falls back to the structured renderers when discovery is empty (API down etc.)
// so the brief never loses its sports section.
function buildSportsBody(issue) {
  const dyn = Array.isArray(issue.dynamicSports) ? issue.dynamicSports : [];
  if (dyn.length) {
    return dyn.map((s, i) => buildSportsCard(s, i === 0)).filter(Boolean).join('\n');
  }
  // Fallback — legacy structured sections.
  const { nhl, f1, golf, worldCup } = issue;
  const hasNHL = !!(nhl && (nhl.final || nhl.next));
  return [
    buildLead(issue),
    hasNHL ? `<div class="sport-subsection">${buildNHL(issue)}</div>` : '',
    buildSports(issue),
    f1?.name ? `<div class="sport-subsection">${buildF1(issue)}</div>` : '',
    golf?.name ? `<div class="sport-subsection">${buildGolf(issue)}</div>` : '',
    worldCup?.length ? `<div class="sport-subsection">${buildWorldCup(issue)}</div>` : '',
  ].filter(Boolean).join('\n');
}

function buildHtml(issue, relatedIssues) {
  const { num, slug, date, title, deck, sports, markets, golf, f1, worldCup, nhl, upcoming, gameMetas, trending, copy } = issue;
  const label = `#${String(num).padStart(3, '0')}`;
  const prevSlug = num > 1 ? `issue-${String(num - 1).padStart(3, '0')}` : null;
  const nextSlug = `issue-${String(num + 1).padStart(3, '0')}`;
  const prevLabel = prevSlug ? `#${String(num - 1).padStart(3, '0')}` : null;

  const hasF1  = f1?.name != null;
  const hasWC  = worldCup?.length > 0;
  const hasGolf = golf?.name != null;
  const hasNHL = !!(nhl && (nhl.final || nhl.next));

  // Right-rail scroll-spy nav — three top-level anchors (Sports / Markets /
  // Culture) plus Sharp Take, with the sports subsections nested + indented under
  // Sports. The subsections are generated dynamically from what discovery returned
  // today (The Lead, then each discovered sport); they are NOT a fixed flat list.
  const dynNav = Array.isArray(issue.dynamicSports) ? issue.dynamicSports : [];
  const sportsSubs = dynNav.length
    ? dynNav.map((s, i) => i === 0 ? ['the-lead', 'The Lead', true] : [slugId(s.label || s.name), s.label || s.name, true])
    : [
        ['the-lead', 'The Lead', true],
        hasNHL  ? ['nhl', 'NHL', true] : null,
        hasF1   ? ['f1', 'F1', true] : null,
        hasGolf ? ['golf', 'Golf', true] : null,
        hasWC   ? ['worldcup', 'World Cup', true] : null,
      ].filter(Boolean);
  // Nested accordion: three clickable top-level parents (Sports / Markets /
  // Culture); the Sports subsections (The Lead + each discovered sport) nest and
  // indent under Sports and expand/collapse. Clicking a parent caret toggles its
  // children; clicking a parent/child label jumps to that section. Top + Sharp
  // Take stay as plain top-level links.
  const navLink = (id, label, cls = '') =>
    `<a href="#${id}" class="bsn-link${cls ? ' ' + cls : ''}" data-target="${esc(id)}"><span class="bsn-txt">${esc(label)}</span><span class="bsn-dot"></span></a>`;

  const navGroup = (id, label, children, openByDefault) => {
    if (!children.length) return navLink(id, label, 'bsn-parent'); // parent with no subsections = plain link
    return `  <div class="bsn-group${openByDefault ? ' open' : ''}" data-group="${esc(id)}">
    <a href="#${id}" class="bsn-link bsn-parent" data-target="${esc(id)}"><span class="bsn-caret" role="button" tabindex="0" aria-label="Toggle ${esc(label)} subsections">▸</span><span class="bsn-txt">${esc(label)}</span><span class="bsn-dot"></span></a>
    <div class="bsn-children">
${children.map(([cid, clabel]) => '      ' + navLink(cid, clabel, 'bsn-sub')).join('\n')}
    </div>
  </div>`;
  };

  const sideNavHtml = `<style>
  /* Accordion (Fix 7). The rail is right-aligned, so children are INSET from the
     right edge (margin-right) to read as a clean indent beneath the parent —
     not widened leftward. Consistent inset + smaller dots = clear hierarchy. */
  .brief-sidenav .bsn-group{display:flex;flex-direction:column;align-items:flex-end;}
  .brief-sidenav .bsn-children{display:flex;flex-direction:column;align-items:flex-end;gap:14px;max-height:0;margin-top:0;overflow:hidden;transition:max-height .28s ease,margin-top .28s ease;}
  .brief-sidenav .bsn-group.open .bsn-children{max-height:600px;margin-top:14px;}
  .brief-sidenav .bsn-caret{display:inline-block;width:1em;margin-right:2px;font-size:.78em;opacity:.65;transition:transform .2s ease;cursor:pointer;}
  .brief-sidenav .bsn-group.open .bsn-caret{transform:rotate(90deg);}
  .brief-sidenav .bsn-link{font-size:0.95em;}
  .brief-sidenav .bsn-parent .bsn-txt{font-weight:800;font-size:1em;letter-spacing:.01em;}
  .brief-sidenav .bsn-sub{margin-right:20px;font-size:0.82em;opacity:0.72;font-weight:500;}
  .brief-sidenav .bsn-sub .bsn-dot{width:5px;height:5px;opacity:.6;}
  /* Images (Fix 6): keep a clean landscape ratio, but bias the crop to the TOP
     so faces/players show instead of a jersey-number zoom. */
  .sport-card-img img{aspect-ratio:16/9;object-fit:cover;object-position:center 18%;background:var(--surface-2);}
  .brief-hero-banner--feature{background-position:center 20%;}
  /* Rundown bullets — clickable anchor navigation. */
  .rbd-bullet{display:flex;flex-direction:column;gap:4px;text-decoration:none;color:inherit;cursor:pointer;border-radius:8px;transition:opacity .15s ease,background .15s ease;-webkit-tap-highlight-color:transparent;}
  .rbd-bullet:hover,.rbd-bullet:focus-visible{opacity:.85;background:rgba(255,255,255,.07);outline:none;}
  .rbd-bullet:hover .rbd-cat{text-decoration:underline;text-underline-offset:2px;}
</style>
<nav class="brief-sidenav" aria-label="On this page">
  ${navLink('top', 'Top')}
${navGroup('sports', 'Sports', sportsSubs.map(([id, label]) => [id, label]), false)}
${navGroup('markets', 'Markets', [], false)}
${navGroup('culture', 'Culture', [], false)}
  ${navLink('sharp-take', 'Sharp Take')}
</nav>`;

  // Hero-area sub-jump chips — the discovered sports (skipping The Lead, which is
  // already the headline act). Empty when there are no subsections.
  const subjumpHtml = sportsSubs.length > 1
    ? `
    <nav class="section-subjump" aria-label="Jump to sports subsection" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;padding-left:14px;font-size:0.85em;opacity:0.8;">${sportsSubs.slice(1).map(([id, label]) => `\n      <a href="#${id}" class="sj-link sj-sub">${esc(label)}</a>`).join('')}
    </nav>`
    : '';

  // Designed hero banner for the top event: a self-hosted sport photo darkened
  // behind the team logos (ESPN CDN) + event + venue. Self-hosted bg can't 404,
  // and even with no photo the dark banner still renders — never a broken icon.
  const heroPick = pickHeroGame(sports, upcoming);
  const heroGame = heroPick?.game || null;
  const heroUpcoming = !!heroPick?.upcoming;
  const heroSport = (heroGame?.sport || 'nba').toLowerCase();
  const heroKey = ({ nba: 'nba', nhl: 'nhl', mlb: 'mlb', f1: 'f1', golf: 'golf' })[heroSport] || 'default';
  const heroV = heroGame ? venueImage(heroGame.home.abbrev, heroSport) : null;
  const heroVenueTxt = heroV ? heroV.cap.split(' · ').slice(0, 2).join(' · ') : '';
  // For an upcoming marquee event, tip-time framing; otherwise the matchup note.
  const heroTipTime = (heroUpcoming && heroGame?.date)
    ? (() => { try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(heroGame.date)) + ' ET'; } catch { return ''; } })()
    : '';
  const heroBase = heroGame ? (heroGame.note || heroGame.shortName || (heroUpcoming ? 'Tonight in sports' : 'Today in sports')) : '';
  const heroEyebrow = heroUpcoming && heroBase
    ? `${heroBase}${heroTipTime ? ` · Tonight ${heroTipTime}` : ' · Tonight'}`
    : heroBase;
  const hAway = heroGame ? espnLogo(heroGame.away.abbrev, heroSport) : null;
  const hHome = heroGame ? espnLogo(heroGame.home.abbrev, heroSport) : null;
  const ho = issue.heroOverride;
  const heroImgHtml = ho
    ? `<div class="brief-hero-banner brief-hero-banner--feature" style="background-image:url('${esc(ho.image)}')">
  <div class="bhb-inner">
    ${ho.eyebrow ? `<div class="bhb-eyebrow">${esc(ho.eyebrow)}</div>` : ''}
    ${ho.title ? `<div class="bhb-feature-title">${esc(ho.title)}</div>` : ''}
    ${ho.sub ? `<div class="bhb-venue">${esc(ho.sub)}</div>` : ''}
  </div>
</div>`
    : heroGame
    ? `<div class="brief-hero-banner" style="background-image:url('/assets/hero/${heroKey}.jpg')">
  <div class="bhb-inner">
    ${heroEyebrow ? `<div class="bhb-eyebrow">${esc(heroEyebrow)}</div>` : ''}
    <div class="bhb-teams">
      ${hAway ? `<img class="bhb-logo" src="${esc(hAway)}" alt="" loading="eager" onerror="this.style.display='none'">` : ''}
      <span class="bhb-vs">${esc(heroGame.away.abbrev)}<span class="bhb-at"> @ </span>${esc(heroGame.home.abbrev)}</span>
      ${hHome ? `<img class="bhb-logo" src="${esc(hHome)}" alt="" loading="eager" onerror="this.style.display='none'">` : ''}
    </div>
    ${heroVenueTxt ? `<div class="bhb-venue"><span class="where-pin">◍</span>${esc(heroVenueTxt)}</div>` : ''}
  </div>
</div>`
    : '';

  const seoTitle = buildSeoTitle(issue);
  const seoDesc  = buildSeoDesc(issue);

  // Word-of-mouth share links (the growth wedge: "don't be the last guy to know")
  const shareUrl  = `https://www.guytalkmedia.com/brief/${slug}/`;
  const shareText = `${title} — the daily GuyTalk brief`;
  const xShare    = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
  const smsShare  = `sms:?&body=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
  const mailShare = `mailto:?subject=${encodeURIComponent('You should read this')}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(seoTitle)}</title>
<meta name="description" content="${esc(seoDesc)}">
<link rel="icon" href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="GuyTalk">
<link rel="apple-touch-icon" href="/assets/logo/guytalk-icon-192.png">
<meta property="og:type"        content="article">
<meta property="og:url"         content="https://www.guytalkmedia.com/brief/${slug}/">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(seoDesc)}">
<meta property="og:image"       content="https://www.guytalkmedia.com/assets/og-cards/${slug}.png">
<meta property="og:site_name"   content="GuyTalk">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@guytalkmedia">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(seoDesc)}">
<meta name="twitter:image"       content="https://www.guytalkmedia.com/assets/og-cards/${slug}.png">
<link rel="canonical"            href="https://www.guytalkmedia.com/brief/${slug}/">
${prevSlug ? `<link rel="prev" href="https://www.guytalkmedia.com/brief/${prevSlug}/">` : ''}
<link rel="next" href="https://www.guytalkmedia.com/brief/${nextSlug}/">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":${JSON.stringify(title)},"description":${JSON.stringify(seoDesc)},"url":"https://www.guytalkmedia.com/brief/${slug}/","image":"https://www.guytalkmedia.com/assets/og-cards/${slug}.png","publisher":{"@type":"Organization","name":"GuyTalk","logo":{"@type":"ImageObject","url":"https://www.guytalkmedia.com/assets/logo/guytalk-icon.svg"}},"author":{"@type":"Person","name":"Jake Williams"},"datePublished":"${isoDate(date)}"}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/brief.css">
<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init me ws ys ps bs capture je Di ks register register_once register_for_session unregister unregister_for_session Ps getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Es $s createPersonProfile Is opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing Ss debug xs getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('phc_t9vvXWz7JWBsWkHmmNXCb2KMF79puQomJnJvREWKQbq8',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'});
</script>
</head>
<body>

<div class="reading-progress" id="readingProgress"></div>

<nav class="brief-nav">
  <div class="brief-nav-inner">
    <a href="/" class="brief-wordmark">GuyTalk<span class="dot">.</span></a>
    <div class="brief-nav-right">
      <a href="/live/" class="brief-nav-live"><span class="blc-dot"></span>Live</a>
      <span class="brief-nav-issue">The Brief · ${label}</span>
      <a href="/#signup" class="brief-cta">Subscribe free →</a>
    </div>
  </div>
</nav>

<div class="brief-hero-area">
  <div class="brief-hero-inner">
    <div class="brief-hero-num">${label}</div>
    <div class="brief-pretitle">
      <span class="brief-pretitle-dot"></span>
      ${esc(date)}
    </div>
    <h1 class="brief-title">${esc(title)}</h1>
    <p class="brief-deck">${esc(deck)}</p>
    <div class="brief-meta">
      <span>5 MIN READ</span>
      <span class="sep">·</span>
      <span>ISSUE ${label}</span>
      <span class="sep">·</span>
      <span>SPORTS · MARKETS · CULTURE</span>
    </div>
    <nav class="section-jump" aria-label="Jump to section">
      <a href="#sports" class="sj-link">Sports</a>
      <a href="#markets" class="sj-link">Markets</a>
      <a href="#culture" class="sj-link">Culture</a>
    </nav>${subjumpHtml}
  </div>
</div>

${sideNavHtml}

<article class="brief-article" id="briefArticle">
<span id="top"></span>

${heroImgHtml}

${buildRundown(issue)}

<div class="umbrella-head" id="sports"><span class="umbrella-kicker">The Rundown</span><h2 class="umbrella-title">Sports</h2></div>

${buildSportsBody(issue)}

<a href="/live/" class="brief-live-cta">
  <span class="blc-dot"></span>
  <div class="blc-inner">
    <div class="blc-label">Happening Now</div>
    <p class="blc-text">Scores, markets, and standings are moving as you read. Follow live updates on GuyTalk Live.</p>
  </div>
  <span class="blc-btn">Open GuyTalk Live →</span>
</a>

<div class="brief-inline-cta">
  <div class="bic-inner">
    <div class="bic-label">Free · Daily · 5 Minutes</div>
    <p class="bic-text">Get GuyTalk in your inbox every morning — before you check anything else.</p>
  </div>
  <a href="/#signup" class="bic-btn">Subscribe free →</a>
</div>

<div class="umbrella-head"><h2 class="umbrella-title">Markets</h2></div>

${buildMarkets(issue)}

<div class="umbrella-head"><h2 class="umbrella-title">Culture</h2></div>

${buildCulture(issue)}

${buildRec(issue)}

<div class="umbrella-head" id="sharp-take"><h2 class="umbrella-title">Sharp Take</h2></div>

${buildTheTake(issue)}

${buildFinalSharpTake(issue)}

</article>

<div class="brief-share-bar">
  <span class="share-label">Share this issue</span>
  <div class="share-buttons">
    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`GuyTalk ${label}: ${title}`)}&url=${encodeURIComponent(`https://www.guytalkmedia.com/brief/${slug}/`)}" target="_blank" rel="noopener" class="share-btn share-x">Post on X →</a>
    <button class="share-btn share-copy" onclick="(function(b){navigator.clipboard.writeText('https://www.guytalkmedia.com/brief/${slug}/').then(function(){b.textContent='Copied!';setTimeout(function(){b.textContent='Copy link'},2000)});})(this)">Copy link</button>
  </div>
</div>

${buildMoreIssues(relatedIssues)}

<div class="brief-subscribe-block">
  <div class="bsb-label">Free · Daily · 5 Minutes</div>
  <div class="bsb-headline">Get it in your inbox every morning.</div>
  <p class="bsb-sub">Sports, markets, golf, and culture — before 8am.</p>
  <form class="bsb-form" onsubmit="handleBriefSignup(event, this)">
    <input type="email" name="email" placeholder="Your email address" required class="bsb-input" autocomplete="email">
    <button type="submit" class="bsb-btn">Subscribe Free →</button>
  </form>
  <div class="bsb-success" id="briefSubSuccess">You're in. See you tomorrow morning.</div>
  <p class="bsb-hint">Free forever · No spam · Unsubscribe anytime</p>
</div>

<footer class="brief-footer">
  <div class="footer-share">
    <p class="footer-share-line">Know a guy who's always the last to know?</p>
    <div class="footer-share-btns">
      <a href="${smsShare}" class="share-btn">Text it</a>
      <a href="${mailShare}" class="share-btn">Forward</a>
      <a href="${xShare}" class="share-btn" target="_blank" rel="noopener">Post on X</a>
    </div>
  </div>
  <a href="/briefs/" class="footer-cta">Browse all issues →</a>
  <p class="footer-meta">
    You're reading GuyTalk — the daily brief on sports, markets, and culture.<br>
    Five minutes a day. Free forever. No algorithm.
  </p>
  <p class="footer-sig">— Jake, GuyTalk</p>
  <div class="footer-nav">
    <a href="/">Home</a>
    <a href="/briefs/">All Issues</a>
    ${prevSlug ? `<a href="/brief/${prevSlug}/">← Issue ${prevLabel}</a>` : ''}
    <a href="/terms/">Terms</a>
    <a href="mailto:guytalkdaily@gmail.com">Reply to Jake</a>
  </div>
  <p class="footer-fine">
    Sports data via ESPN and Jolpica/Ergast. Market data via Finnhub.io; informational only, not investment advice.
    GuyTalk is an independent publication and is not affiliated with or endorsed by ESPN, the NBA, MLB, NHL, NFL, Formula 1, the PGA Tour, or any league or team. Team names, logos, and trademarks are the property of their respective owners.
  </p>
</footer>

<script>
window.handleBriefSignup = function(e, form) {
  e.preventDefault();
  var input = form.querySelector('input[type="email"]');
  var email = input.value.trim();
  if (!email) return;
  var btn = form.querySelector('button, [type="submit"]');
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Signing up…'; }
  // Create the subscription server-side (reliable) — only confirm on success.
  fetch('/api/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email })
  })
  .then(function(r) { return r.json().catch(function(){ return { ok: r.ok }; }); })
  .then(function(data) {
    if (!data || !data.ok) throw new Error((data && data.error) || 'Signup failed');
    if (window.posthog) {
      posthog.identify(email, { email: email });
      posthog.capture('email_signup', { email: email, source: 'brief_footer' });
    }
    form.style.display = 'none';
    document.getElementById('briefSubSuccess').style.display = 'block';
  })
  .catch(function(err) {
    if (btn) { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
    if (input) { input.setCustomValidity((err && err.message) || 'Please try again.'); input.reportValidity(); setTimeout(function(){ input.setCustomValidity(''); }, 50); }
  });
};

(function() {
  var bar = document.getElementById('readingProgress');
  var article = document.getElementById('briefArticle');
  if (!bar || !article) return;
  var fired80 = false, fired100 = false;
  function update() {
    var rect = article.getBoundingClientRect();
    var total = article.offsetHeight - window.innerHeight;
    var pct = total > 0 ? Math.min(100, Math.max(0, (-rect.top / total) * 100)) : 0;
    bar.style.width = pct + '%';
    if (!fired80 && pct >= 80) {
      fired80 = true;
      if (window.posthog) posthog.capture('brief_read', { issue: '${slug}', depth: '80pct' });
    }
    if (!fired100 && pct >= 99) {
      fired100 = true;
      if (window.posthog) posthog.capture('brief_read', { issue: '${slug}', depth: '100pct' });
    }
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();

// Right-rail scroll-spy — highlight the section you're currently in.
(function () {
  var links = [].slice.call(document.querySelectorAll('.bsn-link'));
  if (!links.length) return;
  var ids = links.map(function (l) { return l.getAttribute('data-target'); });
  function onScroll() {
    var probe = window.scrollY + window.innerHeight * 0.33;
    var current = ids[0];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top + window.scrollY <= probe) current = id;
    });
    links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('data-target') === current); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
})();

// Sidebar accordion — the caret toggles a parent's subsections open/closed
// without jumping; the parent/child labels still jump to their section.
(function () {
  var carets = [].slice.call(document.querySelectorAll('.brief-sidenav .bsn-caret'));
  carets.forEach(function (caret) {
    function toggle(e) {
      e.preventDefault();
      e.stopPropagation();
      var group = caret.closest('.bsn-group');
      if (group) group.classList.toggle('open');
    }
    caret.addEventListener('click', toggle);
    caret.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') toggle(e);
    });
  });
})();
</script>

</body>
</html>`;
  // Apply entity hyperlinks — wrap first mention of known entities (teams, venues, orgs)
  return linkifyEntities(page);
}

// ─────────────────────────────────────────────────────────────────────────────
// Office Take — one portable sentence for the morning
// ─────────────────────────────────────────────────────────────────────────────
function buildOfficeTake({ copy }) {
  const ot = copy?.officeTake;
  if (!ot) return '';
  return `  <div class="angle-box office-take-callout">
    <span class="angle-label">Office Take</span>
    <p class="angle-text">${esc(ot)}</p>
  </div>`;
}

// The Take — two clearly-labelled opinions up top: a measured Office Take to
// sound informed, and a spicy Bar Argument to start a fight. Both grounded.
function buildTheTake({ copy }) {
  const t = copy?.theTake;
  const office = t && typeof t === 'object' ? String(t.office || '').trim() : '';
  const bar    = t && typeof t === 'object' ? String(t.bar    || '').trim() : '';
  if (!office && !bar) return '';
  const card = (cls, label, hint, text) => text ? `
      <div class="take-card ${cls}">
        <span class="take-label">${label}</span>
        <p class="take-text">${esc(text)}</p>
        <span class="take-hint">${hint}</span>
      </div>` : '';
  return `  <section class="brief-section take-section" id="the-take">
    <div class="section-label sl-take">The Take</div>
    <div class="take-grid">${card('take-office', 'Office Take', 'Drop this at work.', office)}${card('take-bar', 'Bar Argument', 'Start a fight with this one.', bar)}</div>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TL;DR
// ─────────────────────────────────────────────────────────────────────────────
function buildTldrItems({ sports, markets, golf, f1, worldCup, upcoming, copy }) {
  const items = [];

  (sports || []).slice(0, 2).forEach(g => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const note = g.note ? g.note.replace(/^NBA\s+/i, '') : g.shortName;
    items.push({
      tag: 'Sports', anchor: '#sports',
      html: `${esc(note)}: <strong>${esc(w.team)} ${esc(w.score)}</strong>, ${esc(l.team)} ${esc(l.score)}.${g.seriesNote ? ` ${esc(g.seriesNote)}.` : ''}`,
    });
  });

  const sportsCount = items.filter(i => i.tag === 'Sports').length;
  if (sportsCount === 0) {
    items.push({ tag: 'Sports', anchor: '#sports', html: 'No games last night — check the schedule.' });
    items.push({ tag: 'Sports', anchor: '#sports', html: 'Weekend recap inside.' });
  } else if (sportsCount === 1) {
    items.push({ tag: 'Sports', anchor: '#sports', html: 'More scores inside.' });
  }

  if (markets?.SPY?.dayChangePct !== null && markets?.SPY?.dayChangePct !== undefined) {
    const spy = markets.SPY;
    const dir = spy.dayChangePct >= 0 ? 'up' : 'down';
    items.push({
      tag: 'Markets', anchor: '#markets',
      html: `${tickerLink('SPY')} ${dir} ${fmtPct(spy.dayChangePct)} on the day.`,
    });
  } else {
    items.push({ tag: 'Markets', anchor: '#markets', html: 'Markets data unavailable.' });
  }

  const golfLive = golf?.statusState === 'in' || golf?.statusState === 'post';
  if (golf && golfLive && golf.leaders?.[0]) {
    const l = golf.leaders[0];
    const golfVerb = golf.statusState === 'post' ? 'wins' : 'leads';
    items.push({
      tag: 'Sports', anchor: '#sports',
      html: `${playerLink(l.name)} ${golfVerb} ${esc(golf.name)} at ${esc(l.score)} (${esc(golf.status || 'Final')}).`,
    });
  } else if (golf && !golfLive) {
    items.push({ tag: 'Sports', anchor: '#sports', html: `${esc(capFirst(golf.name))} tees off this week.` });
  }

  // F1 bullet
  if (f1?.results?.length && f1.statusState === 'post') {
    items.push({
      tag: 'F1', anchor: '#f1',
      html: `${esc(f1.results[0]?.driver)} wins ${esc(f1.shortName || f1.name)}.`,
    });
  } else if (f1?.name) {
    const f1Headline = copy?.f1Detail?.headline;
    items.push({
      tag: 'F1', anchor: '#f1',
      html: f1Headline ? esc(f1Headline) : `${esc(f1.shortName || f1.name)} — this weekend.`,
    });
  }

  // World Cup bullet
  if (worldCup?.length) {
    const active = worldCup.find(m => m.statusState === 'in' || m.statusState === 'post');
    if (active) {
      items.push({
        tag: 'World Cup', anchor: '#worldcup',
        html: `${esc(active.away.team)} vs ${esc(active.home.team)}: <strong>${esc(active.away.score)}–${esc(active.home.score)}</strong>.`,
      });
    } else {
      items.push({ tag: 'World Cup', anchor: '#worldcup', html: 'FIFA World Cup 2026 opens June 11 — USA hosts.' });
    }
  }

  // Upcoming NBA bullet (Finals preview)
  if (upcoming?.length && items.filter(i => i.tag === 'Sports').length === 0) {
    const g = upcoming[0];
    const when = g.daysAhead === 0 ? 'tonight' : g.daysAhead === 1 ? 'tomorrow' : 'in 2 days';
    items.push({
      tag: 'Sports', anchor: '#sports',
      html: `${esc(g.note || g.shortName)} tips off ${when}${g.daysAhead <= 1 ? ' — Game 1' : ''}.`,
    });
  }

  const cultureBullet = copy?.culture?.[0]?.head
    ? esc(copy.culture[0].head)
    : 'Culture picks inside.';
  items.push({ tag: 'Culture', anchor: '#culture', html: cultureBullet });

  return items;
}

function buildTldr(issue) {
  const items = buildTldrItems(issue);
  const { tagClass } = _tldrHelpers();
  return `  <div class="tldr">
    <div class="tldr-label">TL;DR — Five things to know</div>
    <ul class="tldr-list">
${items.slice(0, 5).map(item => `      <li class="tldr-item">
        <a href="${item.anchor}" class="tag-link"><span class="tag ${tagClass[item.tag] || 'tag-amber'}">${item.tag}</span></a>
        <span>${item.html}</span>
      </li>`).join('\n')}
    </ul>
  </div>`;
}

function buildTodayAtAGlance(issue) {
  const items = buildTldrItems(issue);
  const { tagClass } = _tldrHelpers();
  return `  <div class="tldr tldr-bottom">
    <div class="tldr-label">Today at a Glance</div>
    <ul class="tldr-list">
${items.map(item => `      <li class="tldr-item">
        <a href="${item.anchor}" class="tag-link"><span class="tag ${tagClass[item.tag] || 'tag-amber'}">${item.tag}</span></a>
        <span>${item.html}</span>
      </li>`).join('\n')}
    </ul>
  </div>`;
}

function _tldrHelpers() {
  return {
    tagClass: { 'Sports': 'tag-amber', 'Markets': 'tag-blue', 'F1': 'tag-green', 'World Cup': 'tag-green', 'Culture': 'tag-amber' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sports
// ─────────────────────────────────────────────────────────────────────────────
function buildSports({ sports, copy, golf, num, gameMetas, upcoming }) {
  const golfBlock = buildGolfBlock({ golf, copy });
  const product = PRODUCTS[num % PRODUCTS.length];
  const productCard = `
    <h3>The gear pick.</h3>
    <div class="product-card">
      <div class="product-img">
        ${product.imageUrl
          ? `<img src="${esc(product.imageUrl)}" alt="${esc(product.name)}" loading="lazy">`
          : `<div class="product-img-ph">${esc(product.brand)}</div>`}
      </div>
      <div class="product-info">
        <div class="product-brand">${esc(product.brand)}</div>
        <div class="product-name">${esc(product.name)}</div>
        <p class="product-desc">${product.desc}</p>
        <span class="product-price">${esc(product.price)}</span>
        <a href="${esc(product.url)}" target="_blank" rel="noopener" class="product-link">${esc(product.cta)} →</a>
      </div>
    </div>`;

  // Upcoming game preview card (e.g., NBA Finals Game 1 tomorrow)
  const upcomingCard = upcoming?.length
    ? buildUpcomingGameCard(upcoming[0])
    : '';

  if (!sports?.length) {
    return `  <section class="brief-section" id="sports">
    <div class="section-label sl-sports">Sports</div>
    <h3>No games last night.</h3>
    ${renderParas(copy?.sportsAngle, '')}
${upcomingCard}
${golfBlock}
${productCard}
  </section>`;
  }

  const gameBlocks = sports.map((g, i) => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const homeLoser = !g.home.winner;
    const awayLoser = !g.away.winner;
    const metaText = g.note ? `${g.note} · ${g.status}` : g.status;
    const sport = g.sport?.toLowerCase() || 'nba';

    // Team logos from ESPN CDN
    const homeLogo = espnLogo(g.home.abbrev, sport);
    const awayLogo = espnLogo(g.away.abbrev, sport);

    const scoreboard = `    <div class="scoreboard">
      <div class="score-side">
        ${homeLogo ? `<img src="${esc(homeLogo)}" class="score-logo${homeLoser ? ' loser' : ''}" alt="${esc(g.home.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="score-team${homeLoser ? ' loser' : ''}">${esc(g.home.team)}</div>
        <div class="score-num${homeLoser ? ' loser' : ''}">${esc(g.home.score)}</div>
      </div>
      <div class="score-center">
        <div class="score-meta">${esc(metaText)}</div>
        <div class="score-badge">${esc(w.abbrev || w.team.split(' ').pop())} Win</div>
      </div>
      <div class="score-side right">
        <div class="score-team${awayLoser ? ' loser' : ''}">${esc(g.away.team)}</div>
        <div class="score-num${awayLoser ? ' loser' : ''}">${esc(g.away.score)}</div>
        ${awayLogo ? `<img src="${esc(awayLogo)}" class="score-logo${awayLoser ? ' loser' : ''}" alt="${esc(g.away.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
      </div>
    </div>`;

    // Highlights links (inline in How to watch bullet, not a card)
    const meta = gameMetas?.[g.id];
    const recapUrl = meta?.recapUrl || espnRecapUrl(g.id, sport);
    const ytQuery = encodeURIComponent(`${g.away.team} vs ${g.home.team} highlights`);
    const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

    if (i === 0) {
      const d = copy?.sportsDetail || {};
      const keyNumber       = d.keyNumber       || `${w.score}–${l.score}: ${w.team} take the win.`;
      const seriesSituation = d.seriesSituation || (g.seriesNote ? g.seriesNote : '');
      const howToWatch      = d.howToWatch      || 'Check ESPN for the next game schedule.';
      const groupChat       = d.groupChatAngle  || '';
      const barArgument     = d.barArgument     || '';
      // First sentence only from sportsAngle
      const firstSentence   = (copy?.sportsAngle || `${w.team} win.`).replace(/\n/g, ' ').split(/(?<=[.!?])\s+/)[0] || '';

      return `
    <h3>${esc(g.note || g.name)}</h3>

${scoreboard}

    <p>${esc(firstSentence)}</p>

    <ul class="detail-list">
      <li><span><span class="dl-label">Key number:</span> ${esc(keyNumber)}</span></li>
      ${seriesSituation ? `<li><span><span class="dl-label">What it means:</span> ${esc(seriesSituation)}</span></li>` : ''}
      ${groupChat ? `<li><span><span class="dl-label">Group chat:</span> ${esc(groupChat)}</span></li>` : ''}
      ${barArgument ? `<li><span><span class="dl-label">Bar argument:</span> ${esc(barArgument)}</span></li>` : ''}
      <li><span><span class="dl-label">How to watch:</span> ${esc(howToWatch)} · <a href="${esc(recapUrl)}" target="_blank" rel="noopener">ESPN recap</a> · <a href="${esc(ytUrl)}" target="_blank" rel="noopener">Highlights</a></span></li>
    </ul>`;
    }

    const extraNote = copy?.sportsAdditional?.[i - 1] || `${w.team} win, ${w.score}–${l.score}.`;
    const extraSentence = extraNote.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/)[0] || extraNote;
    return `
    <h3>${esc(g.note || g.name)}</h3>

${scoreboard}

    <p>${esc(extraSentence)}</p>`;
  });

  return `  <section class="brief-section" id="sports">
    <div class="section-label sl-sports">Sports</div>
${gameBlocks.join('\n')}
${upcomingCard}
${golfBlock}
${productCard}
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upcoming game preview card
// ─────────────────────────────────────────────────────────────────────────────
// Format an ISO event start time to US Eastern, e.g. "8:00 PM ET". Returns
// 'Time TBD' when ESPN hasn't set a real tip-off (placeholder midnight-UTC).
function fmtGameTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return /^12:00 AM/.test(t) ? 'Time TBD' : `${t} ET`;
}

function buildUpcomingGameCard(game, preview) {
  if (!game) return '';
  const when = game.daysAhead === 0 ? 'Tonight' : game.daysAhead === 1 ? 'Tomorrow' : 'In 2 days';
  const startTime = fmtGameTime(game.date);
  const whenWithTime = startTime ? `${when} · ${startTime}` : when;
  const pv = preview || {};
  const previewDetail = (pv.whyItMatters || pv.watchFor || pv.whatToSay)
    ? `    <ul class="detail-list">
      ${pv.whyItMatters ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(pv.whyItMatters)}</span></li>` : ''}
      ${pv.watchFor     ? `<li><span><span class="dl-label">Watch for:</span> ${esc(pv.watchFor)}</span></li>` : ''}
      ${pv.whatToSay    ? `<li><span><span class="dl-label">What to say:</span> ${esc(pv.whatToSay)}</span></li>` : ''}
    </ul>`
    : '';
  const sport = game.sport?.toLowerCase() || 'nba';
  const homeLogo = espnLogo(game.home.abbrev, sport);
  const awayLogo = espnLogo(game.away.abbrev, sport);
  const scheduleUrl = `https://www.espn.com/${sport}/game/_/gameId/${game.id}`;
  const isFinals = /finals/i.test(game.note || game.shortName || '');

  // Show arena image for NBA Finals preview
  const arenaVenue = isFinals ? venueImage(game.home.abbrev, sport) : null;
  const arenaHtml = arenaVenue
    ? `<div class="brief-img upcoming-arena-img"><img src="${esc(arenaVenue.url)}" alt="${esc(arenaVenue.alt)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(arenaVenue.cap)}</div></div>`
    : '';

  const h3Label = isFinals
    ? `${esc(game.away.team)} vs. ${esc(game.home.team)} — ${esc(game.note || game.shortName)}. ${when}${startTime ? `, ${startTime}` : ''}.`
    : `${esc(game.away.team)} at ${esc(game.home.team)} — ${when}${startTime ? `, ${startTime}` : ''}.`;

  return `
    <h3>${h3Label}</h3>
    <div class="upcoming-card${isFinals ? ' upcoming-finals' : ''}">
      <div class="upcoming-label">${esc(whenWithTime)} — ${esc(game.note || game.shortName)}</div>
      <div class="upcoming-matchup">
        <div class="upcoming-team">
          ${awayLogo ? `<img src="${esc(awayLogo)}" class="upcoming-logo" alt="${esc(game.away.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <span>${esc(game.away.team)}</span>
        </div>
        <div class="upcoming-vs">${isFinals ? 'NBA<br>FINALS' : 'VS'}</div>
        <div class="upcoming-team upcoming-home">
          <span>${esc(game.home.team)}</span>
          ${homeLogo ? `<img src="${esc(homeLogo)}" class="upcoming-logo" alt="${esc(game.home.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      ${startTime ? `<div class="upcoming-time">Tip-off ${esc(startTime)} · ${esc(when)}</div>` : ''}
      ${game.seriesNote ? `<div class="upcoming-series">${esc(game.seriesNote)}</div>` : ''}
      <a href="${esc(scheduleUrl)}" target="_blank" rel="noopener" class="upcoming-link">Game info on ESPN →</a>
    </div>
${previewDetail}
    ${arenaHtml}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markets
// ─────────────────────────────────────────────────────────────────────────────
function buildMarkets({ markets, copy, date }) {
  const md = copy?.marketsDetail || {};
  const mktTitle = markets?.__meta?.tableTitle || 'Daily Close';
  const mktSub   = markets?.__meta?.tableSub   || date;

  const headline      = md.headline       || 'Markets wrap.';
  const openingPara   = copy?.marketsTake  || 'Market data below.';
  const secondPara    = md.secondPara     || 'Watch for key economic data next week.';
  const stockSpot     = md.stockSpotlight || md.tradeToWatch || '';
  const watchNext     = md.watchNextWeek  || 'Monitor upcoming Fed commentary and economic releases.';
  const bringUpRaw    = md.bringUp || (markets?.SPY?.price ? `SPY closed at ${fmtPrice('SPY', markets.SPY.price)}.` : '');
  const bringUp       = bringUpRaw;

  const rows = BRIEF_ROWS.map(row => {
    if (row.type === 'divider') return '        <div class="mkt-div"></div>';

    const sym = row.key;
    const cfg = TICKERS[sym];
    const q   = markets?.[sym];

    const price  = q?.price       ? fmtPrice(sym, q.price)       : '—';
    const dayPct = q?.dayChangePct !== undefined ? fmtPct(q.dayChangePct) : '—';
    const dayDir = q?.dayChangePct !== undefined ? (q.dayChangePct >= 0 ? 'up' : 'dn') : '';
    const wkPct  = q?.weekChangePct !== null && q?.weekChangePct !== undefined
      ? fmtPct(q.weekChangePct) : '—';
    const wkDir  = q?.weekChangePct !== null && q?.weekChangePct !== undefined
      ? (q.weekChangePct >= 0 ? 'up' : 'dn') : '';

    const nameHtml = cfg?.ms
      ? `<a href="https://www.morningstar.com/${cfg.ms}" class="ticker">${esc(cfg.display)}</a>`
      : esc(cfg?.display || sym);

    return `        <div class="mkt-row">
          <div class="m-name">${nameHtml}</div>
          <div class="m-val">${esc(price)}</div>
          <div class="m-day">${dayDir ? `<span class="pct-badge ${dayDir}">${esc(dayPct)}</span>` : '—'}</div>
          <div class="m-wk ${wkDir}">${esc(wkPct)}</div>
        </div>`;
  }).join('\n');

  return `  <section class="brief-section" id="markets">
    <div class="section-label sl-markets">Markets</div>

    <h3>${esc(headline)}</h3>

    ${renderParas(openingPara, 'Market data below.')}

    <div class="mkt-table">
      <div class="mkt-table-hd">
        <div class="mkt-table-title">${esc(mktTitle)}</div>
        <div class="mkt-table-sub">${esc(mktSub)}</div>
      </div>
      <div class="mkt-table-body">
        <div class="mkt-cols">
          <div class="th">Asset</div>
          <div class="th">Price</div>
          <div class="th">Day</div>
          <div class="th">Week</div>
        </div>
${rows}
      </div>
    </div>

    <ul class="detail-list">
      ${stockSpot ? `<li><span><span class="dl-label">Stock spotlight:</span>${esc(stockSpot)}</span></li>` : ''}
      <li><span><span class="dl-label">Watch next week:</span>${esc(watchNext)}</span></li>
      ${bringUp ? `<li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>` : ''}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Golf block — embedded inside Sports section (no separate section wrapper)
// ─────────────────────────────────────────────────────────────────────────────
function buildGolfBlock({ golf, copy }) {
  if (!golf) return '';

  const gd = copy?.golfDetail || {};
  const golfInProgress = golf?.statusState === 'in' || golf?.statusState === 'post';
  const hasLeaders = golf?.leaders?.length > 0;

  if (golf && golfInProgress && hasLeaders) {
    const top5 = golf.leaders.slice(0, 5);
    const leader = top5[0];
    const leaderLineHtml = top5.map(p =>
      `${playerLink(p.name)} ${esc(p.score)} (${esc(p.pos)})`
    ).join(', ');

    const isFinished  = golf.statusState === 'post';
    const golfNameDisplay = capFirst(golf.name);
    const aiNote      = copy?.golfNote      || (isFinished ? `${esc(leader.name)} wins ${esc(golfNameDisplay)} at ${esc(leader.score)}.` : `${esc(leader.name)} holds the lead at ${esc(leader.score)}.`);
    const whyMatters  = gd.whyItMatters     || `${esc(golfNameDisplay)} carries full FedEx Cup points.`;
    const bringUp     = gd.bringUp          || `${esc(leader.name)} ${isFinished ? 'won' : 'leads'} at ${esc(leader.score)}.`;
    const groupChat   = gd.groupChatAngle   || `${isFinished ? `${esc(leader.name)} took it.` : `Watch ${esc(leader.name)} this weekend.`}`;
    const heading     = isFinished
      ? `${esc(golfNameDisplay)}: ${playerLink(leader.name)} wins at ${esc(leader.score)}.`
      : `${esc(golfNameDisplay)}: ${playerLink(leader.name)} leads at ${esc(leader.score)}.`;
    const thirdDetail = isFinished
      ? `<li><span><span class="dl-label">How it happened:</span>${esc(gd.recap || `${esc(leader.name)} closed out ${esc(golf.name)} in the final round.`)}</span></li>`
      : `<li><span><span class="dl-label">TV schedule:</span>${esc(gd.tvSchedule || 'Golf Channel/Peacock · NBC/CBS. Check local listings.')}</span></li>`;

    // Course image — delegate to golfCourseImage() so venue is always current
    const golfImgObj = golfCourseImage(golf.name);
    const golfImg = golfImgObj
      ? `<div class="brief-img"><img src="${esc(golfImgObj.url)}" alt="${esc(golfImgObj.cap)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(golfImgObj.cap)}</div></div>`
      : '';

    return `
    <h3 id="golf">${heading}</h3>

    ${golfImg}

    <p>${esc(aiNote)}</p>

    <ul class="detail-list">
      <li><span><span class="dl-label">Leaderboard (${esc(golf.status || 'Final')}):</span>${leaderLineHtml}.</span></li>
      <li><span><span class="dl-label">Why it matters:</span>${esc(whyMatters)}</span></li>
      ${thirdDetail}
      <li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>
    </ul>

    <div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>`;

  } else if (golf && !golfInProgress) {
    const golfNameDisplay = capFirst(golf.name);
    const whyMatters = gd.whyItMatters || `${esc(golfNameDisplay)} is the featured PGA Tour event this week.`;
    const bringUp = gd.bringUp || 'Watch for the early rounds to set the weekend field.';
    const groupChat = gd.groupChatAngle || '';
    return `
    <h3 id="golf">${esc(golfNameDisplay)} — tees off this week.</h3>
    <p>${whyMatters} ${bringUp}</p>
    ${groupChat ? `<div class="angle-box">
      <span class="angle-label">Group Chat Angle</span>
      <p class="angle-text">${esc(groupChat)}</p>
    </div>` : ''}`;
  }

  return '';
}

// Detect culture item category from head/source text
function detectCultureTag(head, source, index) {
  const h = (head + ' ' + source).toLowerCase();
  if (index === 2 || /watch this/.test(h)) return 'Streaming';
  if (/netflix|hbo|hulu|peacock|amazon prime|apple tv|max\b|disney\+|paramount\+|theaters|at theaters|film|movie/.test(h)) return 'Streaming';
  if (/album|tour|song|music|rap|hip.hop|pop star|billboard|grammy|spotify|concert|single|debut/.test(h)) return 'Music';
  if (/trade|contract|sign|deal|salary|sports business|league|franchise|broadcast rights/.test(h)) return 'Sports Biz';
  if (/marry|married|wedding|engaged|divorce|couple|relationship|dating|celebrity/.test(h)) return 'Celebrity';
  if (/\btv\b|television|reality show|love island|bachelor|survivor|episode|season|sitcom|reality/.test(h)) return 'TV';
  if (/series|show|streaming|pilot|cancelled|renewed/.test(h)) return 'TV';
  if (/tech|ai\b|app\b|startup|launch|iphone|android|software|hardware/.test(h)) return 'Tech';
  if (/podcast|book|author|bestseller/.test(h)) return 'Media';
  return 'Culture';
}

// ─────────────────────────────────────────────────────────────────────────────
// Culture
// ─────────────────────────────────────────────────────────────────────────────
function buildCulture({ copy }) {
  const items = copy?.culture;

  if (!items?.length || !Array.isArray(items)) {
    return `  <section class="brief-section" id="culture">
    <div class="section-label sl-culture">Culture</div>
    <p>Culture picks are being updated — check back shortly.</p>
  </section>`;
  }

  const itemsHtml = items.slice(0, 3).map((item, i) => {
    const tag = item.tag || detectCultureTag(item.head || '', item.source || '', i);
    const tagClass = `ctag-${tag.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
    return `
      <li class="culture-item">
        <div>
          <div class="culture-item-top">
            <span class="culture-tag ${tagClass}">${esc(tag)}</span>
          </div>
          <div class="culture-head">${esc(item.head || '')}</div>
          <span class="culture-source">${esc(item.source || '')}</span>
          <p class="culture-body">${esc(item.body || '')}</p>
        </div>
      </li>`;
  }).join('');

  return `  <section class="brief-section" id="culture">
    <div class="section-label sl-culture">The Scene</div>
    <ul class="culture-list">
${itemsHtml}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The Rec — rotates by issue number
// ─────────────────────────────────────────────────────────────────────────────
function buildRec({ num }) {
  const rec = RECS[(num + 3) % RECS.length];

  const recImg = rec.imageUrl
    ? `<div class="rec-img"><img src="${esc(rec.imageUrl)}" alt="${esc(rec.brand || rec.title)}" loading="lazy" onerror="this.closest('.rec-img').classList.add('rec-img-failed');this.remove()"><span class="rec-img-ph">${esc(rec.brand || '')}</span></div>`
    : (rec.brand ? `<div class="rec-img rec-img-failed"><span class="rec-img-ph">${esc(rec.brand)}</span></div>` : '');

  return `  <section class="brief-section" id="the-rec">
    <div class="section-label sl-markets">The Rec</div>

    <div class="brief-rec${recImg ? ' brief-rec--media' : ''}">
      ${recImg}
      <div class="rec-content">
        <div class="rec-label">This week's pick</div>
        <div class="rec-title">${esc(rec.title)}</div>
        <p class="rec-body">${esc(rec.body)}</p>
        <a href="${esc(rec.url)}" target="_blank" rel="noopener" class="rec-link">${esc(rec.cta)}</a>
      </div>
    </div>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sharp Take
// ─────────────────────────────────────────────────────────────────────────────
function buildSharpTake({ copy }) {
  const st = copy?.sharpTake;
  let parasHtml = `    <p>The week had its moments. Check back tomorrow.</p>`;
  let bulletsHtml = '';

  if (st && typeof st === 'object') {
    const paras = [st.p1, st.p2].filter(Boolean).map(p => `    <p>${esc(p)}</p>`).join('\n');
    parasHtml = paras || parasHtml;
    if (Array.isArray(st.bullets) && st.bullets.length) {
      bulletsHtml = `
    <ul class="sharp-bullets">
${st.bullets.map(b => `      <li>${esc(b)}</li>`).join('\n')}
    </ul>`;
    }
  } else if (typeof st === 'string' && st) {
    parasHtml = st
      .replace(/^#+\s.*$/gm, '').replace(/^---+$/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1').replace(/^- /gm, '')
      .trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
      .map(p => `    <p>${esc(p)}</p>`).join('\n');
  }

  return `  <div class="sharp-take">
    <div class="sharp-take-label">The Sharp Take</div>
${parasHtml}${bulletsHtml}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers worth stealing
// ─────────────────────────────────────────────────────────────────────────────
function buildNumbers({ sports, markets, golf, upcoming, copy }) {
  const ctxArr = copy?.numbersContext;
  const items = [];

  if (sports?.length) {
    const g = sports[0];
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const note = g.note || g.shortName;
    const rawCtx = ctxArr?.[0]?.context || `${note} final score.`;
    items.push({
      num: `${w.score}–${l.score}`,
      html: `<strong>${esc(note)}.</strong> ${esc(rawCtx.replace(/&amp;/g, '&'))}`,
    });
  }

  if (markets?.SPY?.dayChangePct !== undefined && markets.SPY.dayChangePct !== null) {
    const pct = markets.SPY.dayChangePct;
    const dir = pct >= 0 ? 'gain' : 'drop';
    const rawCtx = ctxArr?.[1]?.context || `S&P 500 closed ${dir === 'gain' ? 'higher' : 'lower'} on the day.`;
    items.push({
      num: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      html: `<strong>S&amp;P 500 ${dir} today.</strong> ${esc(rawCtx.replace(/&amp;/g, '&'))}`,
    });
  }

  if (golf?.leaders?.[0]) {
    const l = golf.leaders[0];
    const isFinished = golf.statusState === 'post';
    const rawCtx = ctxArr?.[2]?.context || `${l.name} ${isFinished ? 'won' : 'leads'} ${golf.name}.`;
    items.push({
      num: l.score,
      html: `<strong>${esc(l.name)}, ${esc(golf.name)}.</strong> ${esc(rawCtx.replace(/&amp;/g, '&'))}`,
    });
  }

  while (items.length < 3) {
    if (upcoming?.length && items.length === 2) {
      const g = upcoming[0];
      const when = g.daysAhead === 0 ? 'tonight' : g.daysAhead === 1 ? 'tomorrow' : 'this week';
      const ctx = copy?.numbersContext?.[2]?.context || `${esc(g.note || g.shortName)} is the most-anticipated game on the calendar right now.`;
      items.push({ num: 'G1', html: `<strong>${esc(g.note || g.shortName)} — ${when}.</strong> ${ctx}` });
    } else {
      items.push({ num: '—', html: '<strong>Check today&#39;s full issue for more.</strong>' });
    }
  }

  return `  <div class="brief-section">
    <div class="section-label">Numbers worth stealing</div>
    <ul class="numbers-list">
${items.slice(0, 3).map(item => `      <li class="numbers-item">
        <div class="n-num">${esc(item.num)}</div>
        <div>${item.html}</div>
      </li>`).join('\n')}
    </ul>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// F1 Section
// ─────────────────────────────────────────────────────────────────────────────
function buildF1Block({ f1, copy }) {
  if (!f1?.name) return '';

  const fd = copy?.f1Detail || {};
  const isFinished = f1.statusState === 'post';
  const isScheduled = f1.statusState === 'pre';

  if (isScheduled || !f1.results?.length) {
    const preHeadline = fd.headline || `${esc(f1.shortName || f1.name)} — this weekend.`;
    const preAngle = fd.angle || `The ${esc(f1.name)} takes place ${esc(f1.venue ? `at ${f1.venue}` : 'this weekend')}. One of the marquee events on the F1 calendar — race day is Sunday.`;
    const preBringUp = fd.bringUp || '';
    const preChamp = fd.championship || '';
    const prePick = fd.pick || '';
    const circuitImg = f1CircuitImage(f1.name);
    const circuitImgHtml = circuitImg
      ? (circuitImg.urls.length > 1
          ? `    <div class="brief-img-gallery">
      <div class="brief-img-gallery-grid">
        ${circuitImg.urls.map((u, i) => `<div class="brief-img"><img src="${esc(u)}" alt="${esc(circuitImg.cap)} ${i + 1}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"></div>`).join('\n        ')}
      </div>
      <div class="brief-img-cap">${esc(circuitImg.cap)}</div>
    </div>`
          : `    <div class="brief-img"><img src="${esc(circuitImg.urls[0])}" alt="${esc(circuitImg.cap)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(circuitImg.cap)}</div></div>`)
      : '';
    return `  <section class="brief-section" id="f1">
    <div class="section-label sl-sports">Formula 1</div>
${circuitImgHtml}
    <h3>${esc(preHeadline)}</h3>
    ${renderParas(preAngle, '')}
    <ul class="detail-list">
      <li><span><span class="dl-label">Race:</span>${esc(f1.name)}${f1.venue ? ` · ${esc(f1.venue)}` : ''} · Sunday</span></li>
      <li><span><span class="dl-label">Watch:</span>ESPN / ABC · Race day coverage begins ~9am ET</span></li>
      ${prePick ? `<li><span><span class="dl-label">Driver to watch:</span>${esc(prePick)}</span></li>` : ''}
      ${preBringUp ? `<li><span><span class="dl-label">What to bring up:</span>${esc(preBringUp)}</span></li>` : ''}
      ${preChamp ? `<li><span><span class="dl-label">Championship:</span>${esc(preChamp)}</span></li>` : ''}
    </ul>
  </section>`;
  }

  const winner = f1.results[0];
  const heading = isFinished
    ? `${esc(f1.shortName || f1.name)}: ${esc(winner.driver)} wins.`
    : `${esc(f1.shortName || f1.name)} — race weekend.`;

  const leaderboardHtml = f1.results.map(r =>
    `P${r.pos} ${playerLink(r.driver)} (${esc(r.team)})${r.time ? ` — ${esc(r.time)}` : ''}`
  ).join(', ');

  const angle = fd.angle || '';
  const bringUp = fd.bringUp || '';
  const champ = fd.championship || '';
  const pick = fd.pick || '';

  // Show circuit image for post-race coverage too
  const postCircuitImg = f1CircuitImage(f1.name);
  const postCircuitHtml = postCircuitImg
    ? `    <div class="brief-img"><img src="${esc(postCircuitImg.urls[0])}" alt="${esc(postCircuitImg.cap)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(postCircuitImg.cap)}</div></div>`
    : '';

  return `  <section class="brief-section" id="f1">
    <div class="section-label sl-sports">Formula 1</div>
${postCircuitHtml}
    <h3>${heading}</h3>
    ${renderParas(angle, '')}
    <ul class="detail-list">
      <li><span><span class="dl-label">Result:</span>${leaderboardHtml}.</span></li>
      ${pick ? `<li><span><span class="dl-label">Driver to watch:</span>${esc(pick)}</span></li>` : ''}
      ${bringUp ? `<li><span><span class="dl-label">What to bring up:</span>${esc(bringUp)}</span></li>` : ''}
      ${champ ? `<li><span><span class="dl-label">Championship:</span>${esc(champ)}</span></li>` : ''}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// World Cup Section
// ─────────────────────────────────────────────────────────────────────────────
function buildWorldCupBlock({ worldCup }) {
  if (!worldCup?.length) return '';

  const active = worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post');
  const upcoming = worldCup.filter(m => m.statusState === 'pre');

  if (!active.length && upcoming.length) {
    // Pre-tournament preview
    const next = upcoming[0];
    return `  <section class="brief-section" id="worldcup">
    <div class="section-label sl-culture">World Cup 2026</div>
    <div class="wc-preview-banner">
      <div class="wc-banner-hosts">
        <span class="wc-flag">🇺🇸</span>
        <span class="wc-flag">🇨🇦</span>
        <span class="wc-flag">🇲🇽</span>
      </div>
      <div class="wc-banner-title">FIFA World Cup 2026</div>
      <div class="wc-banner-sub">June 11 — July 19 · USA / Canada / Mexico</div>
      <div class="wc-banner-stats">
        <div class="wc-stat"><span class="wc-stat-num">48</span><span class="wc-stat-lbl">Teams</span></div>
        <div class="wc-stat"><span class="wc-stat-num">104</span><span class="wc-stat-lbl">Matches</span></div>
        <div class="wc-stat"><span class="wc-stat-num">16</span><span class="wc-stat-lbl">Venues</span></div>
        <div class="wc-stat"><span class="wc-stat-num">9</span><span class="wc-stat-lbl">Days Away</span></div>
      </div>
    </div>
    <h3>The World Cup opens June 11.</h3>
    <p>48 teams. 104 matches. USA, Canada, and Mexico host the first expanded World Cup. The opening match: ${esc(next.away.team)} vs ${esc(next.home.team)}. USA plays June 12 at SoFi Stadium against Paraguay. This is the biggest sporting event on the planet and it's happening in your backyard.</p>
    <ul class="detail-list">
      <li><span><span class="dl-label">First match:</span>${esc(next.away.team)} vs ${esc(next.home.team)} — ${esc(next.status || 'June 11')}</span></li>
      <li><span><span class="dl-label">USA opener:</span>USA vs Paraguay, June 12 · SoFi Stadium, Los Angeles · 9pm ET · Fox</span></li>
      <li><span><span class="dl-label">To watch:</span>48 teams, group stage runs through July 2. Final is July 19 at MetLife Stadium.</span></li>
    </ul>
  </section>`;
  }

  const matchRows = active.slice(0, 4).map(m => {
    const scoreOrStatus = m.statusState === 'post'
      ? `${esc(m.away.score)}–${esc(m.home.score)} Final`
      : esc(m.status || 'In Progress');
    return `<li><span>${esc(m.away.team)} vs ${esc(m.home.team)} — <strong>${scoreOrStatus}</strong></span></li>`;
  }).join('\n      ');

  return `  <section class="brief-section" id="worldcup">
    <div class="section-label sl-culture">World Cup 2026</div>
    <h3>Group stage underway.</h3>
    <ul class="detail-list">
      ${matchRows}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP MODULE — TODAY'S HITS + KEY TAKEAWAY
// ─────────────────────────────────────────────────────────────────────────────
function buildTopModule({ copy, golf, f1, worldCup, markets, sports, upcoming }) {
  const hits = copy?.todaysHits;
  const keyTakeaway = copy?.keyTakeaway;

  const hasF1   = !!f1?.name;
  const hasGolf = !!golf?.name;
  const hasWC   = !!worldCup?.length;

  // Today's Hits = three umbrellas only: Sports, Markets, Culture. Specific
  // sports (golf/F1/NHL/WC) live in their own sections, not here.
  const hitItems = [
    hits?.markets  ? { tag: 'Markets', anchor: '#markets', text: hits.markets, cls: 'hit-markets' } : null,
    hits?.sports   ? { tag: 'Sports',  anchor: '#sports',  text: hits.sports,  cls: 'hit-sports'  } : null,
    hits?.culture  ? { tag: 'Culture', anchor: '#culture', text: hits.culture, cls: 'hit-culture' } : null,
  ].filter(Boolean);

  if (!hitItems.length && !keyTakeaway) return '';

  const hitsHtml = hitItems.length ? `
  <div class="hits-list">
${hitItems.map(h => `    <a href="${h.anchor}" class="hit-item ${h.cls}">
      <span class="hit-tag">${esc(h.tag)}</span>
      <span class="hit-text">${esc(h.text)}</span>
    </a>`).join('\n')}
  </div>` : '';

  const takeawayHtml = keyTakeaway ? `
  <div class="key-takeaway">
    <div class="kt-label">Key Takeaway</div>
    <p class="kt-text">${esc(keyTakeaway)}</p>
  </div>` : '';

  return `  <div class="top-module">
    <div class="top-module-label">Today's Hits</div>${hitsHtml}${takeawayHtml}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE LEAD
// ─────────────────────────────────────────────────────────────────────────────
function buildLead({ sports, upcoming, copy }) {
  const lead = copy?.lead;

  // A championship game tonight/tomorrow leads the brief — never a regular-season
  // result. The MLB scores move down to "More Sports".
  const champ = (upcoming || []).find(u => /final|finals|championship|stanley cup|elimination/i.test(`${u.note || ''} ${u.shortName || ''} ${u.name || ''}`));
  if (champ) {
    return `  <section class="brief-section" id="the-lead">
    <div class="section-label sl-sports">The Lead</div>
${buildUpcomingGameCard(champ, copy?.upcomingPreview)}
  </section>`;
  }

  // AI tells us which game index is the lead story — default to 0
  const gameIdx = (lead?.gameIndex >= 0 && lead?.gameIndex < (sports?.length || 0))
    ? lead.gameIndex : 0;
  const leadGame = sports?.[gameIdx];

  // Scoreboard for the lead game only
  let scoreboardHtml = '';
  if (leadGame) {
    const w = leadGame.home.winner ? leadGame.home : leadGame.away;
    const l = leadGame.home.winner ? leadGame.away : leadGame.home;
    const sport = leadGame.sport?.toLowerCase() || 'nba';
    const homeLogo = espnLogo(leadGame.home.abbrev, sport);
    const awayLogo = espnLogo(leadGame.away.abbrev, sport);
    const homeLoser = !leadGame.home.winner;
    const awayLoser = !leadGame.away.winner;
    const metaText = leadGame.note ? `${leadGame.note} · ${leadGame.status}` : leadGame.status;
    // Both sides identical (logo on top → team → score). Winner shown by the
    // center badge, not by dimming, so the two sides look the same.
    const sideHtml = (t, logo) => `      <div class="score-side">
        ${logo ? `<img src="${esc(logo)}" class="score-logo" alt="${esc(t.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="score-team">${esc(t.team)}</div>
        <div class="score-num">${esc(t.score)}</div>
      </div>`;
    scoreboardHtml = `
    <div class="scoreboard">
${sideHtml(leadGame.home, homeLogo)}
      <div class="score-center">
        <div class="score-meta">${esc(metaText)}</div>
        <div class="score-badge">${esc(w.abbrev || w.team.split(' ').pop())} Win</div>
      </div>
${sideHtml(leadGame.away, awayLogo)}
    </div>`;
  }

  // Upcoming card if there are no results at all (no games played yet today)
  const upcomingCard = (!sports?.length && upcoming?.length) ? buildUpcomingGameCard(upcoming[0], copy?.upcomingPreview) : '';

  // Venue image + an explicit "where / who's home" line for the lead game
  let venueHtml = '';
  let whereHtml = '';
  if (leadGame) {
    const sport = leadGame.sport?.toLowerCase() || 'nba';
    const venue = venueImage(leadGame.home.abbrev, sport);
    if (venue) venueHtml = `    <div class="brief-img"><img src="${esc(venue.url)}" alt="${esc(venue.alt)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(venue.cap)}</div></div>`;
    const venueTxt = venue ? venue.cap.split(' · ').slice(0, 2).join(' · ') : '';
    const startTime = leadGame.statusState !== 'post' ? fmtGameTime(leadGame.date) : '';
    const bits = [venueTxt, `${leadGame.home.team} at home`, startTime].filter(Boolean);
    if (bits.length) whereHtml = `    <div class="where-line"><span class="where-pin">◍</span>${esc(bits.join('  ·  '))}</div>`;
  }

  const headline = lead?.headline || (leadGame
    ? (() => { const w = leadGame.home.winner ? leadGame.home : leadGame.away; const l = leadGame.home.winner ? leadGame.away : leadGame.home; return `${w.team} ${w.score}–${l.score} ${l.team}`; })()
    : 'Today in sports');

  const whatHappened = lead?.whatHappened || '';
  const whyBullet1   = lead?.whyBullet1  || '';
  const whyBullet2   = lead?.whyBullet2  || '';
  const whatToSay    = lead?.whatToSay   || '';

  return `  <section class="brief-section" id="the-lead">
    <div class="section-label sl-sports">The Lead</div>
    <h3>${esc(headline)}</h3>
${scoreboardHtml}
${whereHtml}
${venueHtml}
${upcomingCard}
${whatHappened ? `    <p>${esc(whatHappened)}</p>` : ''}
    <ul class="detail-list">
      ${whyBullet1 ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(whyBullet1)}</span></li>` : ''}
      ${whyBullet2 ? `<li><span><span class="dl-label">The other angle:</span> ${esc(whyBullet2)}</span></li>` : ''}
      ${whatToSay  ? `<li><span><span class="dl-label">What to say:</span> ${esc(whatToSay)}</span></li>`      : ''}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPORTS — other scores + Watch Next card
// ─────────────────────────────────────────────────────────────────────────────
function buildSports({ sports, copy, upcoming }) {
  // If a championship game is leading the brief, it's already shown up top — keep
  // every MLB result here in "More Sports" and don't repeat the watch-next card.
  const champ = (upcoming || []).find(u => /final|finals|championship|stanley cup|elimination/i.test(`${u.note || ''} ${u.shortName || ''} ${u.name || ''}`));
  const leadIdx = copy?.lead?.gameIndex ?? 0;
  const otherGames = champ ? (sports || []) : (sports || []).filter((_, i) => i !== leadIdx);

  // Watch Next card for upcoming playoff/finals game (suppressed when it's the lead)
  const watchNextCard = champ ? '' : (upcoming?.length ? buildUpcomingGameCard(upcoming[0], copy?.upcomingPreview) : '');

  if (!otherGames.length && !watchNextCard) return '';

  const scoreRows = otherGames.map((g, i) => {
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    const sport = g.sport?.toLowerCase() || 'nba';
    const homeLogo = espnLogo(g.home.abbrev, sport);
    const awayLogo = espnLogo(g.away.abbrev, sport);
    const homeLoser = !g.home.winner;
    const awayLoser = !g.away.winner;
    const metaText = g.note ? `${g.note} · ${g.status}` : g.status;

    // sportsOther is aligned 1:1 with `sports` by index; each entry is a
    // { take, why, say } object giving the game real conversational context.
    const ctx = copy?.sportsOther?.[sports.indexOf(g)];
    const take = (ctx && ctx.take) || deriveOtherTake(g, w, l);
    const why  = ctx && ctx.why;
    const say  = ctx && ctx.say;
    const ctxListHtml = (why || say)
      ? `      <ul class="detail-list">
        ${why ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(why)}</span></li>` : ''}
        ${say ? `<li><span><span class="dl-label">What to say:</span> ${esc(say)}</span></li>` : ''}
      </ul>`
      : '';

    // Venue image for the home team (only for notable ballparks/arenas)
    const venue = venueImage(g.home.abbrev, sport);
    const venueImgHtml = venue
      ? `      <div class="brief-img brief-img-sm"><img src="${esc(venue.url)}" alt="${esc(venue.alt)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(venue.cap)}</div></div>`
      : '';

    return `    <div class="other-score-card">
      <div class="scoreboard scoreboard-sm">
        <div class="score-side">
          ${homeLogo ? `<img src="${esc(homeLogo)}" class="score-logo${homeLoser ? ' loser' : ''}" alt="${esc(g.home.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="score-team${homeLoser ? ' loser' : ''}">${esc(g.home.team)}</div>
          <div class="score-num${homeLoser ? ' loser' : ''}">${esc(g.home.score)}</div>
        </div>
        <div class="score-center">
          <div class="score-meta">${esc(metaText)}</div>
          <div class="score-badge">${esc(w.abbrev || w.team.split(' ').pop())} Win</div>
        </div>
        <div class="score-side right">
          <div class="score-team${awayLoser ? ' loser' : ''}">${esc(g.away.team)}</div>
          <div class="score-num${awayLoser ? ' loser' : ''}">${esc(g.away.score)}</div>
          ${awayLogo ? `<img src="${esc(awayLogo)}" class="score-logo${awayLoser ? ' loser' : ''}" alt="${esc(g.away.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
${venueImgHtml}
      <p class="other-score-note">${esc(take)}</p>
${ctxListHtml}
    </div>`;
  }).join('\n');

  const scoresSection = otherGames.length
    ? `    <div class="other-scores-label">Other scores worth knowing</div>\n${scoreRows}`
    : '';

  return `  <section class="brief-section" id="sports-scores">
    <div class="section-label sl-sports">More Sports</div>
${scoresSection}
${watchNextCard}
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKETS — restructured
// ─────────────────────────────────────────────────────────────────────────────
// Tiny inline-SVG sparkline from a series of closes. Renders on web; email
// clients that strip SVG simply fall back to the price + % (still readable).
function sparklineSvg(closes, dir) {
  if (!Array.isArray(closes) || closes.length < 2) return '';
  const w = 88, h = 28, pad = 3;
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = (max - min) || 1;
  const pts = closes.map((c, i) => {
    const x = pad + (i / (closes.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (c - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const stroke = dir === 'dn' ? '#DC2626' : '#16A34A';
  return `<svg class="mt-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function buildMarkets({ markets, copy, date }) {
  if (!markets) return '';

  const mktTitle = markets?.__meta?.tableTitle || 'Daily Close';
  const mktSub   = markets?.__meta?.tableSub   || date;

  const md = copy?.markets || {};
  const mood       = md.mood       || '';
  const whyBullet1 = md.whyBullet1 || '';
  const whyBullet2 = md.whyBullet2 || '';
  const bringUp    = md.bringUp    || '';
  const headlines  = Array.isArray(md.headlines) ? md.headlines.filter(h => h && h.head) : [];
  const headlinesHtml = headlines.length ? `    <ul class="mkt-headlines">
${headlines.map(h => `      <li><span class="mkh-head">${esc(h.head)}</span>${h.sub ? `<span class="mkh-sub">${esc(h.sub)}</span>` : ''}</li>`).join('\n')}
    </ul>` : '';

  // ── Core index tiles — always present (S&P, Dow, Nasdaq, Russell 2000, 10Y) ──
  const coreList = (CORE_TICKERS && CORE_TICKERS.length) ? CORE_TICKERS : ['SPY', 'QQQ', '10Y'];
  const indexTiles = coreList.map(sym => {
    const cfg = TICKERS[sym];
    const q   = markets[sym];
    if (!cfg || !q) return '';
    // Prefer real index level over ETF price when Yahoo delivered it
    const hasIndex = q.indexPrice != null;
    const displayName = hasIndex ? (q.indexDisplay || cfg.indexDisplay || cfg.display || sym) : (cfg.display || sym);
    const price = hasIndex
      ? q.indexPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : (q.price !== undefined && q.price !== null ? fmtPrice(sym, q.price) : '—');
    // Prefer true index day% (from Yahoo ^GSPC/^IXIC etc.) over ETF dayChangePct.
    const pct    = q.indexDayChangePct ?? q.dayChangePct;
    const hasDay = pct !== null && pct !== undefined;
    const dayPct = hasDay ? fmtPct(pct) : '—';
    const dir    = hasDay ? (pct >= 0 ? 'up' : 'dn') : '';
    const spark  = sparklineSvg(q.spark, dir);
    return `        <div class="mkt-tile ${dir}">
          <div class="mt-name">${esc(displayName)}</div>
          <div class="mt-price">${esc(price)}</div>
          <div class="mt-foot"><span class="mt-chg ${dir}">${hasDay ? esc(dayPct) : '—'}</span>${spark}</div>
        </div>`;
  }).filter(Boolean).join('\n');

  // ── Individual stock trackers — true market-wide (FMP screeners) ────────
  const scr = markets.__screeners;
  const usd = (v) => (v == null || isNaN(v)) ? '' : `$${Number(v).toFixed(2)}`;
  const trkCol = (title, items, cls) => {
    if (!Array.isArray(items) || !items.length) return '';
    const rows = items.map(it => {
      const dir = it.changePct >= 0 ? 'up' : 'dn';
      return `          <div class="trk-row" title="${esc(it.name || it.symbol)}">
            <span class="trk-sym">${esc(it.symbol)}</span>
            <span class="trk-price">${esc(usd(it.price))}</span>
            <span class="pct-badge ${dir}">${esc(fmtPct(it.changePct))}</span>
          </div>`;
    }).join('\n');
    return `        <div class="trk-col ${cls}">
          <div class="trk-hd">${esc(title)}</div>
${rows}
        </div>`;
  };

  let trackersBlock = '';
  if (scr && (scr.gainers?.length || scr.losers?.length || scr.actives?.length)) {
    trackersBlock = `
      <div class="mkt-trackers">
${[trkCol('Top Gainers', scr.gainers, 'trk-up'), trkCol('Top Losers', scr.losers, 'trk-dn'), trkCol('Most Active', scr.actives, 'trk-active')].filter(Boolean).join('\n')}
      </div>`;
  } else {
    // Fallback: biggest movers from the curated watchlist (no FMP key yet).
    const movers = Array.isArray(markets.__dynamicMovers) ? markets.__dynamicMovers : [];
    const moverRows = movers.map(sym => {
      const cfg = TICKERS[sym]; const q = markets[sym];
      if (!cfg || !q) return '';
      const price  = q.price != null ? fmtPrice(sym, q.price) : '—';
      const hasDay = q.dayChangePct != null;
      const dir    = hasDay ? (q.dayChangePct >= 0 ? 'up' : 'dn') : '';
      const nameHtml = cfg.ms ? `<a href="https://www.morningstar.com/${cfg.ms}" class="ticker">${esc(cfg.display)}</a>` : esc(cfg.display || sym);
      return `          <div class="mover-row ${dir}"><div class="mv-name">${nameHtml}<span class="mv-full">${esc(cfg.name || '')}</span></div><div class="mv-price">${esc(price)}</div><div class="mv-chg"><span class="pct-badge ${dir}">${hasDay ? esc(fmtPct(q.dayChangePct)) : '—'}</span></div></div>`;
    }).filter(Boolean).join('\n');
    if (moverRows) trackersBlock = `
      <div class="mkt-movers">
        <div class="mkt-movers-hd">Today's Movers</div>
        <div class="mover-list">
${moverRows}
        </div>
      </div>`;
  }

  return `  <section class="brief-section" id="markets">
    <div class="section-label sl-markets">The Close</div>
${headlinesHtml}
    ${mood ? `<p class="markets-mood">${esc(mood)}</p>` : ''}

    <div class="mkt-card">
      <div class="mkt-card-hd">
        <div class="mkt-card-title">${esc(mktTitle)}</div>
        <div class="mkt-card-sub">${esc(mktSub)}</div>
      </div>
      <div class="mkt-index-grid">
${indexTiles}
      </div>${trackersBlock}
    </div>

    <ul class="detail-list">
      ${whyBullet1 ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(whyBullet1)}</span></li>` : ''}
      ${whyBullet2 ? `<li><span><span class="dl-label">Watch for:</span> ${esc(whyBullet2)}</span></li>` : ''}
      ${bringUp    ? `<li><span><span class="dl-label">What to bring up:</span> ${esc(bringUp)}</span></li>` : ''}
${convoBlocks(copy?.markets)}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Golf course image lookup by tournament name
// ─────────────────────────────────────────────────────────────────────────────
function golfCourseImage(tournamentName) {
  const name = (tournamentName || '').toLowerCase();
  const courses = {
    memorial:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Muirfield_Village_Golf_Club.jpg/1280px-Muirfield_Village_Golf_Club.jpg', cap: 'Muirfield Village Golf Club · Dublin, Ohio · Host of The Memorial Tournament' },
    masters:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Augusta_National_Golf_Club_Masters_2011.jpg/1280px-Augusta_National_Golf_Club_Masters_2011.jpg', cap: 'Augusta National Golf Club · Augusta, Georgia' },
    'us open':   { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Shinnecock_Hills_Golf_Club.jpg/1280px-Shinnecock_Hills_Golf_Club.jpg', cap: 'U.S. Open · Shinnecock Hills Golf Club · Southampton, New York' },
    'open championship': { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Royal_Birkdale_Golf_Club_18th_green.jpg/1280px-Royal_Birkdale_Golf_Club_18th_green.jpg', cap: 'The Open Championship · The Royal & Ancient' },
    'pga championship': { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Valhalla_Golf_Club.jpg/1280px-Valhalla_Golf_Club.jpg', cap: 'PGA Championship' },
    players:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/TPC_Sawgrass_17th_hole.jpg/1280px-TPC_Sawgrass_17th_hole.jpg', cap: 'TPC Sawgrass · Ponte Vedra Beach, Florida · The Players Championship' },
    pebble:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Pebble_Beach_Golf_Links.jpg/1280px-Pebble_Beach_Golf_Links.jpg', cap: 'Pebble Beach Golf Links · Pebble Beach, California' },
    torrey:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Torrey_Pines_Golf_Course_2007.jpg/1280px-Torrey_Pines_Golf_Course_2007.jpg', cap: 'Torrey Pines Golf Course · La Jolla, California' },
    riviera:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Riviera_Country_Club_2.jpg/1280px-Riviera_Country_Club_2.jpg', cap: 'Riviera Country Club · Pacific Palisades, California' },
    augusta:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Augusta_National_Golf_Club_Masters_2011.jpg/1280px-Augusta_National_Golf_Club_Masters_2011.jpg', cap: 'Augusta National Golf Club · Augusta, Georgia' },
    muirfield:   { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Muirfield_Village_Golf_Club.jpg/1280px-Muirfield_Village_Golf_Club.jpg', cap: 'Muirfield Village Golf Club · Dublin, Ohio' },
    schwab:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Colonial_Country_Club_golf_course.jpg/1280px-Colonial_Country_Club_golf_course.jpg', cap: 'Colonial Country Club · Fort Worth, Texas · Charles Schwab Challenge' },
    colonial:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Colonial_Country_Club_golf_course.jpg/1280px-Colonial_Country_Club_golf_course.jpg', cap: 'Colonial Country Club · Fort Worth, Texas' },
  };
  const match = Object.entries(courses).find(([key]) => name.includes(key));
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOLF — tight section
// ─────────────────────────────────────────────────────────────────────────────
function buildGolf({ golf, copy }) {
  if (!golf?.name) return '';
  const gd = copy?.golf || {};
  const started = golf.statusState === 'post' || golf.statusState === 'in';
  const headline  = gd.headline  || capFirst(golf.name);
  const whyCare1  = gd.whyCare1  || '';
  const whyCare2  = gd.whyCare2  || '';
  const defending = gd.defending || '';
  const watchFor  = gd.watchFor  || '';
  const whatToSay = gd.whatToSay || '';

  // Only show a "leaderboard" once play has actually started — pre-tournament
  // everyone is at even and it's just tee-time order.
  const leaderLine = (started && golf.leaders?.length)
    ? golf.leaders.slice(0, 3).map(l => `${playerLink(l.name)} ${esc(l.score)}`).join(', ')
    : '';

  const courseImg = golfCourseImage(golf.name);
  const courseImgHtml = courseImg
    ? `    <div class="brief-img"><img src="${esc(courseImg.url)}" alt="${esc(courseImg.cap)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(courseImg.cap)}</div></div>`
    : '';
  // Where + when, from real ESPN golf data (venue/location/date), not a guess.
  const fmtD = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }); } catch (_) { return ''; } };
  let golfWhen = '';
  if (golf.statusState === 'pre' && golf.date) {
    golfWhen = golf.endDate ? `${fmtD(golf.date)}–${fmtD(golf.endDate)}` : `Starts ${fmtD(golf.date)}`;
  } else if (golf.status) {
    golfWhen = golf.status;
  }
  // Venue from ESPN when present; else our curated course list (fixed-venue
  // majors); else just the dates — never a guessed course.
  // Venue: ESPN data → AI preview course → curated course image → dates only.
  const realVenue = golf.venue || gd.course || (courseImg ? courseImg.cap.split(' · ')[0] : '');
  const golfWhereTxt = [realVenue, golf.location, golfWhen].filter(Boolean).join('  ·  ');
  const golfWhereHtml = golfWhereTxt ? `    <div class="where-line"><span class="where-pin">◍</span>${esc(golfWhereTxt)}</div>` : '';

  return `  <section class="brief-section" id="golf">
    <div class="section-label sl-golf">Golf</div>
${courseImgHtml}
    <h3>${esc(headline)}</h3>
${golfWhereHtml}
    ${leaderLine ? `<p class="leaderboard-line">${leaderLine}</p>` : ''}
    <ul class="detail-list">
      ${whyCare1  ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(whyCare1)}</span></li>`  : ''}
      ${defending ? `<li><span><span class="dl-label">Last year:</span> ${esc(defending)}</span></li>`     : ''}
      ${whyCare2  ? `<li><span><span class="dl-label">The angle:</span> ${esc(whyCare2)}</span></li>`        : ''}
      ${watchFor  ? `<li><span><span class="dl-label">${started ? 'Watch for' : 'In the running'}:</span> ${esc(watchFor)}</span></li>` : ''}
${convoBlocks(copy?.golf)}
      ${whatToSay ? `<li><span><span class="dl-label">What to say:</span> ${esc(whatToSay)}</span></li>`          : ''}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// F1 — tight section
// ─────────────────────────────────────────────────────────────────────────────
function buildF1({ f1, copy }) {
  if (!f1?.name) return '';
  const fd = copy?.f1 || {};
  const headline  = fd.headline  || esc(f1.shortName || f1.name);
  const whyCare1  = fd.whyCare1  || '';
  const whyCare2  = fd.whyCare2  || '';
  const watchFor  = fd.watchFor  || '';
  const whatToSay = fd.whatToSay || '';

  const circuitImg = f1CircuitImage(f1.name);
  const f1ImgSrc = f1.imageUrl || (circuitImg && circuitImg.urls[0]);
  const f1ImgCap = f1.imageCap || (circuitImg && circuitImg.cap) || '';
  const imgHtml = f1ImgSrc
    ? `    <div class="brief-img"><img src="${esc(f1ImgSrc)}" alt="${esc(f1ImgCap)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(f1ImgCap)}</div></div>`
    : '';
  const circuitWhere = circuitImg ? circuitImg.cap.split(' · ').slice(0, 2).join(' · ') : (f1.name || '');
  const f1WhereHtml = circuitWhere ? `    <div class="where-line"><span class="where-pin">◍</span>${esc(circuitWhere)}</div>` : '';

  return `  <section class="brief-section" id="f1">
    <div class="section-label sl-sports">Formula 1</div>
${imgHtml}
    <h3>${esc(headline)}</h3>
${f1WhereHtml}
    <ul class="detail-list">
      ${whyCare1  ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(whyCare1)}</span></li>`  : ''}
      ${whyCare2  ? `<li><span><span class="dl-label">Championship:</span> ${esc(whyCare2)}</span></li>`   : ''}
      ${watchFor  ? `<li><span><span class="dl-label">Watch for:</span> ${esc(watchFor)}</span></li>`       : ''}
${convoBlocks(copy?.f1)}
      ${whatToSay ? `<li><span><span class="dl-label">What to say:</span> ${esc(whatToSay)}</span></li>`    : ''}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD CUP — tight section
// ─────────────────────────────────────────────────────────────────────────────
function buildWorldCup({ worldCup, copy }) {
  if (!worldCup?.length) return '';

  const active = worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post');
  const upcoming = worldCup.filter(m => m.statusState === 'pre');

  const matchRows = [...active, ...upcoming.slice(0, 2)].map(m => {
    if (m.statusState === 'post' || m.statusState === 'in') {
      return `      <li><span>${esc(m.away.team)} ${esc(m.away.score)}–${esc(m.home.score)} ${esc(m.home.team)} (${esc(m.statusState === 'post' ? 'Final' : 'Live')})</span></li>`;
    }
    return `      <li><span>${esc(m.away.team)} vs ${esc(m.home.team)} — upcoming</span></li>`;
  }).join('\n');

  // Countdown / day-of-tournament, computed from the issue date.
  const OPEN = Date.parse('2026-06-11T00:00:00-04:00');
  const FINAL = Date.parse('2026-07-19T00:00:00-04:00');
  const now = worldCup[0]?._issueDate ? Date.parse(worldCup[0]._issueDate) : Date.now();
  const dayMs = 86400000;
  let countStat;
  if (now < OPEN)       countStat = { num: Math.max(0, Math.ceil((OPEN - now) / dayMs)), lbl: 'Days Away' };
  else if (now <= FINAL) countStat = { num: `Day ${Math.max(1, Math.floor((now - OPEN) / dayMs) + 1)}`, lbl: 'Of the Cup' };
  else                  countStat = { num: 16, lbl: 'Venues' };

  const wc = copy?.worldCup || {};
  const dayLabel = String(countStat.num).startsWith('Day') ? String(countStat.num) : `${countStat.num} ${countStat.lbl}`;

  // Real event photo (like every other section), not a flat gradient card.
  const img = wc.image || 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Afici%C3%B3n_del_Estadio_azteca_final_2019.jpg/1280px-Afici%C3%B3n_del_Estadio_azteca_final_2019.jpg';
  const imgCap = wc.imageCap || 'Estadio Azteca · Mexico City · The World Cup opener';
  const imgHtml = `    <div class="brief-img"><img src="${esc(img)}" alt="${esc(imgCap)}" loading="lazy" onerror="this.closest('.brief-img').style.display='none'"><div class="brief-img-cap">${esc(imgCap)}</div></div>`;

  const headline = wc.headline || 'The World Cup is here.';
  const resultRows = active.map(m => `      <li><span><span class="dl-label">Result:</span> ${esc(m.away.team)} ${esc(m.away.score)}–${esc(m.home.score)} ${esc(m.home.team)} (Final)</span></li>`).join('\n');
  const upcomingRows = upcoming.slice(0, 2).map(m => `      <li><span>${esc(m.away.team)} vs ${esc(m.home.team)} — upcoming</span></li>`).join('\n');

  return `  <section class="brief-section" id="worldcup">
    <div class="section-label sl-culture">World Cup 2026</div>
${imgHtml}
    <h3>${esc(headline)}</h3>
    <div class="where-line"><span class="where-pin">◍</span>June 11 – July 19 · USA / Canada / Mexico · ${esc(dayLabel)}</div>
    <ul class="detail-list">
      ${wc.whatHappened ? `<li><span><span class="dl-label">What happened:</span> ${esc(wc.whatHappened)}</span></li>` : ''}
      ${wc.whyItMatters ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(wc.whyItMatters)}</span></li>` : ''}
      ${wc.whatToSay ? `<li><span><span class="dl-label">What to bring up:</span> ${esc(wc.whatToSay)}</span></li>` : ''}
      <li><span><span class="dl-label">Format:</span> 48 teams, 104 matches, 12 groups — the first expanded, three-country World Cup.</span></li>
${resultRows}
${upcomingRows}
      <li><span><span class="dl-label">USA opener:</span> USA vs Paraguay, June 12 · SoFi Stadium · 9pm ET · Fox</span></li>
      <li><span><span class="dl-label">Final:</span> July 19 · MetLife Stadium, New York</span></li>
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NHL — most recent final or next game, with venue + when
// ─────────────────────────────────────────────────────────────────────────────
function buildNHL({ nhl, copy }) {
  if (!nhl || (!nhl.final && !nhl.next)) return '';
  const isFinal = !!nhl.final;
  const g = nhl.final || nhl.next;
  const nd = copy?.nhl || {};
  const homeLogo = espnLogo(g.home.abbrev, 'nhl');
  const awayLogo = espnLogo(g.away.abbrev, 'nhl');
  const startTime = fmtGameTime(g.date);
  const whereTxt = [g.venue, g.venueCity].filter(Boolean).join(' · ');

  let body, headline;
  if (isFinal) {
    const w = g.home.winner ? g.home : g.away;
    const side = (t, logo) => `      <div class="score-side">${logo ? `<img src="${esc(logo)}" class="score-logo" alt="${esc(t.abbrev)}" loading="lazy" onerror="this.style.display='none'">` : ''}<div class="score-team">${esc(t.team)}</div><div class="score-num">${esc(t.score)}</div></div>`;
    body = `
    <div class="scoreboard">
${side(g.away, awayLogo)}
      <div class="score-center"><div class="score-meta">${esc(g.note || g.status)}</div><div class="score-badge">${esc(w.abbrev || w.team.split(' ').pop())} Win</div></div>
${side(g.home, homeLogo)}
    </div>`;
    headline = `${esc(w.team)} win${g.seriesNote ? ` — ${esc(g.seriesNote)}` : ''}.`;
  } else {
    body = `
    <div class="upcoming-card">
      <div class="upcoming-label">${startTime ? `${esc(startTime)} · ` : ''}${esc(g.note || g.shortName)}</div>
      <div class="upcoming-matchup">
        <div class="upcoming-team">${awayLogo ? `<img src="${esc(awayLogo)}" class="upcoming-logo" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span>${esc(g.away.team)}</span></div>
        <div class="upcoming-vs">VS</div>
        <div class="upcoming-team upcoming-home"><span>${esc(g.home.team)}</span>${homeLogo ? `<img src="${esc(homeLogo)}" class="upcoming-logo" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}</div>
      </div>
      ${startTime ? `<div class="upcoming-time">Puck drop ${esc(startTime)}</div>` : ''}
      ${g.seriesNote ? `<div class="upcoming-series">${esc(g.seriesNote)}</div>` : ''}
    </div>`;
    headline = `${esc(g.away.team)} at ${esc(g.home.team)}${startTime ? ` — ${esc(startTime)}` : ''}.`;
  }

  const h = nd.headline ? esc(nd.headline) : headline;
  const whenTxt = startTime ? `${isFinal ? 'Played' : 'Puck drop'} ${startTime}` : '';
  const detail = `    <ul class="detail-list">
      ${nd.whyCare1  ? `<li><span><span class="dl-label">Why it matters:</span> ${esc(nd.whyCare1)}</span></li>` : ''}
      ${nd.whyCare2  ? `<li><span><span class="dl-label">The series:</span> ${esc(nd.whyCare2)}</span></li>` : ''}
      ${nd.watchFor  ? `<li><span><span class="dl-label">Watch for:</span> ${esc(nd.watchFor)}</span></li>` : ''}
      ${nd.whatToSay ? `<li><span><span class="dl-label">What to say:</span> ${esc(nd.whatToSay)}</span></li>` : ''}
      ${whenTxt ? `<li><span><span class="dl-label">When:</span> ${esc(whenTxt)}</span></li>` : ''}
    </ul>`;

  return `  <section class="brief-section" id="nhl">
    <div class="section-label sl-sports">NHL</div>
    <h3>${h}</h3>
    ${whereTxt ? `<div class="where-line"><span class="where-pin">◍</span>${esc(whereTxt)}</div>` : ''}
${body}
${detail}
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CULTURE — 3 quick hits
// ─────────────────────────────────────────────────────────────────────────────
function buildCulture({ copy }) {
  const items = copy?.culture;
  if (!items?.length) return '';

  const tagCls = { Celebrity: 'ctag-celebrity', Music: 'ctag-music', 'Sports Biz': 'ctag-sports', TV: 'ctag-sports', Tech: 'ctag-sports', Culture: 'ctag-sports', Streaming: 'ctag-streaming' };

  const itemsHtml = items.map(item => {
    const tag  = item.tag || 'Culture';
    const head = item.topic || item.head || '';
    return `      <li class="culture-item">
        <div class="culture-content">
          <div class="culture-item-top">
            <span class="culture-tag ${tagCls[tag] || 'ctag-sports'}">${esc(tag)}</span>
          </div>
          <div class="culture-head">${esc(head)}</div>
          ${item.whatHappened ? `<p class="culture-line"><strong>What happened:</strong> ${esc(item.whatHappened)}</p>` : ''}
          ${item.whyItMatters ? `<p class="culture-line"><strong>Why it matters:</strong> ${esc(item.whyItMatters)}</p>` : ''}
          ${item.theRead      ? `<p class="culture-line"><strong>The GuyTalk Read:</strong> ${esc(item.theRead)}</p>`    : ''}
          ${Array.isArray(item.ammo) && item.ammo.filter(Boolean).length ? `<ul class="ammo-list">${item.ammo.filter(Boolean).map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          ${item.whatToSay    ? `<p class="culture-line"><strong>What to say:</strong> ${esc(item.whatToSay)}</p>`       : ''}
        </div>
      </li>`;
  }).join('\n');

  return `  <section class="brief-section" id="culture">
    <div class="section-label sl-culture">The Scene</div>
    <ul class="culture-list">
${itemsHtml}
    </ul>
  </section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL SHARP TAKE
// ─────────────────────────────────────────────────────────────────────────────
function buildFinalSharpTake({ copy }) {
  const text = copy?.finalSharpTake;
  if (!text) return '';
  return `  <div class="sharp-take">
    <div class="sharp-take-label">Final Sharp Take</div>
    <p>${esc(text)}</p>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TODAY AT A GLANCE — 5 specific bullets
// ─────────────────────────────────────────────────────────────────────────────
function buildTodayAtAGlance({ copy, sports, markets, upcoming }) {
  const g = copy?.glance;

  // Build from raw data if AI didn't return
  const sportsFallback = (() => {
    if (sports?.[0]) {
      const w = sports[0].home.winner ? sports[0].home : sports[0].away;
      const l = sports[0].home.winner ? sports[0].away : sports[0].home;
      return `${w.team} ${w.score}–${l.score} ${l.team}`;
    }
    if (upcoming?.[0]) return `${upcoming[0].shortName} — ${upcoming[0].daysAhead === 0 ? 'tonight' : 'tomorrow'}`;
    return 'Check scores on ESPN';
  })();

  const marketFallback = (() => {
    if (markets?.SPY?.dayChangePct !== undefined) {
      const d = markets.SPY.dayChangePct;
      return `SPY ${d >= 0 ? '+' : ''}${d.toFixed(1)}% — markets ${d >= 0 ? 'edged up' : 'pulled back'}`;
    }
    return 'Market data inside';
  })();

  // Fallbacks so the glance is always full even if the AI glance call misfires.
  const watchFallback = upcoming?.[0]
    ? `${upcoming[0].shortName}${upcoming[0].note ? ` (${upcoming[0].note})` : ''} — ${upcoming[0].daysAhead === 0 ? 'tonight' : upcoming[0].daysAhead === 1 ? 'tomorrow' : 'soon'}`
    : '';
  const convoFallback = copy?.theTake?.bar || copy?.theTake?.office || (copy?.culture?.[0]?.whatToSay || '');
  const recFallback = copy?.culture?.find(c => /stream|watch/i.test(c.tag || ''))?.topic
    ? `Watch this: ${copy.culture.find(c => /stream|watch/i.test(c.tag || '')).topic}` : '';

  const bullets = [
    { label: 'Main story',  text: g?.sports    || sportsFallback, anchor: '#sports',   cls: 'hit-sports'  },
    { label: 'Market mood', text: g?.market     || marketFallback, anchor: '#markets',  cls: 'hit-markets' },
    { label: 'Best convo',  text: g?.bestConvo  || convoFallback,  anchor: '#the-take', cls: 'hit-culture' },
    { label: 'Watch next',  text: g?.watchNext  || watchFallback,  anchor: '#sports',   cls: 'hit-sports'  },
    { label: 'Quick rec',   text: g?.quickRec   || recFallback,    anchor: '#culture',  cls: 'hit-culture' },
  ].filter(b => b.text);

  if (!bullets.length) return '';

  // Interactive, section-linked rows — mirrors Today's Hits to bookend the brief.
  return `  <div class="glance-card">
    <div class="glance-head"><span class="glance-dot"></span>Today at a Glance</div>
    <div class="glance-rows">
${bullets.map(b => `      <a class="glance-row ${b.cls}" href="${b.anchor}">
        <span class="glance-k">${esc(b.label)}</span>
        <span class="glance-v">${esc(b.text)}</span>
        <span class="glance-arr">→</span>
      </a>`).join('\n')}
    </div>
  </div>`;
}

module.exports = { buildHtml };

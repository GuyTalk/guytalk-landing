#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const { fetchNBA, fetchNBAUpcoming, fetchNBABoxScore, fetchNHL, fetchGameMeta, fetchMLB, fetchF1, fetchWorldCup, fetchMarkets, fetchMarketScreeners, fetchGolf, fetchTennis, fetchTrending } = require('./lib/fetchers');
const { generateCopy }                                      = require('./lib/copy');
const { editBrief }                                         = require('./lib/editor');
const { buildHtml }                                         = require('./lib/html');
const { buildArchive }                                      = require('./lib/archive');
const { fetchTopStories, fetchSectionStories, fetchDynamicSports } = require('./lib/research');
const { isExcluded, classifyTopic, scoreImportance }        = require('./lib/editorial-config');
const { STREAMING_PICKS }                                   = require('./lib/db');
const { GENERATION_WARNINGS, addWarning, resetWarnings, formatWarnings } = require('./lib/warnings');

const ROOT      = path.join(__dirname, '..');
const BRIEF_DIR = path.join(ROOT, 'brief');

// ─────────────────────────────────────────────────────────────────────────────
// Detect the next issue number from existing brief/issue-NNN directories
// ─────────────────────────────────────────────────────────────────────────────
function getNextIssueNum() {
  const dirs = fs.readdirSync(BRIEF_DIR)
    .filter(d => /^issue-\d{3}$/.test(d))
    .map(d => parseInt(d.replace('issue-', ''), 10));
  return dirs.length ? Math.max(...dirs) + 1 : 1;
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function pad(n, w = 3) { return String(n).padStart(w, '0'); }

function line(char = '─', len = 44) { return char.repeat(len); }

// ─────────────────────────────────────────────────────────────────────────────
// Load last N real issue JSON files for the repetition guard
// ─────────────────────────────────────────────────────────────────────────────
function loadPreviousBriefs(n = 3) {
  const dataDir = path.join(BRIEF_DIR, 'data');
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort()
    .slice(-n);
  return files.map(f => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      return {
        slug:                d.slug || f.replace('.json', ''),
        sportsThesis:   (d.copy?.lead?.whatHappened || d.copy?.lead?.headline || '').slice(0, 120),
        lead:           (d.copy?.lead?.headline || '').slice(0, 120),
        bringUp:        d.copy?.markets?.bringUp || '',
        marketsBringUp: d.copy?.markets?.bringUp || '',
        // What events we already covered — used to avoid re-reporting the same
        // completed race/tournament and to pivot forward to what's next.
        f1Event:    d.f1?.name || '',
        f1State:    d.f1?.statusState || '',
        golfEvent:  d.golf?.name || '',
        golfState:  d.golf?.statusState || '',
      };
    } catch (_) { return null; }
  }).filter(Boolean);
}

// Every image URL the previous issue used (hero + per-sport). Passed to research
// so today's image searches avoid them — we never publish a repeated image.
function loadPrevImageUrls() {
  const dataDir = path.join(BRIEF_DIR, 'data');
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(f => /^issue-\d{3}\.json$/.test(f)).sort();
  const last = files[files.length - 1];
  if (!last) return [];
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, last), 'utf8'));
    const urls = [];
    if (d.heroImage) urls.push(d.heroImage);
    (d.dynamicSports || []).forEach(s => { if (s.imageUrl) urls.push(s.imageUrl); });
    if (d.sectionStories?.heroImage?.url) urls.push(d.sectionStories.heroImage.url);
    return [...new Set(urls.filter(Boolean))];
  } catch (_) { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Regen mode — re-render all existing issues from saved JSON (new templates)
// Usage: node scripts/generate-brief.js --regen [--copy]
// --copy also regenerates the AI prose (slower, uses API credits)
// ─────────────────────────────────────────────────────────────────────────────
async function regenAll() {
  const regenCopy = process.argv.includes('--copy');
  const dataDir   = path.join(__dirname, '..', 'brief', 'data');
  if (!fs.existsSync(dataDir)) {
    console.log('No brief/data/ directory found. Nothing to regen.');
    return;
  }
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f.startsWith('issue-'));
  if (!files.length) {
    console.log('No saved issue JSON files found.');
    return;
  }
  console.log(`\n${'═'.repeat(44)}`);
  console.log(`  GuyTalk Brief Regenerator${regenCopy ? ' · WITH AI COPY' : ' · HTML only'}`);
  console.log(`  ${files.length} issue(s) found`);
  console.log(`${'═'.repeat(44)}\n`);

  // Pre-load all issues sorted by num (for related-issues links)
  const allIssuesSorted = files.sort().map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (_) { return null; }
  }).filter(Boolean).sort((a, b) => (b.num || 0) - (a.num || 0));

  for (const file of files.sort()) {
    const jsonPath = path.join(dataDir, file);
    const issueData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const slug = issueData.slug;
    if (regenCopy) {
      console.log(`  ✍️  Regenerating AI copy for ${slug}...`);
      try {
        const { sports, markets, golf, tennis, trending, f1, worldCup, nhl, upcoming } = issueData;
        const boxScores = {};
        const streamingPick = STREAMING_PICKS[(issueData.num || 0) % STREAMING_PICKS.length];
        issueData.copy = await generateCopy({ sports, markets, golf, tennis, trending, topStories: issueData.topStories || [], f1, worldCup, nhl, upcoming, boxScores, prev3: [], streamingPick });
        if (issueData.copy?.title) issueData.title = issueData.copy.title;
        fs.writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
        console.log(`     ✓ Copy: "${issueData.copy?.title || 'generated'}"`);
      } catch (e) {
        console.log(`     ⚠  Copy failed: ${e.message}`);
      }
    }
    // 3 most recent other issues for "more issues" section
    const related = allIssuesSorted.filter(d => d.num !== issueData.num).slice(0, 3);
    const htmlDir  = path.join(__dirname, '..', 'brief', slug);
    if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
    fs.writeFileSync(path.join(htmlDir, 'index.html'), buildHtml(issueData, related));
    console.log(`  ✓ ${slug}/index.html rebuilt`);
  }
  try {
    const ROOT = path.join(__dirname, '..');
    const { buildArchive } = require('./lib/archive');
    buildArchive(ROOT);
    console.log(`  ✓ briefs/index.html archive updated\n`);
  } catch (e) {
    console.log(`  ⚠  Archive update failed: ${e.message}\n`);
  }
  console.log('  Done. Deploy: git add . && git commit -m "Regen all briefs" && git push\n');
}

// Auto-generate a brief title from raw data when AI title generation fails
function autoTitle({ sports, golf, f1, worldCup, upcoming }) {
  const parts = [];
  if (sports?.length) {
    const g = sports[0];
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    parts.push(`${w.team} beat ${l.team} ${w.score}–${l.score}.`);
  } else if (upcoming?.length) {
    const g = upcoming[0];
    parts.push(`${g.shortName} ${g.daysAhead === 0 ? 'tips off today' : 'tomorrow'}.`);
  }
  if (golf?.leaders?.[0]) {
    const l = golf.leaders[0];
    parts.push(`${l.name} leads ${golf.name?.replace(/^the /i, '')}.`);
  }
  if (f1?.name) {
    parts.push(`${f1.name} this weekend.`);
  } else if (worldCup?.length) {
    parts.push('World Cup action underway.');
  }
  return parts.slice(0, 3).join(' ') || 'GuyTalk Daily Brief.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero = the issue's #1 story (the ranked Lead from research.js), never a
// hardcoded sport or a low-priority structured game. Its image must already be
// validated (research.js drops non-images), and it must be RELEVANT — we only
// use an image attached to the lead's own card or to a fellow Tier-1/2 story,
// never a generic stock photo. If no ranked lead has a valid image we fall back
// to the brand hero graphic for the lead's sport (never a wrong/mismatched photo).
// Returns a heroOverride object the template renders as a feature banner, or null.
// ─────────────────────────────────────────────────────────────────────────────
function heroKeyForLabel(label) {
  const t = String(label || '').toLowerCase();
  if (/\bnba\b|basketball/.test(t)) return 'nba';
  if (/\bnhl\b|stanley|hockey/.test(t)) return 'nhl';
  if (/\bmlb\b|baseball|world series/.test(t)) return 'mlb';
  if (/\bf1\b|formula|grand prix/.test(t)) return 'f1';
  if (/golf|pga|masters|open championship/.test(t)) return 'golf';
  return 'default';
}

function buildHeroOverride(dynamicSports) {
  const dyn = Array.isArray(dynamicSports) ? dynamicSports : [];
  if (!dyn.length) return null;            // no ranked lead → template's own fallback
  const lead = dyn[0];

  // Prefer the lead's own (validated, relevant) image; else the next Tier-1/2
  // story that has one. Never borrow an image from an unrelated low-tier card.
  let image = lead.imageUrl || null;
  let imageReal = !!image;
  if (!image) {
    const alt = dyn.find((s) => s.imageUrl && (s.tier == null || s.tier <= 2));
    if (alt) { image = alt.imageUrl; imageReal = true; }
  }
  if (!image) { image = `/assets/hero/${heroKeyForLabel(lead.label || lead.name)}.jpg`; imageReal = false; }

  return {
    image,
    imageReal,                              // real photo vs. brand fallback graphic
    eyebrow: lead.isLead ? 'The Lead' : (lead.label || lead.name),
    title: lead.headline || lead.label || lead.name,
    sub: lead.label || lead.name,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — a completed tournament with a notable winner ALWAYS gets a Sports
// section. Dynamic discovery sometimes omits golf even when it just finished; the
// structured golf data + the (editor-reviewed) golf copy are real, so we map them
// into a Sports card, score it, and re-sort so it lands by importance. Skipped if
// a golf card is already present (within-issue dedup) or the event isn't over.
// ─────────────────────────────────────────────────────────────────────────────
function injectCompletedGolf(dynamicSports, golf, copy, sectionStories) {
  const dyn = Array.isArray(dynamicSports) ? dynamicSports.slice() : [];
  if (!golf || golf.statusState !== 'post' || !golf.leaders || !golf.leaders[0]) return dyn;
  // Already represented by a discovered card? (dedup)
  if (dyn.some((s) => /\bgolf\b|\bpga\b/i.test(`${s.name || ''} ${s.label || ''} ${s.facts || ''}`))) return dyn;

  const w = golf.leaders[0];
  const cg = copy && copy.golf ? copy.golf : {};
  const background = (sectionStories && sectionStories.golf && (sectionStories.golf.background || sectionStories.golf.fact)) || '';
  const headline = cg.headline || `${w.name} wins the ${golf.name} at ${w.score}`;
  const card = {
    name: golf.name,
    label: golf.name,
    category: 'individual',
    headline,
    whatHappened: cg.headline || `${w.name} won the ${golf.name} at ${w.score}.`,
    whyItMatters: [cg.whyCare1, cg.whyCare2].filter(Boolean).join(' ') || (background ? background : ''),
    whatToBringUp: cg.whatToSay || '',
    facts: `${w.name} won the ${golf.name} at ${w.score}.`,
    background,
    source: '', url: '',
    imageUrl: null, // no faked/building image — Fix 6 prefers none over a wrong shot
    videoUrl: null,
    isLead: false,
  };
  const { score, tier } = scoreImportance({ name: golf.name, headline, facts: card.facts, isFinalResult: true });
  card.importance = score; card.tier = tier;

  dyn.push(card);
  // Re-sort by importance (stable) and re-flag The Lead.
  dyn.forEach((s, i) => { if (s.importance == null) { const r = scoreImportance({ name: s.name, headline: s.headline, facts: s.facts }); s.importance = r.score; s.tier = r.tier; } s._r = i; s.isLead = false; });
  dyn.sort((a, b) => (b.importance - a.importance) || (a._r - b._r));
  dyn.forEach((s) => { delete s._r; });
  if (dyn.length) dyn[0].isLead = true;
  console.log(`   ✓ Golf injected as a Sports card (T${tier}/${score}) — "${headline}"`);
  return dyn;
}

// Culture = entertainment only (Fix 2). Drop any culture item that classifies as
// a sports story (UFC/soccer/World Cup/game result) — those belong to Sports, and
// this also removes the cross-section duplicate (e.g. World Cup in Sports AND
// Culture). Never drops below one item.
function filterCultureToEntertainment(copy) {
  if (!copy || !Array.isArray(copy.culture)) return;
  const kept = copy.culture.filter((c) => classifyTopic(`${c.topic || ''} ${c.whatHappened || ''}`) !== 'sports');
  if (kept.length && kept.length !== copy.culture.length) {
    console.log(`   ⤫  Culture: dropped ${copy.culture.length - kept.length} sports item(s) — Culture is entertainment only`);
    copy.culture = kept;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a plain-text "raw facts" block for the editorial pass.
// The editor may ONLY use these facts — it edits wording, never invents data.
// ─────────────────────────────────────────────────────────────────────────────
function buildFactsContext({ sports, markets, golf, tennis, f1, worldCup, nhl, upcoming, boxScores, trending, topStories, sectionStories }) {
  const lines = [];

  if (sports?.length) {
    lines.push('GAMES:');
    sports.forEach(g => {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      let s = `- ${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score} (${g.status})`;
      if (g.seriesNote) s += ` [Series: ${g.seriesNote}]`;
      const leaders = boxScores?.[g.id];
      if (leaders?.length) {
        s += ` | Leaders: ${leaders.map(p => `${p.name} ${p.pts}pts${p.reb ? ` ${p.reb}reb` : ''}${p.ast ? ` ${p.ast}ast` : ''}`).join(', ')}`;
      }
      lines.push(s);
    });
  }

  if (upcoming?.length) {
    lines.push('UPCOMING:');
    upcoming.slice(0, 3).forEach(g => lines.push(`- ${g.shortName}${g.note ? ` (${g.note})` : ''} — ${g.daysAhead === 0 ? 'today' : g.daysAhead === 1 ? 'tomorrow' : `in ${g.daysAhead} days`}`));
  }

  if (f1?.name) {
    if (f1.results?.length && f1.statusState === 'post') {
      lines.push(`F1: ${f1.name} (Finished) — ${f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`);
    } else {
      lines.push(`F1: ${f1.name} — upcoming this weekend (${f1.status || f1.statusState || 'scheduled'})`);
    }
  }

  if (golf?.name) {
    const lb = golf.leaders?.slice(0, 3).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ') || 'no leaderboard yet';
    const status = golf.statusState === 'post' ? 'Finished' : golf.statusState === 'in' ? 'In Progress' : 'Starting this week';
    lines.push(`GOLF: ${golf.name} — ${status}. Leaderboard: ${lb}`);
  }

  if (tennis?.tours?.length) {
    tennis.tours.forEach(t => {
      const tag = t.isMajor ? `${t.tour} GRAND SLAM` : t.tour;
      const res = t.results?.length ? ` Recent: ${t.results.map(r => `${r.winner} def. ${r.loser} ${r.score}`).join('; ')}` : '';
      lines.push(`TENNIS (${tag}): ${t.name} — ${t.status || 'in progress'}.${res}`);
    });
  }

  if (worldCup?.length) {
    const played = worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post').length;
    lines.push(`WORLD CUP: 2026 — ${played} match(es) played so far`);
  }

  if (nhl && (nhl.final || nhl.next)) {
    const g = nhl.final || nhl.next;
    const loc = [g.venue, g.venueCity].filter(Boolean).join(', ');
    if (nhl.final) {
      const w = g.home.winner ? g.home : g.away, l = g.home.winner ? g.away : g.home;
      lines.push(`NHL: ${g.note || 'game'} — ${w.team} ${w.score}–${l.score} ${l.team}${g.seriesNote ? ` [Series: ${g.seriesNote}]` : ''}${loc ? ` at ${loc}` : ''}`);
    } else {
      lines.push(`NHL UPCOMING: ${g.note || g.shortName} — ${g.away.team} at ${g.home.team}${g.seriesNote ? ` [Series: ${g.seriesNote}]` : ''}${loc ? ` at ${loc}` : ''}. NO result yet.`);
    }
  }

  if (markets) {
    const mkt = Object.entries(markets)
      .filter(([, q]) => q?.dayChangePct !== null && q?.dayChangePct !== undefined)
      .map(([sym, q]) => {
        const day = `${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`;
        const wk  = (q.weekChangePct !== null && q.weekChangePct !== undefined)
          ? ` (${q.weekChangePct >= 0 ? '+' : ''}${q.weekChangePct.toFixed(1)}% wk)` : '';
        return `${sym} ${day}${wk}`;
      }).join(', ');
    if (mkt) lines.push(`MARKETS: ${mkt}`);
  }

  if (topStories?.length) {
    lines.push('');
    lines.push("TODAY'S BIGGEST STORIES (web-researched, real & sourced — LEAD THE BRIEF WITH THESE; the ★ is the single biggest story of the day):");
    topStories.forEach((s) => {
      lines.push(`${s.isLead ? '★' : '-'} [${s.category}] ${s.headline}`);
      if (s.whatHappened) lines.push(`   what happened: ${s.whatHappened}`);
      if (s.whyItMatters) lines.push(`   why it matters: ${s.whyItMatters}`);
      if (s.depth) lines.push(`   DEPTH (use this — market impact / index inclusion / how to participate / historical comps): ${s.depth}`);
      if (s.whatToSay) lines.push(`   what to say: ${s.whatToSay}`);
      if (Array.isArray(s.sources) && s.sources[0]) lines.push(`   source: ${s.sources[0]}`);
    });
  }

  if (trending?.length) {
    lines.push('TRENDING HEADLINES (for culture/context):');
    trending.slice(0, 8).forEach(t => lines.push(`- [${t.source}] ${t.title}`));
  }

  // Per-section web research (Change 1) — sourced facts for NHL/F1/Golf + culture.
  if (sectionStories && Object.keys(sectionStories).length) {
    const sec = [];
    const fmt = (label, r) => {
      if (!r || r.no_data) return;
      sec.push(`${label}: ${r.headline || r.fact}${r.fact && r.headline ? ` — ${r.fact}` : ''}${r.url ? ` (source: ${r.url})` : ''}`);
    };
    fmt('NHL (web)', sectionStories.nhl);
    fmt('F1 (web)', sectionStories.f1);
    fmt('GOLF (web)', sectionStories.golf);
    (sectionStories.culture || []).forEach((c, i) => fmt(`CULTURE ${i + 1} (web)`, c));
    if (sec.length) {
      lines.push('');
      lines.push('SECTION RESEARCH (web-sourced, real — use as grounded facts):');
      lines.push(...sec.map(s => `- ${s}`));
    }
  }

  return lines.join('\n') || '(no data available)';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes('--regen')) return regenAll();
  resetWarnings(); // start each run with a clean section-warnings slate
  const isPreview = process.argv.includes('--preview');
  const issueNum  = getNextIssueNum();
  const today     = new Date();
  const date      = formatDate(today);
  const slug      = isPreview ? 'preview' : `issue-${pad(issueNum)}`;

  console.log(`\n${line('═')}`);
  console.log(`  GuyTalk Brief Generator${isPreview ? ' · PREVIEW MODE' : ''}`);
  console.log(`  ${isPreview ? 'Preview' : `Issue #${pad(issueNum)}`} · ${date}`);
  console.log(`${line('═')}\n`);
  if (isPreview) console.log('  ⚡ Preview mode — saves to brief/preview/ only. Nothing published.\n');

  // ── Fetch data ─────────────────────────────────────────────────────────────
  console.log('📡 Fetching data...');

  const [sportsResult, marketsResult, golfResult, trendingResult, f1Result, wcResult, upcomingResult, screenersResult, nhlResult, tennisResult, topStoriesResult] = await Promise.allSettled([
    fetchNBA(),
    fetchMarkets(),
    fetchGolf(),
    fetchTrending(),
    fetchF1(),
    fetchWorldCup(),
    fetchNBAUpcoming(),
    fetchMarketScreeners(),
    fetchNHL(),
    fetchTennis(),
    fetchTopStories(),   // organic web-researched top stories (the day's biggest news, with sources)
  ]);

  let sports       = sportsResult.status    === 'fulfilled' ? sportsResult.value    : null;
  const markets    = marketsResult.status   === 'fulfilled' ? marketsResult.value   : null;
  const screeners  = screenersResult.status === 'fulfilled' ? screenersResult.value : null;
  const nhl        = nhlResult.status === 'fulfilled' ? nhlResult.value : null;
  if (nhl) console.log(`   ✓ NHL: ${nhl.final ? nhl.final.shortName + ' (Final)' : ''}${nhl.next ? ` next: ${nhl.next.shortName}` : ''}`);
  // Attach market-wide screeners (FMP) to the markets object so they're saved
  // with the issue and rendered. Falls back to watchlist movers if no FMP key.
  if (markets && screeners) {
    markets.__screeners = screeners;
    console.log(`   ✓ Market screeners: ${screeners.gainers.length} gainers, ${screeners.losers.length} losers, ${screeners.actives.length} most-active`);
  } else if (markets) {
    console.log('   ⚠  No FMP screeners (set FMP_API_KEY) — using watchlist movers fallback');
  }
  const golf       = golfResult.status      === 'fulfilled' ? golfResult.value      : null;
  const trending   = trendingResult.status  === 'fulfilled' ? trendingResult.value  : null;
  const topStories = topStoriesResult.status === 'fulfilled' ? (topStoriesResult.value || []) : [];
  let   f1         = f1Result.status        === 'fulfilled' ? f1Result.value        : null;
  const worldCup   = wcResult.status        === 'fulfilled' ? wcResult.value        : null;
  const upcoming   = upcomingResult.status  === 'fulfilled' ? upcomingResult.value  : null;
  const tennis     = tennisResult.status    === 'fulfilled' ? tennisResult.value    : null;
  if (tennis) {
    const slam = tennis.anyMajor ? ' ⭐ GRAND SLAM' : '';
    console.log(`   ✓ Tennis:${slam} ${tennis.tours.map(t => `${t.tour} ${t.name}`).join(', ')}`);
  }

  // Fetch box scores + highlight meta for any games (real player stats + recap links)
  let boxScores = {};
  let gameMetas = {};
  if (sports?.length) {
    console.log(`   ✓ NBA: ${sports.length} game(s) — ${sports.map(g => g.shortName).join(', ')}`);
    for (const game of sports.slice(0, 2)) {
      const sport = game.sport?.toLowerCase() || 'nba';
      try {
        if (sport === 'nba') {
          const leaders = await fetchNBABoxScore(game.id);
          if (leaders?.length) {
            boxScores[game.id] = leaders;
            console.log(`   ✓ Box score: ${game.shortName} — ${leaders[0].name} ${leaders[0].pts}pts`);
          }
        }
        const meta = await fetchGameMeta(game.id, sport);
        if (meta) gameMetas[game.id] = meta;
      } catch (_) {}
    }
  } else {
    console.log(`   ⚠  NBA: no games yesterday — trying MLB...`);
    try {
      const mlb = await fetchMLB();
      if (mlb?.length) {
        sports = mlb;
        console.log(`   ✓ MLB: ${mlb.length} game(s) — ${mlb.map(g => g.shortName).join(', ')}`);
      } else {
        console.log(`   ⚠  MLB: no data — sports section will cover F1/upcoming`);
      }
    } catch (e) {
      console.log(`   ⚠  MLB fetch failed: ${e.message}`);
    }
  }

  if (markets)             console.log(`   ✓ Markets: ${Object.keys(markets).filter(k => markets[k]?.price).length} tickers`);
  else                     console.log(`   ⚠  Markets: no data — add FINNHUB_API_KEY to .env.local`);

  if (golf?.name)          console.log(`   ✓ Golf: ${golf.name} — leader: ${golf.leaders?.[0]?.name || 'TBD'} ${golf.leaders?.[0]?.score || ''}`);
  else                     console.log(`   ⚠  Golf: no active tournament found`);

  if (f1?.name)            console.log(`   ✓ F1: ${f1.name} (${f1.status || f1.statusState}) — P1: ${f1.results?.[0]?.driver || 'TBD'}`);
  else                     console.log(`   ⚠  F1: no data`);

  if (worldCup?.length)    console.log(`   ✓ World Cup: ${worldCup.length} match(es) found`);
  else                     console.log(`   ⚠  World Cup: no active matches (tournament may not have started)`);

  if (upcoming?.length)    console.log(`   ✓ Upcoming NBA: ${upcoming.length} game(s) — ${upcoming.map(g => g.shortName).join(', ')}`);

  if (trending?.length)    console.log(`   ✓ Trending: ${trending.length} headlines`);
  else                     console.log(`   ⚠  Trending: no data`);

  // ── Generate AI copy ───────────────────────────────────────────────────────
  console.log('\n✍️  Generating GuyTalk copy with Claude Haiku...');
  let copy = null;
  let sectionStories = {};
  let dynamicSports = [];
  try {
    const prev3 = loadPreviousBriefs(3);
    if (prev3.length) console.log(`   ✓ Repetition guard: loaded ${prev3.length} previous brief(s)`);

    // Don't re-report a completed race we already covered — pivot to a preview of
    // the next track. Swapping f1 to a 'pre'/no-results object makes the whole
    // downstream pipeline (copy + circuit image) treat it as an upcoming race.
    const f1AlreadyCovered = f1?.name && f1.statusState === 'post'
      && prev3.some(p => p.f1Event && p.f1Event === f1.name && p.f1State === 'post');
    if (f1AlreadyCovered && f1.nextRace?.name) {
      console.log(`   ↪ F1: ${f1.name} already covered — pivoting to next race (${f1.nextRace.name})`);
      f1 = {
        name: f1.nextRace.name,
        shortName: f1.nextRace.name,
        venue: '',
        status: 'Upcoming',
        statusState: 'pre',
        champLeader: f1.champLeader,   // keep the real, sourced title-race stat
        results: [],
        nextRace: null,
        daysAway: f1.nextRace.daysAway,
      };
    }
    const streamingPick = STREAMING_PICKS[issueNum % STREAMING_PICKS.length];

    // ── Web research — dynamic sports discovery + culture/hero, in parallel ─────
    // Discovery finds the sports actually generating coverage today (no hardcoded
    // list); culture/hero ground the rest. Image searches avoid the previous
    // issue's image URLs so we never publish a repeated image.
    const prevImageUrls = loadPrevImageUrls();
    console.log('   🔎 Web research: dynamic sports discovery + culture + hero...');
    const leadSubject = (topStories.find(s => s.isLead) || topStories[0])?.headline || null;
    const [secRes, dynRes] = await Promise.allSettled([
      fetchSectionStories({ dateLabel: date, leadSubject, issueNum, prevImageUrls, golf }),
      fetchDynamicSports({ dateLabel: date, issueNum, prevImageUrls }),
    ]);
    sectionStories = secRes.status === 'fulfilled' ? (secRes.value || {}) : {};
    if (secRes.status === 'rejected') console.log(`   ⚠  Section research failed (non-blocking): ${secRes.reason?.message || secRes.reason}`);
    const dynamic = dynRes.status === 'fulfilled' ? (dynRes.value || { lead: null, sports: [] }) : { lead: null, sports: [] };
    if (dynRes.status === 'rejected') console.log(`   ⚠  Dynamic sports failed (non-blocking): ${dynRes.reason?.message || dynRes.reason}`);
    dynamicSports = Array.isArray(dynamic.sports) ? dynamic.sports : [];

    // Section-inclusion safety net (editorial-config.js): discovery already drops
    // EXCLUDEd leagues, but enforce it again here so a renamed variant (e.g.
    // "Women's NBA") can never slip into a published section.
    const beforeExcl = dynamicSports.length;
    dynamicSports = dynamicSports.filter((s) => !isExcluded(s.label || s.name));
    if (dynamicSports.length !== beforeExcl) console.log(`   ⤫  Dropped ${beforeExcl - dynamicSports.length} excluded sport(s) per editorial-config`);

    // Final dedup safety net: drop any image that still matches the previous issue
    // (research already avoids them, but never publish a repeat — render text-only).
    const prevSet = new Set(prevImageUrls);
    dynamicSports.forEach(s => { if (s.imageUrl && prevSet.has(s.imageUrl)) s.imageUrl = null; });

    copy = await generateCopy({ sports, markets, golf, tennis, trending, topStories, sectionStories, dynamicSports, f1, worldCup, nhl, upcoming, boxScores, gameMetas, prev3, streamingPick });

    // Merge the three-label beats (from copy) into each discovered sport so the
    // template renders What happened / Why it matters / What to bring up per card.
    if (dynamicSports.length) {
      const beats = Array.isArray(copy?.dynamicSportsText) ? copy.dynamicSportsText : [];
      dynamicSports = dynamicSports.map((s, i) => ({ ...s, ...(beats[i] || {}) }));
      console.log(`   ✓ Discovered sports (${dynamicSports.length}): ${dynamicSports.map(s => `${s.isLead ? '★ ' : ''}${s.label} [${s.category}]`).join(', ')}`);
    }
    if (copy) {
      if (copy.title)          console.log(`   ✓ Headline: "${copy.title}"`);
      if (copy.lead)           console.log(`   ✓ Sports angle`);
      if (copy.markets?.mood)  console.log(`   ✓ Markets take`);
      if (copy.finalSharpTake) console.log(`   ✓ Sharp take`);
    } else {
      console.log(`   ⚠  Skipped — add ANTHROPIC_API_KEY to .env.local`);
    }
  } catch (err) {
    console.log(`   ⚠  Copy generation failed: ${err.message}`);
  }

  // ── Editorial pass — Claude enforces the GuyTalk Editorial Bible ────────────
  // Claude Haiku gathered the facts and drafted the raw stories above. This is the
  // FINAL writing pass (Claude Sonnet): it checks formatting, sharpens every
  // "What to say" / "Why it matters", enforces GUYTALK_EDITORIAL_BIBLE.md, flags
  // weak content, and checks source links. Sections that still can't meet the
  // standard are flagged in editor.blocking, which qa-brief.js turns into a hard
  // publish block. Fail-open: if Anthropic is unavailable the Claude draft ships
  // with reviewed:false and a loud warning.
  let editorMeta = { reviewed: false, blocking: [], changed: [], notes: [], brokenLinks: [], reason: 'no copy to edit' };
  if (copy) {
    console.log('\n🧐 Editorial pass — Claude enforcing the GuyTalk Editorial Bible...');
    try {
      const facts = buildFactsContext({ sports, markets, golf, tennis, f1, worldCup, nhl, upcoming, boxScores, trending, topStories, sectionStories });
      const links = (trending || []).map(t => t.url).filter(Boolean);
      const result = await editBrief({ copy, context: facts, links });
      copy = result.copy;
      editorMeta = result.editor;
      if (editorMeta.reviewed) {
        console.log(`   ✓ Edited by ${editorMeta.model}`);
        if (editorMeta.changed.length) console.log(`   ✓ Rewrote: ${editorMeta.changed.join(', ')}`);
        if (editorMeta.blocking.length) {
          console.log(`   ⛔ ${editorMeta.blocking.length} section(s) FLAGGED — QA will block publish:`);
          editorMeta.blocking.forEach(b => console.log(`        • ${b.section}: ${b.reason}`));
        } else {
          console.log(`   ✓ All sections meet the Bible — no blocks`);
        }
      } else {
        console.log(`   ⚠  NOT editor-reviewed: ${editorMeta.reason}`);
        console.log(`   ⚠  Brief will publish on the Claude draft only (fail-open).`);
        addWarning('editor', 'failed', editorMeta.reason || 'editor pass did not run');
      }
      if (editorMeta.brokenLinks?.length) {
        console.log(`   🔗 ${editorMeta.brokenLinks.length} broken source link(s):`);
        editorMeta.brokenLinks.forEach(l => console.log(`        • ${l.url} — ${l.reason}`));
      }
    } catch (err) {
      editorMeta = { reviewed: false, blocking: [], changed: [], notes: [], brokenLinks: [], reason: `editor crashed: ${err.message}` };
      console.log(`   ⚠  Editorial pass crashed: ${err.message} — keeping Claude draft (fail-open)`);
      addWarning('editor', 'failed', `crashed: ${err.message}`);
    }
  }

  // ── Round-2 post-processing (run on the final, editor-reviewed copy) ────────
  //   Fix 2: Culture is entertainment-only (drops sports items + cross-section dupes).
  //   Fix 4: a completed tournament (golf) always gets a Sports card, ranked in.
  filterCultureToEntertainment(copy);
  dynamicSports = injectCompletedGolf(dynamicSports, golf, copy, sectionStories);

  // ── Assemble issue data object ─────────────────────────────────────────────
  const issueData = {
    num:     issueNum,
    slug,
    date,
    title:   copy?.title || autoTitle({ sports, golf, f1, worldCup, upcoming }),
    deck:    'Five minutes. Everything you need.',
    sports,
    markets,
    golf,
    tennis,
    f1,
    worldCup,
    nhl,
    upcoming,
    gameMetas,
    trending,
    topStories,
    sectionStories,
    dynamicSports,
    heroImage: (sectionStories?.heroImage && !sectionStories.heroImage.no_data)
      ? sectionStories.heroImage.url
      : null,
    // Hero banner = the ranked #1 story (Fix 1's Lead), with a validated/relevant
    // image or the brand fallback graphic — never the structured-feed marquee game.
    heroOverride: buildHeroOverride(dynamicSports),
    copy,
    editor:  editorMeta,
    // Section retries / failures / editor hard-blocks from this run, persisted so
    // the approval email can surface them (populated by generateCopy + editBrief).
    generationWarnings: [...GENERATION_WARNINGS],
  };

  // ── Write files ────────────────────────────────────────────────────────────
  console.log('\n📝 Writing files...');

  // JSON data file
  const dataDir  = path.join(BRIEF_DIR, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const jsonPath = path.join(dataDir, `${slug}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
  console.log(`   ✓ brief/data/${slug}.json`);

  // HTML file — preview always writes to brief/preview/, issues to brief/issue-NNN/
  const htmlDir  = path.join(BRIEF_DIR, slug);
  if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
  const htmlPath = path.join(htmlDir, 'index.html');
  // Load 3 most recent other issues for "more issues" section
  const relatedForNew = (() => {
    try {
      return fs.readdirSync(dataDir)
        .filter(f => f.endsWith('.json') && f.startsWith('issue-') && !f.includes(slug))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch(_){return null;} })
        .filter(Boolean)
        .sort((a,b) => (b.num||0)-(a.num||0))
        .slice(0, 3);
    } catch(_) { return []; }
  })();
  fs.writeFileSync(htmlPath, buildHtml(issueData, relatedForNew));
  console.log(`   ✓ brief/${slug}/index.html`);

  // Archive index
  if (!isPreview) {
    try {
      buildArchive(ROOT);
      console.log(`   ✓ briefs/index.html (archive updated)`);
    } catch (e) {
      console.log(`   ⚠  Archive build failed: ${e.message}`);
    }
  }

  // Social cards: square (IG feed) + vertical (TikTok / Reels)
  if (!isPreview) {
    try {
      const { generateCard, generateTikTokCard, generateOgCard } = require('./lib/social-card');
      const cardPath   = generateCard(issueData);
      const tiktokPath = generateTikTokCard(issueData);
      const ogPath     = generateOgCard(issueData);
      console.log(`   ✓ ${path.relative(ROOT, cardPath)}`);
      console.log(`   ✓ ${path.relative(ROOT, tiktokPath)}`);
      console.log(`   ✓ ${path.relative(ROOT, ogPath)}`);
    } catch (e) {
      console.log(`   ⚠  Social card failed: ${e.message}`);
    }

    // Daily "what to say" video (resilient — never let it break the brief)
    try {
      const { generateVideo } = require('./generate-video');
      const videoPath = generateVideo(issueData);
      console.log(`   ✓ ${path.relative(ROOT, videoPath)}  (post to TikTok/Reels — add trending audio)`);
    } catch (e) {
      console.log(`   ⚠  Video skipped: ${e.message}`);
    }
  }

  // ── Review checklist ───────────────────────────────────────────────────────
  console.log(`\n${line()}`);
  console.log('  ✅ REVIEW CHECKLIST — scan before it goes live:');
  console.log(line());

  const checks = [];

  if (sports?.length)     checks.push(`□ [VERIFY] Sports scoreboards — confirm scores match ESPN`);
  else                    checks.push(`□ [WARN]   No NBA/MLB games — sports covers F1/upcoming/news`);
  if (f1?.results?.length) checks.push(`□ [VERIFY] F1: ${f1.name} — confirm ${f1.results[0]?.driver} result on ESPN`);
  if (worldCup?.length)   checks.push(`□ [INFO]   World Cup matches found — verify scores are current`);

  if (golf?.leaders?.[0]) checks.push(`□ [VERIFY] Golf leaderboard — verify ${golf.leaders[0].name} still leads`);
  else if (golf)          checks.push(`□ [INFO]   Golf: ${golf.name} not yet in progress`);
  else                    checks.push(`□ [WARN]   No golf data — section shows no active tournament`);

  if (markets)            checks.push(`□ [VERIFY] Market prices + weekly % auto-filled — spot-check SPY/QQQ`);
  else                    checks.push(`□ [WARN]   No market data — add FINNHUB_API_KEY to .env.local`);

  if (copy) {
    checks.push(`□ [REVIEW] AI copy generated — scan sports angle, culture stories, sharp take`);
    if (!copy.culture?.length)  checks.push(`□ [WARN]   Culture section may be sparse — check trending data quality`);
  } else {
    checks.push(`□ [WARN]   No AI copy (missing ANTHROPIC_API_KEY) — briefs will be thin`);
  }

  checks.push(`□ [AUTO]   briefs/index.html archive updated automatically`);

  checks.forEach(c => console.log(`  ${c}`));

  // Section-generation warnings (retries / failures / editor hard-blocks) — make
  // them loud at the end of the run so they're caught before approval.
  if (GENERATION_WARNINGS.length) {
    console.log(`\n  ⚠️  GENERATION WARNINGS (${GENERATION_WARNINGS.length}) — sections that retried, failed, or were blocked:`);
    console.log(formatWarnings());
  } else {
    console.log(`\n  ✅ No generation warnings — all sections generated cleanly on the first try.`);
  }

  if (isPreview) {
    console.log(`\n  📄 File saved: ~/Projects/GuyTalk/brief/preview/index.html`);
    console.log(`  🌐 Open:       open ~/Projects/GuyTalk/brief/preview/index.html`);
    console.log(`  ✋ Not an issue — nothing will be published until you run npm run brief`);
  } else {
    console.log(`\n  Preview:  open brief/${slug}/index.html`);
    console.log(`  Deploy:   git add . && git commit -m "Add ${slug}" && git push`);
  }
  console.log(`${line()}\n`);

  // auto-open: --preview always opens, --open flag also opens (used by brief:review and launchd)
  if (isPreview || process.argv.includes('--open')) {
    require('child_process').execSync(`open "${htmlPath}"`);
  }
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

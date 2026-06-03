#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const { fetchNBA, fetchNBAUpcoming, fetchNBABoxScore, fetchGameMeta, fetchMLB, fetchF1, fetchWorldCup, fetchMarkets, fetchGolf, fetchTrending } = require('./lib/fetchers');
const { generateCopy }                                      = require('./lib/copy');
const { buildHtml }                                         = require('./lib/html');
const { buildArchive }                                      = require('./lib/archive');
const { STREAMING_PICKS }                                   = require('./lib/db');

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
        sharpTakeCloser:     d.copy?.sharpTake?.p2?.split(/[.!?]/).filter(Boolean).pop()?.trim() || '',
        sportsThesis:        (d.copy?.sportsAngle || '').slice(0, 120),
        barArgument:         d.copy?.sportsDetail?.barArgument || '',
        officeTake:          d.copy?.officeTake || '',
        marketsBringUp:      d.copy?.marketsDetail?.bringUp || '',
        marketsBringUpFormat: d.copy?.marketsBringUpFormat || '',
      };
    } catch (_) { return null; }
  }).filter(Boolean);
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
        const { sports, markets, golf, trending, f1, worldCup, upcoming } = issueData;
        const boxScores = {};
        const streamingPick = STREAMING_PICKS[(issueData.num || 0) % STREAMING_PICKS.length];
        issueData.copy = await generateCopy({ sports, markets, golf, trending, f1, worldCup, upcoming, boxScores, prev3: [], streamingPick });
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
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes('--regen')) return regenAll();
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

  const [sportsResult, marketsResult, golfResult, trendingResult, f1Result, wcResult, upcomingResult] = await Promise.allSettled([
    fetchNBA(),
    fetchMarkets(),
    fetchGolf(),
    fetchTrending(),
    fetchF1(),
    fetchWorldCup(),
    fetchNBAUpcoming(),
  ]);

  let sports       = sportsResult.status    === 'fulfilled' ? sportsResult.value    : null;
  const markets    = marketsResult.status   === 'fulfilled' ? marketsResult.value   : null;
  const golf       = golfResult.status      === 'fulfilled' ? golfResult.value      : null;
  const trending   = trendingResult.status  === 'fulfilled' ? trendingResult.value  : null;
  const f1         = f1Result.status        === 'fulfilled' ? f1Result.value        : null;
  const worldCup   = wcResult.status        === 'fulfilled' ? wcResult.value        : null;
  const upcoming   = upcomingResult.status  === 'fulfilled' ? upcomingResult.value  : null;

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
  try {
    const prev3 = loadPreviousBriefs(3);
    if (prev3.length) console.log(`   ✓ Repetition guard: loaded ${prev3.length} previous brief(s)`);
    const streamingPick = STREAMING_PICKS[issueNum % STREAMING_PICKS.length];
    copy = await generateCopy({ sports, markets, golf, trending, f1, worldCup, upcoming, boxScores, gameMetas, prev3, streamingPick });
    if (copy) {
      if (copy.title)        console.log(`   ✓ Headline: "${copy.title}"`);
      if (copy.sportsAngle)  console.log(`   ✓ Sports angle`);
      if (copy.marketsTake)  console.log(`   ✓ Markets take`);
      if (copy.sharpTake)    console.log(`   ✓ Sharp take`);
    } else {
      console.log(`   ⚠  Skipped — add ANTHROPIC_API_KEY to .env.local`);
    }
  } catch (err) {
    console.log(`   ⚠  Copy generation failed: ${err.message}`);
  }

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
    f1,
    worldCup,
    upcoming,
    gameMetas,
    trending,
    copy,
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

  // Social card
  if (!isPreview) {
    try {
      const { generateCard } = require('./lib/social-card');
      const cardPath = generateCard(issueData);
      console.log(`   ✓ ${path.relative(ROOT, cardPath)}`);
    } catch (e) {
      console.log(`   ⚠  Social card failed: ${e.message}`);
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

#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const { fetchNBA, fetchNBAUpcoming, fetchNBABoxScore, fetchGameMeta, fetchMLB, fetchF1, fetchWorldCup, fetchMarkets, fetchGolf, fetchTrending } = require('./lib/fetchers');
const { generateCopy }                                      = require('./lib/copy');
const { buildHtml }                                         = require('./lib/html');
const { buildArchive }                                      = require('./lib/archive');

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
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
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
    copy = await generateCopy({ sports, markets, golf, trending, f1, worldCup, upcoming, boxScores, gameMetas });
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
    title:   copy?.title || 'REPLACE: Issue headline — max 12 words, no colons.',
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
  fs.writeFileSync(htmlPath, buildHtml(issueData));
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

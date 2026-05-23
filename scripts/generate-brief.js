#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const { fetchNBA, fetchMarkets, fetchGolf, fetchTrending } = require('./lib/fetchers');
const { generateCopy }                                      = require('./lib/copy');
const { buildHtml }                                         = require('./lib/html');

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
  const issueNum = getNextIssueNum();
  const today    = new Date();
  const date     = formatDate(today);
  const slug     = `issue-${pad(issueNum)}`;

  console.log(`\n${line('═')}`);
  console.log(`  GuyTalk Brief Generator`);
  console.log(`  Issue #${pad(issueNum)} · ${date}`);
  console.log(`${line('═')}\n`);

  // ── Fetch data ─────────────────────────────────────────────────────────────
  console.log('📡 Fetching data...');

  const [sportsResult, marketsResult, golfResult, trendingResult] = await Promise.allSettled([
    fetchNBA(),
    fetchMarkets(),
    fetchGolf(),
    fetchTrending(),
  ]);

  const sports   = sportsResult.status   === 'fulfilled' ? sportsResult.value   : null;
  const markets  = marketsResult.status  === 'fulfilled' ? marketsResult.value  : null;
  const golf     = golfResult.status     === 'fulfilled' ? golfResult.value     : null;
  const trending = trendingResult.status === 'fulfilled' ? trendingResult.value : null;

  if (sports?.length)      console.log(`   ✓ NBA: ${sports.length} game(s) — ${sports.map(g => g.shortName).join(', ')}`);
  else                     console.log(`   ⚠  NBA: no data${sportsResult.reason ? ` (${sportsResult.reason.message})` : ''}`);

  if (markets)             console.log(`   ✓ Markets: ${Object.keys(markets).filter(k => markets[k]?.price).length} tickers`);
  else                     console.log(`   ⚠  Markets: no data — add FINNHUB_API_KEY to .env.local`);

  if (golf?.name)          console.log(`   ✓ Golf: ${golf.name} — leader: ${golf.leaders?.[0]?.name || 'TBD'} ${golf.leaders?.[0]?.score || ''}`);
  else                     console.log(`   ⚠  Golf: no active tournament found`);

  if (trending?.length)    console.log(`   ✓ Trending: ${trending.length} headlines (used as editorial suggestions)`);
  else                     console.log(`   ⚠  Trending: no data`);

  // ── Generate AI copy ───────────────────────────────────────────────────────
  console.log('\n✍️  Generating GuyTalk copy with Claude Haiku...');
  let copy = null;
  try {
    copy = await generateCopy({ sports, markets, golf, trending });
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

  // HTML file
  const htmlDir  = path.join(BRIEF_DIR, slug);
  if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
  const htmlPath = path.join(htmlDir, 'index.html');
  fs.writeFileSync(htmlPath, buildHtml(issueData));
  console.log(`   ✓ brief/${slug}/index.html`);

  // ── Review checklist ───────────────────────────────────────────────────────
  console.log(`\n${line()}`);
  console.log('  ✅ REVIEW CHECKLIST — complete before pushing:');
  console.log(line());

  const checks = [];

  // Auto-filled items that need verification
  if (sports?.length)     checks.push(`□ [VERIFY] Sports scoreboards — confirm scores on ESPN`);
  else                    checks.push(`□ [FILL]   Sports — no game data. Add scores manually`);

  if (golf?.leaders?.[0]) checks.push(`□ [VERIFY] Golf leaderboard — verify ${golf.leaders[0].name} still leads`);
  else                    checks.push(`□ [FILL]   Golf leaderboard — no tournament data found`);

  if (markets)            checks.push(`□ [VERIFY] Market prices auto-filled — fill in [WEEK%] for each row`);
  else                    checks.push(`□ [FILL]   Market prices — no Finnhub data. Add FINNHUB_API_KEY`);

  // Manual items
  checks.push(`□ [FILL]   Markets: headline + 2nd paragraph + detail list items`);
  checks.push(`□ [FILL]   Culture: all 3 items (suggestions in HTML comments)`);
  checks.push(`□ [FILL]   The Rec: swap in this week's recommendation`);
  checks.push(`□ [FILL]   Product card in Golf section: brand, name, desc, URL, image`);
  checks.push(`□ [ADD]    Product image → /assets/images/PRODUCT-NAME.jpg`);

  if (copy)               checks.push(`□ [REVIEW] AI copy: sports angle, markets take, sharp take`);
  else                    checks.push(`□ [FILL]   All REPLACE markers — no AI copy generated`);

  // TL;DR
  checks.push(`□ [REVIEW] TL;DR bullets — add player names + links to sports bullets`);

  // Numbers
  checks.push(`□ [REVIEW] Numbers Worth Stealing — fill in context for auto-generated stats`);

  // Landing page
  checks.push(`□ [UPDATE] index.html — update 3 brief-story links from current issue to /${slug}/`);

  checks.forEach(c => console.log(`  ${c}`));

  console.log(`\n  Preview:  open brief/${slug}/index.html`);
  console.log(`  Deploy:   git add . && git commit -m "Add ${slug}" && git push`);
  console.log(`${line()}\n`);

  // --open flag: launch in default browser (used by npm run brief:review and launchd)
  if (process.argv.includes('--open')) {
    require('child_process').execSync(`open "${htmlPath}"`);
  }
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

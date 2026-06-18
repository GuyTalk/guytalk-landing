#!/usr/bin/env node
'use strict';

/**
 * One-time post-processing patch for issue-054.
 *
 * Fixes:
 *  1. Markets hero image (was default.jpg = Polish soccer field) → real Fed/Powell photo
 *  2. World Cup image (was default.jpg) → real England-Croatia match photo
 *  3. MLB image (was default.jpg) → real Marlins-Phillies photo
 *  4. F1 image → Jake's race photo f1-054.jpg (reverted during regeneration)
 *  5. Adds playerLinks to World Cup, F1, and Golf sections
 *  6. Rebuilds HTML
 */

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');
const { searchWebImage } = require('./lib/imageSearch');
const { buildHtml }      = require('./lib/html');

const BRIEF_DIR  = path.join(__dirname, '..', 'brief');
const DATA_FILE  = path.join(BRIEF_DIR, 'data', 'issue-054.json');

async function main() {
  console.log('\n🔧 Patching issue-054 images and player links...\n');

  const issue = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  // ── 1. Markets hero image ──────────────────────────────────────────────────
  console.log('Searching for Markets/Fed hero image...');
  const fedQuery = 'Federal Reserve Kevin Warsh Jerome Powell interest rate decision press conference photo June 2026';
  const fedImg = await searchWebImage(fedQuery, { fallback: null });
  if (fedImg) {
    issue.heroOverride.image     = fedImg;
    issue.heroOverride.imageReal = true;
    console.log(`  ✅ Markets hero: ${fedImg.slice(0, 80)}`);
  } else {
    console.log('  ⚠  No Fed image found — leaving null (no soccer field fallback)');
    issue.heroOverride.image     = null;
    issue.heroOverride.imageReal = false;
  }

  // ── 2-4. Sport section images ──────────────────────────────────────────────
  const SPORT_SEARCHES = {
    'FIFA World Cup 2026': {
      query: 'England Croatia FIFA World Cup 2026 match photo Harry Kane soccer action June 17',
      hardcoded: null,
    },
    'Lenovo Austrian Grand Prix': {
      query: null, // Jake's photo wins — use hardcoded
      hardcoded: '/assets/hero/f1-054.jpg',
    },
    'U.S. Open': {
      query: 'US Open golf 2026 Shinnecock Hills player swing action photo',
      hardcoded: null,
    },
    'MIA @ PHI': {
      query: 'Miami Marlins Philadelphia Phillies MLB baseball game action photo June 2026',
      hardcoded: null,
    },
  };

  for (const s of (issue.dynamicSports || [])) {
    const cfg = SPORT_SEARCHES[s.name];
    if (!cfg) continue;

    if (cfg.hardcoded) {
      s.imageUrl = cfg.hardcoded;
      console.log(`  ✅ ${s.name}: ${cfg.hardcoded} (hardcoded)`);
      continue;
    }

    if (cfg.query) {
      console.log(`Searching for ${s.name} image...`);
      const img = await searchWebImage(cfg.query, { fallback: null });
      if (img) {
        s.imageUrl = img;
        console.log(`  ✅ ${s.name}: ${img.slice(0, 80)}`);
      } else {
        s.imageUrl = null;
        console.log(`  ⚠  ${s.name}: no image found — set to null`);
      }
    }
  }

  // ── 5. Player links ────────────────────────────────────────────────────────
  const PLAYER_LINKS = {
    'FIFA World Cup 2026': [
      { name: 'Harry Kane',        url: 'https://en.wikipedia.org/wiki/Harry_Kane' },
      { name: 'Jude Bellingham',   url: 'https://en.wikipedia.org/wiki/Jude_Bellingham' },
      { name: 'Marcus Rashford',   url: 'https://en.wikipedia.org/wiki/Marcus_Rashford' },
      { name: 'Romano Schmid',     url: 'https://en.wikipedia.org/wiki/Romano_Schmid' },
      { name: 'Cristiano Ronaldo', url: 'https://en.wikipedia.org/wiki/Cristiano_Ronaldo' },
    ],
    'Lenovo Austrian Grand Prix': [
      { name: 'Max Verstappen', url: 'https://www.formula1.com/en/drivers/max-verstappen' },
      { name: 'Lando Norris',   url: 'https://www.formula1.com/en/drivers/lando-norris' },
      { name: 'Charles Leclerc', url: 'https://www.formula1.com/en/drivers/charles-leclerc' },
    ],
    'U.S. Open': [
      { name: 'James Nicholas',  url: 'https://www.pgatour.com/players/player.36689.james-nicholas.html' },
      { name: 'Caleb Surratt',   url: 'https://www.pgatour.com/players/player.58026.caleb-surratt.html' },
      { name: 'Rory McIlroy',    url: 'https://www.pgatour.com/players/player.28237.rory-mcilroy.html' },
    ],
  };

  for (const s of (issue.dynamicSports || [])) {
    const links = PLAYER_LINKS[s.name];
    if (links) {
      s.playerLinks = links;
      console.log(`  ✅ Player links added to ${s.name}: ${links.map(p => p.name).join(', ')}`);
    }
  }

  // ── 6. Write patched JSON ──────────────────────────────────────────────────
  fs.writeFileSync(DATA_FILE, JSON.stringify(issue, null, 2));
  console.log('\n  ✅ issue-054.json patched');

  // ── 7. Rebuild HTML ────────────────────────────────────────────────────────
  console.log('\n🔨 Rebuilding HTML...');
  try {
    // Load related issues for prev/next links
    const dataDir = path.join(BRIEF_DIR, 'data');
    const relatedFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f.startsWith('issue-'));
    const relatedIssues = relatedFiles.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { return null; }
    }).filter(Boolean);

    const html = buildHtml(issue, relatedIssues);
    const outDir = path.join(BRIEF_DIR, issue.slug || 'issue-054');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html);
    console.log(`  ✅ HTML rebuilt → brief/${issue.slug}/index.html`);
  } catch (err) {
    console.error(`  ❌ HTML rebuild failed: ${err.message}`);
  }

  console.log('\n✅ Patch complete. Run qa-brief.js to verify, then approve.\n');
}

main().catch(err => { console.error(err); process.exit(1); });

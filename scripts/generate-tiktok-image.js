#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'tiktok-cards');
const DATA_DIR   = path.join(__dirname, '..', 'brief', 'data');

function buildPrompt(issue) {
  const { sports, upcoming, f1, golf, markets, copy } = issue;
  const bullets = copy?.sharpTake?.bullets || [];

  // NBA Finals / upcoming game
  if (upcoming?.length) {
    const game = upcoming[0];
    const teams = game.shortName || game.home + ' vs ' + game.away;
    return `NBA Finals game night, packed arena crowd roaring, dramatic court-level view, championship banners, confetti, cinematic sports photography, 9:16 vertical, photorealistic, no text`;
  }

  // Recent sports result
  if (sports?.length) {
    const g = sports[0];
    const winner = g.home?.winner ? g.home : g.away;
    const sport = g.sport || 'baseball';
    if (sport === 'baseball' || g.home?.team?.match(/Sox|Yankees|Mets|Cubs|Dodgers|Braves|Astros|Cardinals|Phillies|Giants|Brewers|Tigers|Rays/)) {
      return `dramatic baseball stadium at night, packed crowd celebrating, floodlights blazing, cinematic sports moment, photorealistic, vertical 9:16 format, no text`;
    }
    return `dramatic sports arena, crowd erupting, championship energy, cinematic lighting, vertical 9:16 format, photorealistic, no text`;
  }

  // F1
  if (f1?.name) {
    return `Formula 1 race car at speed, ${f1.name || 'Monaco Grand Prix'}, dramatic motion blur, cinematic photography, vertical 9:16 format, photorealistic, no text`;
  }

  // Golf
  if (golf?.leaders?.[0]) {
    return `professional golfer on a championship course, dramatic golden hour light, spectators lining the fairway, cinematic sports photography, vertical 9:16 format, photorealistic, no text`;
  }

  // Markets / general
  return `modern city at dawn, glass office towers, financial district, cinematic morning light, vertical 9:16 format, photorealistic, no text`;
}

async function generateImage(issue) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const slug   = issue.slug;
  const outPath = path.join(OUTPUT_DIR, `${slug}.jpg`);

  if (fs.existsSync(outPath)) {
    console.log(`  ↩  ${slug}.jpg already exists, skipping`);
    return outPath;
  }

  const prompt = buildPrompt(issue);
  console.log(`  Generating: ${prompt.slice(0, 80)}...`);

  const url = execSync(
    `higgsfield generate create nano_banana_2 --prompt "${prompt.replace(/"/g, '\\"')}" --aspect_ratio 9:16 --resolution 2k --wait`,
    { encoding: 'utf8' }
  ).trim();

  if (!url.startsWith('http')) throw new Error(`Unexpected output: ${url}`);

  // Download
  execSync(`curl -sL "${url}" -o "${outPath}"`);
  console.log(`  ✓ Saved: assets/tiktok-cards/${slug}.jpg`);
  return outPath;
}

async function main() {
  const single = process.argv.find(a => a.startsWith('--issue='))?.replace('--issue=', '');

  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('issue-'))
    .sort();

  let files;
  if (single) {
    files = allFiles.filter(f => f.includes(single));
  } else {
    // Last 3 issues
    files = allFiles.slice(-3);
  }

  for (const f of files) {
    const issue = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    if (!issue.slug || issue.title?.startsWith('REPLACE')) continue;
    console.log(`\n  ${issue.slug} — ${issue.title?.slice(0, 60)}`);
    try {
      await generateImage(issue);
    } catch (e) {
      console.log(`  ⚠  Failed: ${e.message}`);
    }
  }
  console.log('\n  Done.\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });

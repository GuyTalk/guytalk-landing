#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const OpenAI = require('openai');
const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractOgImage, isLiveImage } = require('./lib/images');

const ROOT   = path.join(__dirname, '..');
const client = new (OpenAI.default || OpenAI)({ apiKey: process.env.OPENAI_API_KEY });

const PICKS = [
  // ── FITNESS ──────────────────────────────────────────────────────────────
  { slug: 'bowflex-selecttech-552',    category: 'fitness',
    q: 'Bowflex SelectTech 552 adjustable dumbbells product photo official' },
  { slug: 'nike-metcon-9',             category: 'fitness',
    q: 'Nike Metcon 9 training shoe product photo official' },
  { slug: 'new-balance-fresh-foam-1080', category: 'fitness',
    q: 'New Balance Fresh Foam 1080 v14 running shoe product photo' },
  { slug: 'rogue-doorframe-pull-up-bar', category: 'fitness',
    q: 'Rogue Monster Rip Pull-Up Bar or equivalent doorframe pull-up bar product photo' },
  { slug: 'onnit-kettlebell',          category: 'fitness',
    q: 'Onnit primal kettlebell or Rep Fitness cast iron kettlebell product photo' },
  { slug: 'theragun-prime',            category: 'fitness',
    q: 'Theragun Prime massage gun official product photo' },
  { slug: 'crossrope-speed-rope',      category: 'fitness',
    q: 'Crossrope Get Lean jump rope set product photo official' },
  { slug: 'under-armour-duffel',       category: 'fitness',
    q: 'Under Armour Undeniable 5.0 gym duffel bag product photo' },
  { slug: 'whoop-4-0',                 category: 'fitness',
    q: 'Whoop 4.0 fitness tracker wearable product photo official' },
  { slug: 'hydro-flask-32oz',          category: 'fitness',
    q: 'Hydro Flask 32oz Wide Mouth water bottle product photo official' },

  // ── ACCESSORIES ──────────────────────────────────────────────────────────
  { slug: 'korchmar-leather-weekender', category: 'accessories',
    q: 'Korchmar leather weekender bag product photo official' },
  { slug: 'filson-small-duffel',       category: 'accessories',
    q: 'Filson small duffle bag leather bottom product photo official' },
  { slug: 'bellroy-slim-wallet',       category: 'accessories',
    q: 'Bellroy Note Sleeve wallet tan leather product photo official' },
  { slug: 'ridge-wallet-card-case',    category: 'accessories',
    q: 'Ridge Wallet aluminum card case official product photo' },
  { slug: 'ray-ban-wayfarer-classic',  category: 'accessories',
    q: 'Ray-Ban Wayfarer RB2140 sunglasses product photo official' },
  { slug: 'persol-714-folding-sunglasses', category: 'accessories',
    q: 'Persol 714 Steve McQueen folding sunglasses product photo official' },
  { slug: 'warby-parker-sport-sunglasses', category: 'accessories',
    q: 'Warby Parker sunglasses men product photo official' },
  { slug: 'no-logo-full-grain-leather-belt', category: 'accessories',
    q: 'full grain leather dress belt no logo brown men product photo' },
  { slug: 'tommy-bahama-canvas-web-belt', category: 'accessories',
    q: 'canvas web belt men casual brown khaki product photo' },
];

async function search(q) {
  const r = await client.responses.create({
    model: process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1',
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    tool_choice: 'required',
    input: [{ role: 'user', content: `Find the official product image for: ${q}. Return any direct image URLs you find (.jpg .png .webp) and the product page URL.` }],
  });

  const citedUrls = [];
  (r.output || []).forEach(b => {
    if (b.type === 'message') (b.content || []).forEach(c => (c.annotations || []).forEach(a => {
      if (a.type === 'url_citation') citedUrls.push(a.url);
    }));
  });
  const text = (r.output || []).filter(b => b.type === 'message')
    .flatMap(b => Array.isArray(b.content) ? b.content : [])
    .map(c => c.text || '').join('');
  const imgs = (text.match(/https?:\/\/[^\s"'<>)\]]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>)\]]*)?/gi) || []);
  return { citedUrls, imgs };
}

async function tryDownload(url, dest) {
  const r = spawnSync('curl', ['-s', '-L', '-o', dest, '--max-time', '20',
    '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    url], { encoding: 'buffer' });
  if (r.status !== 0 || !fs.existsSync(dest)) return false;
  const s = fs.statSync(dest).size;
  if (s < 5000) { try { fs.unlinkSync(dest); } catch {} return false; }
  const fout = spawnSync('file', [dest], { encoding: 'utf8' });
  if (!/JPEG|PNG|WebP/i.test(fout.stdout)) { try { fs.unlinkSync(dest); } catch {} return false; }
  console.log(`    ✓ ${Math.round(s / 1024)}KB`);
  return true;
}

async function main() {
  let ok = 0, fail = 0;

  for (const pick of PICKS) {
    const dir  = path.join(ROOT, 'assets', 'guide', pick.category);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${pick.slug}.jpg`);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 5000) {
      console.log(`  ↩ ${pick.slug}: exists`);
      ok++; continue;
    }

    console.log(`\n[${pick.category}] ${pick.slug}`);
    const { citedUrls, imgs } = await search(pick.q);

    let found = false;
    for (const u of imgs.slice(0, 8)) {
      try { if (await isLiveImage(u)) { found = await tryDownload(u, dest); if (found) break; } } catch {}
    }
    if (!found) {
      for (const u of citedUrls.slice(0, 6)) {
        try {
          const og = await extractOgImage(u);
          if (og && await isLiveImage(og)) { found = await tryDownload(og, dest); if (found) break; }
        } catch {}
      }
    }

    if (found) ok++; else { fail++; console.log('    ✗ no image'); }
    await new Promise(r => setTimeout(r, 700));
  }

  console.log(`\n✓ ${ok} images / ✗ ${fail} missing`);
}

main().catch(console.error);

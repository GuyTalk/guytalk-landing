#!/usr/bin/env node
'use strict';

/**
 * Second-pass image fetcher for items that failed or returned bad results first time.
 * Uses more specific search queries and known CDN patterns.
 */

require('dotenv').config({ path: '.env.local' });

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractOgImage, isLiveImage } = require('./lib/images');

const ROOT   = path.join(__dirname, '..');
const client = new (OpenAI.default || OpenAI)({ apiKey: process.env.OPENAI_API_KEY });

const TARGETS = [
  // ── BOURBON ──────────────────────────────────────────────────────────────
  { slug: 'arturo-fuente-hemingway', category: 'bourbon-cigars',
    queries: [
      'Arturo Fuente Hemingway Short Story cigar site:famous-smoke.com',
      'Arturo Fuente Hemingway Short Story cigar site:jrcigar.com',
      '"Arturo Fuente" "Hemingway Short Story" cigar buy online',
    ]},

  // ── WATCHES ──────────────────────────────────────────────────────────────
  { slug: 'hamilton-khaki-field', category: 'watches',
    queries: [
      'Hamilton Khaki Field Mechanical H69439931 watch site:hamiltonwatch.com',
      'Hamilton Khaki Field Mechanical 38mm watch buy official',
      '"Hamilton Khaki Field" mechanical 38mm watch product photo',
    ]},

  // ── CARS ─────────────────────────────────────────────────────────────────
  { slug: 'mazda-miata-mx5', category: 'cars',
    queries: [
      'Mazda MX-5 Miata 2024 official press release photo',
      'Mazda MX-5 Miata red roadster official photo site:media.mazdausa.com',
      '"Mazda MX-5" OR "Mazda Miata" 2024 official press photo',
    ]},

  { slug: 'leased-amg-take', category: 'cars',
    queries: [
      'Mazda MX-5 Miata white 2024 official photo driving',
      'Mazda MX-5 Miata side profile official product photo',
    ]},

  { slug: 'noco-boost-jump-starter', category: 'cars',
    queries: [
      'NOCO Boost Plus GB40 jump starter site:amazon.com',
      'NOCO GB40 jump starter product photo site:nocoproducts.com',
      '"NOCO" "GB40" jump starter buy amazon product image',
    ]},

  { slug: 'weathertech-floor-mats', category: 'cars',
    queries: [
      'WeatherTech FloorLiner car floor mat product photo',
      'WeatherTech floor liner HP product image black',
      '"WeatherTech" floor mat product photo site:amazon.com',
    ]},

  // ── STYLE ────────────────────────────────────────────────────────────────
  { slug: 'peter-millar-crown-comfort-polo', category: 'style',
    queries: [
      'Peter Millar Crown Comfort polo shirt product photo site:petermillar.com',
      '"Peter Millar" polo shirt product image buy site:nordstrom.com',
      'Peter Millar Crown Comfort polo buy official product photo',
    ]},

  { slug: 'ocbd-oxford-button-down', category: 'style',
    queries: [
      'Spier Mackay Oxford Cloth Button Down shirt product photo',
      '"Spier & Mackay" OCBD shirt product image buy',
      '"Spier and Mackay" oxford button down shirt light blue product photo',
    ]},

  { slug: 'common-projects-achilles-low', category: 'style',
    queries: [
      'Common Projects Achilles Low white sneaker product photo site:commonprojects.com',
      '"Common Projects" Achilles Low white leather sneaker buy official',
      'Common Projects Achilles Low white buy site:mrporter.com',
    ]},

  { slug: 'beckett-simonon-chukka', category: 'style',
    queries: [
      'Beckett Simonon Holt chukka boot tan suede product photo',
      '"Beckett Simonon" chukka boot product photo buy',
      'Beckett Simonon Holt suede chukka official photo site:beckettsimonon.com',
    ]},

  { slug: 'buck-mason-curved-hem-tee', category: 'style',
    queries: [
      'Buck Mason Curved Hem Slub Tee white shirt product photo',
      '"Buck Mason" curved hem tee product image buy',
      'Buck Mason slub tee product photo site:buckmason.com',
    ]},

  { slug: 'therealreal-vintage-leather-bomber', category: 'style',
    queries: [
      'men leather bomber jacket vintage black TheRealReal product photo',
      'leather bomber jacket men resale product photo buy',
    ]},

  { slug: 'dior-sauvage-edt', category: 'style',
    queries: [
      'Dior Sauvage EDT product photo site:sephora.com',
      '"Dior Sauvage" eau de toilette bottle product photo official',
      'Dior Sauvage EDT buy official fragrance bottle photo',
    ]},
];

async function searchForImage(query) {
  const prompt = `Search for: "${query}"

Find a direct URL to a high-quality product photo (JPG, PNG, or WebP) — the official product image or clean product photography.

Return any direct image URLs you find (.jpg, .png, .webp), and the page URLs where you found them.`;

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1',
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    });

    const citedUrls = [];
    (response.output || []).forEach(block => {
      if (block.type === 'message') {
        (block.content || []).forEach(c => {
          (c.annotations || []).forEach(a => {
            if (a.type === 'url_citation' && a.url) citedUrls.push(a.url);
          });
        });
      }
    });

    const text = (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .filter(c => c?.type === 'output_text' || c?.type === 'text')
      .map(c => c.text || '')
      .join('');

    const directImgs = (text.match(
      /https?:\/\/[^\s"'<>)\]]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>)\]]*)?/gi
    ) || []).filter(u => !u.includes('data:'));

    return { citedUrls, directImgs };
  } catch (err) {
    console.error(`    search error: ${err.message}`);
    return { citedUrls: [], directImgs: [] };
  }
}

async function resolveImage({ citedUrls, directImgs }) {
  for (const url of directImgs.slice(0, 10)) {
    try {
      if (await isLiveImage(url)) return url;
    } catch {}
  }
  for (const url of citedUrls.slice(0, 8)) {
    try {
      const og = await extractOgImage(url);
      if (og && await isLiveImage(og)) return og;
    } catch {}
  }
  return null;
}

async function downloadImage(imageUrl, destPath) {
  if (!imageUrl) return false;
  try {
    const r = spawnSync(
      'curl', ['-s', '-L', '-o', destPath, '--max-time', '20',
               '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
               imageUrl],
      { encoding: 'buffer' }
    );
    if (r.status !== 0) return false;
    const stat = fs.statSync(destPath);
    if (stat.size < 5000) { try { fs.unlinkSync(destPath); } catch {} return false; }
    console.log(`    ✓ ${Math.round(stat.size / 1024)}KB → ${path.basename(destPath)}`);
    return true;
  } catch { return false; }
}

async function main() {
  const results = { ok: [], fail: [] };

  for (const target of TARGETS) {
    const imgPath = path.join(ROOT, 'assets/guide', target.category, `${target.slug}.jpg`);

    if (fs.existsSync(imgPath) && fs.statSync(imgPath).size > 5000) {
      console.log(`  ↩ ${target.slug}: already exists`);
      continue;
    }

    console.log(`\n[${target.category}] ${target.slug}`);

    let found = false;
    for (const query of target.queries) {
      console.log(`    query: ${query.slice(0, 70)}`);
      const searchResult = await searchForImage(query);
      const imageUrl = await resolveImage(searchResult);

      if (imageUrl) {
        console.log(`    found: ${imageUrl.slice(0, 80)}`);
        found = await downloadImage(imageUrl, imgPath);
        if (found) break;
      }

      await new Promise(r => setTimeout(r, 600));
    }

    if (found) results.ok.push(target.slug);
    else { results.fail.push(target.slug); console.log('    ✗ still no image'); }
  }

  console.log('\n══════════ PASS 2 RESULTS ══════════');
  console.log(`Downloaded: ${results.ok.length} — ${results.ok.join(', ')}`);
  if (results.fail.length) console.log(`Still missing: ${results.fail.join(', ')}`);
}

main().catch(console.error);

#!/usr/bin/env node
'use strict';

/**
 * fetch-guide-images.js
 *
 * For each Guide pick across all four categories:
 *  1. Uses OpenAI web search to find the official product page + image
 *  2. Extracts og:image from found pages (same pattern as the brief pipeline)
 *  3. Downloads the image to /assets/guide/<category>/<slug>.jpg
 *  4. Verifies current HTML links and patches any 404s with the found URL
 *
 * Run from project root:
 *   node scripts/fetch-guide-images.js
 */

require('dotenv').config({ path: '.env.local' });

const OpenAI  = require('openai');
const fs      = require('fs');
const path    = require('path');
const { spawnSync } = require('child_process');
const { extractOgImage, isLiveImage } = require('./lib/images');

const ROOT   = path.join(__dirname, '..');
const client = new (OpenAI.default || OpenAI)({ apiKey: process.env.OPENAI_API_KEY });

// ─── Pick manifest ──────────────────────────────────────────────────────────
// currentUrl = what's in the HTML right now; used for targeted replacement if
// we find a better / working URL via search.

const ALL_PICKS = [
  // ── BOURBON & CIGARS ──────────────────────────────────────────────────────
  { slug: 'buffalo-trace',          category: 'bourbon-cigars',
    productSearch: 'Buffalo Trace Kentucky Straight Bourbon 750ml bottle official',
    preferredDomains: ['reservebar.com', 'totalwine.com'],
    currentUrl: 'https://www.reservebar.com/products/buffalo-trace-bourbon?ref=guytalk' },

  { slug: 'wild-turkey-101',        category: 'bourbon-cigars',
    productSearch: 'Wild Turkey 101 Proof Bourbon 750ml bottle official',
    preferredDomains: ['totalwine.com', 'reservebar.com'],
    currentUrl: 'https://www.totalwine.com/search/all?text=wild+turkey+101' },

  { slug: 'four-roses-single-barrel', category: 'bourbon-cigars',
    productSearch: 'Four Roses Single Barrel Bourbon 750ml bottle official',
    preferredDomains: ['reservebar.com', 'totalwine.com'],
    currentUrl: 'https://www.reservebar.com/products/four-roses-single-barrel-select-bourbon-whisky?ref=guytalk' },

  { slug: 'eagle-rare-10',          category: 'bourbon-cigars',
    productSearch: 'Eagle Rare 10 Year Single Barrel Bourbon bottle official',
    preferredDomains: ['totalwine.com', 'reservebar.com'],
    currentUrl: 'https://www.totalwine.com/search/all?text=eagle+rare+10+year' },

  { slug: 'blantons-single-barrel', category: 'bourbon-cigars',
    productSearch: "Blanton's Original Single Barrel Bourbon 750ml bottle official",
    preferredDomains: ['reservebar.com', 'totalwine.com'],
    currentUrl: 'https://www.reservebar.com/collections/blantons' },

  { slug: 'pappy-van-winkle-take',  category: 'bourbon-cigars',
    productSearch: 'W.L. Weller 12 Year Bourbon bottle official',
    preferredDomains: ['totalwine.com', 'reservebar.com'],
    currentUrl: 'https://www.totalwine.com/search/all?text=weller+12+year+bourbon' },

  { slug: 'oliva-serie-v',          category: 'bourbon-cigars',
    productSearch: 'Oliva Serie V Torpedo cigar official product photo',
    preferredDomains: ['famous-smoke.com', 'cigarsintl.com'],
    currentUrl: 'https://www.famous-smoke.com/oliva-serie-v-cigars?ref=guytalk' },

  { slug: 'arturo-fuente-hemingway', category: 'bourbon-cigars',
    productSearch: 'Arturo Fuente Hemingway Short Story cigar official product photo',
    preferredDomains: ['famous-smoke.com', 'jrcigar.com'],
    currentUrl: 'https://www.famous-smoke.com/arturo-fuente-cigars?ref=guytalk' },

  { slug: 'glencairn-glass-set',    category: 'bourbon-cigars',
    productSearch: 'Glencairn whisky glass set of 2 official product photo',
    preferredDomains: ['amazon.com', 'glencairn.co.uk'],
    currentUrl: 'https://www.amazon.com/s?k=Glencairn+whisky+glass+set&tag=guytalk-20' },

  { slug: 'king-ice-cube-mold',     category: 'bourbon-cigars',
    productSearch: 'Tovolo King Cube silicone ice tray official product photo',
    preferredDomains: ['amazon.com', 'tovolo.com'],
    currentUrl: 'https://www.amazon.com/s?k=Tovolo+King+Cube+ice+tray&tag=guytalk-20' },

  // ── WATCHES ───────────────────────────────────────────────────────────────
  { slug: 'seiko-5-sports',         category: 'watches',
    productSearch: 'Seiko 5 Sports SRPD55 automatic watch official product photo',
    preferredDomains: ['seikousa.com', 'amazon.com'],
    currentUrl: 'https://www.amazon.com/s?k=Seiko+5+Sports+SRPD&tag=guytalk-20' },

  { slug: 'hamilton-khaki-field',   category: 'watches',
    productSearch: 'Hamilton Khaki Field Mechanical 38mm watch official product photo',
    preferredDomains: ['hamiltonwatch.com'],
    currentUrl: 'https://www.hamiltonwatch.com/en-us/collection/khaki-field/' },

  { slug: 'tissot-prx-powermatic',  category: 'watches',
    productSearch: 'Tissot PRX Powermatic 80 blue dial watch official product photo',
    preferredDomains: ['tissotwatches.com'],
    currentUrl: 'https://www.tissotwatches.com/en-us/collection/prx.html' },

  { slug: 'tudor-black-bay',        category: 'watches',
    productSearch: 'Tudor Black Bay 58 navy blue watch official product photo',
    preferredDomains: ['tudorwatch.com'],
    currentUrl: 'https://www.tudorwatch.com/watches/black-bay' },

  // rolex-take card shows Tudor image — same search as above
  { slug: 'rolex-submariner-take',  category: 'watches',
    productSearch: 'Tudor Black Bay 58 watch on wrist official photo',
    preferredDomains: ['tudorwatch.com'],
    currentUrl: 'https://www.tudorwatch.com/watches/black-bay' },

  { slug: 'casio-world-time',       category: 'watches',
    productSearch: 'Casio A158WA-1 stainless steel digital watch official product photo',
    preferredDomains: ['amazon.com', 'casiomx.com'],
    currentUrl: 'https://www.amazon.com/s?k=Casio+A158WA&tag=guytalk-20' },

  // fashion-brand-watch-take card shows Seiko 5 as the alternative
  { slug: 'fashion-brand-watch-take', category: 'watches',
    productSearch: 'Seiko 5 Sports SRPD51 black automatic watch official product photo',
    preferredDomains: ['seikousa.com', 'amazon.com'],
    currentUrl: 'https://www.amazon.com/s?k=Seiko+5+Sports+SRPD&tag=guytalk-20' },

  { slug: 'leather-nato-strap',     category: 'watches',
    productSearch: 'Barton watch band quick release leather NATO strap official product photo',
    preferredDomains: ['amazon.com', 'bartonwatchbands.com'],
    currentUrl: 'https://www.amazon.com/s?k=Barton+quick+release+watch+strap&tag=guytalk-20' },

  // ── CARS ──────────────────────────────────────────────────────────────────
  { slug: 'mazda-miata-mx5',        category: 'cars',
    productSearch: 'Mazda MX-5 Miata roadster official press photo 2024',
    preferredDomains: ['media.mazdausa.com', 'mazdausa.com'],
    currentUrl: 'https://www.carsandbids.com/search#?q=miata' },

  { slug: 'used-porsche-911',       category: 'cars',
    productSearch: 'Porsche 911 Carrera official press photo silver',
    preferredDomains: ['newsroom.porsche.com', 'media.porsche.com'],
    currentUrl: 'https://bringatrailer.com/porsche/911/' },

  // leased-amg-take shows a Miata as the editorial alternative
  { slug: 'leased-amg-take',        category: 'cars',
    productSearch: 'Mazda MX-5 Miata driving action photo red convertible',
    preferredDomains: ['mazdausa.com', 'media.mazdausa.com'],
    currentUrl: 'https://www.carsandbids.com/search#?q=miata' },

  { slug: 'noco-boost-jump-starter', category: 'cars',
    productSearch: 'NOCO Boost Plus GB40 lithium jump starter official product photo',
    preferredDomains: ['amazon.com', 'nocoproducts.com'],
    currentUrl: 'https://www.amazon.com/s?k=NOCO+Boost+Plus+GB40&tag=guytalk-20' },

  { slug: 'viofo-dash-cam',         category: 'cars',
    productSearch: 'VIOFO A139 Pro dash camera official product photo',
    preferredDomains: ['amazon.com', 'viofo.com'],
    currentUrl: 'https://www.amazon.com/s?k=VIOFO+A139+dash+cam&tag=guytalk-20' },

  { slug: 'chemical-guys-wash-kit', category: 'cars',
    productSearch: 'Chemical Guys car wash kit detailing products official product photo',
    preferredDomains: ['chemicalguys.com', 'amazon.com'],
    currentUrl: 'https://www.amazon.com/s?k=Chemical+Guys+car+wash+starter+kit&tag=guytalk-20' },

  { slug: 'weathertech-floor-mats', category: 'cars',
    productSearch: 'WeatherTech FloorLiner car floor mat official product photo',
    preferredDomains: ['weathertech.com'],
    currentUrl: 'https://www.weathertech.com/vehicle-protectors/floor-mats/floor-liners-hp/' },

  { slug: 'leather-honey-conditioner', category: 'cars',
    productSearch: 'Leather Honey leather conditioner bottle official product photo',
    preferredDomains: ['amazon.com'],
    currentUrl: 'https://www.amazon.com/s?k=Leather+Honey+conditioner&tag=guytalk-20' },

  // ── STYLE ─────────────────────────────────────────────────────────────────
  { slug: 'peter-millar-crown-comfort-polo', category: 'style',
    productSearch: 'Peter Millar Crown Comfort Pima Cotton polo shirt product photo navy',
    preferredDomains: ['petermillar.com', 'millarstore.com'],
    currentUrl: 'https://www.petermillar.com/mens/shirts-polos/polos?ref=guytalk' },

  { slug: 'ocbd-oxford-button-down', category: 'style',
    productSearch: 'Spier Mackay Oxford Cloth Button Down shirt blue product photo',
    preferredDomains: ['spierandmackay.com'],
    currentUrl: 'https://www.spierandmackay.com/collections/dress-shirts' },

  { slug: 'common-projects-achilles-low', category: 'style',
    productSearch: 'Common Projects Achilles Low white leather sneaker official product photo',
    preferredDomains: ['commonprojects.com'],
    currentUrl: 'https://www.commonprojects.com/collections/achilles' },

  { slug: 'apc-petit-standard-denim', category: 'style',
    productSearch: 'A.P.C. Petit Standard raw selvedge denim jeans official product photo',
    preferredDomains: ['apcus.com', 'mrporter.com'],
    currentUrl: 'https://www.apcus.com/en-us/collections/men-jeans' },

  { slug: 'taylor-stitch-chore-coat', category: 'style',
    productSearch: 'Taylor Stitch Ojai Chore Coat olive jacket official product photo',
    preferredDomains: ['taylorstitch.com'],
    currentUrl: 'https://www.taylorstitch.com/collections/the-ojai-jacket' },

  { slug: 'uniqlo-merino-crew',     category: 'style',
    productSearch: 'Uniqlo Extra Fine Merino Crewneck Sweater navy official product photo',
    preferredDomains: ['uniqlo.com'],
    currentUrl: 'https://www.uniqlo.com/us/en/feature/men-merino' },

  { slug: 'buck-mason-curved-hem-tee', category: 'style',
    productSearch: 'Buck Mason Curved Hem Slub Tee white shirt official product photo',
    preferredDomains: ['buckmason.com'],
    currentUrl: 'https://www.buckmason.com/collections/t-shirts' },

  { slug: 'todd-snyder-stretch-chino', category: 'style',
    productSearch: 'Todd Snyder Slim Fit Stretch Chino pants khaki official product photo',
    preferredDomains: ['toddsnyder.com'],
    currentUrl: 'https://www.toddsnyder.com/collections/pants' },

  { slug: 'beckett-simonon-chukka', category: 'style',
    productSearch: 'Beckett Simonon Holt suede chukka boot tan official product photo',
    preferredDomains: ['beckettsimonon.com'],
    currentUrl: 'https://www.beckettsimonon.com/collections/chukka-boots' },

  { slug: 'therealreal-vintage-leather-bomber', category: 'style',
    productSearch: 'leather bomber jacket men vintage resale product photo',
    preferredDomains: ['therealreal.com', 'grailed.com'],
    currentUrl: 'https://www.therealreal.com/search?query=leather+bomber' },

  { slug: 'le-labo-santal-33',      category: 'style',
    productSearch: 'Le Labo Santal 33 perfume bottle official product photo',
    preferredDomains: ['lelabofragrances.com', 'sephora.com'],
    currentUrl: 'https://www.lelabofragrances.com/santal-33.html' },

  { slug: 'byredo-mister-marvelous', category: 'style',
    productSearch: 'Byredo Mister Marvelous fragrance bottle official product photo',
    preferredDomains: ['byredo.com', 'sephora.com'],
    currentUrl: 'https://www.byredo.com/us_en/mister-marvelous.html' },

  { slug: 'dior-sauvage-edt',       category: 'style',
    productSearch: 'Dior Sauvage Eau de Toilette fragrance bottle official product photo',
    preferredDomains: ['dior.com', 'sephora.com'],
    currentUrl: 'https://www.sephora.com/search#q=dior%20sauvage%20edt' },
];

// ─── HTML file map ───────────────────────────────────────────────────────────
const HTML_FILES = {
  'bourbon-cigars': path.join(ROOT, 'guide/bourbon-cigars/index.html'),
  'watches':        path.join(ROOT, 'guide/watches/index.html'),
  'cars':           path.join(ROOT, 'guide/cars/index.html'),
  'style':          path.join(ROOT, 'guide/style/index.html'),
};

// Also patch the hub (guide/index.html) for style picks that appear there
const HUB_HTML = path.join(ROOT, 'guide/index.html');

// ─── Search ──────────────────────────────────────────────────────────────────
async function searchProduct(pick) {
  const prompt = `Search for this product and find:
1. The specific product page URL on the retailer's site (deep link to the exact item)
2. A direct URL to the product image (JPG, PNG, or WebP)

Product: "${pick.productSearch}"
Preferred retailers/sources: ${pick.preferredDomains.join(', ')}

Search the web and find both the product page and an official product photo URL.`;

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

    // Direct image URLs in text (fast path)
    const directImgs = (text.match(
      /https?:\/\/[^\s"'<>)\]]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>)\]]*)?/gi
    ) || []).filter(u => !u.includes('data:'));

    return { citedUrls, directImgs, text };
  } catch (err) {
    console.error(`    search error: ${err.message}`);
    return { citedUrls: [], directImgs: [], text: '' };
  }
}

// ─── Image resolution ────────────────────────────────────────────────────────
async function resolveImage({ citedUrls, directImgs }) {
  // 1. Try direct image URLs found in the response text
  for (const url of directImgs.slice(0, 10)) {
    try {
      if (await isLiveImage(url)) {
        console.log(`    img (direct): ${url.slice(0, 80)}`);
        return url;
      }
    } catch {}
  }

  // 2. Try og:image from each cited product page
  for (const url of citedUrls.slice(0, 8)) {
    try {
      const og = await extractOgImage(url);
      if (og && await isLiveImage(og)) {
        console.log(`    img (og): ${og.slice(0, 80)}`);
        return og;
      }
    } catch {}
  }

  return null;
}

// ─── URL resolution ──────────────────────────────────────────────────────────
function resolveProductUrl(citedUrls, preferredDomains) {
  // Find a citation from a preferred domain that looks like a product page (depth >= 3)
  for (const domain of preferredDomains) {
    const match = citedUrls.find(u => {
      try {
        const parsed = new URL(u);
        const host = parsed.hostname.replace(/^www\./, '');
        const depth = parsed.pathname.split('/').filter(Boolean).length;
        return (host === domain || host.endsWith('.' + domain)) && depth >= 2;
      } catch { return false; }
    });
    if (match) return match;
  }
  return null;
}

// ─── Download ─────────────────────────────────────────────────────────────────
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
    if (stat.size < 2000) { try { fs.unlinkSync(destPath); } catch {} return false; }
    console.log(`    ✓ ${Math.round(stat.size / 1024)}KB → ${path.basename(destPath)}`);
    return true;
  } catch { return false; }
}

// ─── HTML patching ────────────────────────────────────────────────────────────
function patchHtml(htmlPath, oldUrl, newUrl) {
  if (!oldUrl || !newUrl || oldUrl === newUrl) return false;
  // Don't downgrade a specific URL to a search/category
  if (/[?#]q=|search\?|\/search|\/collections\/|\/category/i.test(newUrl)
   && !/[?#]q=|search\?|\/search|\/collections\/|\/category/i.test(oldUrl)) {
    return false; // old URL is already more specific
  }
  let html = fs.readFileSync(htmlPath, 'utf8');
  const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  if (!re.test(html)) return false;
  const updated = html.replace(new RegExp(escaped, 'g'), newUrl);
  if (updated !== html) {
    fs.writeFileSync(htmlPath, updated);
    return true;
  }
  return false;
}

// ─── Link verifier ───────────────────────────────────────────────────────────
async function checkUrl(url) {
  if (!url || /[?#]q=|\/search|\/collections\/|\/s\?/.test(url)) return 'search'; // search pages skip check
  try {
    const r = spawnSync(
      'curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-L',
               '--max-time', '10', '-A', 'Mozilla/5.0', url],
      { encoding: 'utf8' }
    );
    return (r.stdout || '').trim();
  } catch { return 'err'; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set');
    process.exit(1);
  }

  const results = [];
  let imgOk = 0, imgFail = 0, urlFixed = 0;

  for (const pick of ALL_PICKS) {
    const imgDir  = path.join(ROOT, 'assets/guide', pick.category);
    const imgPath = path.join(imgDir, `${pick.slug}.jpg`);
    const htmlPath = HTML_FILES[pick.category];

    // Skip if image already downloaded
    const imgExists = fs.existsSync(imgPath) && fs.statSync(imgPath).size > 2000;

    console.log(`\n[${pick.category}] ${pick.slug}`);

    // 1. Check current URL
    const urlStatus = await checkUrl(pick.currentUrl);
    const urlOk = urlStatus === '200' || urlStatus === 'search';
    if (!urlOk) console.log(`    link ${urlStatus}: ${pick.currentUrl.slice(0, 70)}`);

    // 2. Search (skip if image already OK and URL is fine)
    let imageUrl = null, foundProductUrl = null;
    if (!imgExists || !urlOk) {
      const searchResult = await searchProduct(pick);
      foundProductUrl = resolveProductUrl(searchResult.citedUrls, pick.preferredDomains);
      if (!imgExists) imageUrl = await resolveImage(searchResult);
    } else {
      console.log(`    img exists ✓, url ok ✓ — skipping search`);
    }

    // 3. Download image
    let imgDownloaded = imgExists;
    if (!imgExists) {
      if (imageUrl) {
        imgDownloaded = await downloadImage(imageUrl, imgPath);
        if (imgDownloaded) imgOk++; else imgFail++;
      } else {
        console.log('    ✗ no image found');
        imgFail++;
      }
    }

    // 4. Patch URL if we found a better one and current is broken
    let urlPatched = false;
    if (!urlOk && foundProductUrl && foundProductUrl !== pick.currentUrl) {
      // Patch all HTML files that reference this URL (category + hub)
      for (const p of [htmlPath, HUB_HTML]) {
        if (patchHtml(p, pick.currentUrl, foundProductUrl)) {
          console.log(`    ✓ patched url → ${foundProductUrl.slice(0, 70)}`);
          urlPatched = true;
          urlFixed++;
        }
      }
    }

    results.push({
      slug: pick.slug,
      category: pick.category,
      imgDownloaded,
      imageUrl: imgExists ? 'pre-existing' : (imageUrl || null),
      urlStatus,
      urlPatched,
      newUrl: urlPatched ? foundProductUrl : null,
    });

    // Rate-limit to avoid hammering OpenAI
    await new Promise(r => setTimeout(r, 900));
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\n══════════ RESULTS ══════════');
  console.log(`Images downloaded: ${imgOk}`);
  console.log(`Images not found:  ${imgFail}`);
  console.log(`Links patched:     ${urlFixed}`);

  const missing = results.filter(r => !r.imgDownloaded);
  if (missing.length) {
    console.log('\nMissing images (will use letter placeholder):');
    missing.forEach(r => console.log(`  • ${r.category}/${r.slug}`));
  }

  const broken = results.filter(r => r.urlStatus !== '200' && r.urlStatus !== 'search' && !r.urlPatched);
  if (broken.length) {
    console.log('\nLinks still unresolved:');
    broken.forEach(r => console.log(`  • ${r.category}/${r.slug} (${r.urlStatus})`));
  }

  // Save full log
  fs.writeFileSync(
    path.join(ROOT, 'guide/data/guide-image-results.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('\nFull log → guide/data/guide-image-results.json');
}

main().catch(err => { console.error(err); process.exit(1); });

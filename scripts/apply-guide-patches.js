#!/usr/bin/env node
/**
 * apply-guide-patches.js
 *
 * The missing half of the weekly guide refresh: refresh-guide.js only ever
 * wrote {category}-patch.json suggestions — nothing consumed them, so the
 * Guide has never actually updated on a live product. This script is that
 * consumer. Run right after refresh-guide.js:
 *
 *   1. Price updates  -> patched into the matching .pick-card-price in place.
 *   2. Stale picks     -> removed from the category page and appended to
 *                         guide/data/archive.json (with a retiredDate), so
 *                         nothing is lost as products cycle out.
 *   3. New pick         -> appended to the category's picks-grid as a fresh
 *                         .pick-card (image sourcing is a separate step —
 *                         run scripts/fetch-guide-images.js afterward to
 *                         backfill a real photo; until then it degrades to
 *                         the same letter-placeholder every other card falls
 *                         back to on a broken image).
 *   4. guide/archive/index.html is regenerated in full from archive.json.
 *   5. Consumed patch files are deleted so a re-run doesn't double-apply.
 *
 * Safe to run with no patch files present (no-op).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'guide', 'data');
const ARCHIVE_JSON = path.join(DATA_DIR, 'archive.json');
const ARCHIVE_HTML = path.join(ROOT, 'guide', 'archive', 'index.html');

const CATEGORY_NAMES = {
  style: 'Style', watches: 'Watches', 'bourbon-cigars': 'Bourbon & Cigars',
  cars: 'Cars', fitness: 'Fitness', accessories: 'Accessories', golf: 'Golf',
  other: 'Other', 'self-care': 'Self-Care',
};

function htmlPathFor(catId) {
  return path.join(ROOT, 'guide', catId, 'index.html');
}

// ─── Pick-card block extraction (depth-counted, not regex-guessed) ─────────
function findPickCardBlocks(html) {
  const blocks = [];
  const marker = '<div class="pick-card">';
  let searchFrom = 0;
  while (true) {
    const start = html.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 1;
    let i = start + marker.length;
    const openRe = /<div\b[^>]*>/g;
    const closeRe = /<\/div>/g;
    while (depth > 0 && i < html.length) {
      openRe.lastIndex = i;
      closeRe.lastIndex = i;
      const nextOpen = html.slice(i).search(/<div\b[^>]*>/);
      const nextClose = html.slice(i).search(/<\/div>/);
      if (nextClose === -1) { i = html.length; break; }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i += nextOpen + html.slice(i + nextOpen).match(/<div\b[^>]*>/)[0].length;
      } else {
        depth--;
        i += nextClose + '</div>'.length;
      }
    }
    blocks.push({ start, end: i, text: html.slice(start, i) });
    searchFrom = i;
  }
  return blocks;
}

function extractField(block, cls) {
  const re = new RegExp(`class="${cls}"[^>]*>([^<]*)<`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function cardMatchesPick(block, pickText) {
  const brand = extractField(block, 'pick-card-brand').toLowerCase();
  const name  = extractField(block, 'pick-card-name').toLowerCase();
  const combined = `${brand} ${name}`;
  const needle = pickText.toLowerCase().replace(/~?\$[\d,.]+.*$/, '').trim();
  if (!needle) return false;
  // Match if every significant word of the pick name appears in the card's brand+name
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return false;
  return words.every((w) => combined.includes(w));
}

function newPickCardHtml(cat, pick) {
  const brand = pick.brand || '';
  const name  = pick.name || '';
  const initial = (brand[0] || name[0] || '?').toUpperCase();
  const price = pick.price || '';
  const tag   = pick.tag || 'GuyTalk Pick';
  const desc  = pick.description || '';
  const buyLink = pick.buyLink || `https://www.amazon.com/s?k=${encodeURIComponent(`${brand} ${name}`)}&tag=guytalk-20`;
  const slug = `${brand} ${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `      <div class="pick-card">
  <div class="pick-card-img">
    <img src="/assets/guide/${cat}/${slug}.jpg" alt="${escHtml(brand)} ${escHtml(name)}" loading="lazy"
         onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'pick-card-img-ph\\'><div class=\\'pick-card-img-ph-initial\\'>${escJsQuoted(initial)}</div><div class=\\'pick-card-img-ph-label\\'>${escJsQuoted(brand)}</div></div>'">
  </div>
  <div class="pick-card-body">
    <div class="pick-card-tag"><span class="gtag gtag-blue">${escHtml(tag)}</span></div>
    <div class="pick-card-brand">${escHtml(brand)}</div>
    <div class="pick-card-name">${escHtml(name)}</div>
    <div class="pick-card-price">${escHtml(price)}</div>
    <p class="pick-card-bio">${escHtml(desc)}</p>
    <a href="#" class="pick-card-buy">Learn More →</a>
    <a href="${escHtml(buyLink)}" class="pick-card-shop" target="_blank" rel="noopener nofollow">Shop on Amazon →</a>
  </div>
</div>
`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The onerror fallback is HTML written inside a JS string that's itself inside
// an HTML attribute — apostrophes there need a backslash (matching the \' the
// template already uses for class='...') or they close the JS string early and
// silently break the fallback (e.g. "Kiehl's" -> broken image, not the letter
// placeholder). escHtml() alone does not cover this — always use this for any
// brand/label text placed inside that onerror string.
function escJsQuoted(s) {
  return escHtml(s).replace(/'/g, "\\'");
}

// Reverse of escHtml — used when pulling text OUT of existing HTML into JSON/
// plain-text storage (archive.json), so it isn't double-escaped when later
// rendered back into HTML via escHtml().
function unescHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_JSON)) return {};
  try { return JSON.parse(fs.readFileSync(ARCHIVE_JSON, 'utf8')); } catch { return {}; }
}

function saveArchive(archive) {
  fs.writeFileSync(ARCHIVE_JSON, JSON.stringify(archive, null, 2));
}

function applyPatchToCategory(catId, patch, archive) {
  const htmlPath = htmlPathFor(catId);
  if (!fs.existsSync(htmlPath)) {
    console.warn(`  no HTML file for category "${catId}" — skipping`);
    return;
  }
  let html = fs.readFileSync(htmlPath, 'utf8');
  let changed = false;
  const today = new Date().toISOString().slice(0, 10);

  // 1. Price updates
  for (const upd of (patch.priceUpdates || [])) {
    const blocks = findPickCardBlocks(html);
    const target = blocks.find((b) => cardMatchesPick(b.text, upd.pick));
    if (!target) continue;
    const newBlockText = target.text.replace(
      /(class="pick-card-price">)[^<]*(<)/,
      (_, g1, g2) => g1 + escHtml(upd.newPrice) + g2
    );
    if (newBlockText !== target.text) {
      html = html.slice(0, target.start) + newBlockText + html.slice(target.end);
      changed = true;
      console.log(`  price: ${upd.pick} -> ${upd.newPrice}`);
    }
  }

  // 2. Stale picks -> archive + remove
  for (const staleName of (patch.stalePicks || [])) {
    const blocks = findPickCardBlocks(html);
    const target = blocks.find((b) => cardMatchesPick(b.text, staleName));
    if (!target) continue;
    const brand = unescHtml(extractField(target.text, 'pick-card-brand'));
    const name  = unescHtml(extractField(target.text, 'pick-card-name'));
    const price = unescHtml(extractField(target.text, 'pick-card-price'));
    const bioMatch = target.text.match(/class="pick-card-bio">([^<]*)</);
    archive[catId] = archive[catId] || [];
    archive[catId].push({
      brand, name, price, description: bioMatch ? unescHtml(bioMatch[1].trim()) : '',
      retiredDate: today,
    });
    html = html.slice(0, target.start) + html.slice(target.end);
    changed = true;
    console.log(`  archived stale pick: ${brand} ${name}`);
  }

  // 3. New pick -> append to picks-grid
  if (patch.newPick && patch.newPick.name) {
    const gridClose = html.indexOf('</div>', html.lastIndexOf('<div class="picks-grid">'));
    // Insert right before the picks-grid's own closing </div> — find it properly
    // by locating the grid start and walking to its matching close.
    const gridStart = html.indexOf('<div class="picks-grid">');
    if (gridStart !== -1) {
      const blocks = findPickCardBlocks(html);
      const lastCardInGrid = blocks.filter((b) => b.start > gridStart).pop();
      const insertAt = lastCardInGrid ? lastCardInGrid.end : gridStart + '<div class="picks-grid">'.length;
      const cardHtml = newPickCardHtml(catId, patch.newPick);
      html = html.slice(0, insertAt) + '\n' + cardHtml + html.slice(insertAt);
      changed = true;
      console.log(`  added new pick: ${patch.newPick.brand} ${patch.newPick.name}`);
    }
  }

  if (changed) fs.writeFileSync(htmlPath, html);
  return changed;
}

// ─── Archive page (static, regenerated in full each run) ───────────────────
function buildArchivePage(archive) {
  const sections = Object.keys(CATEGORY_NAMES)
    .filter((catId) => (archive[catId] || []).length)
    .map((catId) => {
      const items = archive[catId].slice().sort((a, b) => (b.retiredDate || '').localeCompare(a.retiredDate || ''));
      const cards = items.map((it) => `
      <div class="pick-card">
        <div class="pick-card-img"><div class="pick-card-img-ph"><div class="pick-card-img-ph-initial">${escHtml((it.brand || it.name || '?')[0].toUpperCase())}</div><div class="pick-card-img-ph-label">${escHtml(it.brand)}</div></div></div>
        <div class="pick-card-body">
          <div class="pick-card-tag"><span class="gtag gtag-gray">Retired ${escHtml(it.retiredDate || '')}</span></div>
          <div class="pick-card-brand">${escHtml(it.brand)}</div>
          <div class="pick-card-name">${escHtml(it.name)}</div>
          <div class="pick-card-price">${escHtml(it.price)}</div>
          <p class="pick-card-bio">${escHtml(it.description)}</p>
        </div>
      </div>`).join('');
      return `
    <div class="guide-section">
      <div class="gc">
        <div class="gsec-eyebrow">Previously Recommended</div>
        <div class="gsec-title">${escHtml(CATEGORY_NAMES[catId])}</div>
        <div class="picks-grid">${cards}
        </div>
      </div>
    </div>`;
    }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Archive — The GuyTalk Guide</title>
<meta name="description" content="Every product GuyTalk has recommended and since cycled out — kept here for the record.">
<link rel="canonical" href="https://www.guytalkmedia.com/guide/archive/">
<link rel="icon" href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap" rel="stylesheet">
<style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #F9F8F5; --surface: #FFFFFF; --surface-2: #F2F0EB;
    --border: #E5E2DB; --border-light: #D4D0C8;
    --text: #0F1724; --text-2: #6E6862; --text-3: #9E9891;
    --accent: #2B6FFF;
  }
  body { background:var(--bg);color:var(--text);font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased; }
  a { color:var(--accent);text-decoration:none; }
  .gc{max-width:1120px;margin:0 auto;padding:0 24px;}
  .top-nav{background:#111;padding:18px 24px;}
  .top-nav a{color:#fff;font-family:'Inter Tight',sans-serif;font-weight:800;text-decoration:none;}
  .hero{padding:56px 24px 32px;max-width:1120px;margin:0 auto;}
  .hero h1{font-family:'Inter Tight',sans-serif;font-weight:900;font-size:clamp(28px,5vw,44px);letter-spacing:-.03em;margin-bottom:10px;}
  .hero p{color:var(--text-2);max-width:560px;}
  .guide-section{padding:32px 0;}
  .gsec-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
  .gsec-title{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:clamp(20px,3vw,28px);letter-spacing:-.02em;margin-bottom:20px;}
  .picks-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
  @media(max-width:900px){.picks-grid{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:540px){.picks-grid{grid-template-columns:1fr;}}
  .pick-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;opacity:0.85;}
  .pick-card-img{height:180px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;}
  .pick-card-img-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;width:100%;}
  .pick-card-img-ph-initial{font-family:'Inter Tight',sans-serif;font-weight:900;font-size:44px;color:var(--border-light);line-height:1;}
  .pick-card-img-ph-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);}
  .pick-card-body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1;}
  .pick-card-tag{margin-bottom:8px;}
  .gtag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:4px;}
  .gtag-gray{background:var(--surface-2);color:var(--text-3);}
  .pick-card-brand{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-2);margin-bottom:2px;}
  .pick-card-name{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:15px;margin-bottom:6px;}
  .pick-card-price{font-size:13px;font-weight:700;color:var(--text-3);margin-bottom:8px;text-decoration:line-through;}
  .pick-card-bio{font-size:13.5px;color:var(--text-2);line-height:1.5;}
</style>
</head>
<body>
<div class="top-nav"><a href="/guide/">← Back to the Guide</a></div>
<div class="hero">
  <h1>The Archive</h1>
  <p>Every product we've recommended and since cycled out as something better came along. Nothing gets deleted — it just moves here.</p>
</div>
${sections || '<div class="hero"><p>Nothing retired yet — check back as picks rotate.</p></div>'}
</body>
</html>
`;
}

function main() {
  const archive = loadArchive();
  const patchFiles = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('-patch.json'));

  if (!patchFiles.length) {
    console.log('No patch files to apply.');
  } else {
    for (const file of patchFiles) {
      const catId = file.replace(/-patch\.json$/, '');
      const patch = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      console.log(`Applying patch: ${catId}`);
      applyPatchToCategory(catId, patch, archive);
      fs.unlinkSync(path.join(DATA_DIR, file)); // consumed
    }
    saveArchive(archive);
  }

  fs.mkdirSync(path.dirname(ARCHIVE_HTML), { recursive: true });
  fs.writeFileSync(ARCHIVE_HTML, buildArchivePage(archive));
  console.log('Archive page written -> guide/archive/index.html');
}

main();

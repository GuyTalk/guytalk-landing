'use strict';
// Adds the inline subscribe CTA before the markets section in all existing brief HTML files
// Run once: node scripts/add-brief-cta.js

const fs   = require('fs');
const path = require('path');

const briefDir = path.join(__dirname, '..', 'brief');
const issues   = fs.readdirSync(briefDir)
  .filter(d => /^issue-\d+$/.test(d))
  .sort();

const CTA_HTML = `<div class="brief-inline-cta">
  <div class="bic-inner">
    <div class="bic-label">Free · Daily · 5 Minutes</div>
    <p class="bic-text">Get GuyTalk in your inbox every morning — before you check anything else.</p>
  </div>
  <a href="/#signup" class="bic-btn">Subscribe free →</a>
</div>

`;

let updated = 0, skipped = 0;

for (const dir of issues) {
  const htmlPath = path.join(briefDir, dir, 'index.html');
  if (!fs.existsSync(htmlPath)) { skipped++; continue; }

  let html = fs.readFileSync(htmlPath, 'utf8');

  if (html.includes('brief-inline-cta')) { skipped++; continue; }

  const marketsIdx = html.indexOf('<section class="brief-section" id="markets">');
  if (marketsIdx === -1) {
    console.log(`  SKIP ${dir} (no markets section found)`);
    skipped++;
    continue;
  }

  html = html.slice(0, marketsIdx) + CTA_HTML + html.slice(marketsIdx);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`  OK  ${dir}`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`);

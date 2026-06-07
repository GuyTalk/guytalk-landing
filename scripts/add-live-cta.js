'use strict';
// Backfills the GuyTalk Live nav link + cross-link CTA into every existing
// brief HTML file. Future briefs get these from the template (scripts/lib/html.js).
// Run once: node scripts/add-live-cta.js

const fs   = require('fs');
const path = require('path');

const briefDir = path.join(__dirname, '..', 'brief');
const issues = fs.readdirSync(briefDir)
  .filter(d => /^issue-\d+$/.test(d))
  .sort();

const NAV_LINK = `<a href="/live/" class="brief-nav-live"><span class="blc-dot"></span>Live</a>\n      `;

const LIVE_CTA = `<a href="/live/" class="brief-live-cta">
  <span class="blc-dot"></span>
  <div class="blc-inner">
    <div class="blc-label">Happening Now</div>
    <p class="blc-text">Scores, markets, and standings are moving as you read. Follow live updates on GuyTalk Live.</p>
  </div>
  <span class="blc-btn">Open GuyTalk Live →</span>
</a>

`;

let navAdded = 0, ctaAdded = 0, skipped = 0;

for (const dir of issues) {
  const htmlPath = path.join(briefDir, dir, 'index.html');
  if (!fs.existsSync(htmlPath)) { skipped++; continue; }

  let html = fs.readFileSync(htmlPath, 'utf8');
  let changed = false;

  // 1. Nav link — insert before the issue label in brief-nav-right.
  if (!html.includes('brief-nav-live')) {
    const navAnchor = '<span class="brief-nav-issue">';
    if (html.includes(navAnchor)) {
      html = html.replace(navAnchor, NAV_LINK + navAnchor);
      navAdded++; changed = true;
    }
  }

  // 2. Cross-link CTA — insert right before the sports section (after the lead).
  if (!html.includes('brief-live-cta')) {
    const sportsAnchor = '<section class="brief-section" id="sports">';
    const idx = html.indexOf(sportsAnchor);
    if (idx !== -1) {
      html = html.slice(0, idx) + LIVE_CTA + html.slice(idx);
      ctaAdded++; changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`  OK  ${dir}`);
  } else {
    skipped++;
  }
}

console.log(`\nDone: nav +${navAdded}, cta +${ctaAdded}, skipped ${skipped}`);

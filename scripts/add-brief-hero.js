'use strict';
// Adds the dark hero wrapper to all existing brief HTML files (issue-010 onward)
// Run once: node scripts/add-brief-hero.js

const fs   = require('fs');
const path = require('path');

const briefDir = path.join(__dirname, '..', 'brief');
const issues   = fs.readdirSync(briefDir)
  .filter(d => /^issue-\d+$/.test(d))
  .sort();

let updated = 0, skipped = 0;

for (const dir of issues) {
  const htmlPath = path.join(briefDir, dir, 'index.html');
  if (!fs.existsSync(htmlPath)) { skipped++; continue; }

  let html = fs.readFileSync(htmlPath, 'utf8');

  // Skip if already has hero wrapper
  if (html.includes('brief-hero-area')) { skipped++; continue; }

  // Skip if doesn't have the standard brief-pretitle + section-jump structure
  if (!html.includes('<div class="brief-pretitle">') || !html.includes('class="section-jump"')) {
    console.log(`  SKIP ${dir} (non-standard structure)`);
    skipped++;
    continue;
  }

  // Extract issue number from directory name
  const numMatch = dir.match(/issue-(\d+)/);
  const issueNum = numMatch ? parseInt(numMatch[1]) : 0;
  const issueLabel = '#' + String(issueNum).padStart(3, '0');

  // Strategy: extract the header block from inside <article> and move it before article
  // The header block is everything between <article ...> opening and <div class="tldr">
  const articleOpenRe = /(<article class="brief-article" id="briefArticle">)([\s\S]*?)(?=\s*<div class="tldr">)/;
  const match = articleOpenRe.exec(html);

  if (!match) {
    console.log(`  SKIP ${dir} (tldr pattern not found)`);
    skipped++;
    continue;
  }

  const headerBlock = match[2].trim(); // date, title, deck, meta, section-jump
  const heroHtml = `
<div class="brief-hero-area">
  <div class="brief-hero-inner">
    <div class="brief-hero-num">${issueLabel}</div>
    ${headerBlock}
  </div>
</div>

<article class="brief-article" id="briefArticle">

`;

  // Replace the article opening + header block with the new structure
  html = html.replace(articleOpenRe, heroHtml);

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`  OK  ${dir}`);
  updated++;
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`);

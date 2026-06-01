'use strict';

const fs   = require('fs');
const path = require('path');

// Builds /briefs/index.html from all brief/data/issue-NNN.json files
function buildArchive(rootDir) {
  const dataDir  = path.join(rootDir, 'brief', 'data');
  const outDir   = path.join(rootDir, 'briefs');

  const files = fs.readdirSync(dataDir)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort()
    .reverse(); // newest first

  const issues = files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    } catch (_) { return null; }
  }).filter(Boolean);

  const rows = issues.map(d => {
    const num  = String(d.num).padStart(3, '0');
    const slug = d.slug || `issue-${num}`;
    return `
      <a href="/brief/${slug}/" class="archive-row">
        <span class="ar-num">#${num}</span>
        <span class="ar-title">${escHtml(d.title || 'GuyTalk Brief')}</span>
        <span class="ar-date">${escHtml(d.date || '')}</span>
        <span class="ar-arrow">→</span>
      </a>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>All Issues — GuyTalk</title>
<meta name="description" content="Every GuyTalk brief — sports, markets, golf, and culture in five minutes a day.">
<link rel="icon" href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<meta property="og:title"       content="GuyTalk Archive">
<meta property="og:description" content="Every GuyTalk brief — browse all issues.">
<meta property="og:image"       content="https://www.guytalkmedia.com/assets/og-card.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #F9F8F5; --surface: #fff; --border: #E5E2DB; --border-light: #D4D0C8;
    --text: #0F1724; --text-2: #6E6862; --text-3: #9E9891;
    --accent: #2B6FFF; --accent-h: #1A5CEF; --accent-muted: #EBF1FF; --amber: #B87C35;
  }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg); color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased; line-height: 1.55;
  }
  a { color: inherit; text-decoration: none; }

  /* Nav */
  nav {
    position: sticky; top: 0; z-index: 50;
    background: rgba(249,248,245,0.92);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--border);
  }
  .nav-inner {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 24px; max-width: 760px; margin: 0 auto;
  }
  .wordmark { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 19px; letter-spacing: -0.03em; color: var(--text); }
  .wordmark .dot { color: var(--accent); }
  .nav-cta {
    font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
    padding: 7px 14px; background: var(--accent); color: white; border-radius: 7px;
    transition: background 0.15s ease;
  }
  .nav-cta:hover { background: var(--accent-h); }

  /* Main content */
  .archive-wrap { max-width: 760px; margin: 0 auto; padding: 52px 24px 80px; }
  .archive-pretitle {
    font-family: 'Inter Tight', sans-serif; font-weight: 600;
    font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 16px;
  }
  .archive-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 800;
    font-size: 40px; letter-spacing: -0.035em; line-height: 1.08; color: var(--text);
    margin-bottom: 10px;
  }
  .archive-sub { font-size: 17px; color: var(--text-2); margin-bottom: 40px; }
  .archive-count {
    font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-3);
    letter-spacing: 0.04em; padding-bottom: 16px;
    border-bottom: 2px solid var(--border); margin-bottom: 8px;
  }

  /* Archive rows */
  .archive-row {
    display: grid; grid-template-columns: 52px 1fr auto 28px;
    align-items: center; gap: 16px; padding: 16px 0;
    border-bottom: 1px solid var(--border);
    transition: background 0.12s ease;
  }
  .archive-row:hover { background: rgba(43,111,255,0.03); margin: 0 -12px; padding-left: 12px; padding-right: 12px; border-radius: 8px; }
  .archive-row:hover .ar-arrow { color: var(--accent); transform: translateX(3px); }
  .ar-num {
    font-family: 'JetBrains Mono', monospace; font-weight: 600;
    font-size: 12px; color: var(--accent); letter-spacing: 0.04em;
  }
  .ar-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 600;
    font-size: 16px; color: var(--text); line-height: 1.3;
  }
  .ar-date { font-size: 13px; color: var(--text-3); white-space: nowrap; text-align: right; }
  .ar-arrow { color: var(--border-light); font-size: 18px; transition: color 0.12s ease, transform 0.15s ease; }

  /* Footer */
  footer { border-top: 1px solid var(--border); padding: 32px 24px; text-align: center; }
  footer p { font-size: 13px; color: var(--text-3); margin-bottom: 6px; }
  footer a { color: var(--accent); }

  @media (max-width: 600px) {
    .archive-title { font-size: 30px; }
    .archive-row { grid-template-columns: 44px 1fr 20px; }
    .ar-date { display: none; }
    .archive-wrap { padding: 36px 18px 60px; }
  }
</style>
</head>
<body>

<nav>
  <div class="nav-inner">
    <a href="/" class="wordmark">GuyTalk<span class="dot">.</span></a>
    <a href="/#signup" class="nav-cta">Subscribe Free →</a>
  </div>
</nav>

<main class="archive-wrap">
  <div class="archive-pretitle">The Brief</div>
  <h1 class="archive-title">Every issue.</h1>
  <p class="archive-sub">Five minutes a day. Sports, markets, golf, and culture.</p>
  <div class="archive-count">${issues.length} issue${issues.length !== 1 ? 's' : ''} published</div>
  <div class="archive-list">
    ${rows}
  </div>
</main>

<footer>
  <p>GuyTalk — the daily brief for guys who want to stay sharp.</p>
  <p><a href="/">Home</a> · <a href="/#signup">Subscribe</a> · <a href="mailto:guytalkdaily@gmail.com">Contact</a></p>
</footer>

</body>
</html>`;

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { buildArchive };

'use strict';

const fs   = require('fs');
const path = require('path');

function buildTickerItems(issue) {
  const items = [];
  // Markets
  const m = issue.markets || {};
  const tickers = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'BTC'];
  for (const sym of tickers) {
    if (m[sym]?.dayChangePct !== undefined) {
      const pct = m[sym].dayChangePct;
      const cls = pct >= 0 ? 'ticker-up' : 'ticker-down';
      const sign = pct >= 0 ? '+' : '';
      items.push(`<div class="ticker-item"><span class="ticker-sym">${sym}</span><span class="${cls}">${sign}${pct.toFixed(2)}%</span></div>`);
    }
  }
  items.push('<div class="ticker-item"><span class="ticker-divider">—</span></div>');
  // Sports
  const sports = issue.sports || [];
  for (const g of sports.slice(0, 3)) {
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    if (w && l) {
      const label = (g.note || g.shortName || '').toUpperCase();
      items.push(`<div class="ticker-item"><span class="ticker-sport">${w.team.toUpperCase()} ${w.score}  ${l.team.toUpperCase()} ${l.score}${label ? `  · ${label}` : ''}</span></div>`);
    }
  }
  // Upcoming
  const upcoming = issue.upcoming || [];
  for (const g of upcoming.slice(0, 2)) {
    const when = g.daysAhead === 0 ? 'TODAY' : g.daysAhead === 1 ? 'TOMORROW' : 'UPCOMING';
    const label = (g.note || g.shortName || '').toUpperCase();
    items.push(`<div class="ticker-item"><span class="ticker-sport">${label}  · ${when}</span></div>`);
  }
  // F1
  if (issue.f1?.name) {
    const status = issue.f1.statusState === 'post' ? 'FINAL' : 'THIS WEEKEND';
    const leader = issue.f1.results?.[0]?.driver || 'TBD';
    items.push(`<div class="ticker-item"><span class="ticker-sport">F1 ${issue.f1.name?.toUpperCase()}  · ${leader} ${status}</span></div>`);
  }
  // Golf
  if (issue.golf?.leaders?.[0]) {
    const l = issue.golf.leaders[0];
    const status = issue.golf.statusState === 'post' ? 'WINS' : 'LEADS';
    const scoreLabel = l.score === 'E' ? 'EVEN' : l.score;
    const rawName = issue.golf.shortName || issue.golf.name || '';
    // Keep ticker labels short — strip "pres. by ..." suffix and truncate
    const golfName = rawName.replace(/pres\. by .*/i, '').replace(/presented by .*/i, '').trim().toUpperCase();
    items.push(`<div class="ticker-item"><span class="ticker-sport">${l.name.toUpperCase()} ${status}  ${golfName}  AT ${scoreLabel}</span></div>`);
  }
  return items.length > 2 ? items.join('\n        ') : null;
}

// Builds /briefs/index.html from all brief/data/issue-NNN.json files
function buildArchive(rootDir) {
  const dataDir  = path.join(rootDir, 'brief', 'data');
  const outDir   = path.join(rootDir, 'briefs');

  const files = fs.readdirSync(dataDir)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort()
    .reverse(); // newest first

  const allIssues = files.map(f => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      if (!d.num) {
        const m = f.match(/issue-(\d+)\.json/);
        if (m) d.num = parseInt(m[1], 10);
      }
      if (!d.slug) d.slug = f.replace('.json', '');
      return d;
    } catch (_) { return null; }
  }).filter(Boolean);

  // Drop placeholder/test issues and keep only the latest issue per date
  const filtered = allIssues.filter(d => d.title && !d.title.startsWith('REPLACE'));
  const byDate = new Map();
  for (const d of filtered) {
    const key = d.date || '';
    if (!byDate.has(key) || d.num > byDate.get(key).num) byDate.set(key, d);
  }
  const issues = Array.from(byDate.values()).sort((a, b) => b.num - a.num);

  // Update about page issue count
  const aboutPath = path.join(rootDir, 'about', 'index.html');
  if (fs.existsSync(aboutPath)) {
    let aboutHtml = fs.readFileSync(aboutPath, 'utf8');
    aboutHtml = aboutHtml.replace(
      /(<div class="stat-num">)\d+\+?(<\/div>\s*<div class="stat-label">Issues published)/,
      `$1${issues.length}+$2`
    );
    fs.writeFileSync(aboutPath, aboutHtml, 'utf8');
  }

  // Update homepage nav + sample brief section with latest issue info
  const latest = issues[0];
  if (latest) {
    const latestSlug = latest.slug || `issue-${String(latest.num).padStart(3, '0')}`;
    const latestNum  = String(latest.num).padStart(3, '0');
    const indexPath  = path.join(rootDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      let indexHtml = fs.readFileSync(indexPath, 'utf8');
      // Update nav "Today's Brief" link
      indexHtml = indexHtml.replace(
        /href="\/brief\/issue-\d+\/"([^>]*)>Today's Brief/,
        `href="/brief/${latestSlug}/"$1>Today's Brief`
      );
      // Update sample brief date, issue number, and story links
      if (latest.date) {
        indexHtml = indexHtml.replace(
          /(<div class="brief-date">)[^<]+(<\/div>)/,
          `$1${latest.date}$2`
        );
      }
      indexHtml = indexHtml.replace(
        /(<div class="brief-issue">ISSUE #)\d+(<\/div>)/,
        `$1${latestNum}$2`
      );
      // Update all links in the brief mock to point to latest issue
      indexHtml = indexHtml.replace(
        /href="\/brief\/issue-\d+\/(#[a-z0-9]+)"/g,
        `href="/brief/${latestSlug}/$1"`
      );
      // Update ticker with latest sports + market data
      const tickerItems = buildTickerItems(latest);
      if (tickerItems) {
        indexHtml = indexHtml.replace(
          /(<div class="ticker" id="ticker-track">)[\s\S]*?(<\/div><\/div>\s*<\/div>)/,
          `$1\n        ${tickerItems}\n        ${tickerItems}\n      </div></div>\n    </div>`
        );
      }
      // Update GuyTalk chat card date
      if (latest.date) {
        indexHtml = indexHtml.replace(
          /(<span class="msg-gt-hdr-issue">)[^<]+(<\/span>)/,
          `$1${latest.date}$2`
        );
      }
      fs.writeFileSync(indexPath, indexHtml, 'utf8');
    }

    // Write /brief/ index that redirects to the latest issue.
    // Keeps generic "/brief/" links (e.g. the Live nav) from 404ing and
    // always points "Today's Brief" at whatever issue is newest.
    writeBriefRedirect(rootDir, latestSlug, latest);
  }

  const rows = issues.map(d => {
    const num  = String(d.num).padStart(3, '0');
    const slug = d.slug || `issue-${num}`;
    const title = d.title || 'GuyTalk Brief';
    const date = d.date || '';
    const search = escHtml(`${title} ${num} #${num} ${date}`.toLowerCase());
    return `
      <a href="/brief/${slug}/" class="archive-row" data-search="${search}">
        <span class="ar-num">#${num}</span>
        <span class="ar-title">${escHtml(title)}</span>
        <span class="ar-date">${escHtml(date)}</span>
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
<meta property="og:image"       content="https://www.guytalkmedia.com/assets/og-card.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init me ws ys ps bs capture je Di ks register register_once register_for_session unregister unregister_for_session Ps getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Es $s createPersonProfile Is opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing Ss debug xs getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('phc_t9vvXWz7JWBsWkHmmNXCb2KMF79puQomJnJvREWKQbq8',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'});
</script>
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

  /* Search */
  .archive-search-wrap { position: relative; margin-bottom: 18px; }
  .archive-search-icon {
    position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
    color: var(--text-3); pointer-events: none;
  }
  .archive-search-input {
    width: 100%; padding: 14px 16px 14px 44px;
    border: 1.5px solid var(--border); border-radius: 11px;
    font-size: 15px; font-family: inherit; background: var(--surface); color: var(--text);
    outline: none; transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .archive-search-input:focus { border-color: rgba(43,111,255,0.5); box-shadow: 0 0 0 3px rgba(43,111,255,0.10); }
  .archive-search-input::placeholder { color: var(--text-3); }
  .archive-empty { padding: 40px 0; text-align: center; color: var(--text-2); font-size: 15px; }

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

  /* Subscribe CTA */
  .archive-cta-block {
    margin: 52px 0 0; padding: 36px 32px; text-align: center;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04);
  }
  .archive-cta-label {
    font-family: 'Inter Tight', sans-serif; font-weight: 700;
    font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 12px;
  }
  .archive-cta-headline {
    font-family: 'Inter Tight', sans-serif; font-weight: 800;
    font-size: 28px; letter-spacing: -0.025em; color: var(--text);
    margin-bottom: 8px;
  }
  .archive-cta-sub { font-size: 16px; color: var(--text-2); margin-bottom: 24px; }
  .archive-cta-form { display: flex; gap: 10px; max-width: 420px; margin: 0 auto; }
  .archive-cta-input {
    flex: 1; padding: 12px 16px; border: 1.5px solid var(--border);
    border-radius: 9px; font-size: 15px; font-family: inherit;
    background: var(--bg); color: var(--text); outline: none;
    transition: border-color 0.15s ease;
  }
  .archive-cta-input:focus { border-color: rgba(43,111,255,0.45); }
  .archive-cta-btn {
    padding: 12px 22px; background: var(--accent); color: white;
    border: none; border-radius: 9px; font-family: inherit;
    font-weight: 700; font-size: 14px; cursor: pointer; white-space: nowrap;
    transition: background 0.15s ease, transform 0.15s ease;
  }
  .archive-cta-btn:hover { background: var(--accent-h); transform: translateY(-1px); }
  .archive-cta-hint { font-size: 12px; color: var(--text-3); margin-top: 10px; }
  .archive-cta-success { display: none; font-size: 15px; color: var(--accent); font-weight: 600; margin-top: 10px; }

  /* Footer */
  footer {
    border-top: 1px solid var(--border); padding: 32px 24px 48px;
    max-width: 760px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  }
  .footer-brand { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 17px; letter-spacing: -0.03em; color: var(--text); }
  .footer-brand .dot { color: var(--accent); }
  .footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
  .footer-links a { font-size: 13px; color: var(--text-3); text-decoration: none; transition: color 0.15s ease; }
  .footer-links a:hover { color: var(--text); }

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
  <div class="archive-search-wrap">
    <svg class="archive-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
    <input type="search" id="archiveSearch" class="archive-search-input" placeholder="Search by topic, team, issue #…" aria-label="Search issues" autocomplete="off">
  </div>
  <div class="archive-count" id="archiveCount">${issues.length} issue${issues.length !== 1 ? 's' : ''} published</div>
  <div class="archive-list" id="archiveList">
    ${rows}
  </div>
  <div class="archive-empty" id="archiveEmpty" hidden>No issues match your search.</div>

  <div class="archive-cta-block">
    <div class="archive-cta-label">Free · Daily · 5 Minutes</div>
    <div class="archive-cta-headline">Get it in your inbox.</div>
    <p class="archive-cta-sub">Sports, markets, golf, and culture — every morning before 8am.</p>
    <form class="archive-cta-form" onsubmit="handleSignup(event, this)">
      <input type="email" name="email" placeholder="Enter your email" required class="archive-cta-input" autocomplete="email">
      <button type="submit" class="archive-cta-btn">Subscribe Free</button>
    </form>
    <div class="archive-cta-success" id="archiveSuccess">You're in. Check your inbox tomorrow morning.</div>
    <p class="archive-cta-hint">Free forever · No spam · Unsubscribe anytime</p>
  </div>
</main>

<footer>
  <div class="footer-brand">GuyTalk<span class="dot">.</span></div>
  <div class="footer-links">
    <a href="/">Home</a>
    <a href="https://instagram.com/guytalkmedia" target="_blank" rel="noopener">Instagram</a>
    <a href="https://x.com/guytalkmedia" target="_blank" rel="noopener">X</a>
    <a href="https://tiktok.com/@guytalkmedia" target="_blank" rel="noopener">TikTok</a>
    <a href="mailto:guytalkdaily@gmail.com">Contact</a>
  </div>
</footer>

<script>
// Client-side issue search/filter — instant, no network.
(function () {
  var input = document.getElementById('archiveSearch');
  if (!input) return;
  var rows  = Array.prototype.slice.call(document.querySelectorAll('.archive-row'));
  var count = document.getElementById('archiveCount');
  var empty = document.getElementById('archiveEmpty');
  var total = rows.length;
  function apply() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    rows.forEach(function (r) {
      var match = !q || (r.getAttribute('data-search') || '').indexOf(q) !== -1;
      r.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    if (empty) empty.hidden = shown !== 0;
    if (count) count.textContent = q
      ? (shown + ' of ' + total + ' issue' + (total !== 1 ? 's' : '') + ' match')
      : (total + ' issue' + (total !== 1 ? 's' : '') + ' published');
  }
  input.addEventListener('input', apply);
})();

window.handleSignup = function(e, form) {
  e.preventDefault();
  var email = form.querySelector('input[type="email"]').value.trim();
  if (!email) return;
  form.style.display = 'none';
  document.getElementById('archiveSuccess').style.display = 'block';
  if (window.posthog) {
    posthog.identify(email, { email: email });
    posthog.capture('email_signup', { email: email, source: 'archive' });
  }
  var fd = new FormData();
  fd.append('email', email);
  fetch('https://subscribe-forms.beehiiv.com/api/v3/forms/88b2d1b6-d0c3-4d33-ac26-d69fd2158a3d/subscriptions', {
    method: 'POST', mode: 'no-cors', body: fd
  }).catch(function() {});
};
</script>

</body>
</html>`;

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

  // Auto-update sitemap.xml
  const sitemapPath = path.join(rootDir, 'sitemap.xml');
  const staticUrls = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    { loc: '/live/', changefreq: 'always', priority: '0.9' },
    { loc: '/briefs/', changefreq: 'daily', priority: '0.9' },
    { loc: '/about/', changefreq: 'monthly', priority: '0.7' },
    { loc: '/reviews/', changefreq: 'weekly', priority: '0.7' },
    { loc: '/advertise/', changefreq: 'monthly', priority: '0.8' },
    { loc: '/privacy/', changefreq: 'yearly', priority: '0.3' },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const briefUrls = issues.map(d => {
    let lastmod = today;
    if (d.date) {
      try { lastmod = new Date(d.date).toISOString().slice(0, 10); } catch (_) {}
    }
    return {
      loc: `/brief/${d.slug || `issue-${String(d.num).padStart(3, '0')}`}/`,
      changefreq: 'never',
      priority: d === issues[0] ? '0.8' : '0.6',
      lastmod,
    };
  });
  const allUrls = [
    ...staticUrls.map(u => ({ ...u, lastmod: today })),
    ...briefUrls,
  ];
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    allUrls.map(u => `  <url>\n    <loc>https://www.guytalkmedia.com${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')
  }\n</urlset>\n`;
  fs.writeFileSync(sitemapPath, sitemapXml, 'utf8');
}

// Builds /brief/index.html — a fast redirect to the latest published issue.
function writeBriefRedirect(rootDir, latestSlug, latest) {
  const dest = `/brief/${latestSlug}/`;
  const title = latest && latest.title ? latest.title : 'Today’s Brief';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Today’s Brief — GuyTalk</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="https://www.guytalkmedia.com${dest}">
<meta http-equiv="refresh" content="0; url=${dest}">
<script>window.location.replace(${JSON.stringify(dest)});</script>
<style>
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#F9F8F5;color:#0F1724;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px;}
  a{color:#2B6FFF;font-weight:600;text-decoration:none;}
</style>
</head>
<body>
  <p>Taking you to today’s brief…<br><a href="${dest}">${escHtml(title)} →</a></p>
</body>
</html>`;
  const outDir = path.join(rootDir, 'brief');
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

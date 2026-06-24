#!/usr/bin/env node
'use strict';

/**
 * GuyTalk Guide generator — reads guide/data/articles.json, writes static HTML.
 *
 * Usage:
 *   node scripts/generate-guide.js              # regenerate everything
 *   node scripts/generate-guide.js --slug=what-is-peter-millar
 */

require('dotenv').config({ path: '.env.local' });
const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'guide', 'data');
const OUT_DIR  = path.join(ROOT, 'guide');

const SITE_URL = 'https://www.guytalkmedia.com';

const CATEGORY_META = {
  style: {
    label: 'Style',
    icon: '👔',
    description: 'How to dress better, spend less, and stop overthinking it.',
  },
  watches: {
    label: 'Watches',
    icon: '⌚',
    description: 'What to buy, what it means, and how not to look clueless at the AD.',
  },
  'bourbon-cigars': {
    label: 'Bourbon & Cigars',
    icon: '🥃',
    description: 'The fundamentals. What to order, what to know, what to say.',
  },
  cars: {
    label: 'Cars',
    icon: '🚗',
    description: "What actually matters when you're buying, maintaining, or just talking about cars.",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('  wrote:', path.relative(ROOT, filePath));
}

function resolveShopUrl(pick, affiliates) {
  if (!pick.affiliateBrand) return pick.shopUrl || '#';
  const aff = affiliates[pick.affiliateBrand];
  if (!aff) return pick.shopUrl || '#';
  return aff.homepage;
}

// ─── Shared nav/footer fragments ─────────────────────────────────────────────

function guideNav(activePath) {
  return `
<nav class="guide-nav">
  <div class="guide-nav-inner">
    <a href="/" class="guide-wordmark">GuyTalk<span class="guide-dot">.</span></a>
    <div class="guide-nav-links">
      <a href="/brief/" class="guide-nav-link">Today's Brief</a>
      <a href="/guide/" class="guide-nav-link${activePath === '/guide/' ? ' is-active' : ''}">Guide</a>
      <a href="/#signup" class="guide-nav-cta">Subscribe Free →</a>
    </div>
  </div>
</nav>`.trim();
}

function guideFooter() {
  return `
<footer class="guide-footer">
  <div class="guide-footer-inner">
    <div class="guide-footer-brand">GuyTalk<span class="guide-dot">.</span></div>
    <div class="guide-footer-links">
      <a href="/guide/">Guide</a>
      <a href="/briefs/">Archive</a>
      <a href="/about/">About</a>
      <a href="/privacy/">Privacy</a>
    </div>
    <div class="guide-footer-note">© ${new Date().getFullYear()} GuyTalk Media. Some links may be affiliate links that earn a small commission at no cost to you.</div>
  </div>
</footer>`.trim();
}

// ─── Shared CSS ──────────────────────────────────────────────────────────────

const GUIDE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:      #0A0E1A;
    --surface: #111827;
    --surface2: #1A2235;
    --border:  rgba(255,255,255,0.08);
    --border2: rgba(255,255,255,0.14);
    --text:    #F4F6FB;
    --text-2:  rgba(244,246,251,0.68);
    --text-3:  rgba(244,246,251,0.40);
    --accent:  #2B6FFF;
    --accent-h: #4D8AFF;
    --amber:   #F59E0B;
    --green:   #4ADE80;
  }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg); color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 17px; line-height: 1.65; -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* NAV */
  .guide-nav {
    position: sticky; top: 0; z-index: 50;
    background: rgba(10,14,26,0.88);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
  }
  .guide-nav-inner {
    display: flex; align-items: center; justify-content: space-between;
    max-width: 960px; margin: 0 auto; padding: 14px 24px;
  }
  .guide-wordmark {
    font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 19px;
    letter-spacing: -0.03em; color: var(--text); text-decoration: none;
  }
  .guide-wordmark:hover { text-decoration: none; }
  .guide-dot { color: var(--accent); }
  .guide-nav-links { display: flex; align-items: center; gap: 22px; }
  .guide-nav-link { font-size: 14px; font-weight: 500; color: var(--text-2); text-decoration: none; }
  .guide-nav-link:hover { color: var(--text); text-decoration: none; }
  .guide-nav-link.is-active { color: var(--text); font-weight: 600; }
  .guide-nav-cta {
    font-size: 13px; font-weight: 600; padding: 7px 14px;
    background: var(--accent); color: #fff; border-radius: 7px; text-decoration: none;
  }
  .guide-nav-cta:hover { background: var(--accent-h); text-decoration: none; }

  /* FOOTER */
  .guide-footer { border-top: 1px solid var(--border); margin-top: 80px; padding: 40px 24px; }
  .guide-footer-inner { max-width: 960px; margin: 0 auto; }
  .guide-footer-brand { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 17px; letter-spacing: -0.02em; margin-bottom: 14px; }
  .guide-footer-links { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 16px; }
  .guide-footer-links a { font-size: 14px; color: var(--text-2); text-decoration: none; }
  .guide-footer-links a:hover { color: var(--text); }
  .guide-footer-note { font-size: 12px; color: var(--text-3); line-height: 1.6; }

  /* CONTAINER */
  .guide-container { max-width: 720px; margin: 0 auto; padding: 0 24px; }
  .guide-container-wide { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  @media (max-width: 640px) {
    .guide-nav-links { gap: 14px; }
    .guide-nav-cta { display: none; }
    body { font-size: 16px; }
  }
`.trim();

// ─── Article renderer ─────────────────────────────────────────────────────────

function renderPick(pick, affiliates) {
  const shopUrl = resolveShopUrl(pick, affiliates);
  const priceStr = pick.priceNote ? `${esc(pick.price)} <span class="pick-price-note">${esc(pick.priceNote)}</span>` : esc(pick.price);
  return `
<div class="pick-card">
  <div class="pick-top">
    <div class="pick-name">${esc(pick.name)}</div>
    <div class="pick-brand">${esc(pick.brand)}</div>
  </div>
  <div class="pick-reason">${esc(pick.reason)}</div>
  <div class="pick-bottom">
    <span class="pick-price">${priceStr}</span>
    <a href="${esc(shopUrl)}" class="pick-shop" target="_blank" rel="noopener">Shop →</a>
  </div>
</div>`.trim();
}

function renderTier(tier, affiliates) {
  const picks = (tier.picks || []).map(p => renderPick(p, affiliates)).join('\n');
  return `
<div class="tier">
  <div class="tier-label">${esc(tier.label)}</div>
  <div class="tier-picks">${picks}</div>
</div>`.trim();
}

function renderOurPick(ourPick, affiliates) {
  if (!ourPick) return '';
  const shopUrl = resolveShopUrl(ourPick, affiliates);
  const priceStr = ourPick.priceNote ? `${esc(ourPick.price)} · ${esc(ourPick.priceNote)}` : esc(ourPick.price);
  return `
<div class="our-pick">
  <div class="our-pick-badge">OUR PICK</div>
  <div class="our-pick-name">${esc(ourPick.name)}</div>
  <div class="our-pick-brand">${esc(ourPick.brand)} · <span class="our-pick-price">${priceStr}</span></div>
  <p class="our-pick-why">${esc(ourPick.why)}</p>
  <a href="${esc(shopUrl)}" class="our-pick-cta" target="_blank" rel="noopener">Shop ${esc(ourPick.brand)} →</a>
</div>`.trim();
}

function renderArticle(article, affiliates) {
  const catMeta = CATEGORY_META[article.category] || { label: article.category };
  const pageUrl = `${SITE_URL}/guide/${article.category}/${article.slug}/`;

  const heroStyle = article.heroImage
    ? `style="background-image:url('${esc(article.heroImage)}');background-size:cover;background-position:center;"`
    : '';

  const whatToKnowItems = (article.sections.whatToKnow || [])
    .map(item => `<li>${esc(item)}</li>`).join('\n');

  const whatToSayItems = (article.sections.whatToSay || [])
    .map((s, i) => `<li class="${i === 0 ? 'say-do' : 'say-dont'}">${esc(s)}</li>`).join('\n');

  const tierHtml = Object.values(article.sections.whatToBuy || {})
    .map(tier => renderTier(tier, affiliates)).join('\n');

  const ourPickHtml = renderOurPick(article.ourPick, affiliates);

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.subtitle,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    url: pageUrl,
    publisher: { '@type': 'Organization', name: 'GuyTalk', url: SITE_URL },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(article.title)} — GuyTalk Guide</title>
<meta name="description" content="${esc(article.subtitle)}">
<meta property="og:type"        content="article">
<meta property="og:title"       content="${esc(article.title)} — GuyTalk Guide">
<meta property="og:description" content="${esc(article.subtitle)}">
<meta property="og:image"       content="${esc(article.heroImage || `${SITE_URL}/assets/og-card.png`)}">
<meta property="og:url"         content="${esc(pageUrl)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@guytalkmedia">
<meta name="twitter:title"       content="${esc(article.title)} — GuyTalk Guide">
<meta name="twitter:description" content="${esc(article.subtitle)}">
<link rel="canonical"            href="${esc(pageUrl)}">
<link rel="icon"                 href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${GUIDE_CSS}

/* HERO */
.article-hero {
  position: relative; min-height: 320px; display: flex; align-items: flex-end;
  background: var(--surface2);
}
.article-hero-img { position: absolute; inset: 0; background-size: cover; background-position: center; }
.article-hero-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,14,26,0.95) 0%, rgba(10,14,26,0.5) 60%, rgba(10,14,26,0.1) 100%); }
.article-hero-content { position: relative; z-index: 1; padding: 32px 24px 40px; max-width: 960px; margin: 0 auto; width: 100%; }
.article-breadcrumb { font-family: 'Inter Tight', sans-serif; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); margin-bottom: 16px; }
.article-breadcrumb a { color: var(--accent); text-decoration: none; }
.article-breadcrumb a:hover { text-decoration: underline; }
.article-breadcrumb-sep { margin: 0 8px; color: var(--text-3); }
.article-title { font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: clamp(28px, 5vw, 48px); line-height: 1.06; letter-spacing: -0.03em; color: var(--text); margin-bottom: 12px; }
.article-subtitle { font-size: 17px; line-height: 1.55; color: var(--text-2); max-width: 560px; }

/* ARTICLE BODY */
.article-body { padding: 56px 0 0; }

.section { margin-bottom: 48px; }
.section-eyebrow {
  font-family: 'Inter Tight', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase; color: var(--amber);
  margin-bottom: 14px;
}
.section-text { color: var(--text-2); line-height: 1.72; font-size: 17px; }
.section-text + .section-text { margin-top: 16px; }

/* WHAT TO KNOW */
.know-list { list-style: none; padding: 0; margin: 0; }
.know-list li {
  padding: 14px 0 14px 20px; border-bottom: 1px solid var(--border);
  color: var(--text-2); line-height: 1.6; font-size: 16px;
  position: relative;
}
.know-list li:first-child { border-top: 1px solid var(--border); }
.know-list li::before { content: '—'; position: absolute; left: 0; color: var(--amber); font-weight: 700; }

/* WHAT TO BUY */
.tiers { display: flex; flex-direction: column; gap: 32px; }
.tier-label {
  font-family: 'Inter Tight', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: .10em; text-transform: uppercase; color: var(--text-3);
  padding: 10px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px;
}
.tier-picks { display: flex; flex-direction: column; gap: 12px; }
.pick-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 20px;
}
.pick-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 12px; }
.pick-name { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 16px; color: var(--text); }
.pick-brand { font-size: 13px; color: var(--text-3); white-space: nowrap; flex-shrink: 0; }
.pick-reason { font-size: 15px; color: var(--text-2); line-height: 1.55; margin-bottom: 14px; }
.pick-bottom { display: flex; justify-content: space-between; align-items: center; }
.pick-price { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 15px; color: var(--amber); }
.pick-price-note { font-weight: 400; font-size: 13px; color: var(--text-3); }
.pick-shop {
  font-size: 13px; font-weight: 600; color: var(--accent); text-decoration: none;
  padding: 5px 12px; border: 1px solid rgba(43,111,255,0.35); border-radius: 6px;
}
.pick-shop:hover { background: rgba(43,111,255,0.12); text-decoration: none; }

/* WHAT TO SAY */
.say-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.say-list li {
  padding: 14px 16px 14px 44px; border-radius: 10px;
  font-size: 16px; line-height: 1.6; position: relative;
}
.say-do { background: rgba(74,222,128,0.07); border: 1px solid rgba(74,222,128,0.18); color: var(--text-2); }
.say-do::before { content: '✓'; position: absolute; left: 16px; color: var(--green); font-weight: 700; }
.say-dont { background: rgba(244,246,251,0.04); border: 1px solid var(--border); color: var(--text-2); }
.say-dont::before { content: '→'; position: absolute; left: 16px; color: var(--text-3); font-weight: 700; }

/* OUR PICK */
.our-pick {
  background: rgba(74,222,128,0.06); border: 1px solid rgba(74,222,128,0.22);
  border-left: 3px solid var(--green); border-radius: 12px;
  padding: 28px 28px 24px; margin: 48px 0;
}
.our-pick-badge {
  font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--green);
  margin-bottom: 10px;
}
.our-pick-name { font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: 22px; letter-spacing: -0.02em; color: var(--text); margin-bottom: 4px; }
.our-pick-brand { font-size: 14px; color: var(--text-3); margin-bottom: 14px; }
.our-pick-price { color: var(--amber); font-weight: 600; }
.our-pick-why { font-size: 16px; line-height: 1.65; color: var(--text-2); margin-bottom: 20px; }
.our-pick-cta {
  display: inline-block; background: var(--green); color: #0A0E1A;
  font-weight: 700; font-size: 14px; padding: 10px 20px; border-radius: 8px; text-decoration: none;
}
.our-pick-cta:hover { opacity: 0.88; text-decoration: none; }

@media (max-width: 640px) {
  .article-hero { min-height: 240px; }
  .article-title { font-size: 26px; }
  .pick-top { flex-direction: column; gap: 2px; }
}
</style>
</head>
<body>

${guideNav('/guide/')}

<div class="article-hero">
  <div class="article-hero-img" ${heroStyle}></div>
  <div class="article-hero-overlay"></div>
  <div class="article-hero-content guide-container-wide">
    <div class="article-breadcrumb">
      <a href="/guide/">Guide</a>
      <span class="article-breadcrumb-sep">/</span>
      <a href="/guide/${esc(article.category)}/">${esc(catMeta.label)}</a>
      <span class="article-breadcrumb-sep">/</span>
      ${esc(article.title)}
    </div>
    <h1 class="article-title">${esc(article.title)}</h1>
    <p class="article-subtitle">${esc(article.subtitle)}</p>
  </div>
</div>

<div class="guide-container">
  <div class="article-body">

    <div class="section">
      <div class="section-eyebrow">What It Is</div>
      <p class="section-text">${esc(article.sections.whatItIs)}</p>
    </div>

    <div class="section">
      <div class="section-eyebrow">Why It Matters</div>
      <p class="section-text">${esc(article.sections.whyItMatters)}</p>
    </div>

    <div class="section">
      <div class="section-eyebrow">The GuyTalk Read</div>
      <p class="section-text">${esc(article.sections.guytalkRead)}</p>
    </div>

    <div class="section">
      <div class="section-eyebrow">What to Know</div>
      <ul class="know-list">
        ${whatToKnowItems}
      </ul>
    </div>

    <div class="section">
      <div class="section-eyebrow">What to Buy</div>
      <div class="tiers">
        ${tierHtml}
      </div>
    </div>

    <div class="section">
      <div class="section-eyebrow">What to Say</div>
      <ul class="say-list">
        ${whatToSayItems}
      </ul>
    </div>

    ${ourPickHtml}

  </div>
</div>

${guideFooter()}

<script type="application/ld+json">${schemaJson}</script>
</body>
</html>`;
}

// ─── Category hub renderer ─────────────────────────────────────────────────────

function renderArticleCard(article) {
  const url = `/guide/${article.category}/${article.slug}/`;
  return `
<a href="${esc(url)}" class="cat-article-card">
  <div class="cat-article-title">${esc(article.title)}</div>
  <div class="cat-article-sub">${esc(article.subtitle)}</div>
  <div class="cat-article-arrow">Read →</div>
</a>`.trim();
}

function renderCategoryHub(category, articles, affiliates) {
  const meta = CATEGORY_META[category] || { label: category, description: '' };
  const pageUrl = `${SITE_URL}/guide/${category}/`;
  const cards = articles.map(a => renderArticleCard(a)).join('\n');

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${meta.label} — GuyTalk Guide`,
    description: meta.description,
    url: pageUrl,
    publisher: { '@type': 'Organization', name: 'GuyTalk', url: SITE_URL },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(meta.label)} — GuyTalk Guide</title>
<meta name="description" content="${esc(meta.description)}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${esc(meta.label)} — GuyTalk Guide">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image"       content="${esc(SITE_URL)}/assets/og-card.png">
<meta property="og:url"         content="${esc(pageUrl)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@guytalkmedia">
<link rel="canonical"            href="${esc(pageUrl)}">
<link rel="icon"                 href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${GUIDE_CSS}

.cat-hero { padding: 64px 24px 56px; border-bottom: 1px solid var(--border); }
.cat-hero-inner { max-width: 960px; margin: 0 auto; }
.cat-breadcrumb { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); margin-bottom: 20px; }
.cat-breadcrumb a { color: var(--accent); text-decoration: none; }
.cat-breadcrumb a:hover { text-decoration: underline; }
.cat-breadcrumb-sep { margin: 0 8px; }
.cat-label { font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: clamp(36px, 6vw, 60px); letter-spacing: -0.03em; color: var(--text); margin-bottom: 12px; }
.cat-desc { font-size: 18px; color: var(--text-2); max-width: 480px; line-height: 1.6; }

.cat-articles { padding: 48px 24px; }
.cat-articles-inner { max-width: 960px; margin: 0 auto; }
.cat-articles-grid { display: flex; flex-direction: column; gap: 2px; }

.cat-article-card {
  display: block; padding: 24px 0; border-bottom: 1px solid var(--border);
  text-decoration: none; color: var(--text);
  transition: padding-left 0.18s ease;
}
.cat-article-card:hover { padding-left: 8px; text-decoration: none; }
.cat-article-title { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 20px; letter-spacing: -0.02em; color: var(--text); margin-bottom: 6px; }
.cat-article-sub { font-size: 15px; color: var(--text-2); line-height: 1.5; margin-bottom: 10px; }
.cat-article-arrow { font-size: 13px; font-weight: 600; color: var(--accent); }
</style>
</head>
<body>

${guideNav('/guide/')}

<div class="cat-hero">
  <div class="cat-hero-inner">
    <div class="cat-breadcrumb"><a href="/guide/">Guide</a><span class="cat-breadcrumb-sep">/</span>${esc(meta.label)}</div>
    <div class="cat-label">${esc(meta.label)}</div>
    <p class="cat-desc">${esc(meta.description)}</p>
  </div>
</div>

<div class="cat-articles">
  <div class="cat-articles-inner">
    <div class="cat-articles-grid">
      ${cards}
    </div>
  </div>
</div>

${guideFooter()}

<script type="application/ld+json">${schemaJson}</script>
</body>
</html>`;
}

// ─── Main guide hub renderer ──────────────────────────────────────────────────

function renderGuideHub(byCategory) {
  const pageUrl = `${SITE_URL}/guide/`;

  const catCards = Object.entries(byCategory).map(([cat, arts]) => {
    const meta = CATEGORY_META[cat] || { label: cat, description: '' };
    const count = arts.length;
    return `
<a href="/guide/${esc(cat)}/" class="hub-cat-card">
  <div class="hub-cat-label">${esc(meta.label)}</div>
  <div class="hub-cat-desc">${esc(meta.description)}</div>
  <div class="hub-cat-count">${count} ${count === 1 ? 'guide' : 'guides'} →</div>
</a>`.trim();
  }).join('\n');

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'The GuyTalk Guide',
    description: 'An evergreen reference library for guys who want to know more and say the right thing.',
    url: pageUrl,
    publisher: { '@type': 'Organization', name: 'GuyTalk', url: SITE_URL },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The GuyTalk Guide</title>
<meta name="description" content="An evergreen reference library for guys who want to know more and say the right thing.">
<meta property="og:type"        content="website">
<meta property="og:title"       content="The GuyTalk Guide">
<meta property="og:description" content="An evergreen reference library for guys who want to know more and say the right thing.">
<meta property="og:image"       content="${esc(SITE_URL)}/assets/og-card.png">
<meta property="og:url"         content="${esc(pageUrl)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@guytalkmedia">
<link rel="canonical"            href="${esc(pageUrl)}">
<link rel="icon"                 href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
${GUIDE_CSS}

.hub-hero { padding: 80px 24px 72px; border-bottom: 1px solid var(--border); }
.hub-hero-inner { max-width: 960px; margin: 0 auto; }
.hub-eyebrow {
  font-family: 'Inter Tight', sans-serif; font-size: 11px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase; color: var(--amber);
  margin-bottom: 18px;
}
.hub-title {
  font-family: 'Inter Tight', sans-serif; font-weight: 900;
  font-size: clamp(40px, 7vw, 72px); letter-spacing: -0.04em;
  line-height: 1.02; color: var(--text); margin-bottom: 20px;
}
.hub-title em { font-style: normal; color: var(--accent); }
.hub-sub { font-size: 18px; color: var(--text-2); max-width: 520px; line-height: 1.6; }

.hub-cats { padding: 56px 24px; }
.hub-cats-inner { max-width: 960px; margin: 0 auto; }
.hub-cats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }

.hub-cat-card {
  display: block; background: var(--surface); border: 1px solid var(--border);
  border-radius: 16px; padding: 28px 26px; text-decoration: none;
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.hub-cat-card:hover { border-color: var(--border2); transform: translateY(-3px); text-decoration: none; }
.hub-cat-label { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 22px; letter-spacing: -0.02em; color: var(--text); margin-bottom: 8px; }
.hub-cat-desc { font-size: 15px; color: var(--text-2); line-height: 1.55; margin-bottom: 16px; }
.hub-cat-count { font-size: 13px; font-weight: 600; color: var(--accent); }

@media (max-width: 640px) {
  .hub-cats-grid { grid-template-columns: 1fr; }
  .hub-hero { padding: 48px 24px 44px; }
}
</style>
</head>
<body>

${guideNav('/guide/')}

<div class="hub-hero">
  <div class="hub-hero-inner">
    <div class="hub-eyebrow">GuyTalk Guide</div>
    <h1 class="hub-title">Know more.<br><em>Say the right thing.</em></h1>
    <p class="hub-sub">An evergreen reference library. What it is, why it matters, what to buy, and exactly what to say — on the things worth knowing about.</p>
  </div>
</div>

<div class="hub-cats">
  <div class="hub-cats-inner">
    <div class="hub-cats-grid">
      ${catCards}
    </div>
  </div>
</div>

${guideFooter()}

<script type="application/ld+json">${schemaJson}</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const slugFilter = (process.argv.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '') || null;

  const articles  = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'articles.json'), 'utf8'));
  const affiliates = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'affiliates.json'), 'utf8'));

  const filtered = slugFilter ? articles.filter(a => a.slug === slugFilter) : articles;
  if (slugFilter && filtered.length === 0) { console.error('No article found with slug:', slugFilter); process.exit(1); }

  const byCategory = {};
  for (const a of articles) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a);
  }

  for (const article of filtered) {
    const html = renderArticle(article, affiliates);
    writeFile(path.join(OUT_DIR, article.category, article.slug, 'index.html'), html);
  }

  if (!slugFilter) {
    for (const [cat, arts] of Object.entries(byCategory)) {
      writeFile(path.join(OUT_DIR, cat, 'index.html'), renderCategoryHub(cat, arts, affiliates));
    }
    writeFile(path.join(OUT_DIR, 'index.html'), renderGuideHub(byCategory));
  }

  console.log(`\nGuide generated: ${filtered.length} article(s)${!slugFilter ? `, ${Object.keys(byCategory).length} category hub(s), 1 main hub` : ''}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

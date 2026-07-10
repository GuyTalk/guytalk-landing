#!/usr/bin/env node
'use strict';

/**
 * Generates per-pick detail pages for all GuyTalk Guide categories.
 *
 * Usage:
 *   node scripts/generate-guide-detail-pages.js             # all picks
 *   node scripts/generate-guide-detail-pages.js --cat=style  # one category
 *   node scripts/generate-guide-detail-pages.js --slug=buffalo-trace  # one pick
 *
 * Idempotent: skips picks that already have ourTake in the JSON.
 * Results logged to guide/data/detail-generation-log.json
 */

require('dotenv').config({ path: '.env.local' });

const OpenAI = require('openai');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '..');
const DATA   = path.join(ROOT, 'guide', 'data');
const MODEL  = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1';
const client = new (OpenAI.default || OpenAI)({ apiKey: process.env.OPENAI_API_KEY });

const SITE = 'https://www.guytalkmedia.com';

// ─── All categories + their data files ───────────────────────────────────────
const CATEGORIES = [
  { key: 'style',          label: 'Style',          file: 'style-picks.json',       verb: 'Wear' },
  { key: 'watches',        label: 'Watches',        file: 'watches-picks.json',      verb: 'Wear' },
  { key: 'bourbon-cigars', label: 'Bourbon & Cigars', file: 'bourbon-picks.json',   verb: 'Drink' },
  { key: 'cars',           label: 'Cars',           file: 'cars-picks.json',         verb: 'Drive/Use' },
  { key: 'fitness',        label: 'Fitness',        file: 'fitness-picks.json',      verb: 'Use' },
  { key: 'accessories',    label: 'Accessories',    file: 'accessories-picks.json',  verb: 'Carry/Wear' },
];

// ─── Shared CSS + nav ─────────────────────────────────────────────────────────
const SHARED_CSS = `<style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #F9F8F5; --surface: #FFFFFF; --surface-2: #F2F0EB;
    --border: #E5E2DB; --border-light: #D4D0C8;
    --text: #0F1724; --text-2: #6E6862; --text-3: #9E9891;
    --accent: #2B6FFF; --accent-h: #1A5CEF; --accent-muted: #EBF1FF;
    --amber: #B87C35; --amber-muted: rgba(184,124,53,0.08);
    --green: #16A34A; --navy: #0F1724;
  }
  html { scroll-behavior: smooth; }
  body { background:var(--bg);color:var(--text);font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased; }
  a { color:var(--accent);text-decoration:none; }
  a:hover { text-decoration:underline; }
  p { margin-bottom:0; }
  /* NAV */
  .guide-nav{position:sticky;top:0;z-index:50;background:rgba(249,248,245,0.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--border);}
  .guide-nav-inner{display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto;padding:14px 24px;}
  .guide-wordmark{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:19px;letter-spacing:-.02em;color:var(--text);text-decoration:none;}
  .guide-wordmark span{color:var(--accent);}
  .guide-nav-links{display:flex;align-items:center;gap:24px;}
  .guide-nav-link{font-size:14px;font-weight:600;color:var(--text-2);}
  .guide-nav-cta{background:var(--accent);color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;}
  .guide-nav-cta:hover{background:var(--accent-h);text-decoration:none;}
  /* GUIDE TABS */
  .guide-tabs{position:sticky;top:57px;z-index:90;background:rgba(249,248,245,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}
  .guide-tabs-inner{max-width:1120px;margin:0 auto;padding:0 24px;display:flex;gap:0;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .guide-tab{padding:12px 18px;font-family:'Inter Tight',sans-serif;font-weight:700;font-size:13px;letter-spacing:.01em;color:var(--text-2);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s ease,border-color .15s ease;white-space:nowrap;}
  .guide-tab:hover{color:var(--text);text-decoration:none;}
  .guide-tab.active{color:var(--accent);border-bottom-color:var(--accent);}
  /* HERO */
  .detail-hero{background:#1A1A1A;color:#fff;padding:48px 24px 40px;}
  .detail-hero-inner{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:1fr 340px;gap:48px;align-items:center;}
  @media(max-width:800px){.detail-hero-inner{grid-template-columns:1fr;}}
  .detail-crumb{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:14px;}
  .detail-crumb a{color:rgba(255,255,255,.55);text-decoration:none;}
  .detail-crumb a:hover{color:rgba(255,255,255,.85);}
  .detail-crumb-sep{margin:0 8px;}
  .detail-brand{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:6px;}
  .detail-name{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:clamp(24px,4.5vw,40px);letter-spacing:-.025em;line-height:1.1;margin-bottom:12px;}
  .detail-price{font-size:20px;font-weight:700;color:var(--accent);margin-bottom:14px;}
  .detail-verdict{font-size:16px;color:rgba(255,255,255,.72);font-style:italic;max-width:480px;line-height:1.55;}
  .gtag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:4px;margin-bottom:12px;}
  .gtag-blue{background:var(--accent-muted);color:var(--accent);}
  .gtag-amber{background:var(--amber-muted);color:var(--amber);}
  .gtag-navy{background:rgba(15,23,36,.07);color:var(--navy);}
  .gtag-green{background:rgba(22,163,74,.08);color:var(--green);}
  .detail-hero-img{border-radius:10px;overflow:hidden;height:260px;background:rgba(255,255,255,.06);}
  .detail-hero-img img{width:100%;height:100%;object-fit:cover;}
  .detail-hero-img-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;}
  .detail-hero-img-ph-init{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:64px;color:rgba(255,255,255,.15);}
  .detail-hero-img-ph-label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.25);}
  /* CONTENT SECTIONS */
  .detail-body{max-width:720px;margin:0 auto;padding:56px 24px;}
  .detail-section{margin-bottom:48px;}
  .detail-section-eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
  .detail-section-title{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:22px;letter-spacing:-.015em;margin-bottom:16px;}
  .detail-section-body{font-size:16px;line-height:1.7;color:var(--text);}
  .detail-section-body p+p{margin-top:14px;}
  .detail-bullets{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px;}
  .detail-bullets li{display:flex;gap:10px;font-size:15px;line-height:1.55;color:var(--text-2);}
  .detail-bullets li::before{content:'→';color:var(--accent);font-weight:700;flex-shrink:0;margin-top:1px;}
  /* FLASHY CHECK */
  .flashy-block{background:var(--navy);color:#fff;border-radius:12px;padding:28px 32px;margin-bottom:48px;}
  .flashy-block-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:8px;}
  .flashy-block-text{font-size:16px;line-height:1.6;}
  /* SPECS */
  .specs-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  @media(max-width:560px){.specs-grid{grid-template-columns:1fr;}}
  .spec-item{background:var(--surface-2);border-radius:8px;padding:14px 16px;font-size:14px;}
  .spec-item strong{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:4px;}
  /* VIDEO */
  .video-wrap{border-radius:12px;overflow:hidden;position:relative;padding-bottom:56.25%;height:0;}
  .video-wrap iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;}
  /* BUY SECTION */
  .buy-section{background:var(--surface-2);border:1px solid var(--border);border-radius:14px;padding:28px 32px;display:flex;flex-direction:column;gap:16px;}
  .buy-primary{display:inline-flex;align-items:center;gap:8px;background:#1A1A1A;color:#fff;padding:13px 22px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;transition:background .15s;}
  .buy-primary:hover{background:var(--accent);text-decoration:none;}
  .buy-alt{font-size:14px;color:var(--text-2);}
  .buy-alt a{font-weight:600;}
  /* GOES WELL WITH */
  .gww-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
  @media(max-width:600px){.gww-grid{grid-template-columns:1fr;}}
  .gww-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;text-decoration:none;}
  .gww-card:hover{border-color:var(--accent);text-decoration:none;}
  .gww-card-img{height:120px;background:var(--surface-2);overflow:hidden;}
  .gww-card-img img{width:100%;height:100%;object-fit:cover;}
  .gww-card-body{padding:12px 14px;}
  .gww-card-brand{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:3px;}
  .gww-card-name{font-size:13px;font-weight:700;color:var(--text);}
  /* SOURCES */
  .sources-list{display:flex;flex-direction:column;gap:10px;}
  .source-item{font-size:14px;display:flex;gap:8px;}
  .source-outlet{font-weight:700;color:var(--text-3);flex-shrink:0;min-width:80px;}
  /* BACK NAV */
  .back-nav{max-width:1120px;margin:0 auto;padding:32px 24px;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--text-2);border-top:1px solid var(--border);}
  .back-nav a{color:var(--text-2);}
  .back-nav a:hover{color:var(--accent);}
  /* FOOTER */
  .guide-footer{background:#0F1724;color:rgba(255,255,255,.5);padding:40px 24px;font-size:13px;}
  .guide-footer-inner{max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;}
  .guide-footer a{color:rgba(255,255,255,.5);}
  .guide-footer a:hover{color:#fff;text-decoration:none;}
</style>`;

const GUIDE_NAV = `<nav class="guide-nav">
  <div class="guide-nav-inner">
    <a href="/guide/" class="guide-wordmark">Guy<span>Talk</span> Guide</a>
    <div class="guide-nav-links">
      <a href="/" class="guide-nav-link">Today's Brief</a>
      <a href="/guide/" class="guide-nav-link">Guide</a>
      <a href="https://www.guytalk.beehiiv.com/subscribe" class="guide-nav-cta" target="_blank" rel="noopener">Subscribe</a>
    </div>
  </div>
</nav>
<div class="guide-tabs" id="guideTabs">
  <div class="guide-tabs-inner">
    <a href="/guide/style/"          class="guide-tab" data-path="style">Style</a>
    <a href="/guide/watches/"        class="guide-tab" data-path="watches">Watches</a>
    <a href="/guide/bourbon-cigars/" class="guide-tab" data-path="bourbon-cigars">Bourbon &amp; Cigars</a>
    <a href="/guide/cars/"           class="guide-tab" data-path="cars">Cars</a>
    <a href="/guide/fitness/"        class="guide-tab" data-path="fitness">Fitness</a>
    <a href="/guide/accessories/"    class="guide-tab" data-path="accessories">Accessories</a>
  </div>
</div>
<script>(function(){var p=window.location.pathname;document.querySelectorAll('.guide-tab').forEach(function(t){if(p.indexOf('/'+t.dataset.path+'/')!==-1)t.classList.add('active');});})();</script>`;

// ─── JSON repair ────────────────────────────────────────────────────────────────────────────────
function repairJson(raw) {
  // Scan character-by-character; handle all common AI JSON output problems:
  // 1. Raw newlines/tabs inside string values
  // 2. Curly/smart double quotes used inside string values (output as escaped \")
  // 3. Curly single quotes in strings (fine as-is, no escaping needed)
  // 4. Control characters stripped
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const code = c.charCodeAt(0);
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { esc = true; out += c; continue; }
    // Curly double quotes (U+201C, U+201D)
    if (code === 0x201C || code === 0x201D) {
      if (inStr) { out += "\\\""; } else { out += "\""; inStr = true; }
      continue;
    }
    // Regular straight double quote = string delimiter
    if (c === "\"") { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      if (code < 0x20) continue; // strip other control chars
    }
    out += c;
  }
  try { return JSON.parse(out); } catch (e) {}
  // Second pass: fix unrecognised escape sequences like \s \w
  const fixed = out.replace(/\\([^"\\\n\r\tbfnrtu\/0-9])/g, function(m, ch) { return ch; });
  return JSON.parse(fixed);
}
// ─── Content generation via OpenAI ───────────────────────────────────────────
async function generateContent(pick, catLabel, verb) {
  const prompt = `You are a senior editor at GuyTalk, a premium men's lifestyle publication. Voice: confident, opinionated, plain-spoken, never cringe, never hype. Like a smart friend who actually did the homework.

Generate deep editorial content for this product pick. Research it using web search — find real expert reviews, Reddit threads, brand history, and actual usage experiences.

Product: ${pick.brand} ${pick.name}
Category: ${catLabel}
Price: ${pick.priceApprox}
Our current bio: "${pick.bio}"
Flashy check: "${pick.flashyCheck}"

Return ONLY valid JSON (no markdown, no commentary) with these exact fields:
{
  "quickVerdict": "One crisp sentence. Our honest bottom line on this product.",
  "ourTake": "4-6 sentences expanding on the card bio. Real, opinionated, based on research. Not a spec sheet. Not neutral. A sharp friend's honest read.",
  "whyRecommend": ["3-4 specific reasons to buy this. Each one a complete sentence. Real reasons, not marketing copy."],
  "keySpecs": ["4-6 key facts or specs presented as bullet facts. Be specific — actual numbers, materials, weights where relevant."],
  "brandStory": "3-4 sentences on the brand: who they are, how they got here, where they sit in the market. Honest — mention if they're corporate or independent, known for quality or for marketing.",
  "howToUse": "2-3 sentences of practical advice: how to actually ${verb} this, pair it, maintain it, or get the most out of it.",
  "videoTitle": "Short descriptive title for the YouTube video we'd embed (what it should cover)",
  "videoQuery": "YouTube search query to find the best review or explainer video for this product",
  "goesWith": ["2-3 slugs from this list that pair well with this pick: peter-millar-crown-comfort-polo, ocbd-oxford-button-down, common-projects-achilles-low, apc-petit-standard-denim, taylor-stitch-chore-coat, uniqlo-merino-crew, buck-mason-curved-hem-tee, todd-snyder-stretch-chino, beckett-simonon-chukka, therealreal-vintage-leather-bomber, le-labo-santal-33, byredo-mister-marvelous, dior-sauvage-edt, seiko-5-sports, hamilton-khaki-field, tissot-prx-powermatic, tudor-black-bay, casio-world-time, leather-nato-strap, buffalo-trace, wild-turkey-101, four-roses-single-barrel, eagle-rare-10, blantons-single-barrel, oliva-serie-v, glencairn-glass-set, king-ice-cube-mold, mazda-miata-mx5, noco-boost-jump-starter, viofo-dash-cam, chemical-guys-wash-kit, weathertech-floor-mats, bowflex-selecttech-552, nike-metcon-9, new-balance-1080, kettlebell, theragun-prime, gym-bag, bellroy-note-sleeve, ray-ban-wayfarer, persol-714, leather-dress-belt, dopp-kit"],
  "alternatives": [{"slug": "pick-slug-if-exists-or-empty", "name": "Alternative Product Name", "reason": "One sentence: who should buy this instead and why."}],
  "sources": [
    {"outlet": "Outlet Name", "title": "Article or thread title", "url": "https://..."},
    {"outlet": "Outlet Name", "title": "Article or thread title", "url": "https://..."}
  ]
}`;

  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    tool_choice: 'required',
    input: [{ role: 'user', content: prompt }],
  });

  const text = (response.output || [])
    .filter(b => b.type === 'message')
    .flatMap(b => Array.isArray(b.content) ? b.content : [])
    .filter(c => c?.type === 'output_text' || c?.type === 'text')
    .map(c => c.text || '')
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in content response');
  return repairJson(jsonMatch[0]);
}

async function findYouTubeVideo(query) {
  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: 'web_search', search_context_size: 'low' }],
    tool_choice: 'required',
    input: [{ role: 'user', content: `Find the best YouTube review or explainer video for: "${query}"\n\nReturn ONLY valid JSON:\n{"videoId": "11-char-youtube-id-or-null", "videoTitle": "Video title"}` }],
  });

  const text = (response.output || [])
    .filter(b => b.type === 'message')
    .flatMap(b => Array.isArray(b.content) ? b.content : [])
    .map(c => c.text || '')
    .join('');

  // Try to extract from JSON
  const jMatch = text.match(/\{[\s\S]*?\}/);
  if (jMatch) {
    try {
      const obj = JSON.parse(jMatch[0]);
      if (obj.videoId && /^[a-zA-Z0-9_-]{11}$/.test(obj.videoId)) return obj;
    } catch {}
  }

  // Fallback: regex extract from text
  const ytMatch = text.match(/(?:v=|youtu\.be\/|\/watch\?v=)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { videoId: ytMatch[1], videoTitle: query };

  return { videoId: null, videoTitle: null };
}

async function verifyVideoId(videoId) {
  if (!videoId) return false;
  try {
    const res = await fetch(`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, { method: 'HEAD' });
    return res.ok;
  } catch { return false; }
}

// ─── HTML template ────────────────────────────────────────────────────────────
function renderDetailPage(pick, content, catKey, catLabel, videoId, allPicks) {
  const tagClass = pick.tag === 'GuyTalk Pick' ? 'gtag-blue'
                 : pick.tag === 'Best Value'    ? 'gtag-green'
                 : pick.tag === 'Upgrade'       ? 'gtag-amber'
                 : 'gtag-navy';
  const initial = (pick.brand || pick.name || '?')[0].toUpperCase();
  const imgPath = `/assets/guide/${catKey}/${pick.slug}.jpg`;
  const fallback = `this.onerror=null;this.parentElement.innerHTML='<div class="detail-hero-img-ph"><div class="detail-hero-img-ph-init">${initial}</div><div class="detail-hero-img-ph-label">${pick.brand}</div></div>'`;

  // Build goesWith cards using allPicks cross-reference
  const goesWithCards = (content.goesWith || []).slice(0, 3).map(slug => {
    const found = allPicks.find(p => p.slug === slug);
    const cat   = found ? found._cat : catKey;
    const name  = found ? found.name : slug;
    const brand = found ? found.brand : '';
    const imgSrc = found ? `/assets/guide/${cat}/${slug}.jpg` : '';
    const fallbackGww = `this.onerror=null;this.src='/assets/guide/${cat}/placeholder.svg'`;
    return `<a href="/guide/${cat}/${slug}/" class="gww-card">
        <div class="gww-card-img"><img src="${imgSrc}" alt="${name}" loading="lazy" onerror="${fallbackGww}"></div>
        <div class="gww-card-body">
          <div class="gww-card-brand">${brand}</div>
          <div class="gww-card-name">${name}</div>
        </div>
      </a>`;
  }).join('\n      ');

  // Build bullets HTML
  const bulletList = (arr) => (arr || []).map(b => `<li>${b}</li>`).join('\n          ');

  // Specs grid
  const specsGrid = (content.keySpecs || []).map(s => {
    const colonIdx = s.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      return `<div class="spec-item"><strong>${s.slice(0, colonIdx)}</strong>${s.slice(colonIdx + 1).trim()}</div>`;
    }
    return `<div class="spec-item">${s}</div>`;
  }).join('\n          ');

  // Sources list
  const sourcesList = (content.sources || []).map(s =>
    `<div class="source-item"><span class="source-outlet">${s.outlet}</span><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></div>`
  ).join('\n        ');

  // Buy section
  const buyUrl = pick.affiliateUrl || '#';
  const buyText = catKey === 'watches' ? 'Buy This Watch →'
                : catKey === 'bourbon-cigars' ? 'Buy This Bottle →'
                : catKey === 'cars' ? 'Browse Listings →'
                : 'Buy This →';
  const altSection = (content.alternatives || []).length > 0
    ? `<div class="buy-alt">Too much? <a href="${content.alternatives[0].url || '/guide/' + catKey + '/'}">${content.alternatives[0].reason}</a></div>`
    : '';

  // Video embed
  const videoSection = videoId
    ? `<div class="detail-section">
      <div class="detail-section-eyebrow">WATCH THIS</div>
      <h2 class="detail-section-title">Worth Watching</h2>
      <div class="video-wrap">
        <iframe src="https://www.youtube.com/embed/${videoId}" title="${content.videoTitle || pick.name + ' review'}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pick.brand} ${pick.name} — GuyTalk Guide</title>
<meta name="description" content="${content.quickVerdict || pick.bio}">
<meta property="og:type"        content="article">
<meta property="og:title"       content="${pick.brand} ${pick.name} — GuyTalk Guide">
<meta property="og:description" content="${content.quickVerdict || pick.bio}">
<meta property="og:image"       content="${SITE}${imgPath}">
<meta property="og:url"         content="${SITE}/guide/${catKey}/${pick.slug}/">
<meta name="twitter:card"       content="summary_large_image">
<link rel="canonical"           href="${SITE}/guide/${catKey}/${pick.slug}/">
<link rel="icon"                href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap" rel="stylesheet">
${SHARED_CSS}
</head>
<body>
${GUIDE_NAV}

<div class="detail-hero">
  <div class="detail-hero-inner">
    <div>
      <div class="detail-crumb">
        <a href="/guide/">Guide</a><span class="detail-crumb-sep">›</span>
        <a href="/guide/${catKey}/">${catLabel}</a><span class="detail-crumb-sep">›</span>
        ${pick.name}
      </div>
      <div class="detail-brand">${pick.brand}</div>
      <h1 class="detail-name">${pick.name}</h1>
      <div class="detail-price">${pick.priceApprox}</div>
      <span class="gtag ${tagClass}">${pick.tag}</span>
      <p class="detail-verdict">${content.quickVerdict || pick.bio}</p>
    </div>
    <div class="detail-hero-img">
      <img src="${imgPath}" alt="${pick.brand} ${pick.name}" loading="eager"
           onerror="${fallback}">
    </div>
  </div>
</div>

<div class="detail-body">

  <div class="detail-section">
    <div class="detail-section-eyebrow">THE GUYTALK TAKE</div>
    <h2 class="detail-section-title">Our Honest Read</h2>
    <div class="detail-section-body">
      <p>${(content.ourTake || pick.bio).replace(/\. /g, '.</p><p>')}</p>
    </div>
  </div>

  <div class="detail-section">
    <div class="detail-section-eyebrow">WHY WE RECOMMEND IT</div>
    <h2 class="detail-section-title">The Case For It</h2>
    <ul class="detail-bullets">
          ${bulletList(content.whyRecommend)}
    </ul>
  </div>

  <div class="flashy-block">
    <div class="flashy-block-label">Is It Too Flashy?</div>
    <div class="flashy-block-text">${pick.flashyCheck}</div>
  </div>

  <div class="detail-section">
    <div class="detail-section-eyebrow">WHAT TO KNOW</div>
    <h2 class="detail-section-title">Key Facts</h2>
    <div class="specs-grid">
          ${specsGrid}
    </div>
  </div>

  <div class="detail-section">
    <div class="detail-section-eyebrow">THE BRAND</div>
    <h2 class="detail-section-title">Who Makes This</h2>
    <div class="detail-section-body">
      <p>${(content.brandStory || '').replace(/\. /g, '.</p><p>')}</p>
    </div>
  </div>

  <div class="detail-section">
    <div class="detail-section-eyebrow">HOW TO USE IT</div>
    <h2 class="detail-section-title">Making It Work</h2>
    <div class="detail-section-body">
      <p>${(content.howToUse || '').replace(/\. /g, '.</p><p>')}</p>
    </div>
  </div>

  ${videoSection}

  <div class="detail-section">
    <div class="detail-section-eyebrow">WHERE TO BUY</div>
    <h2 class="detail-section-title">Get It</h2>
    <div class="buy-section">
      <a href="${buyUrl}" class="buy-primary" target="_blank" rel="noopener">${buyText}</a>
      ${altSection}
    </div>
  </div>

  ${(content.goesWith || []).length > 0 ? `<div class="detail-section">
    <div class="detail-section-eyebrow">GOES WELL WITH</div>
    <h2 class="detail-section-title">Also Worth Owning</h2>
    <div class="gww-grid">
      ${goesWithCards}
    </div>
  </div>` : ''}

  ${(content.sources || []).length > 0 ? `<div class="detail-section">
    <div class="detail-section-eyebrow">WHAT WE READ</div>
    <h2 class="detail-section-title">Our Research</h2>
    <div class="sources-list">
        ${sourcesList}
    </div>
  </div>` : ''}

</div>

<div class="back-nav">
  <a href="/guide/${catKey}/">← Back to ${catLabel}</a>
</div>

<footer class="guide-footer">
  <div class="guide-footer-inner">
    <span>© 2026 GuyTalk Media. All rights reserved.</span>
    <span><a href="/guide/">Guide Home</a> &nbsp;·&nbsp; <a href="/">Today's Brief</a> &nbsp;·&nbsp; <a href="https://www.guytalk.beehiiv.com/subscribe">Subscribe</a></span>
  </div>
</footer>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const catFilter  = (args.find(a => a.startsWith('--cat='))  || '').replace('--cat=', '');
  const slugFilter = (args.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '');

  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

  // Build full picks manifest across all categories
  const allPicks = [];
  for (const cat of CATEGORIES) {
    const dataFile = path.join(DATA, cat.file);
    if (!fs.existsSync(dataFile)) { console.log(`SKIP (no data): ${cat.file}`); continue; }
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    (data.picks || []).forEach(p => allPicks.push({ ...p, _cat: cat.key, _catLabel: cat.label, _verb: cat.verb }));
  }

  const log = { generated: [], skipped: [], failed: [], unresolved: [] };

  const picksToProcess = allPicks.filter(p => {
    if (catFilter  && p._cat  !== catFilter)  return false;
    if (slugFilter && p.slug  !== slugFilter)  return false;
    return true;
  });

  console.log(`Processing ${picksToProcess.length} picks...`);

  for (const pick of picksToProcess) {
    const catKey    = pick._cat;
    const catLabel  = pick._catLabel;
    const verb      = pick._verb;
    const outDir    = path.join(ROOT, 'guide', catKey, pick.slug);
    const outFile   = path.join(outDir, 'index.html');
    const dataFile  = path.join(DATA, CATEGORIES.find(c => c.key === catKey).file);

    // Skip if already fully generated
    if (fs.existsSync(outFile) && pick.ourTake) {
      console.log(`  SKIP (exists): ${catKey}/${pick.slug}`);
      log.skipped.push(`${catKey}/${pick.slug}`);
      continue;
    }

    console.log(`\n  [${catKey}] ${pick.slug}`);
    fs.mkdirSync(outDir, { recursive: true });

    let content = {};
    let videoId = null;

    try {
      // 1. Generate content
      content = await generateContent(pick, catLabel, verb);
      console.log(`    ✓ content generated`);
    } catch (err) {
      console.error(`    ✗ content failed: ${err.message}`);
      log.failed.push(`${catKey}/${pick.slug}: content — ${err.message}`);
      content = { quickVerdict: pick.bio, ourTake: pick.bio, whyRecommend: [], keySpecs: [], brandStory: '', howToUse: '', goesWith: [], sources: [] };
    }

    await new Promise(r => setTimeout(r, 600));

    try {
      // 2. Find YouTube video
      const { videoId: vid, videoTitle } = await findYouTubeVideo(content.videoQuery || `${pick.brand} ${pick.name} review`);
      if (vid) {
        const valid = await verifyVideoId(vid);
        if (valid) {
          videoId = vid;
          content.videoId = vid;
          content.videoTitle = videoTitle;
          console.log(`    ✓ video: ${vid}`);
        } else {
          console.log(`    ✗ video ID invalid: ${vid}`);
          log.unresolved.push(`video: ${catKey}/${pick.slug} — ID ${vid} did not validate`);
        }
      } else {
        console.log(`    ✗ no video found`);
        log.unresolved.push(`video: ${catKey}/${pick.slug} — no YouTube ID found`);
      }
    } catch (err) {
      console.error(`    ✗ video search failed: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 600));

    // 3. Update picks JSON with extended content
    try {
      const picksData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const pickIdx = (picksData.picks || []).findIndex(p => p.slug === pick.slug);
      if (pickIdx !== -1) {
        picksData.picks[pickIdx] = { ...picksData.picks[pickIdx], ...content };
        fs.writeFileSync(dataFile, JSON.stringify(picksData, null, 2));
      }
    } catch (err) {
      console.error(`    ✗ JSON update failed: ${err.message}`);
    }

    // 4. Render HTML
    const html = renderDetailPage(pick, content, catKey, catLabel, videoId, allPicks);
    fs.writeFileSync(outFile, html);
    console.log(`    ✓ wrote ${outFile}`);
    log.generated.push(`${catKey}/${pick.slug}`);

    await new Promise(r => setTimeout(r, 900));
  }

  // ── Verification report ────────────────────────────────────────────────────
  fs.writeFileSync(path.join(DATA, 'detail-generation-log.json'), JSON.stringify(log, null, 2));

  console.log('\n\n══════════ DETAIL PAGE GENERATION COMPLETE ══════════');
  console.log(`Generated:  ${log.generated.length}`);
  console.log(`Skipped:    ${log.skipped.length}`);
  console.log(`Failed:     ${log.failed.length}`);
  console.log(`Unresolved: ${log.unresolved.length}`);
  if (log.unresolved.length) {
    console.log('\nUNRESOLVED:');
    log.unresolved.forEach(u => console.log('  •', u));
  }
  if (log.failed.length) {
    console.log('\nFAILED:');
    log.failed.forEach(f => console.log('  •', f));
  }
}

main().catch(console.error);

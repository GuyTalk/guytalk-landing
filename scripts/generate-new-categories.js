#!/usr/bin/env node
'use strict';

/**
 * Generates Fitness and Accessories category pages for GuyTalk Guide.
 * Uses OpenAI web_search to research picks, then writes picks JSON + HTML.
 * Run: node scripts/generate-new-categories.js
 */

require('dotenv').config({ path: '.env.local' });

const OpenAI = require('openai');
const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const DATA    = path.join(ROOT, 'guide', 'data');
const client  = new (OpenAI.default || OpenAI)({ apiKey: process.env.OPENAI_API_KEY });
const MODEL   = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1';

// ─── Shared CSS/NAV block (matches all guide pages) ───────────────────────────
function sharedCSS() {
  return `<style>*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
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
  .guide-nav{position:sticky;top:0;z-index:50;background:rgba(249,248,245,0.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--border);}
  .guide-nav-inner{display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto;padding:14px 24px;}
  .guide-wordmark{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:19px;letter-spacing:-.02em;color:var(--text);text-decoration:none;}
  .guide-wordmark span{color:var(--accent);}
  .guide-nav-links{display:flex;align-items:center;gap:24px;}
  .guide-nav-link{font-size:14px;font-weight:600;color:var(--text-2);}
  .guide-nav-cta{background:var(--accent);color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;}
  .guide-nav-cta:hover{background:var(--accent-h);text-decoration:none;}
  /* ── GUIDE TABS ── */
  .guide-tabs{position:sticky;top:57px;z-index:90;background:rgba(249,248,245,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}
  .guide-tabs-inner{max-width:1120px;margin:0 auto;padding:0 24px;display:flex;gap:0;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .guide-tab{padding:12px 18px;font-family:'Inter Tight',sans-serif;font-weight:700;font-size:13px;letter-spacing:.01em;color:var(--text-2);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s ease,border-color .15s ease;white-space:nowrap;}
  .guide-tab:hover{color:var(--text);text-decoration:none;}
  .guide-tab.active{color:var(--accent);border-bottom-color:var(--accent);}
  /* ── CAT BAND ── */
  .cat-band{background:#1A1A1A;color:#fff;padding:48px 24px 40px;}
  .cat-band-inner{max-width:1120px;margin:0 auto;}
  .cat-band-crumb{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:12px;}
  .cat-band-crumb a{color:rgba(255,255,255,.55);text-decoration:none;}
  .cat-band-crumb a:hover{color:rgba(255,255,255,.85);}
  .cat-band-crumb-sep{margin:0 8px;}
  .cat-band-title{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:clamp(28px,5vw,44px);letter-spacing:-.025em;line-height:1.1;margin-bottom:10px;}
  .cat-band-desc{font-size:16px;color:rgba(255,255,255,.62);max-width:480px;}
  /* ── PICKS GRID ── */
  .picks-section{padding:64px 24px;}
  .picks-inner{max-width:1120px;margin:0 auto;}
  .section-eyebrow{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
  .section-title{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:clamp(22px,3.5vw,32px);letter-spacing:-.02em;margin-bottom:8px;}
  .section-desc{font-size:15px;color:var(--text-2);margin-bottom:36px;max-width:560px;}
  .picks-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
  @media(max-width:900px){.picks-grid{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:580px){.picks-grid{grid-template-columns:1fr;}}
  .pick-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
  .pick-card-img{height:210px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;overflow:hidden;}
  .pick-card-img img{width:100%;height:100%;object-fit:cover;}
  .pick-card-img-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:6px;}
  .pick-card-img-ph-initial{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:48px;color:var(--border-light);}
  .pick-card-img-ph-label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);}
  .pick-card-body{padding:18px 18px 20px;display:flex;flex-direction:column;flex:1;}
  .pick-card-tag{margin-bottom:10px;}
  .gtag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:4px;}
  .gtag-blue{background:var(--accent-muted);color:var(--accent);}
  .gtag-amber{background:var(--amber-muted);color:var(--amber);}
  .gtag-navy{background:rgba(15,23,36,.07);color:var(--navy);}
  .gtag-green{background:rgba(22,163,74,.08);color:var(--green);}
  .pick-card-brand{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:4px;}
  .pick-card-name{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:15px;letter-spacing:-.01em;color:var(--text);margin-bottom:6px;}
  .pick-card-price{font-size:14px;font-weight:700;color:var(--accent);margin-bottom:10px;}
  .pick-card-bio{font-size:13px;color:var(--text-2);line-height:1.55;margin-bottom:16px;flex:1;}
  .pick-card-buy{display:inline-block;padding:9px 16px;background:#1A1A1A;color:#fff;border-radius:7px;font-size:13px;font-weight:700;transition:background .15s ease;}
  .pick-card-buy:hover{background:var(--accent);text-decoration:none;}
  .pick-card-buy.gray-tag{background:var(--surface-2);color:var(--text-2);font-size:12px;}
  /* ── DEALS STRIP ── */
  .deals-section{background:var(--surface-2);padding:48px 24px;}
  .deals-inner{max-width:1120px;margin:0 auto;}
  .deals-scroll{display:flex;gap:16px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch;}
  .deal-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;min-width:220px;max-width:260px;flex-shrink:0;}
  .deal-card-source{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;}
  .deal-card-name{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:14px;margin-bottom:4px;}
  .deal-card-brand{font-size:12px;color:var(--text-2);margin-bottom:8px;}
  .deal-card-price{font-size:16px;font-weight:700;color:var(--accent);}
  .deal-card-orig{font-size:12px;color:var(--text-3);text-decoration:line-through;margin-left:6px;}
  .deal-card-note{font-size:12px;color:var(--text-2);margin-top:6px;}
  .deal-card-link{display:inline-block;margin-top:12px;font-size:12px;font-weight:700;color:var(--accent);}
  /* ── FOOTER ── */
  .guide-footer{background:#0F1724;color:rgba(255,255,255,.5);padding:40px 24px;font-size:13px;}
  .guide-footer-inner{max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;}
  .guide-footer a{color:rgba(255,255,255,.5);}
  .guide-footer a:hover{color:#fff;text-decoration:none;}
</style>`;
}

function sharedNav() {
  return `<nav class="guide-nav">
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
}

function sharedFooter() {
  return `<footer class="guide-footer">
  <div class="guide-footer-inner">
    <span>© 2026 GuyTalk Media. All rights reserved.</span>
    <span><a href="/guide/">Guide Home</a> &nbsp;·&nbsp; <a href="/">Today's Brief</a> &nbsp;·&nbsp; <a href="https://www.guytalk.beehiiv.com/subscribe">Subscribe</a></span>
  </div>
</footer>`;
}

// ─── OpenAI research helpers ──────────────────────────────────────────────────
async function researchPicks(category, description, pickList) {
  const prompt = `You are building product recommendation data for GuyTalk, a premium men's lifestyle publication. The voice is confident, opinionated, plain-spoken — like a trusted friend who did the homework.

Category: ${category}
Description: ${description}

I need a JSON array of ${pickList.length} product picks. For each item in this list, produce one pick object:
${pickList.map((p, i) => `${i + 1}. ${p}`).join('\n')}

For each pick, research the actual product and return valid JSON with these exact fields:
{
  "slug": "kebab-case-unique-id",
  "brand": "Brand Name",
  "name": "Product Full Name",
  "tier": "one of: Best Overall | Best Value | Upgrade Pick | The Alternative | Think Twice",
  "tag": "one of: GuyTalk Pick | Best Value | Upgrade | Skip This",
  "priceApprox": "$XX",
  "bio": "2-3 sentence honest take. Opinionated. Not hype. Not neutral summary. What a sharp friend would tell you.",
  "flashyCheck": "1 sentence: is it flashy? How much? Who cares vs. who notices?",
  "productSearch": "Search query to find this exact product image",
  "preferredRetailer": "Best retailer name or Amazon",
  "linkType": "specific",
  "affiliateUrl": "https://www.amazon.com/dp/ASIN?tag=guytalk-20 OR brand website URL",
  "image": ""
}

Return ONLY valid JSON array. No markdown, no commentary.`;

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

  // Extract JSON array
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response:\n' + text.slice(0, 500));
  return JSON.parse(jsonMatch[0]);
}

async function researchOutfit(category, theme, items) {
  const prompt = `Create an outfit/collection board for GuyTalk Guide's ${category} category.
Theme: "${theme}"

Pick ${items.length} specific products that work together as a set:
${items.join(', ')}

Return valid JSON (no markdown):
{
  "theme": "${theme}",
  "subtitle": "One-line editorial caption (honest, sharp, not cringe)",
  "items": [
    { "name": "Full Product Name", "brand": "Brand", "role": "What this item does in the context", "price": "$XX", "shopUrl": "https://..." }
  ]
}`;

  const response = await client.responses.create({
    model: MODEL,
    tools: [{ type: 'web_search', search_context_size: 'low' }],
    tool_choice: 'required',
    input: [{ role: 'user', content: prompt }],
  });

  const text = (response.output || [])
    .filter(b => b.type === 'message')
    .flatMap(b => Array.isArray(b.content) ? b.content : [])
    .map(c => c.text || '')
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in outfit response');
  return JSON.parse(match[0]);
}

// ─── HTML generators ──────────────────────────────────────────────────────────
function pickCardHTML(pick, category) {
  const initial = (pick.brand || pick.name || '?')[0].toUpperCase();
  const imgPath = `/assets/guide/${category}/${pick.slug}.jpg`;
  const tagClass = pick.tag === 'GuyTalk Pick' ? 'gtag-blue'
                 : pick.tag === 'Best Value'    ? 'gtag-green'
                 : pick.tag === 'Upgrade'       ? 'gtag-amber'
                 : 'gtag-navy';
  const fallbackInner = `this.onerror=null;this.parentElement.innerHTML='<div class=\\'pick-card-img-ph\\'><div class=\\'pick-card-img-ph-initial\\'>${initial}</div><div class=\\'pick-card-img-ph-label\\'>${pick.brand}</div></div>'`;

  return `    <div class="pick-card">
      <div class="pick-card-img">
        <img src="${imgPath}" alt="${pick.brand} ${pick.name}" loading="lazy"
             onerror="${fallbackInner}">
      </div>
      <div class="pick-card-body">
        <div class="pick-card-tag"><span class="gtag ${tagClass}">${pick.tag}</span></div>
        <div class="pick-card-brand">${pick.brand}</div>
        <div class="pick-card-name">${pick.name}</div>
        <div class="pick-card-price">${pick.priceApprox}</div>
        <p class="pick-card-bio">${pick.bio}</p>
        <a href="/guide/${category}/${pick.slug}/" class="pick-card-buy">Read Our Take →</a>
      </div>
    </div>`;
}

function categoryPageHTML(category, meta, picks, outfit, deals) {
  const outfitItems = (outfit.items || []).map(item => `
          <div class="outfit-item">
            <div class="outfit-item-info">
              <div class="outfit-item-name">${item.name}</div>
              <div class="outfit-item-role">${item.role}</div>
            </div>
            <a href="${item.shopUrl}" class="outfit-item-shop" target="_blank" rel="noopener">Shop →</a>
          </div>`).join('');

  const dealsHTML = (deals || []).map(d => `
        <div class="deal-card">
          <div class="deal-card-source">${d.source}</div>
          <div class="deal-card-name">${d.name}</div>
          <div class="deal-card-brand">${d.brand}</div>
          <div class="deal-card-price">${d.price}${d.originalPrice ? `<span class="deal-card-orig">${d.originalPrice}</span>` : ''}</div>
          <div class="deal-card-note">${d.note}</div>
          <a href="${d.link}" class="deal-card-link" target="_blank" rel="noopener">Get it →</a>
        </div>`).join('');

  const picksHTML = picks.map(p => pickCardHTML(p, category)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${meta.label} — The GuyTalk Guide</title>
<meta name="description" content="${meta.description}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${meta.label} — The GuyTalk Guide">
<meta property="og:description" content="${meta.description}">
<meta property="og:image"       content="https://www.guytalkmedia.com/assets/og-card.png">
<meta property="og:url"         content="https://www.guytalkmedia.com/guide/${category}/">
<meta name="twitter:card"       content="summary_large_image">
<link rel="canonical"           href="https://www.guytalkmedia.com/guide/${category}/">
<link rel="icon"                href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${sharedCSS()}
  /* ── OUTFIT BOARD ── */
  .outfit-section{padding:64px 24px 0;}
  .outfit-inner{max-width:1120px;margin:0 auto;}
  .outfit-board{display:grid;grid-template-columns:320px 1fr;gap:32px;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
  @media(max-width:720px){.outfit-board{grid-template-columns:1fr;}}
  .outfit-img{height:380px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;overflow:hidden;}
  .outfit-img img{width:100%;height:100%;object-fit:cover;}
  .outfit-img-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--text-3);}
  .outfit-img-ph-label{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}
  .outfit-content{padding:32px;}
  .outfit-theme{font-family:'Inter Tight',sans-serif;font-weight:800;font-size:20px;letter-spacing:-.015em;margin-bottom:6px;}
  .outfit-subtitle{font-size:13px;color:var(--text-2);margin-bottom:24px;font-style:italic;}
  .outfit-items{display:flex;flex-direction:column;gap:0;}
  .outfit-item{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--border);}
  .outfit-item:last-child{border-bottom:none;}
  .outfit-item-name{font-weight:600;font-size:14px;margin-bottom:2px;}
  .outfit-item-role{font-size:12px;color:var(--text-2);}
  .outfit-item-shop{font-size:13px;font-weight:700;color:var(--accent);white-space:nowrap;margin-left:16px;}
  .outfit-item-shop:hover{text-decoration:underline;}
  .outfit-caption{font-size:13px;color:var(--text-2);font-style:italic;margin-top:20px;padding-top:16px;border-top:1px solid var(--border);}
</head>
<body>
${sharedNav()}
<div class="cat-band">
  <div class="cat-band-inner">
    <div class="cat-band-crumb"><a href="/guide/">Guide</a><span class="cat-band-crumb-sep">›</span>${meta.label}</div>
    <h1 class="cat-band-title">${meta.label}</h1>
    <p class="cat-band-desc">${meta.description}</p>
  </div>
</div>

<section class="outfit-section">
  <div class="outfit-inner">
    <div class="section-eyebrow">THE COLLECTION</div>
    <h2 class="section-title">${outfit.theme}</h2>
    <div class="outfit-board">
      <div class="outfit-img">
        <div class="outfit-img-ph"><div class="outfit-img-ph-label">${meta.label}</div></div>
      </div>
      <div class="outfit-content">
        <div class="outfit-theme">${outfit.theme}</div>
        <div class="outfit-subtitle">${outfit.subtitle}</div>
        <div class="outfit-items">${outfitItems}</div>
      </div>
    </div>
  </div>
</section>

<section class="picks-section">
  <div class="picks-inner">
    <div class="section-eyebrow">START HERE</div>
    <h2 class="section-title">Picks We'd Buy First</h2>
    <p class="section-desc">From the ${meta.label} guide — the things worth owning.</p>
    <div class="picks-grid">
${picksHTML}
    </div>
  </div>
</section>

<section class="deals-section">
  <div class="deals-inner">
    <div class="section-eyebrow">DEALS</div>
    <h2 class="section-title">Good Finds Right Now</h2>
    <div class="deals-scroll">
${dealsHTML}
    </div>
  </div>
</section>

${sharedFooter()}
</body>
</html>`;
}

// ─── Category configs ─────────────────────────────────────────────────────────
const CATEGORIES = {
  fitness: {
    label: 'Fitness',
    description: 'The equipment that earns its space. What to buy, what to skip, and how to build a real home gym without the noise.',
    outfitTheme: 'The Home Gym Starting Five',
    outfitItems: ['Adjustable dumbbells', 'Pull-up bar', 'Jump rope', 'Foam roller', 'Training shoes'],
    picks: [
      'Bowflex SelectTech 552 adjustable dumbbells',
      'Nike Metcon 9 training shoes',
      'New Balance Fresh Foam 1080 running shoes',
      'Rogue fitness pull-up bar or equivalent doorframe pull-up bar',
      'Onnit kettlebell or Rep Fitness kettlebell',
      'Theragun Prime or TriggerPoint GRID foam roller',
      'Speed rope / jump rope for conditioning (Crossrope or WOD Nation)',
      'Gym bag / duffel — Under Armour Undeniable or GORUCK GR1',
      'Whoop 4.0 fitness tracker or Garmin Forerunner',
      'Hydro Flask 32oz wide mouth water bottle',
    ],
    deals: [
      { slug: 'bowflex-selecttech-deal', source: 'Amazon', brand: 'Bowflex', name: 'SelectTech 552 Dumbbells', price: '$299', originalPrice: '$429', note: 'Periodic discount — set a price alert', link: 'https://www.amazon.com/dp/B001ARYS84?tag=guytalk-20' },
      { slug: 'nike-metcon-deal', source: 'Nike', brand: 'Nike', name: 'Metcon 9 Training Shoe', price: '$130', originalPrice: '$150', note: 'Outlet colorways often on sale', link: 'https://www.nike.com/t/metcon-9-training-shoes' },
      { slug: 'hydroflask-deal', source: 'Amazon', brand: 'Hydro Flask', name: '32oz Wide Mouth', price: '$38', originalPrice: '$50', note: 'Refurb and seasonal promos available', link: 'https://www.amazon.com/s?k=Hydro+Flask+32oz+Wide+Mouth&tag=guytalk-20' },
    ],
  },
  accessories: {
    label: 'Accessories',
    description: 'The details that finish the look. Bags, sunglasses, and the stuff that separates deliberate dressing from just getting dressed.',
    outfitTheme: 'The Weekend Carry',
    outfitItems: ['Leather weekender bag', 'Slim card wallet', 'Classic sunglasses', 'Watch'],
    picks: [
      'Leather weekender or overnight bag — Filson or Korchmar',
      'Bellroy slim wallet or Ridge wallet card case',
      'Ray-Ban Wayfarer sunglasses (classic)',
      'Persol 714 folding sunglasses (upgrade)',
      'Warby Parker or Goodr sport sunglasses (value)',
      'Leather dress belt — full-grain, no logo',
      'Dopp kit / toiletry bag — Filson or Waterfield',
      'Canvas or braided casual belt',
    ],
    deals: [
      { slug: 'bellroy-wallet-deal', source: 'Amazon', brand: 'Bellroy', name: 'Note Sleeve Wallet', price: '$59', originalPrice: '$79', note: 'Color-of-year discounts appear 2x yearly', link: 'https://www.amazon.com/s?k=Bellroy+Note+Sleeve+wallet&tag=guytalk-20' },
      { slug: 'rayban-wayfarer-deal', source: 'Amazon', brand: 'Ray-Ban', name: 'Original Wayfarer RB2140', price: '$99', originalPrice: '$163', note: 'Amazon often runs 20–40% off', link: 'https://www.amazon.com/s?k=Ray-Ban+Wayfarer+RB2140&tag=guytalk-20' },
      { slug: 'filson-bag-deal', source: 'Filson', brand: 'Filson', name: 'Medium Duffle Bag', price: '$285', originalPrice: '$350', note: 'Annual warehouse sale — check July/Jan', link: 'https://www.filson.com/products/medium-duffle-bag' },
    ],
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────
async function generateCategory(catKey) {
  const config = CATEGORIES[catKey];
  console.log(`\n=== Generating ${config.label} ===`);

  const outDir = path.join(ROOT, 'guide', catKey);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const assetsDir = path.join(ROOT, 'assets', 'guide', catKey);
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  // 1. Generate picks data
  const picksFile = path.join(DATA, `${catKey}-picks.json`);
  let picks;
  if (fs.existsSync(picksFile)) {
    console.log('  picks data exists, loading...');
    picks = JSON.parse(fs.readFileSync(picksFile, 'utf8')).picks;
  } else {
    console.log('  researching picks via OpenAI...');
    picks = await researchPicks(config.label, config.description, config.picks);
    const dataOut = { category: catKey, categoryLabel: config.label, categoryTagline: config.description, picks };
    fs.writeFileSync(picksFile, JSON.stringify(dataOut, null, 2));
    console.log(`  saved ${picks.length} picks to ${picksFile}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // 2. Generate outfit data
  const outfitFile = path.join(DATA, `${catKey}-outfits.json`);
  let outfit;
  if (fs.existsSync(outfitFile)) {
    console.log('  outfit data exists, loading...');
    outfit = JSON.parse(fs.readFileSync(outfitFile, 'utf8'));
  } else {
    console.log('  researching outfit via OpenAI...');
    outfit = await researchOutfit(config.label, config.outfitTheme, config.outfitItems);
    fs.writeFileSync(outfitFile, JSON.stringify(outfit, null, 2));
    console.log('  saved outfit data');
    await new Promise(r => setTimeout(r, 1000));
  }

  // 3. Build HTML
  const html = categoryPageHTML(catKey, config, picks, outfit, config.deals);
  const outFile = path.join(outDir, 'index.html');
  fs.writeFileSync(outFile, html);
  console.log(`  wrote ${outFile} (${picks.length} picks)`);

  // 4. Save deals data
  const dealsFile = path.join(DATA, `${catKey}-deals.json`);
  if (!fs.existsSync(dealsFile)) {
    fs.writeFileSync(dealsFile, JSON.stringify({ category: catKey, updatedAt: new Date().toISOString().slice(0, 10), deals: config.deals }, null, 2));
  }

  return picks;
}

async function main() {
  for (const catKey of Object.keys(CATEGORIES)) {
    await generateCategory(catKey);
  }
  console.log('\n✓ All new categories generated');
}

main().catch(console.error);

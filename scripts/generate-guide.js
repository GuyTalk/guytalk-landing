#!/usr/bin/env node
'use strict';

/**
 * GuyTalk Guide generator — reads guide/data/ files, writes static HTML.
 *
 * Usage:
 *   node scripts/generate-guide.js                          # regenerate everything
 *   node scripts/generate-guide.js --slug=what-is-peter-millar  # single article
 *   node scripts/generate-guide.js --category=style        # one category + its articles
 */

require('dotenv').config({ path: '.env.local' });
const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'guide', 'data');
const OUT_DIR  = path.join(ROOT, 'guide');
const SITE_URL = 'https://www.guytalkmedia.com';

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META = {
  style: {
    label: 'Style',
    description: 'How to dress better, spend less, and stop overthinking it.',
    pairingLabel: 'This Week\'s Fit',
    live: true,
  },
  watches: {
    label: 'Watches',
    description: 'What to buy, what it means, and how not to look clueless at the AD.',
    pairingLabel: 'The Starter Collection',
    live: false,
  },
  'bourbon-cigars': {
    label: 'Bourbon & Cigars',
    description: 'The fundamentals. What to order, what to know, what to say.',
    pairingLabel: 'The Bar Cart',
    live: false,
  },
  cars: {
    label: 'Cars',
    description: "What actually matters when you're buying, maintaining, or just talking about cars.",
    pairingLabel: 'The Weekend Rotation',
    live: false,
  },
};

// Brand homepage fallbacks (used when affiliateUrl is empty)
const BRAND_URLS = {
  'Peter Millar':       'https://www.millarstore.com',
  'Spier & Mackay':     'https://www.spierandmackay.com',
  'Common Projects':    'https://www.commonprojects.com',
  'A.P.C.':             'https://www.apc.fr/en-us',
  'Taylor Stitch':      'https://www.taylorstitch.com',
  'Uniqlo':             'https://www.uniqlo.com/us/en/',
  'Buck Mason':         'https://www.buckmason.com',
  'Todd Snyder':        'https://www.toddsnyder.com',
  'Beckett Simonon':    'https://www.beckettsimonon.com',
  'Via TheRealReal':    'https://www.therealreal.com',
  'Le Labo':            'https://www.lelabofragrances.com',
  'Byredo':             'https://www.byredo.com',
  'Dior':               'https://www.dior.com/en_us',
  'Reigning Champ':     'https://www.reigningchamp.com',
  'Patagonia':          'https://www.patagonia.com',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('  wrote:', path.relative(ROOT, filePath));
}

function pickBuyUrl(pick) {
  if (pick.affiliateUrl) return pick.affiliateUrl;
  return BRAND_URLS[pick.brand] || '#';
}

function tagClass(tag) {
  const t = (tag || '').toLowerCase();
  if (/guytalk pick|editor.s pick|wear this instead/.test(t)) return 'gtag-blue';
  if (/foundation/.test(t)) return 'gtag-navy';
  if (/best value/.test(t)) return 'gtag-amber';
  if (/^deal$/.test(t)) return 'gtag-green';
  return 'gtag-gray';
}

// ─── Shared CSS ───────────────────────────────────────────────────────────────

const GUIDE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:           #F9F8F5;
    --surface:      #FFFFFF;
    --surface-2:    #F2F0EB;
    --border:       #E5E2DB;
    --border-light: #D4D0C8;
    --text:         #0F1724;
    --text-2:       #6E6862;
    --text-3:       #9E9891;
    --accent:       #2B6FFF;
    --accent-h:     #1A5CEF;
    --accent-muted: #EBF1FF;
    --amber:        #B87C35;
    --amber-muted:  rgba(184,124,53,0.08);
    --green:        #16A34A;
    --navy:         #0F1724;
  }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg); color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 17px; line-height: 1.65; -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  p { margin-bottom: 0; }

  /* ── NAV (matches main site light frosted glass) ── */
  .guide-nav {
    position: sticky; top: 0; z-index: 50;
    background: rgba(249,248,245,0.92);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--border);
  }
  .guide-nav-inner {
    display: flex; align-items: center; justify-content: space-between;
    max-width: 1120px; margin: 0 auto; padding: 14px 24px;
  }
  .guide-wordmark {
    font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 19px;
    letter-spacing: -0.03em; color: var(--text); text-decoration: none;
  }
  .guide-wordmark:hover { text-decoration: none; }
  .guide-dot { color: var(--accent); }
  .guide-nav-links { display: flex; align-items: center; gap: 24px; }
  .gnl { font-size: 14px; font-weight: 500; color: var(--text-2); text-decoration: none; }
  .gnl:hover { color: var(--text); text-decoration: none; }
  .gnl.is-active { color: var(--text); font-weight: 600; }
  .gnl-cta {
    font-size: 13px; font-weight: 600; padding: 7px 14px;
    background: var(--accent); color: #fff; border-radius: 7px; text-decoration: none;
  }
  .gnl-cta:hover { background: var(--accent-h); text-decoration: none; }

  /* ── CONTAINERS ── */
  .gc  { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  .gc-narrow { max-width: 720px; margin: 0 auto; padding: 0 24px; }

  /* ── CATEGORY HEADER BAND ── */
  .cat-band {
    background: var(--navy); border-top: 3px solid var(--accent);
    padding: 44px 0 40px;
  }
  .cat-band-crumb {
    font-family: 'Inter Tight', sans-serif; font-size: 11px; font-weight: 600;
    letter-spacing: .08em; text-transform: uppercase;
    color: rgba(255,255,255,0.40); margin-bottom: 14px;
  }
  .cat-band-crumb a { color: rgba(255,255,255,0.55); text-decoration: none; }
  .cat-band-crumb a:hover { color: rgba(255,255,255,0.85); }
  .cat-band-crumb-sep { margin: 0 8px; }
  .cat-band-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 900;
    font-size: clamp(34px, 5vw, 54px); letter-spacing: -0.03em;
    color: #fff; line-height: 1.04; margin-bottom: 8px;
  }
  .cat-band-desc { font-size: 16px; color: rgba(255,255,255,0.62); max-width: 480px; }

  /* ── SECTION WRAPPERS ── */
  .guide-section { padding: 56px 0; }
  .guide-section + .guide-section { border-top: 1px solid var(--border); }
  .gsec-eyebrow {
    font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
    margin-bottom: 6px;
  }
  .gsec-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 900;
    font-size: 22px; letter-spacing: -0.02em; color: var(--text);
    margin-bottom: 4px;
  }
  .gsec-sub { font-size: 15px; color: var(--text-2); margin-bottom: 28px; line-height: 1.55; }

  /* ── TAG PILLS ── */
  .gtag {
    display: inline-block; font-family: 'Inter Tight', sans-serif;
    font-size: 9px; font-weight: 700; letter-spacing: .10em;
    text-transform: uppercase; padding: 3px 8px; border-radius: 4px;
  }
  .gtag-blue  { background: var(--accent); color: #fff; }
  .gtag-navy  { background: var(--navy);   color: #fff; }
  .gtag-amber { background: var(--amber);  color: #fff; }
  .gtag-green { background: var(--green);  color: #fff; }
  .gtag-gray  { background: var(--surface-2); color: var(--text-3); }

  /* ── OUTFIT BOARD ── */
  .outfit-board {
    display: grid; grid-template-columns: 320px 1fr; gap: 0;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; overflow: hidden;
  }
  .outfit-img {
    background: var(--surface-2); min-height: 380px;
    display: flex; align-items: center; justify-content: center;
  }
  .outfit-img img { width: 100%; height: 380px; object-fit: cover; display: block; }
  .outfit-img-ph {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 380px; width: 100%;
    font-family: 'Inter Tight', sans-serif; font-size: 11px; font-weight: 700;
    letter-spacing: .10em; text-transform: uppercase; color: var(--text-3); gap: 8px;
  }
  .outfit-img-ph svg { opacity: .25; }
  .outfit-content { padding: 32px 36px; display: flex; flex-direction: column; gap: 0; }
  .outfit-eyebrow {
    font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
    margin-bottom: 10px;
  }
  .outfit-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: 22px;
    letter-spacing: -0.02em; color: var(--text); margin-bottom: 4px;
  }
  .outfit-subtitle { font-size: 14px; color: var(--text-2); margin-bottom: 16px; }
  .outfit-writeup { font-size: 15px; color: var(--text-2); line-height: 1.68; margin-bottom: 24px; }
  .outfit-items { list-style: none; padding: 0; margin: 0 0 18px; border-top: 1px solid var(--border); }
  .outfit-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .outfit-item-info { flex: 1; min-width: 0; }
  .outfit-item-name { font-weight: 600; font-size: 14px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .outfit-item-role { font-size: 12px; color: var(--text-3); }
  .outfit-item-shop {
    flex-shrink: 0; margin-left: 14px; font-size: 12px; font-weight: 600;
    color: var(--accent); white-space: nowrap; text-decoration: none;
  }
  .outfit-item-shop:hover { text-decoration: underline; }
  .outfit-flashy { font-size: 12px; color: var(--text-3); font-style: italic; line-height: 1.5; }

  /* ── PRODUCT GRID ── */
  .picks-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
  }
  .pick-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden;
    display: flex; flex-direction: column;
    transition: box-shadow 0.18s ease, transform 0.18s ease;
  }
  .pick-card:hover { box-shadow: 0 6px 24px rgba(15,23,36,0.07); transform: translateY(-2px); }
  .pick-card-img {
    height: 210px; background: var(--surface-2);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; position: relative;
  }
  .pick-card-img img { width: 100%; height: 100%; object-fit: cover; }
  .pick-card-img-ph {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; padding: 16px; text-align: center;
  }
  .pick-card-img-ph-initial {
    font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: 32px;
    color: var(--border); line-height: 1;
  }
  .pick-card-img-ph-label {
    font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 600;
    letter-spacing: .08em; text-transform: uppercase; color: var(--text-3);
  }
  .pick-card-body { padding: 16px 18px 20px; display: flex; flex-direction: column; flex: 1; }
  .pick-card-tag { margin-bottom: 10px; }
  .pick-card-brand {
    font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-3); margin-bottom: 3px;
  }
  .pick-card-name {
    font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 15px;
    letter-spacing: -0.01em; color: var(--text); margin-bottom: 6px; line-height: 1.3;
  }
  .pick-card-price {
    font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 14px;
    color: var(--accent); margin-bottom: 10px;
  }
  .pick-card-bio { font-size: 13px; color: var(--text-2); line-height: 1.6; margin-bottom: 16px; flex: 1; }
  .pick-card-buy {
    display: block; text-align: center; background: var(--text); color: #fff;
    font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 13px;
    padding: 10px 16px; border-radius: 8px; text-decoration: none;
    transition: background 0.15s ease; margin-top: auto;
  }
  .pick-card-buy:hover { background: var(--accent); text-decoration: none; }
  .pick-card-deal-badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 600; color: var(--green); margin-top: 8px;
  }
  .pick-card-deal-badge::before { content: '◆'; font-size: 7px; }

  /* ── COLOGNE SUBSECTION ── */
  .cologne-sub { padding-top: 48px; border-top: 1px solid var(--border); margin-top: 48px; }
  .cologne-intro { font-size: 15px; color: var(--text-2); max-width: 600px; margin-bottom: 28px; line-height: 1.65; }

  /* ── DEALS STRIP ── */
  .deals-strip { background: var(--surface-2); padding: 40px 0; }
  .deals-hdr { display: flex; align-items: baseline; gap: 14px; margin-bottom: 20px; }
  .deals-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: 20px;
    letter-spacing: -0.02em; color: var(--text);
  }
  .deals-updated { font-size: 12px; color: var(--text-3); }
  .deals-scroll { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch; }
  .deals-scroll::-webkit-scrollbar { height: 3px; }
  .deals-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .deal-card {
    flex-shrink: 0; width: 220px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px;
  }
  .deal-source {
    font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
    color: var(--green); margin-bottom: 8px;
  }
  .deal-name { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 14px; color: var(--text); margin-bottom: 3px; line-height: 1.3; }
  .deal-brand { font-size: 12px; color: var(--text-2); margin-bottom: 8px; }
  .deal-price { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 14px; color: var(--accent); margin-bottom: 8px; }
  .deal-note { font-size: 12px; color: var(--text-3); margin-bottom: 12px; line-height: 1.5; }
  .deal-link { font-size: 12px; font-weight: 600; color: var(--accent); }
  .deals-empty { font-size: 14px; color: var(--text-3); padding: 8px 0; }

  /* ── ESSAYS / DEPTH ── */
  .essays-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 0;
    border-left: 1px solid var(--border); border-top: 1px solid var(--border);
    margin-top: 28px;
  }
  .essay-card {
    display: block; padding: 24px 22px;
    border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);
    text-decoration: none; color: var(--text);
    transition: background 0.15s ease;
  }
  .essay-card:hover { background: var(--surface); text-decoration: none; }
  .essay-card-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 16px;
    letter-spacing: -0.01em; color: var(--text); margin-bottom: 5px; line-height: 1.3;
  }
  .essay-card-sub { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 10px; }
  .essay-card-cta { font-size: 12px; font-weight: 600; color: var(--accent); }

  /* ── ARTICLE PAGES ── */
  .art-header { background: var(--navy); border-top: 3px solid var(--accent); padding: 56px 0 48px; }
  .art-crumb {
    font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    color: rgba(255,255,255,0.40); margin-bottom: 18px;
  }
  .art-crumb a { color: rgba(255,255,255,0.6); text-decoration: none; }
  .art-crumb a:hover { color: rgba(255,255,255,0.9); }
  .art-crumb-sep { margin: 0 8px; }
  .art-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 900;
    font-size: clamp(26px, 5vw, 44px); letter-spacing: -0.03em;
    color: #fff; margin-bottom: 12px; line-height: 1.06;
  }
  .art-subtitle { font-size: 17px; color: rgba(255,255,255,0.62); line-height: 1.55; }
  .art-body { padding: 56px 0 0; }
  .art-section { margin-bottom: 48px; }
  .art-eyebrow {
    font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
    margin-bottom: 14px;
  }
  .art-text { color: var(--text-2); line-height: 1.72; font-size: 17px; }
  .art-know-list { list-style: none; padding: 0; margin: 0; }
  .art-know-list li {
    padding: 13px 0 13px 20px; border-bottom: 1px solid var(--border);
    color: var(--text-2); line-height: 1.6; font-size: 16px; position: relative;
  }
  .art-know-list li:first-child { border-top: 1px solid var(--border); }
  .art-know-list li::before { content: '—'; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
  .art-say-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .art-say-list li { padding: 13px 16px 13px 44px; border-radius: 10px; font-size: 16px; line-height: 1.6; position: relative; }
  .art-say-do { background: rgba(22,163,74,0.06); border: 1px solid rgba(22,163,74,0.18); color: var(--text-2); }
  .art-say-do::before { content: '✓'; position: absolute; left: 16px; color: var(--green); font-weight: 700; }
  .art-say-dont { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); }
  .art-say-dont::before { content: '→'; position: absolute; left: 16px; color: var(--text-3); font-weight: 700; }
  .art-tiers { display: flex; flex-direction: column; gap: 32px; }
  .art-tier-label {
    font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 700;
    letter-spacing: .10em; text-transform: uppercase; color: var(--text-3);
    padding: 10px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px;
  }
  .art-tier-picks { display: flex; flex-direction: column; gap: 10px; }
  .art-pick-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .art-pick-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 12px; }
  .art-pick-name { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 15px; color: var(--text); }
  .art-pick-brand { font-size: 12px; color: var(--text-3); white-space: nowrap; flex-shrink: 0; }
  .art-pick-reason { font-size: 14px; color: var(--text-2); line-height: 1.55; margin-bottom: 12px; }
  .art-pick-bottom { display: flex; justify-content: space-between; align-items: center; }
  .art-pick-price { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 14px; color: var(--accent); }
  .art-pick-note { font-weight: 400; font-size: 12px; color: var(--text-3); }
  .art-pick-shop { font-size: 12px; font-weight: 600; color: var(--accent); text-decoration: none; padding: 4px 10px; border: 1px solid rgba(43,111,255,0.30); border-radius: 6px; }
  .art-pick-shop:hover { background: var(--accent-muted); text-decoration: none; }
  .art-our-pick {
    background: var(--accent-muted); border: 1px solid rgba(43,111,255,0.20);
    border-left: 3px solid var(--accent); border-radius: 12px;
    padding: 26px 26px 22px; margin: 48px 0;
  }
  .art-our-pick-badge {
    font-family: 'Inter Tight', sans-serif; font-size: 10px; font-weight: 700;
    letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px;
  }
  .art-our-pick-name { font-family: 'Inter Tight', sans-serif; font-weight: 900; font-size: 20px; letter-spacing: -0.02em; color: var(--text); margin-bottom: 3px; }
  .art-our-pick-brand { font-size: 13px; color: var(--text-3); margin-bottom: 12px; }
  .art-our-pick-price { color: var(--accent); font-weight: 600; }
  .art-our-pick-why { font-size: 16px; line-height: 1.65; color: var(--text-2); margin-bottom: 18px; }
  .art-our-pick-cta {
    display: inline-block; background: var(--accent); color: #fff;
    font-weight: 700; font-size: 13px; padding: 9px 18px; border-radius: 8px; text-decoration: none;
  }
  .art-our-pick-cta:hover { background: var(--accent-h); text-decoration: none; }

  /* ── HUB PAGE ── */
  .hub-hero { padding: 72px 0 64px; border-bottom: 3px solid var(--accent); }
  .hub-eyebrow {
    font-family: 'Inter Tight', sans-serif; font-size: 11px; font-weight: 700;
    letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 16px;
  }
  .hub-title {
    font-family: 'Inter Tight', sans-serif; font-weight: 900;
    font-size: clamp(36px, 6vw, 64px); letter-spacing: -0.04em;
    line-height: 1.02; color: var(--text); margin-bottom: 16px;
  }
  .hub-sub { font-size: 18px; color: var(--text-2); max-width: 480px; line-height: 1.6; }
  .hub-cats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 28px; }
  .hub-cat-tile {
    display: block; background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 18px; text-decoration: none;
    transition: border-color 0.18s, transform 0.18s;
  }
  .hub-cat-tile.is-live:hover { border-color: var(--accent); transform: translateY(-2px); text-decoration: none; }
  .hub-cat-tile:not(.is-live) { opacity: 0.5; pointer-events: none; }
  .hub-cat-name { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 16px; color: var(--text); margin-bottom: 5px; }
  .hub-cat-desc { font-size: 13px; color: var(--text-2); line-height: 1.5; margin-bottom: 10px; }
  .hub-cat-cta { font-size: 12px; font-weight: 600; color: var(--accent); }
  .hub-cat-soon { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }

  /* ── FOOTER ── */
  .guide-footer { background: var(--navy); padding: 40px 0; }
  .guide-footer-inner {
    max-width: 1120px; margin: 0 auto; padding: 0 24px;
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;
  }
  .guide-footer-brand { font-family: 'Inter Tight', sans-serif; font-weight: 800; font-size: 17px; letter-spacing: -0.02em; color: #fff; }
  .guide-footer-links { display: flex; flex-wrap: wrap; gap: 20px; }
  .guide-footer-links a { font-size: 13px; color: rgba(255,255,255,0.50); text-decoration: none; }
  .guide-footer-links a:hover { color: rgba(255,255,255,0.9); }
  .guide-footer-note { width: 100%; font-size: 11px; color: rgba(255,255,255,0.30); line-height: 1.6; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); }

  /* ── RESPONSIVE ── */
  @media (max-width: 960px) {
    .picks-grid { grid-template-columns: repeat(2, 1fr); }
    .hub-cats-grid { grid-template-columns: repeat(2, 1fr); }
    .outfit-board { grid-template-columns: 1fr; }
    .outfit-content { padding: 24px; }
    .outfit-img-ph { height: 240px; min-height: 240px; }
    .outfit-img img { height: 240px; }
    .essays-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 600px) {
    .picks-grid { grid-template-columns: 1fr; }
    .hub-cats-grid { grid-template-columns: repeat(2, 1fr); }
    .gnl-cta { display: none; }
    body { font-size: 16px; }
  }
`.trim();

// ─── Shared nav/footer ────────────────────────────────────────────────────────

function guideNav(activeHref) {
  return `<nav class="guide-nav">
  <div class="guide-nav-inner">
    <a href="/" class="guide-wordmark">GuyTalk<span class="guide-dot">.</span></a>
    <div class="guide-nav-links">
      <a href="/brief/" class="gnl">Today's Brief</a>
      <a href="/guide/" class="gnl${activeHref === '/guide/' ? ' is-active' : ''}">Guide</a>
      <a href="/#signup" class="gnl-cta">Subscribe Free →</a>
    </div>
  </div>
</nav>`;
}

function guideFooter() {
  return `<footer class="guide-footer">
  <div class="guide-footer-inner">
    <div class="guide-footer-brand">GuyTalk<span class="guide-dot">.</span></div>
    <div class="guide-footer-links">
      <a href="/guide/">Guide</a>
      <a href="/briefs/">Archive</a>
      <a href="/about/">About</a>
      <a href="/privacy/">Privacy</a>
    </div>
    <p class="guide-footer-note">© ${new Date().getFullYear()} GuyTalk Media. Some links may be affiliate links that earn a small commission at no cost to you. Prices shown are approximate and subject to change.</p>
  </div>
</footer>`;
}

function pageHead({ title, description, url, image }) {
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image"       content="${esc(image || `${SITE_URL}/assets/og-card.png`)}">
<meta property="og:url"         content="${esc(url)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@guytalkmedia">
<link rel="canonical"            href="${esc(url)}">
<link rel="icon"                 href="/assets/logo/guytalk-icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap" rel="stylesheet">`;
}

// ─── Product card ─────────────────────────────────────────────────────────────

function renderPickCard(pick) {
  const buyUrl = pick.affiliateUrl || BRAND_URLS[pick.brand] || '#';
  const initial = (pick.brand || '?').replace(/^Via /, '')[0].toUpperCase();

  const imgHtml = pick.image
    ? `<img src="${esc(pick.image)}" alt="${esc(pick.name)}" loading="lazy">`
    : `<div class="pick-card-img-ph">
        <div class="pick-card-img-ph-initial">${esc(initial)}</div>
        <div class="pick-card-img-ph-label">${esc(pick.brand)}</div>
      </div>`;

  const dealBadge = pick.dealSource
    ? `<div class="pick-card-deal-badge">Via ${esc(pick.dealSource)}</div>` : '';

  return `<div class="pick-card">
  <div class="pick-card-img">${imgHtml}</div>
  <div class="pick-card-body">
    <div class="pick-card-tag"><span class="gtag ${tagClass(pick.tag)}">${esc(pick.tag)}</span></div>
    <div class="pick-card-brand">${esc(pick.brand)}</div>
    <div class="pick-card-name">${esc(pick.name)}</div>
    <div class="pick-card-price">${esc(pick.priceApprox)}</div>
    <p class="pick-card-bio">${esc(pick.bio)}</p>
    <a href="${esc(buyUrl)}" class="pick-card-buy" target="_blank" rel="noopener">Shop ${esc(pick.brand.replace(/^Via /, ''))} →</a>
    ${dealBadge}
  </div>
</div>`;
}

// ─── Outfit board ─────────────────────────────────────────────────────────────

function renderOutfitBoard(outfit, picksBySlug, pairingLabel) {
  const imgHtml = outfit.image
    ? `<img src="${esc(outfit.image)}" alt="${esc(outfit.title)}" loading="lazy">`
    : `<div class="outfit-img-ph">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        Photo coming soon
      </div>`;

  const itemsHtml = (outfit.items || []).map(item => {
    const pick = picksBySlug[item.ref];
    const name = pick ? `${pick.brand} ${pick.name}` : item.ref;
    const shopUrl = pick ? (pick.affiliateUrl || BRAND_URLS[pick.brand] || null) : null;
    return `<li class="outfit-item">
      <div class="outfit-item-info">
        <div class="outfit-item-name">${esc(name)}</div>
        <div class="outfit-item-role">${esc(item.role)}</div>
      </div>
      ${shopUrl ? `<a href="${esc(shopUrl)}" class="outfit-item-shop" target="_blank" rel="noopener">Shop →</a>` : ''}
    </li>`;
  }).join('\n');

  return `<div class="outfit-board">
  <div class="outfit-img">${imgHtml}</div>
  <div class="outfit-content">
    <div class="outfit-eyebrow">${esc(pairingLabel)}</div>
    <div class="outfit-title">${esc(outfit.title)}</div>
    <div class="outfit-subtitle">${esc(outfit.subtitle)}</div>
    <p class="outfit-writeup">${esc(outfit.writeup)}</p>
    <ul class="outfit-items">${itemsHtml}</ul>
    <p class="outfit-flashy">${esc(outfit.flashyCheck)}</p>
  </div>
</div>`;
}

// ─── Deals strip ──────────────────────────────────────────────────────────────

function renderDealsStrip(dealsData) {
  const deals = (dealsData && dealsData.deals) || [];
  const updatedAt = dealsData && dealsData.updatedAt;

  let scrollContent;
  if (deals.length === 0) {
    scrollContent = `<p class="deals-empty">Good finds rotate weekly — check back soon.</p>`;
  } else {
    scrollContent = `<div class="deals-scroll">${deals.map(d => `
<div class="deal-card">
  <div class="deal-source">${esc(d.source)}</div>
  <div class="deal-name">${esc(d.name)}</div>
  <div class="deal-brand">${esc(d.brand)}</div>
  <div class="deal-price">${esc(d.dealPrice)}</div>
  ${d.note ? `<p class="deal-note">${esc(d.note)}</p>` : ''}
  <a href="${esc(d.url)}" class="deal-link" target="_blank" rel="noopener">View deal →</a>
</div>`).join('\n')}</div>`;
  }

  return `<div class="deals-strip">
  <div class="gc">
    <div class="deals-hdr">
      <div class="deals-title">Deals This Week</div>
      ${updatedAt ? `<div class="deals-updated">Updated ${esc(updatedAt)}</div>` : ''}
    </div>
    ${scrollContent}
  </div>
</div>`;
}

// ─── Data loader ──────────────────────────────────────────────────────────────

function loadCategoryData(cat) {
  const load = (name) => {
    const p = path.join(DATA_DIR, name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  };
  return {
    picks:   load(`${cat}-picks.json`),
    outfits: load(`${cat}-outfits.json`),
    deals:   load(`${cat}-deals.json`),
  };
}

// ─── Article page renderer ────────────────────────────────────────────────────

function renderArticle(article, catData) {
  const catMeta = CATEGORY_META[article.category] || { label: article.category };
  const pageUrl = `${SITE_URL}/guide/${article.category}/${article.slug}/`;

  const whatToKnowItems = (article.sections.whatToKnow || [])
    .map(item => `<li>${esc(item)}</li>`).join('\n');

  const whatToSayItems = (article.sections.whatToSay || [])
    .map((s, i) => `<li class="${i === 0 ? 'art-say-do' : 'art-say-dont'}">${esc(s)}</li>`).join('\n');

  const tierHtml = Object.values(article.sections.whatToBuy || {}).map(tier => {
    const picks = (tier.picks || []).map(p => {
      const shopUrl = p.affiliateUrl || BRAND_URLS[p.brand] || p.shopUrl || '#';
      const priceStr = p.priceNote ? `${esc(p.price)} <span class="art-pick-note">${esc(p.priceNote)}</span>` : esc(p.price);
      return `<div class="art-pick-card">
  <div class="art-pick-top">
    <div class="art-pick-name">${esc(p.name)}</div>
    <div class="art-pick-brand">${esc(p.brand)}</div>
  </div>
  <p class="art-pick-reason">${esc(p.reason)}</p>
  <div class="art-pick-bottom">
    <span class="art-pick-price">${priceStr}</span>
    <a href="${esc(shopUrl)}" class="art-pick-shop" target="_blank" rel="noopener">Shop →</a>
  </div>
</div>`;
    }).join('\n');
    return `<div class="art-tier"><div class="art-tier-label">${esc(tier.label)}</div><div class="art-tier-picks">${picks}</div></div>`;
  }).join('\n');

  let ourPickHtml = '';
  if (article.ourPick) {
    const op = article.ourPick;
    const opUrl = op.affiliateUrl || BRAND_URLS[op.brand] || op.shopUrl || '#';
    const opPrice = op.priceNote ? `${esc(op.price)} · ${esc(op.priceNote)}` : esc(op.price);
    ourPickHtml = `<div class="art-our-pick">
  <div class="art-our-pick-badge">Our Pick</div>
  <div class="art-our-pick-name">${esc(op.name)}</div>
  <div class="art-our-pick-brand">${esc(op.brand || '')} · <span class="art-our-pick-price">${opPrice}</span></div>
  <p class="art-our-pick-why">${esc(op.why)}</p>
  <a href="${esc(opUrl)}" class="art-our-pick-cta" target="_blank" rel="noopener">Shop ${esc(op.brand || '')} →</a>
</div>`;
  }

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: article.title, description: article.subtitle,
    datePublished: article.publishedAt, dateModified: article.updatedAt,
    url: pageUrl, publisher: { '@type': 'Organization', name: 'GuyTalk', url: SITE_URL },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
${pageHead({ title: `${article.title} — GuyTalk Guide`, description: article.subtitle, url: pageUrl })}
<style>${GUIDE_CSS}</style>
</head>
<body>
${guideNav('/guide/')}
<div class="art-header">
  <div class="gc-narrow">
    <div class="art-crumb">
      <a href="/guide/">Guide</a><span class="art-crumb-sep">/</span>
      <a href="/guide/${esc(article.category)}/">${esc(catMeta.label)}</a><span class="art-crumb-sep">/</span>
      ${esc(article.title)}
    </div>
    <h1 class="art-title">${esc(article.title)}</h1>
    <p class="art-subtitle">${esc(article.subtitle)}</p>
  </div>
</div>
<div class="gc-narrow">
  <div class="art-body">
    <div class="art-section">
      <div class="art-eyebrow">What It Is</div>
      <p class="art-text">${esc(article.sections.whatItIs)}</p>
    </div>
    <div class="art-section">
      <div class="art-eyebrow">Why It Matters</div>
      <p class="art-text">${esc(article.sections.whyItMatters)}</p>
    </div>
    <div class="art-section">
      <div class="art-eyebrow">The GuyTalk Read</div>
      <p class="art-text">${esc(article.sections.guytalkRead)}</p>
    </div>
    <div class="art-section">
      <div class="art-eyebrow">What to Know</div>
      <ul class="art-know-list">${whatToKnowItems}</ul>
    </div>
    <div class="art-section">
      <div class="art-eyebrow">What to Buy</div>
      <div class="art-tiers">${tierHtml}</div>
    </div>
    <div class="art-section">
      <div class="art-eyebrow">What to Say</div>
      <ul class="art-say-list">${whatToSayItems}</ul>
    </div>
    ${ourPickHtml}
  </div>
</div>
${guideFooter()}
<script type="application/ld+json">${schemaJson}</script>
</body>
</html>`;
}

// ─── Category hub renderer ────────────────────────────────────────────────────

function renderCategoryHub(category, articles, catData) {
  const meta   = CATEGORY_META[category] || { label: category, description: '', pairingLabel: 'This Week\'s Fit' };
  const pageUrl = `${SITE_URL}/guide/${category}/`;
  const picks  = catData.picks;
  const outfits = catData.outfits;
  const deals  = catData.deals;

  // Build pick lookup for outfit items
  const picksBySlug = {};
  if (picks) {
    for (const p of [...(picks.picks || []), ...(picks.cologne ? picks.cologne.picks : [])]) {
      picksBySlug[p.slug] = p;
    }
  }

  // Featured outfit
  const featuredOutfit = outfits && (outfits.outfits || []).find(o => o.featured);

  // Pairing section
  const pairingSection = featuredOutfit ? `
<div class="guide-section">
  <div class="gc">
    <div class="gsec-eyebrow">${esc(meta.pairingLabel)}</div>
    <div class="gsec-title">${esc(featuredOutfit.title)}</div>
    <div class="gsec-sub">${esc(featuredOutfit.subtitle)}</div>
    ${renderOutfitBoard(featuredOutfit, picksBySlug, meta.pairingLabel)}
  </div>
</div>` : '';

  // Main picks grid
  const mainPicks = picks ? (picks.picks || []) : [];
  const picksGridSection = mainPicks.length > 0 ? `
<div class="guide-section">
  <div class="gc">
    <div class="gsec-eyebrow">Curated Picks</div>
    <div class="gsec-title">What We'd Actually Buy</div>
    <div class="gsec-sub">Ranked by value, not price — with our honest take on each.</div>
    <div class="picks-grid">
      ${mainPicks.map(p => renderPickCard(p)).join('\n')}
    </div>
    ${picks && picks.cologne ? `
    <div class="cologne-sub">
      <div class="gsec-eyebrow">Cologne</div>
      <div class="gsec-title">${esc(picks.cologne.label)}</div>
      <p class="cologne-intro">${esc(picks.cologne.intro)}</p>
      <div class="picks-grid">
        ${(picks.cologne.picks || []).map(p => renderPickCard(p)).join('\n')}
      </div>
    </div>` : ''}
  </div>
</div>` : '';

  // Deals strip
  const dealsSection = renderDealsStrip(deals);

  // Teaching essays
  const essaysSection = articles.length > 0 ? `
<div class="guide-section">
  <div class="gc">
    <div class="gsec-eyebrow">The Depth</div>
    <div class="gsec-title">Guides Worth Reading</div>
    <div class="gsec-sub">Long reads on the things worth knowing about — with our actual opinion in each one.</div>
    <div class="essays-grid">
      ${articles.map(a => `
<a href="/guide/${esc(a.category)}/${esc(a.slug)}/" class="essay-card">
  <div class="essay-card-title">${esc(a.title)}</div>
  <div class="essay-card-sub">${esc(a.subtitle)}</div>
  <div class="essay-card-cta">Read →</div>
</a>`).join('\n')}
    </div>
  </div>
</div>` : '';

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: `${meta.label} — GuyTalk Guide`, description: meta.description,
    url: pageUrl, publisher: { '@type': 'Organization', name: 'GuyTalk', url: SITE_URL },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
${pageHead({ title: `${meta.label} — GuyTalk Guide`, description: meta.description, url: pageUrl })}
<style>${GUIDE_CSS}</style>
</head>
<body>
${guideNav('/guide/')}
<div class="cat-band">
  <div class="gc">
    <div class="cat-band-crumb"><a href="/guide/">Guide</a><span class="cat-band-crumb-sep">/</span>${esc(meta.label)}</div>
    <h1 class="cat-band-title">${esc(meta.label)}</h1>
    <p class="cat-band-desc">${esc(meta.description)}</p>
  </div>
</div>
${pairingSection}
${picksGridSection}
${dealsSection}
${essaysSection}
${guideFooter()}
<script type="application/ld+json">${schemaJson}</script>
</body>
</html>`;
}

// ─── Hub page ─────────────────────────────────────────────────────────────────

function renderGuideHub(byCategory, allCatData) {
  const pageUrl = `${SITE_URL}/guide/`;

  // Featured outfit from Style
  const styleOutfits = allCatData.style && allCatData.style.outfits;
  const featuredOutfit = styleOutfits && (styleOutfits.outfits || []).find(o => o.featured);
  const stylePicks = allCatData.style && allCatData.style.picks;
  const picksBySlug = {};
  if (stylePicks) {
    for (const p of [...(stylePicks.picks || []), ...(stylePicks.cologne ? stylePicks.cologne.picks : [])]) {
      picksBySlug[p.slug] = p;
    }
  }

  // 3 featured picks (GuyTalk Pick tag)
  const featuredPicks = stylePicks ? (stylePicks.picks || []).filter(p => p.tag === 'GuyTalk Pick').slice(0, 3) : [];

  const catTiles = Object.entries(CATEGORY_META).map(([cat, meta]) => {
    const isLive = byCategory[cat] || (allCatData[cat] && allCatData[cat].picks);
    return `<a href="${isLive ? `/guide/${cat}/` : '#'}" class="hub-cat-tile${isLive ? ' is-live' : ''}">
  <div class="hub-cat-name">${esc(meta.label)}</div>
  <div class="hub-cat-desc">${esc(meta.description)}</div>
  ${isLive ? `<div class="hub-cat-cta">Explore →</div>` : `<div class="hub-cat-soon">Coming soon</div>`}
</a>`;
  }).join('\n');

  const outfitSection = featuredOutfit ? `
<div class="guide-section" style="background:var(--surface);">
  <div class="gc">
    <div class="gsec-eyebrow">This Week's Fit</div>
    <div class="gsec-title">${esc(featuredOutfit.title)}</div>
    <div class="gsec-sub">${esc(featuredOutfit.subtitle)}</div>
    ${renderOutfitBoard(featuredOutfit, picksBySlug, 'This Week\'s Fit')}
  </div>
</div>` : '';

  const featPicksSection = featuredPicks.length > 0 ? `
<div class="guide-section">
  <div class="gc">
    <div class="gsec-eyebrow">Start Here</div>
    <div class="gsec-title">Picks We'd Buy First</div>
    <div class="gsec-sub">From the Style guide — three things worth owning.</div>
    <div class="picks-grid">
      ${featuredPicks.map(p => renderPickCard(p)).join('\n')}
    </div>
  </div>
</div>` : '';

  const schemaJson = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'The GuyTalk Guide',
    description: 'An evergreen reference library. What to buy, why it matters, and exactly what to say.',
    url: pageUrl, publisher: { '@type': 'Organization', name: 'GuyTalk', url: SITE_URL },
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
${pageHead({
  title: 'The GuyTalk Guide',
  description: 'An evergreen reference library. What to buy, why it matters, and exactly what to say.',
  url: pageUrl,
})}
<style>${GUIDE_CSS}</style>
</head>
<body>
${guideNav('/guide/')}
<div class="hub-hero">
  <div class="gc">
    <div class="hub-eyebrow">GuyTalk Guide</div>
    <h1 class="hub-title">Know more.<br>Say the right thing.</h1>
    <p class="hub-sub">An evergreen reference library — what to buy, why it matters, what to know, and exactly what to say on the things worth knowing about.</p>
  </div>
</div>
<div class="guide-section">
  <div class="gc">
    <div class="gsec-eyebrow">Categories</div>
    <div class="gsec-title">Pick your subject.</div>
    <div class="hub-cats-grid">
      ${catTiles}
    </div>
  </div>
</div>
${outfitSection}
${featPicksSection}
${guideFooter()}
<script type="application/ld+json">${schemaJson}</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const slugFilter = (process.argv.find(a => a.startsWith('--slug=')) || '').replace('--slug=', '') || null;
  const catFilter  = (process.argv.find(a => a.startsWith('--category=')) || '').replace('--category=', '') || null;

  const articles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'articles.json'), 'utf8'));

  const byCategory = {};
  for (const a of articles) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a);
  }

  // Load category-specific data for all known categories
  const allCatData = {};
  for (const cat of Object.keys(CATEGORY_META)) {
    allCatData[cat] = loadCategoryData(cat);
  }

  const filteredArticles = slugFilter
    ? articles.filter(a => a.slug === slugFilter)
    : catFilter
      ? articles.filter(a => a.category === catFilter)
      : articles;

  if (slugFilter && filteredArticles.length === 0) {
    console.error('No article found with slug:', slugFilter); process.exit(1);
  }

  // Render article pages
  for (const article of filteredArticles) {
    const html = renderArticle(article, allCatData[article.category] || {});
    writeFile(path.join(OUT_DIR, article.category, article.slug, 'index.html'), html);
  }

  // Render category hubs
  if (!slugFilter) {
    const cats = catFilter ? [catFilter] : [...new Set(articles.map(a => a.category))];
    for (const cat of cats) {
      const catArticles = byCategory[cat] || [];
      writeFile(path.join(OUT_DIR, cat, 'index.html'), renderCategoryHub(cat, catArticles, allCatData[cat] || {}));
    }
  }

  // Render main hub
  if (!slugFilter && !catFilter) {
    writeFile(path.join(OUT_DIR, 'index.html'), renderGuideHub(byCategory, allCatData));
  }

  console.log(`\nGuide generated: ${filteredArticles.length} article(s)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

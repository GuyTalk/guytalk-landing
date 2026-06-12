#!/usr/bin/env node
'use strict';

/**
 * update-homepage.js — refresh the homepage from the latest brief.
 *
 * Runs in the daily pipeline AFTER generate-brief.js and BEFORE the git commit
 * (see run-brief.sh). It rewrites three parts of index.html from the just-
 * generated brief/data/issue-NNN.json:
 *
 *   Section A  "From the brief" preview block (.brief-body)
 *   Section B  App mockup phone slides (#phoneSlidesTrack)
 *   Section C  Group chat (.chat-feed)
 *
 * It also replaces the old `sed` href bump — every /brief/issue-NNN/ link is
 * repointed to the new issue.
 *
 * FAIL-OPEN: if the JSON is missing/malformed or anything throws, it logs a
 * warning, leaves index.html untouched, and exits 0 so the pipeline never breaks.
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const DATA_DIR   = path.join(ROOT, 'brief', 'data');
const INDEX_PATH = path.join(ROOT, 'index.html');

function warn(msg) { console.log(`   ⚠  update-homepage: ${msg}`); }
function ok(msg)   { console.log(`   ✓ update-homepage: ${msg}`); }

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad = (n) => String(n).padStart(3, '0');

function firstSentence(s) {
  const t = String(s || '').trim();
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
}
function shorten(s, max = 100) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
}

// Pick the highest-numbered issue JSON (the just-generated brief).
function loadLatestIssue() {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort();
  if (!files.length) return null;
  const file = files[files.length - 1];
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  if (!data.slug) data.slug = file.replace('.json', '');
  if (data.num == null) { const m = file.match(/issue-(\d+)/); if (m) data.num = parseInt(m[1], 10); }
  return data;
}

// Build a normalized list of "sections" from the brief copy, in priority order.
function buildSections(data) {
  const c = data.copy || {};
  const out = [];
  const catClass = (k) => (k === 'markets' || k === 'culture') ? k : 'sports'; // CSS only has sports/markets/culture for phone-cat

  if (c.lead) out.push({
    cat: 'Sports', cls: 'sports', anchor: 'sports', phoneCat: 'sports',
    headline: c.lead.headline, snippet: c.lead.whatHappened,
    say: c.lead.whatToSay, label: 'Bring up →',
  });
  if (c.markets?.headlines?.[0]) out.push({
    cat: 'Markets', cls: 'markets', anchor: 'markets', phoneCat: 'markets',
    headline: c.markets.headlines[0].head, snippet: c.markets.headlines[0].sub || c.markets.mood,
    say: c.markets.bringUp, label: 'Office take →',
  });
  if (c.culture?.[0]) out.push({
    cat: 'Culture', cls: 'culture', anchor: 'culture', phoneCat: 'culture',
    headline: c.culture[0].topic, snippet: c.culture[0].whyItMatters || c.culture[0].whatHappened,
    say: c.culture[0].whatToSay, label: 'Bring up →',
  });
  if (c.f1) out.push({
    cat: 'Formula 1', cls: 'sports', anchor: 'f1', phoneCat: 'sports',
    headline: c.f1.headline, snippet: c.f1.whyCare1, say: c.f1.whatToSay, label: 'Bring up →',
  });
  if (c.golf) out.push({
    cat: 'Golf', cls: 'golf', anchor: 'golf', phoneCat: 'sports',
    headline: c.golf.headline, snippet: c.golf.whyCare1, say: c.golf.whatToSay, label: 'Bring up →',
  });
  if (c.nhl) out.push({
    cat: 'NHL', cls: 'sports', anchor: 'nhl', phoneCat: 'sports',
    headline: c.nhl.headline, snippet: c.nhl.whyCare1, say: c.nhl.whatToSay, label: 'Bring up →',
  });
  // Keep only entries that actually have a headline.
  return out.filter(s => s.headline);
}

// Market rows for the phone mock — first 4 watchlist tickers with a day change.
function buildMarketRows(data) {
  const mkt = data.markets || {};
  const order = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'BTC', 'DIA', 'IWM', 'MSFT', 'AAPL'];
  const rows = [];
  for (const sym of order) {
    const q = mkt[sym];
    if (q && typeof q.dayChangePct === 'number') rows.push([sym, q.dayChangePct]);
    if (rows.length >= 4) break;
  }
  return rows;
}

function main() {
  const data = loadLatestIssue();
  if (!data || !data.copy) { warn('no usable brief JSON found — index.html unchanged'); return; }

  let html;
  try { html = fs.readFileSync(INDEX_PATH, 'utf8'); }
  catch (e) { warn(`could not read index.html (${e.message}) — unchanged`); return; }
  const original = html;

  const slug = data.slug;
  const sections = buildSections(data);
  if (!sections.length) { warn('brief has no usable sections — index.html unchanged'); return; }

  const pick = (anchor) => sections.find(s => s.anchor === anchor);
  const date = data.date || '';
  const greeting = data.copy.title || firstSentence(data.copy.keyTakeaway) || '';
  const intro = data.copy.keyTakeaway || data.deck || '';

  const applied = [];
  // Replace via a FUNCTION so `$` in dynamic content (e.g. "$135") is never
  // misread as a $1 backreference. `build` receives the regex groups and
  // returns the literal replacement string.
  const replaceOnce = (label, re, build) => {
    if (re.test(html)) { html = html.replace(re, (...args) => build(...args)); applied.push(label); }
    else warn(`could not locate ${label} — skipped`);
  };
  const leaf = (content) => (_m, p1, p2) => p1 + content + p2;

  // ── brief-header date + issue (leaf nodes) ───────────────────────────────
  replaceOnce('brief-date', /(<div class="brief-date">)[^<]*(<\/div>)/, leaf(esc(date)));
  replaceOnce('brief-issue', /(<div class="brief-issue">)[^<]*(<\/div>)/, leaf(`ISSUE #${pad(data.num)}`));

  // ── SECTION A — rebuild the whole .brief-body (greeting + intro + 3 stories)
  const aStories = [pick('sports'), pick('markets'), pick('culture')].filter(Boolean);
  for (const s of sections) { if (aStories.length >= 3) break; if (!aStories.includes(s)) aStories.push(s); }
  const storyHtml = (s) => `        <a class="brief-story" href="/brief/${slug}/#${s.anchor}" target="_blank" rel="noopener">
          <div class="brief-cat bc-${s.cls}">${esc(s.cat)}</div>
          <div class="brief-headline">${esc(s.headline)}</div>
          <div class="brief-snippet">${esc(s.snippet)}</div>
          <div class="brief-bring bb-${s.cls}"><span class="brief-bring-label">${esc(s.label)}</span> "${esc(s.say)}"</div>
        </a>`;
  const briefBody = `<div class="brief-body">
        <div class="brief-greeting">${esc(greeting)}</div>
        <div class="brief-intro">${esc(intro)}</div>

${aStories.map(storyHtml).join('\n\n')}
      </div>
    </div>
  </div>
</section>`;
  replaceOnce('Section A (brief-body)',
    /<div class="brief-body">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/section>(\s*<!-- APP PREVIEW -->)/,
    (_m, p1) => briefBody + p1);

  // ── SECTION B — phone slides ─────────────────────────────────────────────
  const topics = sections.map(s => s.headline);
  // Slide 1: notification + 3 brief items
  replaceOnce('phone notif-body', /(<div class="phone-notif-body">)[^<]*(<\/div>)/,
    leaf(esc(`Today's brief is ready. ${shorten(topics[0], 70)}${topics[1] ? ` ${shorten(topics[1], 60)}` : ''}`)));
  const phoneItem = (s) => `              <div class="phone-brief-item"><span class="phone-cat phone-cat-${s.phoneCat}">${esc(s.cat)}</span><span class="phone-hl">${esc(shorten(s.headline, 80))}</span></div>`;
  const phoneItems = sections.slice(0, 3).map((s, i) => i === 0 ? phoneItem(s).trimStart() : phoneItem(s)).join('\n');
  replaceOnce('phone brief-items',
    /<div class="phone-brief-item">[\s\S]*?<\/div>(\s*<div class="phone-btn">)/,
    (_m, p1) => phoneItems + p1);
  // Slide 2: sports story headline + body
  const sportsLead = pick('sports') || sections[0];
  replaceOnce('phone story-hl', /(<div class="phone-story-hl">)[^<]*(<\/div>)/, leaf(esc(shorten(sportsLead.headline, 70))));
  replaceOnce('phone story-body', /(<div class="phone-story-body">)[^<]*(<\/div>)/, leaf(esc(sportsLead.snippet)));
  // Slide 3: market rows + take
  const mktRows = buildMarketRows(data);
  if (mktRows.length) {
    const rowHtml = mktRows.map(([sym, chg], i) => {
      const cls = chg >= 0 ? 'up' : 'dn';
      const sign = chg >= 0 ? '+' : '−';
      const indent = i === 0 ? '' : '              ';
      return `${indent}<div class="phone-mkt-row"><span class="phone-mkt-sym">${esc(sym)}</span><span class="phone-mkt-chg ${cls}">${sign}${Math.abs(chg).toFixed(1)}%</span></div>`;
    }).join('\n');
    replaceOnce('phone mkt-rows',
      /<div class="phone-mkt-row">[\s\S]*?<\/div>(\s*<div class="phone-mkt-take">)/,
      (_m, p1) => rowHtml + p1);
  } else warn('no market data — phone mkt-rows left as-is');
  const mktTake = data.copy.markets?.mood || data.copy.markets?.bringUp;
  if (mktTake) replaceOnce('phone mkt-take', /(<div class="phone-mkt-take">)[^<]*(<\/div>)/, leaf(esc(shorten(mktTake, 180))));

  // ── SECTION C — group chat ───────────────────────────────────────────────
  // User bubbles: fill each .msg-bub (in order) with a casual line from the brief.
  const bubbleTexts = sections.map(s => shorten(firstSentence(s.say) || s.headline, 110)).filter(Boolean);
  if (bubbleTexts.length) {
    let bi = 0, swapped = 0;
    html = html.replace(/(<div class="msg-bub">)[^<]*(<\/div>)/g, (_m, p1, p2) => {
      const t = bubbleTexts[bi % bubbleTexts.length]; bi += 1; swapped += 1;
      return `${p1}${esc(t)}${p2}`;
    });
    if (swapped) applied.push(`chat bubbles (${swapped})`); else warn('no .msg-bub found');
  }
  // GuyTalk card: date + 4 items
  replaceOnce('chat gt-hdr-issue', /(<span class="msg-gt-hdr-issue">)[^<]*(<\/span>)/, leaf(esc(date)));
  const gtItems = topics.slice(0, 4).map(h => `              <div class="msg-gt-item">${esc(shorten(h, 70))}</div>`).join('\n');
  replaceOnce('chat gt-items',
    /<div class="msg-gt-body">[\s\S]*?<\/div>(\s*<a href="#brief")/,
    (_m, p1) => `<div class="msg-gt-body">\n${gtItems}\n            </div>` + p1);

  // ── Repoint every remaining /brief/issue-NNN/ link to the new issue ──────
  const before = html;
  html = html.replace(/brief\/issue-\d{3}\//g, `brief/${slug}/`);
  if (html !== before) applied.push('issue links');

  if (html === original) { warn('nothing changed (no patterns matched) — index.html unchanged'); return; }

  fs.writeFileSync(INDEX_PATH, html);
  ok(`index.html refreshed for ${slug} → ${applied.join(', ')}`);
}

try { main(); }
catch (e) { warn(`crashed (${e.message}) — index.html left unchanged`); }
process.exit(0);

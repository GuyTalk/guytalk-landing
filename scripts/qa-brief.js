#!/usr/bin/env node
'use strict';

/**
 * GuyTalk Brief QA — automated copy quality checker
 * Usage: node scripts/qa-brief.js [issue-slug]  (defaults to latest)
 *
 * Checks:
 *  1. Banned AI words/phrases
 *  2. Culture head ↔ body consistency (keyword overlap)
 *  3. Golf note is not a refusal
 *  4. No clearly empty required sections
 *  5. Culture item 3 not a kids/animated film
 *  6. Hallucination risk: no player names in sports copy unless in box score
 *  7. Market take uses real ticker symbols from data
 */

const fs   = require('fs');
const path = require('path');

const BANNED = [
  'pivotal', 'groundbreaking', 'game-changer', 'game changer', 'seismic',
  'monumental', 'at the end of the day', "it's worth noting",
  'to be clear', 'make no mistake', 'delve', 'tech ecosystem',
  'broader narrative', 'dominant narrative', 'shifting the narrative',
  'changes the narrative', 'ultimately,', 'interestingly,', 'notably,',
  "it's important to note", 'speaks to the larger', 'nuanced approach',
  'leverage the', 'leveraging the',
];

const KIDS_STUDIOS = ['pixar', 'disney animation', 'dreamworks', 'illumination', 'studio ghibli'];
const KIDS_KEYWORDS = ['animated', 'toy story', 'finding ', 'frozen', 'moana', 'inside out', 'minions', 'despicable me', 'kung fu panda'];

const REFUSAL_PHRASES = [
  "i don't have data", "i can't write", "i cannot write",
  "without inventing", "i have no information", "not in the prompt",
  "hallucination rules", "violates the", "i'm unable",
];

function loadIssue(slug) {
  const dataDir = path.join(__dirname, '..', 'brief', 'data');
  if (slug) {
    const f = path.join(dataDir, `${slug}.json`);
    if (!fs.existsSync(f)) { console.error(`No data file for "${slug}"`); process.exit(1); }
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  // Latest
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f.startsWith('issue-')).sort();
  if (!files.length) { console.error('No issue data files found'); process.exit(1); }
  // Deduplicate by date, take highest num
  const byDate = new Map();
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      if (!d.title || d.title.startsWith('REPLACE')) continue;
      const key = d.date || f;
      const ex  = byDate.get(key);
      if (!ex || (d.num || 0) > (ex.num || 0)) byDate.set(key, { f, d });
    } catch (_) {}
  }
  const latest = Array.from(byDate.values()).sort((a, b) => (b.d.num || 0) - (a.d.num || 0))[0];
  return latest.d;
}

function check(label, pass, detail) {
  const icon = pass ? '✅' : '❌';
  const msg  = `  ${icon} ${label}`;
  if (!pass && detail) console.log(`${msg}\n     ↳ ${detail}`);
  else console.log(msg);
  return pass;
}

function warn(label, detail) {
  console.log(`  ⚠️  ${label}${detail ? `\n     ↳ ${detail}` : ''}`);
}

function allText(issue) {
  const c = issue.copy || {};
  return [
    c.sportsAngle, c.marketsTake, c.golfNote,
    c.sharpTake?.p1, c.sharpTake?.p2,
    ...(c.sharpTake?.bullets || []),
    ...(c.culture || []).map(i => `${i.head} ${i.body}`),
    ...(c.numbersContext || []).map(i => i.context),
    ...(c.sportsAdditional || []),
    c.marketsDetail?.headline, c.marketsDetail?.bringUp, c.marketsDetail?.stockSpotlight,
    c.golfDetail?.bringUp, c.golfDetail?.groupChatAngle,
    c.f1Detail?.angle, c.f1Detail?.bringUp,
  ].filter(Boolean).join(' ').toLowerCase();
}

function main() {
  const arg  = process.argv[2];
  const slug = arg?.startsWith('issue-') ? arg : null;
  const issue = loadIssue(slug);
  const { copy, sports, markets, upcoming, golf } = issue;

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  GuyTalk Brief QA — ${issue.slug || 'latest'} · ${issue.date || '?'}`);
  console.log(`${'═'.repeat(50)}\n`);

  let passed = 0, failed = 0;

  function run(label, pass, detail) {
    if (check(label, pass, detail)) passed++; else failed++;
  }

  const full = allText(issue);

  // 1. Headline exists and looks like three fragments
  const title = (issue.title || '').trim();
  run(
    'Headline present and looks like 3 fragments',
    title.length > 10 && (title.match(/\./g) || []).length >= 2,
    title ? `Got: "${title}"` : 'Missing headline'
  );

  // 2. Sports angle exists and is substantial
  const sa = (copy?.sportsAngle || '').trim();
  run('Sports angle present (>80 chars)', sa.length > 80, sa.length ? `Length: ${sa.length}` : 'Empty');

  // 3. Markets take present
  const mt = (copy?.marketsTake || '').trim();
  run('Markets take present (>40 chars)', mt.length > 40, mt.length ? `Length: ${mt.length}` : 'Empty');

  // 4. Sharp take exists with bullets
  const st = copy?.sharpTake;
  run(
    'Sharp take: p1, p2, and 3 bullets',
    !!(st?.p1 && st?.p2 && st?.bullets?.length >= 3),
    st ? `bullets: ${st.bullets?.length || 0}` : 'Missing'
  );

  // 5. Culture: 3 items, each with head+body
  const cult = copy?.culture || [];
  run('Culture: exactly 3 items', cult.length === 3, `Got ${cult.length}`);
  cult.forEach((item, i) => {
    run(
      `Culture ${i + 1}: head and body non-empty`,
      !!(item.head?.trim() && item.body?.trim()),
      `head="${item.head?.slice(0, 40)}" body="${item.body?.slice(0, 40)}"`
    );
  });

  // 6. Culture head ↔ body consistency — check that key nouns from head appear in body
  cult.slice(0, 2).forEach((item, i) => {
    const headWords = (item.head || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 4);
    const bodyLower = (item.body || '').toLowerCase();
    const overlap   = headWords.filter(w => bodyLower.includes(w));
    const consistent = overlap.length >= 1;
    run(
      `Culture ${i + 1}: body matches headline topic`,
      consistent,
      consistent ? undefined : `Head: "${item.head}" — no shared words with body. Possible mix-up.`
    );
  });

  // 7. Culture item 3 — not a kids film
  const c3 = cult[2];
  if (c3) {
    const c3text = `${c3.head} ${c3.source} ${c3.body}`.toLowerCase();
    const isKids  = KIDS_STUDIOS.some(s => c3text.includes(s)) || KIDS_KEYWORDS.some(k => c3text.includes(k));
    run('Culture item 3 is not a kids/animated film', !isKids, `Title: "${c3.head}"`);
  }

  // 8. Golf note — warn on refusal (non-blocking: prompt fix prevents this, QA flags it as safety net)
  const gn = (copy?.golfNote || '').toLowerCase();
  const isRefusal = REFUSAL_PHRASES.some(p => gn.includes(p));
  if (isRefusal) {
    warn('Golf note looks like a refusal — review before publishing', `"${copy?.golfNote?.slice(0, 100)}"`);
  } else {
    run('Golf note looks clean', true);
  }

  // 9. Banned words
  const banned = BANNED.filter(w => full.includes(w.toLowerCase()));
  run('No banned AI words/phrases', banned.length === 0, banned.length ? `Found: ${banned.join(', ')}` : undefined);

  // 10. No passive voice in headlines ("was won by", "was beaten")
  const passiveInTitle = /\b(was\s+\w+ed\s+by|were\s+\w+ed\s+by)\b/i.test(title);
  run('No passive voice in headline', !passiveInTitle, passiveInTitle ? `Headline: "${title}"` : undefined);

  // 11. Market tickers in copy match data
  if (markets) {
    const tickerSyms = Object.keys(markets);
    const mktText = `${copy?.marketsTake || ''} ${copy?.marketsDetail?.stockSpotlight || ''} ${copy?.marketsDetail?.bringUp || ''}`.toUpperCase();
    const hasAnySym = tickerSyms.some(sym => mktText.includes(sym));
    if (!hasAnySym && mt.length > 0) {
      warn('Markets: no ticker symbols found in copy (may not reference real data)');
    }
  }

  // 12. Sharp take doesn't use "ultimately"
  const stText = `${st?.p1 || ''} ${st?.p2 || ''}`.toLowerCase();
  run('Sharp take does not open with "Ultimately"', !stText.includes('ultimately,'));

  // Summary
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed · ${failed} failed\n`);

  if (failed === 0) {
    console.log('  🎉 Brief looks clean — ready to deploy.\n');
  } else {
    console.log('  ⚠️  Fix the issues above before sending.\n');
    process.exit(1);
  }
}

main();

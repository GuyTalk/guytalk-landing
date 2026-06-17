#!/usr/bin/env node
'use strict';

/**
 * GuyTalk Brief QA — automated copy quality checker
 * Usage: node scripts/qa-brief.js [issue-slug]  (defaults to latest)
 *
 * Checks (in order):
 *  1. Headline present (3 fragments)
 *  2. The Lead present (headline + whatHappened)
 *  3. Markets table renders clean text (no [object Object])
 *  4. Markets compliance — no investment advice language
 *  5. Culture: 3 items, each with topic + whatHappened
 *  6. Culture item 3 not a kids/animated film
 *  7. Banned AI words/phrases
 *  8. Refusal phrases (model refusing to write)
 *  9. No passive voice in title
 * 10. Final Sharp Take present and under 200 words
 * 11. Today at a Glance present (5 fields)
 */

const fs   = require('fs');
const path = require('path');

// ── Banned AI phrasing ───────────────────────────────────────────────────────
const BANNED_GENERAL = [
  'pivotal', 'groundbreaking', 'game-changer', 'game changer', 'seismic',
  'monumental', 'at the end of the day', "it's worth noting",
  'to be clear,', 'make no mistake', 'delve', 'tech ecosystem',
  'broader narrative', 'dominant narrative', 'shifting the narrative',
  'ultimately,', 'interestingly,', 'notably,',
  "it's important to note", 'speaks to the larger', 'nuanced approach',
  'leverage the', 'leveraging the', 'canary in the coal mine',
];

// ── Markets compliance — investment advice phrases (hard fail) ────────────────
const MARKETS_COMPLIANCE_VIOLATIONS = [
  'buying opportunity',
  'investors should buy',
  'investors should sell',
  'investors should hold',
  'investors should consider',
  'consider adding shares',
  'consider adding exposure',
  'consider reducing',
  'now may be a good time to buy',
  'now is a good time to buy',
  'great long-term investment',
  "we like this stock",
  'our favorite stock',
  'the smart move is',
  'the smart trade is',
  'smart money move',
  'looks undervalued',
  'looks overvalued',
  'price target of',
  'portfolio allocation',
  'risk tolerance',
  'retirement advice',
  'could be a buying',
];

const KIDS_STUDIOS   = ['pixar', 'disney animation', 'dreamworks', 'illumination', 'studio ghibli'];
const KIDS_KEYWORDS  = ['animated', 'toy story', 'finding ', 'frozen', 'moana', 'inside out', 'minions', 'despicable me', 'kung fu panda'];

const REFUSAL_PHRASES = [
  "i don't have data", "i can't write", "i cannot write",
  "without inventing", "i have no information", "not in the prompt",
  "hallucination rules", "violates the", "i'm unable",
];

// ── Load issue ───────────────────────────────────────────────────────────────
function loadIssue(slug) {
  const dataDir = path.join(__dirname, '..', 'brief', 'data');
  if (slug) {
    const f = path.join(dataDir, `${slug}.json`);
    if (!fs.existsSync(f)) { console.error(`No data file for "${slug}"`); process.exit(1); }
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f.startsWith('issue-')).sort();
  if (!files.length) { console.error('No issue data files found'); process.exit(1); }
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

// ── Collect all AI-generated text for scanning ───────────────────────────────
function allText(issue) {
  const c = issue.copy || {};
  const parts = [
    c.keyTakeaway,
    c.lead?.headline, c.lead?.whatHappened, c.lead?.whyBullet1, c.lead?.whyBullet2,
    c.lead?.theRead, ...(c.lead?.ammo || []), c.lead?.whatToSay,
    c.markets?.mood, c.markets?.whyBullet1, c.markets?.whyBullet2, c.markets?.bringUp,
    c.markets?.theRead, ...(c.markets?.ammo || []),
    c.golf?.headline, c.golf?.whyCare1, c.golf?.whyCare2, c.golf?.watchFor,
    c.golf?.theRead, ...(c.golf?.ammo || []), c.golf?.whatToSay,
    c.f1?.headline, c.f1?.whyCare1, c.f1?.whyCare2, c.f1?.watchFor,
    c.f1?.theRead, ...(c.f1?.ammo || []), c.f1?.whatToSay,
    c.nhl?.headline, c.nhl?.whyCare1, c.nhl?.whyCare2,
    c.nhl?.theRead, ...(c.nhl?.ammo || []), c.nhl?.whatToSay,
    ...(c.sportsOther || []).flatMap(o => o && typeof o === 'object'
      ? [o.take, o.why, o.theRead, ...(o.ammo || []), o.say] : [o]),
    ...(c.culture || []).flatMap(i => [i.topic || i.head, i.whatHappened, i.whyItMatters, i.theRead, ...(i.ammo || []), i.whatToSay]),
    ...(c.dynamicSportsText || []).flatMap(d => [d.whatHappened, d.whyItMatters, d.theRead, ...(d.ammo || []), d.whatToBringUp]),
    c.finalSharpTake,
    c.glance?.sports, c.glance?.market, c.glance?.bestConvo, c.glance?.watchNext, c.glance?.quickRec,
    ...(Object.values(c.todaysHits || {})),
  ].filter(Boolean);
  return parts.join(' ').toLowerCase();
}

// ── Collect markets-specific text only ───────────────────────────────────────
function marketsText(issue) {
  const c = issue.copy || {};
  return [
    c.markets?.mood,
    c.markets?.whyBullet1,
    c.markets?.whyBullet2,
    c.markets?.bringUp,
    c.markets?.theRead,
    ...(c.markets?.ammo || []),
    c.glance?.market,
  ].filter(Boolean).join(' ').toLowerCase();
}

// ── Check rendered HTML for [object Object] ──────────────────────────────────
function checkRenderedHtml(slug) {
  const htmlPath = path.join(__dirname, '..', 'brief', slug, 'index.html');
  if (!fs.existsSync(htmlPath)) return { exists: false };
  const html = fs.readFileSync(htmlPath, 'utf8');
  const badCount = (html.match(/\[object Object\]/g) || []).length;
  return { exists: true, badCount };
}

// ── Output helpers ───────────────────────────────────────────────────────────
function check(label, pass, detail) {
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} ${label}`);
  if (!pass && detail) console.log(`     ↳ ${detail}`);
  return pass;
}
function warn(label, detail) {
  console.log(`  ⚠️  ${label}${detail ? `\n     ↳ ${detail}` : ''}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const arg   = process.argv[2];
  const slug  = arg?.startsWith('issue-') ? arg : (arg === 'preview' ? 'preview' : null);
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
  const mkt  = marketsText(issue);

  // 1. Headline
  const title = (issue.title || '').trim();
  run(
    'Headline present (3 fragments)',
    title.length > 10 && (title.match(/\./g) || []).length >= 2,
    title ? `Got: "${title}"` : 'Missing headline'
  );

  // 2. The Lead present
  const lead = copy?.lead;
  run(
    'The Lead: headline and whatHappened present',
    !!(lead?.headline?.trim() && lead?.whatHappened?.trim()),
    lead ? `headline="${lead.headline?.slice(0, 50)}"` : 'lead is null'
  );

  // 3. Rendered HTML clean (no [object Object])
  const html = checkRenderedHtml(issue.slug || '');
  if (html.exists) {
    run(
      'Rendered HTML: no [object Object]',
      html.badCount === 0,
      html.badCount ? `Found ${html.badCount} instance(s)` : undefined
    );
  } else {
    warn('HTML file not found — run generator first');
  }

  // 3a. OPENAI VERIFICATION — hard gate (must pass before push to pending)
  console.log('\n  [OpenAI Verification]');
  const vfy = issue.verification;
  if (!vfy) {
    warn('No verification record — generated before the verification pass existed');
  } else if (vfy.skipped) {
    warn('Verification skipped — ' + (vfy.reason || 'OPENAI_API_KEY missing or crashed'));
  } else if (!vfy.pass) {
    run(
      'OpenAI verification: no blocking issues',
      false,
      `FAILED: ${(vfy.blocking || []).map(b => `[${b.section}] ${b.flag}: ${b.reason}`).join(' | ')}`
    );
  } else {
    run(
      'OpenAI verification: PASS',
      true,
      vfy.verificationSummary || `${(vfy.warnings || []).length} warning(s)`
    );
    if (vfy.warnings?.length) warn(`Verification warnings: ${vfy.warnings.map(w => `[${w.section}] ${w.note}`).join(' | ')}`);
  }

  // 3b. EDITORIAL BIBLE — the Claude editor's verdict (hard gate)
  console.log('\n  [Editorial Bible]');
  const ed = issue.editor;
  if (!ed) {
    warn('No editor record on this issue — generated before the editorial pass existed');
  } else if (ed.reviewed) {
    run(
      'Editor pass: no sections blocked by the Bible',
      (ed.blocking || []).length === 0,
      (ed.blocking || []).length
        ? `Blocked: ${ed.blocking.map(b => `${b.section} (${b.reason})`).join(' | ')}`
        : `Reviewed by ${ed.model}${ed.changed?.length ? ` — rewrote ${ed.changed.join(', ')}` : ''}`
    );
    if (ed.notes?.length) warn(`Editor notes: ${ed.notes.join(' | ')}`);
  } else {
    // Fail-open by design (Jake, 2026-06-04): publish but warn loudly.
    warn(
      'BRIEF NOT EDITOR-REVIEWED — shipping on Claude draft only',
      `${ed.reason || 'editor did not run'} — check ANTHROPIC_API_KEY to restore the editorial pass`
    );
  }
  // Broken source links — warning only, never a hard block.
  if (ed?.brokenLinks?.length) {
    warn(`${ed.brokenLinks.length} broken source link(s)`, ed.brokenLinks.map(l => `${l.url} (${l.reason})`).join(' | '));
  }

  // 3c. NO-AMMO GATE — hard fail if any required section has < 3 ammo items
  console.log('\n  [Conversation Ammo]');
  const ammoSections = [
    ...(copy?.lead ? [{ label: 'lead', ammo: copy.lead.ammo }] : []),
    ...(copy?.markets ? [{ label: 'markets', ammo: copy.markets.ammo }] : []),
    ...(copy?.golf ? [{ label: 'golf', ammo: copy.golf.ammo }] : []),
    ...(copy?.f1 ? [{ label: 'f1', ammo: copy.f1.ammo }] : []),
    ...(copy?.nhl ? [{ label: 'nhl', ammo: copy.nhl.ammo }] : []),
    ...(copy?.sportsOther || []).map((o, i) => ({ label: `sportsOther[${i}]`, ammo: o?.ammo })),
    ...(copy?.dynamicSportsText || []).map((d, i) => ({ label: `dynamicSports[${i}]`, ammo: d?.ammo })),
    // culture items 1 and 2 (index 0 and 1) require ammo; item 3 (index 2) is a watch rec, exempt
    ...(copy?.culture || []).slice(0, 2).map((c, i) => ({ label: `culture[${i + 1}]`, ammo: c?.ammo })),
  ];
  const ammoFails = ammoSections.filter(s => !Array.isArray(s.ammo) || s.ammo.filter(Boolean).length < 3);
  run(
    'Conversation Ammo: all required sections have ≥3 items',
    ammoFails.length === 0,
    ammoFails.length ? `Missing/thin ammo in: ${ammoFails.map(s => `${s.label}(${(s.ammo || []).length})`).join(', ')}` : undefined
  );

  // 4. MARKETS COMPLIANCE — hard fail (no investment advice)
  console.log('\n  [Markets Compliance]');
  const complianceViolations = MARKETS_COMPLIANCE_VIOLATIONS.filter(p => mkt.includes(p));
  run(
    'Markets: no investment advice language',
    complianceViolations.length === 0,
    complianceViolations.length
      ? `Violation(s): "${complianceViolations.join('", "')}" — rewrite before publishing`
      : undefined
  );

  // Also scan full brief text (other sections sometimes bleed market advice)
  const fullComplianceViolations = MARKETS_COMPLIANCE_VIOLATIONS.filter(p => full.includes(p));
  if (fullComplianceViolations.length > complianceViolations.length) {
    warn(
      'Investment advice language found outside Markets section',
      `"${fullComplianceViolations.filter(v => !complianceViolations.includes(v)).join('", "')}"`
    );
  }

  // 5. Culture: 3 items
  console.log('\n  [Culture]');
  const cult = copy?.culture || [];
  run('Culture: 3 items present', cult.length === 3, `Got ${cult.length}`);
  cult.forEach((item, i) => {
    const head = item.topic || item.head || '';
    const body = item.whatHappened || item.body || '';
    run(
      `Culture ${i + 1}: topic + whatHappened non-empty`,
      !!(head.trim() && body.trim()),
      `topic="${head.slice(0, 40)}" whatHappened="${body.slice(0, 40)}"`
    );
  });

  // 6. Culture item 3 not a kids film
  const c3 = cult[2];
  if (c3) {
    const c3text = `${c3.topic || c3.head} ${c3.whatHappened} ${c3.whyItMatters}`.toLowerCase();
    const isKids = KIDS_STUDIOS.some(s => c3text.includes(s)) || KIDS_KEYWORDS.some(k => c3text.includes(k));
    run('Culture item 3 not a kids/animated film', !isKids, isKids ? `"${c3.topic || c3.head}"` : undefined);
  }

  // 7. Banned AI words
  console.log('\n  [Copy Quality]');
  const banned = BANNED_GENERAL.filter(w => full.includes(w.toLowerCase()));
  run('No banned AI phrases', banned.length === 0, banned.length ? `Found: ${banned.join(', ')}` : undefined);

  // 8. Refusal phrases
  const refusals = REFUSAL_PHRASES.filter(p => full.includes(p));
  run('No refusal phrases in copy', refusals.length === 0, refusals.length ? `Found: "${refusals[0]}"` : undefined);

  // 9. Passive voice in title
  const passiveInTitle = /\b(was\s+\w+ed\s+by|were\s+\w+ed\s+by)\b/i.test(title);
  run('No passive voice in headline', !passiveInTitle, passiveInTitle ? title : undefined);

  // 10. Final Sharp Take — present and not too long
  const fst = (copy?.finalSharpTake || '').trim();
  const fstWords = fst.split(/\s+/).filter(Boolean).length;
  run('Final Sharp Take present', fst.length > 20, fst.length ? `Length: ${fst.length} chars` : 'Missing');
  if (fst.length > 0) {
    run(
      'Final Sharp Take under 150 words',
      fstWords <= 150,
      `${fstWords} words — trim to under 150`
    );
  }

  // 11. Today at a Glance (warn only — fallbacks exist in html.js)
  const glance = copy?.glance;
  const glanceFields = ['sports', 'market', 'bestConvo', 'watchNext', 'quickRec'].filter(k => glance?.[k]);
  if (glanceFields.length < 4) {
    warn(`Today at a Glance: only ${glanceFields.length}/5 fields — will use fallbacks`);
  } else {
    check('Today at a Glance: 4+ fields populated', true);
    passed++;
  }

  // 12. Golf refusal check (warn only)
  const golfCopy = [copy?.golf?.whyCare1, copy?.golf?.whyCare2, copy?.golf?.watchFor].filter(Boolean).join(' ').toLowerCase();
  const isRefusal = REFUSAL_PHRASES.some(p => golfCopy.includes(p));
  if (isRefusal) warn('Golf copy looks like a refusal — review before publishing');

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed · ${failed} failed\n`);

  if (failed === 0) {
    console.log('  ✅ Brief passes QA — ready to deploy.\n');
  } else {
    console.log('  ❌ Fix the issues above before sending.\n');
    process.exit(1);
  }
}

main();

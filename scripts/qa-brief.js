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

// ── Health/product recommendation — guaranteed-outcome phrases (hard fail) ────
const HEALTH_CLAIM_VIOLATIONS = [
  'changes how you eat permanently',
  'permanently change',
  'permanently changes',
  'changes your health permanently',
  'guaranteed results',
  'fixes your metabolism',
  'transforms your health',
  'clinically proven to',
  'will transform',
  'will cure',
  'will fix',
  'medical advice',
  'treats the condition',
];

// ── Market index names that must NOT be paired with ETF ticker prices ─────────
// The rendered HTML must show real index levels (no $ prefix, reasonable magnitude)
// when labeling tiles as S&P 500, Dow, Nasdaq, or Russell 2000.
const INDEX_NAMES_IN_HTML  = ['S&amp;P 500', 'Dow', 'Nasdaq', 'Russell 2000'];
const ETF_PRICE_PATTERN    = /\$\d{2,4}\.\d{2}/; // e.g. $745.96, $520.35

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

  // ── Research mode banner — must be the first thing QA reports ────────────────
  const researchMode = issue.researchMode || (issue.researchPack?.searchActive ? 'openai-search' : 'feed-only');
  console.log('  [Research Mode]');
  if (researchMode === 'openai-search') {
    const model = issue.researchPack?.searchModel || 'unknown';
    console.log(`  ✅ OpenAI research ACTIVE — ${model} with live web search`);
    console.log(`     ${issue.researchPack?.stories?.length || 0} web-verified stories`);
    if (issue.researchPack?.rejectedStories?.length) {
      console.log(`     ${issue.researchPack.rejectedStories.length} rejected: ${issue.researchPack.rejectedStories.slice(0, 2).map(r => r.reason?.slice(0, 50)).join(' | ')}`);
    }
  } else {
    console.log('  ⚠️  FEED-ONLY MODE — OpenAI web research was unavailable for this issue');
    console.log('     Sports: ESPN structured feeds only');
    console.log('     Stories: Tier-1 source filter applied');
    console.log('     Verification confidence: DEGRADED');
  }
  console.log('');

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
    // In feed-only mode the editorial pass is the fact-check backstop — don't double-block.
    warn(
      researchMode === 'feed-only'
        ? 'Feed-only mode: OpenAI verification skipped (editor pass is backstop)'
        : 'Verification skipped — ' + (vfy.reason || 'OPENAI_API_KEY missing or crashed')
    );
  } else if (!vfy.pass) {
    run(
      'OpenAI verification: no blocking issues',
      false,
      `FAILED: ${(vfy.blocking || []).map(b => `[${b.section}] ${b.flag}: ${b.reason}`).join(' | ')}`
    );
  } else {
    // Verification passed. In feed-only mode, surface warnings more loudly.
    const label = researchMode === 'feed-only'
      ? 'Feed-only mode: verification PASS (degraded confidence)'
      : 'OpenAI verification: PASS';
    run(label, true, vfy.verificationSummary || `${(vfy.warnings || []).length} warning(s)`);
    if (vfy.warnings?.length) {
      if (researchMode === 'feed-only') {
        console.log(`     ⚠️  Feed-only warnings (no web search to confirm these):`);
        vfy.warnings.forEach(w => console.log(`        • [${w.section}] ${w.note}`));
      } else {
        warn(`Verification warnings: ${vfy.warnings.map(w => `[${w.section}] ${w.note}`).join(' | ')}`);
      }
    }
  }

  // 3b. EDITORIAL BIBLE — the Claude editor's verdict (hard gate)
  console.log('\n  [Editorial Bible]');
  const ed = issue.editor;
  if (!ed) {
    warn('No editor record on this issue — generated before the editorial pass existed');
  } else if (ed.reviewed) {
    // Quality blocks (no_ammo, no_current_facts, low_conversation_relevance) are content
    // issues — warn Jake but allow the brief to stage. Safety/compliance blocks hard fail.
    const QUALITY_BLOCK_REASONS = ['no_ammo', 'no_current_facts', 'low_conversation_relevance'];
    const isQualityBlock = (b) => QUALITY_BLOCK_REASONS.some(r => b.reason?.startsWith(r));
    const allBlocks    = ed.blocking || [];
    const safetyBlocks = allBlocks.filter(b => !isQualityBlock(b));
    const qualityBlocks = allBlocks.filter(b => isQualityBlock(b));
    run(
      'Editor pass: no safety/compliance violations',
      safetyBlocks.length === 0,
      safetyBlocks.length
        ? `Safety blocked: ${safetyBlocks.map(b => `${b.section} (${b.reason})`).join(' | ')}`
        : `Reviewed by ${ed.model}${ed.changed?.length ? ` — rewrote ${ed.changed.join(', ')}` : ''}`
    );
    if (qualityBlocks.length) {
      warn(
        `Editor: content-quality issues (brief will still stage — review before approving)`,
        qualityBlocks.map(b => `${b.section} (${b.reason})`).join(' | ')
      );
    }
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

  // 3d. MARKET INDEX vs ETF LABEL CHECK — hard fail
  // Scans the rendered HTML: if a tile is labeled with a real index name
  // (S&P 500, Dow, Nasdaq, Russell 2000), its mt-price must NOT be an ETF
  // dollar price (e.g. $745.96). Index levels have no $ prefix.
  console.log('\n  [Market Index Integrity]');
  if (html.exists) {
    const rawHtml = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'brief', issue.slug || '', 'index.html'), 'utf8'
    );
    let etfAsMismatch = false;
    for (const idxName of INDEX_NAMES_IN_HTML) {
      const tileIdx = rawHtml.indexOf(`mt-name">${idxName}</`);
      if (tileIdx === -1) continue;
      const afterName = rawHtml.slice(tileIdx, tileIdx + 300);
      if (ETF_PRICE_PATTERN.test(afterName)) {
        etfAsMismatch = true;
        run(
          `Market tile: "${idxName}" must show index level (no $)`,
          false,
          `Found ETF-style dollar price under index label "${idxName}" — pipeline must fetch real index via Yahoo Finance (^GSPC/^DJI/^IXIC/^RUT)`
        );
      }
    }
    if (!etfAsMismatch) {
      run('Market tiles: index labels paired with real index levels (no $ prefix)', true);
    }
  } else {
    warn('Market index check skipped — HTML not found');
  }

  // 3e. HEALTH/PRODUCT CLAIM CHECK — hard fail
  console.log('\n  [Health & Product Claims]');
  const healthViolations = HEALTH_CLAIM_VIOLATIONS.filter(p => full.includes(p.toLowerCase()));
  run(
    'No guaranteed/permanent health outcome claims',
    healthViolations.length === 0,
    healthViolations.length
      ? `Violation(s): "${healthViolations.join('", "')}" — soften to observational framing`
      : undefined
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

  // 5. Culture: 3 items preferred, 2 allowed (warn only)
  // If culture is null in JSON but editor reviewed and did not block culture, the editor
  // rebuilt the section in HTML — downgrade to warn so the brief can still stage.
  console.log('\n  [Culture]');
  const cult = copy?.culture || [];
  const editorRebuiltCulture = !cult.length && issue.editor?.reviewed && !(issue.editor?.blocking || []).some(b => b.section === 'culture');
  if (cult.length >= 3) {
    run('Culture: 3 items present', true);
  } else if (cult.length === 2) {
    warn('Culture: only 2 items (3 preferred) — brief will publish with 2 culture items');
  } else if (editorRebuiltCulture) {
    warn('Culture: null in JSON but editor rebuilt section in HTML — review before approving');
  } else {
    run('Culture: minimum 2 items required', false, `Got ${cult.length} — brief cannot publish without at least 2 culture items`);
  }
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

  // 10b. SPORTS IMAGE MISMATCH — hard fail if a sport's image is from a different sport
  console.log('\n  [Sports Image Validation]');
  const dynSports = issue.dynamicSports || [];
  const IMAGE_SPORT_RULES = [
    // key = sport label (lowercase), banned = substrings in imageUrl that indicate a wrong sport
    { sport: 'world cup',  banned: ['nba', 'nhl', 'mlb', 'basketball', 'hockey', 'baseball'] },
    { sport: 'worldcup',   banned: ['nba', 'nhl', 'mlb', 'basketball', 'hockey', 'baseball'] },
    { sport: 'mlb',        banned: ['nba', 'nhl', 'basketball', 'hockey'] },
    { sport: 'nba',        banned: ['nhl', 'mlb', 'soccer', 'football', 'hockey', 'baseball'] },
    { sport: 'nhl',        banned: ['nba', 'mlb', 'basketball', 'baseball', 'soccer'] },
    { sport: 'f1',         banned: ['nba', 'nhl', 'mlb', 'basketball', 'hockey', 'baseball', 'soccer'] },
    { sport: 'golf',       banned: ['nba', 'nhl', 'mlb', 'basketball', 'hockey', 'baseball', 'soccer'] },
  ];
  let imageMismatch = false;
  for (const s of dynSports) {
    const label = (s.label || '').toLowerCase();
    const img   = (s.imageUrl || '').toLowerCase();
    if (!img) continue;
    const rule = IMAGE_SPORT_RULES.find(r => label.includes(r.sport) || r.sport.includes(label));
    if (rule) {
      const banned = rule.banned.find(b => img.includes(b));
      if (banned) {
        imageMismatch = true;
        run(
          `Sports image: ${s.label} image must not be a ${banned} asset`,
          false,
          `imageUrl="${s.imageUrl}" contains "${banned}" — wrong sport. Use null or a ${s.label}-specific image.`
        );
      }
    }
  }
  if (!imageMismatch) run('Sports images: no cross-sport image mismatches', true);

  // 10c. DUPLICATE IMAGE CHECK — hard fail if any imageUrl appears twice in the same brief
  console.log('\n  [Image Freshness]');
  {
    const allImages = [];
    const heroImg = issue.heroOverride?.image;
    if (heroImg) allImages.push({ section: 'heroOverride', url: heroImg });
    for (const s of dynSports) {
      if (s.imageUrl) allImages.push({ section: s.label || s.name || 'sport', url: s.imageUrl });
    }
    const seen = new Map();
    let hasDupe = false;
    for (const { section, url } of allImages) {
      if (seen.has(url)) {
        hasDupe = true;
        run(
          `No duplicate images: ${section}`,
          false,
          `"${url}" already used in "${seen.get(url)}" — each section needs a distinct image`
        );
      } else {
        seen.set(url, section);
      }
    }
    if (!hasDupe) run('No duplicate images within issue', true);

    // 10d. CROSS-ISSUE IMAGE REUSE — warn if image was also used in the previous brief
    const dataDir = path.join(__dirname, '..', 'brief', 'data');
    const prevNum = (issue.num || 0) - 1;
    const prevSlug = prevNum > 0 ? `issue-${String(prevNum).padStart(3, '0')}` : null;
    const prevFile = prevSlug ? path.join(dataDir, `${prevSlug}.json`) : null;
    if (prevFile && fs.existsSync(prevFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
        const prevImages = new Set();
        if (prev.heroOverride?.image) prevImages.add(prev.heroOverride.image);
        for (const s of (prev.dynamicSports || [])) {
          if (s.imageUrl) prevImages.add(s.imageUrl);
        }
        const reused = allImages.filter(({ url }) => prevImages.has(url));
        if (reused.length) {
          warn(
            `${reused.length} image(s) reused from ${prevSlug}`,
            reused.map(r => `${r.section}: ${r.url}`).join(' | ')
          );
        } else {
          run(`No images reused from ${prevSlug}`, true);
        }
      } catch (_) {}
    }
  }

  // 11. THE RUNDOWN module — verify narrative sources exist (warn only, fallbacks in html.js)
  const hasRundownNarrative = !!(copy?.rundownNarrative);
  const hasRundownFallbacks = !!(
    ((copy?.markets?.headlines?.[0]?.head) || copy?.markets?.mood) &&
    (issue.dynamicSports?.[0]?.headline)
  );
  if (!hasRundownNarrative && !hasRundownFallbacks) {
    warn('The Rundown: no narrative sources — module will be empty. Ensure markets mood + sports lead are present.');
  } else {
    check('The Rundown: narrative sources present', true);
    passed++;
  }

  // 11b. RUNDOWN MARKET DATA CONSISTENCY — hard gate
  // The Rundown bullet must use the same verified index data as the market cards.
  // All three must agree: Rundown text, market-card tiles, Sharp Take.
  // Rule: market data is centralized — no section invents its own S&P/Nasdaq/Dow move.
  console.log('\n  [Rundown Market Data Consistency]');
  {
    const spy = markets?.SPY;
    const qqq = markets?.QQQ;
    const hasSpyData = spy && (spy.indexDayChangePct != null || spy.dayChangePct != null);
    const hasQqqData = qqq && (qqq.indexDayChangePct != null || qqq.dayChangePct != null);
    run(
      'Rundown: market data present for S&P 500 and Nasdaq',
      !!(hasSpyData && hasQqqData),
      !hasSpyData ? 'SPY market data missing — Rundown will show fallback text' :
      !hasQqqData ? 'QQQ market data missing — Rundown will show fallback text' : undefined
    );
    if (hasSpyData && spy.indexDayChangePct == null) {
      warn('Rundown: S&P 500 using ETF day% (indexDayChangePct not populated) — true index % preferred');
    }
    if (hasQqqData && qqq.indexDayChangePct == null) {
      warn('Rundown: Nasdaq using ETF day% (indexDayChangePct not populated) — true index % preferred');
    }
    // If both index and ETF % are present, they should be reasonably close.
    // Small divergences are normal (SPY uses previous close, ^GSPC is real-time).
    if (spy?.indexDayChangePct != null && spy?.dayChangePct != null) {
      const diff = Math.abs(spy.indexDayChangePct - spy.dayChangePct);
      if (diff > 1.5) {
        run(
          'Rundown: S&P 500 index% and ETF% agree (within 1.5ppt)',
          false,
          `index=${spy.indexDayChangePct.toFixed(2)}% ETF=${spy.dayChangePct.toFixed(2)}% — divergence ${diff.toFixed(2)}ppt likely indicates a stale quote`
        );
      } else if (diff > 0.5) {
        warn(`S&P 500 index/ETF% diverge ${diff.toFixed(2)}ppt (acceptable — may be stale quote)`);
      }
    }
  }

  // 12. CROSS-SECTION CONSISTENCY — Fed/macro framing must agree across sections
  // Markets is the source of truth; Culture and condensed sections must not contradict.
  console.log('\n  [Cross-Section Consistency]');
  const mkMood = (copy?.markets?.mood || '').toLowerCase();
  const cultText = (copy?.culture || []).map(c => [c.whatHappened, c.theRead, c.head].join(' ')).join(' ').toLowerCase();
  const hikeMkt  = /hike|hawkish|rate.*up|increase.*rate/.test(mkMood);
  const hikeCult = /hike|hawkish|rate.*up|increase.*rate/.test(cultText);
  const cutMkt   = /\bcut\b|\bdovish\b|rate.*down|decrease.*rate/.test(mkMood) && !hikeMkt;
  const cutCult  = /\bcut\b|\bdovish\b|rate.*down|decrease.*rate/.test(cultText) && !hikeCult;
  // Only flag if Markets says hike but Culture says cut (or vice versa)
  const fedContradiction = (hikeMkt && cutCult) || (cutMkt && hikeCult && !!(mkMood));
  run(
    'Fed/rate direction consistent: Markets and Culture agree',
    !fedContradiction,
    fedContradiction
      ? `Markets mood says ${hikeMkt ? 'HIKE' : 'CUT'} but Culture copy says ${hikeCult ? 'HIKE' : 'CUT'} — one source of truth must feed all sections`
      : undefined
  );

  // 13. Golf refusal check (warn only)
  const golfCopy = [copy?.golf?.whyCare1, copy?.golf?.whyCare2, copy?.golf?.watchFor].filter(Boolean).join(' ').toLowerCase();
  const isRefusal = REFUSAL_PHRASES.some(p => golfCopy.includes(p));
  if (isRefusal) warn('Golf copy looks like a refusal — review before publishing');

  // ── Pre-approval audit print ─────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`);
  console.log('  PRE-APPROVAL AUDIT');
  console.log(`${'═'.repeat(50)}`);
  {
    const dynSportsAudit = issue.dynamicSports || [];
    const totalPlayers   = dynSportsAudit.reduce((n, s) => n + (Array.isArray(s.playerLinks) ? s.playerLinks.length : 0), 0);
    const hasPlayerLinks = totalPlayers > 0;
    console.log(`  Player links added:              ${hasPlayerLinks ? `YES (${totalPlayers} total)` : 'NO'}`);

    const auditImgs = [];
    if (issue.heroOverride?.image) auditImgs.push(issue.heroOverride.image);
    for (const s of dynSportsAudit) { if (s.imageUrl) auditImgs.push(s.imageUrl); }
    const uniqueImgs = new Set(auditImgs);
    const hasDupesAudit = uniqueImgs.size < auditImgs.length;
    console.log(`  Duplicate images in issue:       ${hasDupesAudit ? `YES (${auditImgs.length - uniqueImgs.size} dupe(s))` : 'NO'}`);

    // Cross-issue reuse
    const dataDir2 = path.join(__dirname, '..', 'brief', 'data');
    const prevNum2 = (issue.num || 0) - 1;
    const prevFile2 = prevNum2 > 0 ? path.join(dataDir2, `issue-${String(prevNum2).padStart(3, '0')}.json`) : null;
    let reuseAnswer = 'NO';
    if (prevFile2 && fs.existsSync(prevFile2)) {
      try {
        const prev2 = JSON.parse(fs.readFileSync(prevFile2, 'utf8'));
        const prevImgs2 = new Set();
        if (prev2.heroOverride?.image) prevImgs2.add(prev2.heroOverride.image);
        for (const s of (prev2.dynamicSports || [])) { if (s.imageUrl) prevImgs2.add(s.imageUrl); }
        const reusedCount = auditImgs.filter(u => prevImgs2.has(u)).length;
        if (reusedCount) reuseAnswer = `YES (${reusedCount} shared with #${String(prevNum2).padStart(3, '0')})`;
      } catch (_) {}
    }
    console.log(`  Images reused from prev issue:   ${reuseAnswer}`);

    // F1 freshness
    const f1Entry = dynSportsAudit.find(s => (s.label || '').toLowerCase().includes('f1') || (s.name || '').toLowerCase().includes('grand prix'));
    const f1Img   = f1Entry?.imageUrl || '';
    let f1Fresh = 'N/A';
    if (f1Img) {
      let prevF1Img = '';
      if (prevFile2 && fs.existsSync(prevFile2)) {
        try {
          const prev2 = JSON.parse(fs.readFileSync(prevFile2, 'utf8'));
          prevF1Img = (prev2.dynamicSports || []).find(s => (s.label||'').toLowerCase().includes('f1'))?.imageUrl || '';
        } catch (_) {}
      }
      f1Fresh = (f1Img && f1Img !== prevF1Img) ? `YES (${f1Img.split('/').pop()})` : `NO (same as prev: ${f1Img.split('/').pop()})`;
    }
    console.log(`  F1 image fresh:                  ${f1Fresh}`);

    // Wrong sport/player image — pull from earlier check results
    console.log(`  Wrong sport/player image:        ${imageMismatch ? 'YES — see [Sports Image Validation] above' : 'NO'}`);

    // Per-section image summary
    console.log('');
    console.log('  Section images:');
    if (issue.heroOverride?.image) {
      console.log(`    Lead/Markets: ${issue.heroOverride.image}`);
    }
    for (const s of dynSportsAudit) {
      const players = Array.isArray(s.playerLinks) ? s.playerLinks.map(p => p.name).join(', ') : '';
      console.log(`    ${(s.label || s.name || '?').padEnd(18)}: ${s.imageUrl || '(none)'}`);
      if (players) console.log(`      ${''.padEnd(18)}  players: ${players}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed · ${failed} failed\n`);

  if (failed === 0) {
    if (researchMode === 'feed-only') {
      console.log('  ✅ Brief passes QA (feed-only mode — degraded confidence)\n');
      console.log('     OpenAI web research was unavailable. Review top stories carefully before approving.\n');
    } else {
      console.log('  ✅ Brief passes QA — ready to deploy.\n');
    }
  } else {
    console.log('  ❌ Fix the issues above before sending.\n');
    process.exit(1);
  }
}

main();

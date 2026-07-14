#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { fetchNBA, fetchNBAUpcoming, fetchNBABoxScore, fetchNHL, fetchUFC, fetchGameMeta, fetchMLB, fetchF1, fetchWorldCup, fetchMarkets, fetchMarketScreeners, fetchGolf, fetchTennis, fetchTrending } = require('./lib/fetchers');
const { generateCopy, generateF1Only }                      = require('./lib/copy');
const { editBrief }                                         = require('./lib/editor');
const { buildHtml }                                         = require('./lib/html');
const { buildArchive }                                      = require('./lib/archive');
const { fetchTopStories, fetchSectionStories, fetchDynamicSports, fetchAnthropicResearchPack } = require('./lib/research');
const { fetchFactPack }                                             = require('./lib/factpack');
const { fetchOpenAIResearch }                                       = require('./lib/openai-research');
const { verifyBrief }                                               = require('./lib/openai-verify');
const { isExcluded, classifyTopic, scoreImportance }        = require('./lib/editorial-config');
const { STREAMING_PICKS, buildPlayerLinksFromFacts, PLAYERS, officialPlayerUrl } = require('./lib/db');
const { GENERATION_WARNINGS, addWarning, resetWarnings, formatWarnings } = require('./lib/warnings');
const { cleanImageUrl } = require('./lib/images');

const ROOT      = path.join(__dirname, '..');
const BRIEF_DIR = path.join(ROOT, 'brief');

// ─────────────────────────────────────────────────────────────────────────────
// Research pack → topStories / sectionStories.culture adapters.
// Claude's generateCopy() receives these in the same format it already expects,
// but they are now sourced from OpenAI's web-searched, confidence-scored pack
// instead of from unverified NewsAPI headlines ranked by Haiku.
// ─────────────────────────────────────────────────────────────────────────────
function researchPackToTopStories(pack) {
  if (!pack?.stories?.length) return [];
  return pack.stories
    .filter(s => s.category !== 'Culture')
    .map(s => ({
      category:     s.category  || 'World',
      headline:     s.headline  || '',
      whatHappened: s.whatHappened || '',
      whyItMatters: s.whyItMatters || '',
      depth:        s.guytalkRead  || '',    // used by copy.js for market depth
      whatToSay:    s.whatToSay    || '',
      sources:      Array.isArray(s.sources) ? s.sources : [],
      isLead:       !!s.isLead,
      tier:         1,                        // research-backed = always Tier 1
      _category:    s.category || '',
      _context:     Array.isArray(s.context) ? s.context : [],
      _confidenceScore:   s.scores?.confidence || 5,
      _selectionReason:   s.selectionReason    || '',
      _verificationConcerns: s.verificationConcerns || '',
    }));
}

function researchPackToCulture(pack) {
  if (!pack?.stories?.length) return [];
  return pack.stories
    .filter(s => s.category === 'Culture')
    .map(s => ({
      headline:   s.headline   || '',
      source:     (s.sourceNames || []).join(', '),
      url:        (s.sources   || [])[0] || '',
      fact:       s.whatHappened || '',
      background: s.whyItMatters || '',
      no_data:    false,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detect the next issue number from existing brief/issue-NNN directories
// ─────────────────────────────────────────────────────────────────────────────
function getNextIssueNum() {
  const dirs = fs.readdirSync(BRIEF_DIR)
    .filter(d => /^issue-\d{3}$/.test(d))
    .map(d => parseInt(d.replace('issue-', ''), 10));
  return dirs.length ? Math.max(...dirs) + 1 : 1;
}

// Guards against the scheduled cron and a manual dispatch both firing the same
// day: each run is a from-scratch regeneration that force-pushes to `pending`,
// so a second run silently clobbers any edits/approval made after the first
// (this happened for real on 2026-07-14 — a manual run's image fixes were wiped
// by the scheduled run firing later that morning). If `slug` already exists on
// `pending` dated today, skip instead of overwriting it.
function alreadyGeneratedTodayOnPending(slug, date) {
  try {
    execSync('git fetch origin pending', { cwd: ROOT, stdio: 'ignore' });
    const raw = execSync(`git show origin/pending:brief/data/${slug}.json`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const existing = JSON.parse(raw);
    return existing.date === date;
  } catch (_) {
    return false; // no matching issue on pending yet, or git/network unavailable — proceed
  }
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function pad(n, w = 3) { return String(n).padStart(w, '0'); }

function line(char = '─', len = 44) { return char.repeat(len); }

// Deck (sub-headline) rotates by issue number so the brief doesn't open with the
// identical tagline every single day. Deterministic cycle — no repeat until the
// pool is exhausted. Keep each ≤ ~7 words, on-brand, no punctuation gimmicks.
const DECK_LINES = [
  'Five minutes. Everything you need.',
  "Today's world, handled.",
  'The stories worth your morning.',
  'What everyone will be talking about.',
  'Sports, markets, culture — sorted.',
  'Your daily edge, in five minutes.',
  'Everything that matters today, fast.',
  'The reading, done for you.',
  "Caught up before the coffee's cold.",
  'What happened — and what to say about it.',
];

// ─────────────────────────────────────────────────────────────────────────────
// Load last N real issue JSON files for the repetition guard
// ─────────────────────────────────────────────────────────────────────────────
function loadPreviousBriefs(n = 3) {
  const dataDir = path.join(BRIEF_DIR, 'data');
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort()
    .slice(-n);
  return files.map(f => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      return {
        slug:                d.slug || f.replace('.json', ''),
        sportsThesis:   (d.copy?.lead?.whatHappened || d.copy?.lead?.headline || '').slice(0, 120),
        lead:           (d.copy?.lead?.headline || '').slice(0, 120),
        bringUp:        d.copy?.markets?.bringUp || '',
        marketsBringUp: d.copy?.markets?.bringUp || '',
        // What events we already covered — used to avoid re-reporting the same
        // completed race/tournament and to pivot forward to what's next.
        f1Event:    d.f1?.name || '',
        f1State:    d.f1?.statusState || '',
        golfEvent:  d.golf?.name || '',
        golfState:  d.golf?.statusState || '',
        nhlGame:    d.nhl?.final?.note || d.nhl?.final?.shortName || '',
        nhlFinal:   !!(d.nhl?.final),
        dynamicLabels: (d.dynamicSports || []).map(s => (s.label || '').toLowerCase()),
        recBrand:   d.recPick?.brand || '',
      };
    } catch (_) { return null; }
  }).filter(Boolean);
}

// Every image URL the previous issue used (hero + per-sport). Passed to research
// so today's image searches avoid them — we never publish a repeated image.
function loadPrevImageUrls() {
  const dataDir = path.join(BRIEF_DIR, 'data');
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir).filter(f => /^issue-\d{3}\.json$/.test(f)).sort();
  const recent = files.slice(-10); // check last 10 issues to avoid repeated images
  const urls = [];
  for (const file of recent) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      if (d.heroImage) urls.push(d.heroImage);
      (d.dynamicSports || []).forEach(s => { if (s.imageUrl) urls.push(s.imageUrl); });
      if (d.sectionStories?.heroImage?.url) urls.push(d.sectionStories.heroImage.url);
    } catch (_) {}
  }
  return [...new Set(urls.filter(Boolean))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Regen mode — re-render all existing issues from saved JSON (new templates)
// Usage: node scripts/generate-brief.js --regen [--copy]
// --copy also regenerates the AI prose (slower, uses API credits)
// ─────────────────────────────────────────────────────────────────────────────
async function regenAll() {
  const regenCopy = process.argv.includes('--copy');
  const dataDir   = path.join(__dirname, '..', 'brief', 'data');
  if (!fs.existsSync(dataDir)) {
    console.log('No brief/data/ directory found. Nothing to regen.');
    return;
  }
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f.startsWith('issue-'));
  if (!files.length) {
    console.log('No saved issue JSON files found.');
    return;
  }
  console.log(`\n${'═'.repeat(44)}`);
  console.log(`  GuyTalk Brief Regenerator${regenCopy ? ' · WITH AI COPY' : ' · HTML only'}`);
  console.log(`  ${files.length} issue(s) found`);
  console.log(`${'═'.repeat(44)}\n`);

  // Pre-load all issues sorted by num (for related-issues links)
  const allIssuesSorted = files.sort().map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (_) { return null; }
  }).filter(Boolean).sort((a, b) => (b.num || 0) - (a.num || 0));

  for (const file of files.sort()) {
    const jsonPath = path.join(dataDir, file);
    const issueData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const slug = issueData.slug;
    if (regenCopy) {
      console.log(`  ✍️  Regenerating AI copy for ${slug}...`);
      try {
        const { sports, markets, golf, tennis, trending, f1, worldCup, nhl, upcoming } = issueData;
        const boxScores = {};
        const streamingPick = STREAMING_PICKS[(issueData.num || 0) % STREAMING_PICKS.length];
        issueData.copy = await generateCopy({ sports, markets, golf, tennis, trending, topStories: issueData.topStories || [], f1, worldCup, nhl, upcoming, boxScores, prev3: [], streamingPick });
        if (issueData.copy?.title) issueData.title = issueData.copy.title;
        fs.writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
        console.log(`     ✓ Copy: "${issueData.copy?.title || 'generated'}"`);
      } catch (e) {
        console.log(`     ⚠  Copy failed: ${e.message}`);
      }
    }
    // 3 most recent other issues for "more issues" section
    const related = allIssuesSorted.filter(d => d.num !== issueData.num).slice(0, 3);
    const htmlDir  = path.join(__dirname, '..', 'brief', slug);
    if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
    fs.writeFileSync(path.join(htmlDir, 'index.html'), buildHtml(issueData, related));
    console.log(`  ✓ ${slug}/index.html rebuilt`);
  }
  try {
    const ROOT = path.join(__dirname, '..');
    const { buildArchive } = require('./lib/archive');
    buildArchive(ROOT);
    console.log(`  ✓ briefs/index.html archive updated`);
    console.log(`  ✓ brief/index.html redirect updated`);
    console.log(`  ✓ index.html + about/index.html + sitemap.xml updated\n`);
  } catch (e) {
    console.log(`  ⚠  Archive update failed: ${e.message}\n`);
  }

  // --deploy flag: stage all regen-touched files and commit+push in one shot
  if (process.argv.includes('--deploy')) {
    const { execSync } = require('child_process');
    const ROOT = path.join(__dirname, '..');
    try {
      execSync('git add brief/ briefs/ index.html about/index.html sitemap.xml', { cwd: ROOT, stdio: 'inherit' });
      const slug = process.argv.find(a => a.startsWith('--slug='))?.replace('--slug=', '') || 'all';
      execSync(`git commit -m "regen: rebuild ${slug} brief HTML + redirect + archive"`, { cwd: ROOT, stdio: 'inherit' });
      // Rebase onto remote first (Vercel auto-commits can cause non-fast-forward)
      try { execSync('git pull origin main --rebase', { cwd: ROOT, stdio: 'inherit' }); } catch (_) {}
      execSync('git push origin main', { cwd: ROOT, stdio: 'inherit' });
      console.log('  ✅ Deployed.\n');
    } catch (e) {
      console.log(`  ⚠  Deploy failed: ${e.message}\n`);
    }
    return;
  }

  console.log('  Done. Deploy: node scripts/generate-brief.js --regen --deploy\n');
}

// Auto-generate a brief title from raw data when AI title generation fails
function autoTitle({ sports, golf, f1, worldCup, upcoming, topStories = [] }) {
  const nonSportsLead = topStories.find(s => s.isLead && !['Sports','NBA','NHL','MLB','NFL','F1','Golf','World Cup','UFC'].includes(s.category || ''));
  if (nonSportsLead) return nonSportsLead.headline || 'GuyTalk Daily Brief.';

  const parts = [];
  if (sports?.length) {
    const g = sports[0];
    const w = g.home.winner ? g.home : g.away;
    const l = g.home.winner ? g.away : g.home;
    parts.push(`${w.team} beat ${l.team} ${w.score}–${l.score}.`);
  } else if (upcoming?.length) {
    const g = upcoming[0];
    parts.push(`${g.shortName} ${g.daysAhead === 0 ? 'tips off today' : 'tomorrow'}.`);
  }
  if (golf?.leaders?.[0]) {
    const l = golf.leaders[0];
    parts.push(`${l.name} leads ${golf.name?.replace(/^the /i, '')}.`);
  }
  if (f1?.name) {
    parts.push(`${f1.name} this weekend.`);
  } else if (worldCup?.length) {
    parts.push('World Cup action underway.');
  }
  return parts.slice(0, 3).join(' ') || 'GuyTalk Daily Brief.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero = the issue's #1 story (the ranked Lead from research.js), never a
// hardcoded sport or a low-priority structured game. Its image must already be
// validated (research.js drops non-images), and it must be RELEVANT — we only
// use an image attached to the lead's own card or to a fellow Tier-1/2 story,
// never a generic stock photo. If no ranked lead has a valid image we fall back
// to the brand hero graphic for the lead's sport (never a wrong/mismatched photo).
// Returns a heroOverride object the template renders as a feature banner, or null.
// ─────────────────────────────────────────────────────────────────────────────
function heroKeyForLabel(label) {
  const t = String(label || '').toLowerCase();
  if (/\bnba\b|basketball/.test(t)) return 'nba';
  if (/\bnhl\b|stanley|hockey/.test(t)) return 'nhl';
  if (/\bmlb\b|baseball|world series/.test(t)) return 'mlb';
  if (/\bf1\b|formula|grand prix/.test(t)) return 'f1';
  if (/golf|pga|masters|open championship/.test(t)) return 'golf';
  return 'default';
}

function buildHeroOverride(dynamicSports) {
  const dyn = Array.isArray(dynamicSports) ? dynamicSports : [];
  if (!dyn.length) return null;            // no ranked lead → template's own fallback
  const lead = dyn[0];

  // /media/motion/ URLs are video thumbnails (press-conference clips, studio
  // shots) — they often show the back of someone's head and look bad as hero
  // banners. Prefer real news/action photos (/photo/ URLs) over them.
  const isVideoThumb = (url) => Boolean(url && /\/media\/motion\//i.test(url));
  const isRealPhoto  = (url) => Boolean(url && !isVideoThumb(url));

  const photoSource = dyn.find(s => isRealPhoto(s.imageUrl) && (s.tier == null || s.tier <= 2));
  let image = isRealPhoto(lead.imageUrl) ? lead.imageUrl
    : (photoSource ? photoSource.imageUrl : lead.imageUrl) || null;
  let imageReal = !!image;
  if (!image) {
    const alt = dyn.find((s) => s.imageUrl && (s.tier == null || s.tier <= 2));
    if (alt) { image = alt.imageUrl; imageReal = true; }
  }
  // Never fall back to default.jpg (it's a soccer field) — null is better than wrong
  if (!image) { const key = heroKeyForLabel(lead.label || lead.name); image = key !== 'default' ? `/assets/hero/${key}.jpg` : null; imageReal = false; }

  return {
    image: cleanImageUrl(image),
    imageReal,                              // real photo vs. brand fallback graphic
    eyebrow: lead.isLead ? 'The Lead' : (lead.label || lead.name),
    title: lead.headline || lead.label || lead.name,
    sub: lead.label || lead.name,
  };
}

// Returns a hero override from either the research-pack lead (if non-sports and high-scoring)
// or the top dynamic sports card — whichever represents the single biggest story today.
async function buildSmartHeroOverride(dynamicSports, topStories) {
  const researchLead = Array.isArray(topStories) ? topStories.find(s => s.isLead) : null;
  const SPORTS_CATEGORIES = new Set(['Sports', 'NBA', 'NHL', 'MLB', 'NFL', 'UFC', 'F1', 'Golf', 'World Cup', 'Soccer']);
  const isSportsLead = !researchLead || SPORTS_CATEGORIES.has(researchLead.category || '');

  if (researchLead && !isSportsLead) {
    // Search for a real photo — never fall back to default.jpg (it's a soccer field)
    let heroImg = null;
    let imageReal = false;
    try {
      const { searchWebImage, buildLeadImageQuery } = require('./lib/imageSearch');
      const query = buildLeadImageQuery({ title: researchLead.headline, eyebrow: researchLead.category });
      if (query) {
        heroImg = await searchWebImage(query, { fallback: null });
        imageReal = !!heroImg;
      }
    } catch (_) {}
    return {
      image: heroImg,
      imageReal,
      eyebrow: researchLead.category || 'The Lead',
      title: researchLead.headline || '',
      sub: researchLead.category || '',
      isNonSportsLead: true,
      leadCategory: researchLead.category || '',
    };
  }

  const heroResult = buildHeroOverride(dynamicSports);

  // If the hero reuses dyn[0]'s imageUrl, the QA duplicate-image check will fail
  // because the same URL appears in both heroOverride.image and the section card.
  // Search for a fresh alternative image for the section card so they're distinct.
  const lead = Array.isArray(dynamicSports) ? dynamicSports[0] : null;
  if (heroResult && lead && heroResult.image && heroResult.image === lead.imageUrl) {
    try {
      const { searchWebImage, buildSportImageQuery } = require('./lib/imageSearch');
      const query = buildSportImageQuery(lead);
      if (query) {
        const altImg = await searchWebImage(query, { fallback: null });
        if (altImg && altImg !== heroResult.image) {
          lead.imageUrl = altImg;  // mutates in-place; section card will use this distinct URL
        }
      }
    } catch (_) {}
  }

  return heroResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix 4 — a completed tournament with a notable winner ALWAYS gets a Sports
// section. Dynamic discovery sometimes omits golf even when it just finished; the
// structured golf data + the (editor-reviewed) golf copy are real, so we map them
// into a Sports card, score it, and re-sort so it lands by importance. Skipped if
// a golf card is already present (within-issue dedup) or the event isn't over.
// ─────────────────────────────────────────────────────────────────────────────
function injectCompletedGolf(dynamicSports, golf, copy, sectionStories) {
  const dyn = Array.isArray(dynamicSports) ? dynamicSports.slice() : [];
  if (!golf || golf.statusState !== 'post' || !golf.leaders || !golf.leaders[0]) return dyn;
  // Already represented by a discovered card? (dedup)
  if (dyn.some((s) => /\bgolf\b|\bpga\b/i.test(`${s.name || ''} ${s.label || ''} ${s.facts || ''}`))) return dyn;

  const w = golf.leaders[0];
  const cg = copy && copy.golf ? copy.golf : {};
  const background = (sectionStories && sectionStories.golf && (sectionStories.golf.background || sectionStories.golf.fact)) || '';
  const headline = cg.headline || `${w.name} wins the ${golf.name} at ${w.score}`;
  const card = {
    name: golf.name,
    label: golf.name,
    category: 'individual',
    headline,
    whatHappened: cg.headline || `${w.name} won the ${golf.name} at ${w.score}.`,
    whyItMatters: [cg.whyCare1, cg.whyCare2].filter(Boolean).join(' ') || (background ? background : ''),
    whatToBringUp: cg.whatToSay || '',
    facts: `${w.name} won the ${golf.name} at ${w.score}.`,
    background,
    source: '', url: '',
    imageUrl: null, // no faked/building image — Fix 6 prefers none over a wrong shot
    videoUrl: null,
    isLead: false,
  };
  const { score, tier } = scoreImportance({ name: golf.name, headline, facts: card.facts, isFinalResult: true });
  card.importance = score; card.tier = tier;

  dyn.push(card);
  // Re-sort by importance (stable) and re-flag The Lead.
  dyn.forEach((s, i) => { if (s.importance == null) { const r = scoreImportance({ name: s.name, headline: s.headline, facts: s.facts }); s.importance = r.score; s.tier = r.tier; } s._r = i; s.isLead = false; });
  dyn.sort((a, b) => (b.importance - a.importance) || (a._r - b._r));
  dyn.forEach((s) => { delete s._r; });
  if (dyn.length) dyn[0].isLead = true;
  console.log(`   ✓ Golf injected as a Sports card (T${tier}/${score}) — "${headline}"`);
  return dyn;
}

// Culture = entertainment only (Fix 2). Drop any culture item that classifies as
// a sports story (UFC/soccer/World Cup/game result) — those belong to Sports, and
// this also removes the cross-section duplicate (e.g. World Cup in Sports AND
// Culture). Never drops below one item.
function filterCultureToEntertainment(copy) {
  if (!copy || !Array.isArray(copy.culture)) return;
  const kept = copy.culture.filter((c) => classifyTopic(`${c.topic || ''} ${c.whatHappened || ''}`) !== 'sports');
  if (kept.length && kept.length !== copy.culture.length) {
    console.log(`   ⤫  Culture: dropped ${copy.culture.length - kept.length} sports item(s) — Culture is entertainment only`);
    copy.culture = kept;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a plain-text "raw facts" block for the editorial pass.
// The editor may ONLY use these facts — it edits wording, never invents data.
// ─────────────────────────────────────────────────────────────────────────────
function buildFactsContext({ sports, markets, golf, tennis, f1, worldCup, nhl, ufc, upcoming, boxScores, trending, topStories, sectionStories }) {
  const lines = [];

  if (sports?.length) {
    lines.push('GAMES:');
    sports.forEach(g => {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      let s = `- ${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score} (${g.status})`;
      if (g.seriesNote) s += ` [Series: ${g.seriesNote}]`;
      const leaders = boxScores?.[g.id];
      if (leaders?.length) {
        s += ` | Leaders: ${leaders.map(p => `${p.name} ${p.pts}pts${p.reb ? ` ${p.reb}reb` : ''}${p.ast ? ` ${p.ast}ast` : ''}`).join(', ')}`;
      }
      lines.push(s);
    });
  }

  if (upcoming?.length) {
    lines.push('UPCOMING:');
    upcoming.slice(0, 3).forEach(g => lines.push(`- ${g.shortName}${g.note ? ` (${g.note})` : ''} — ${g.daysAhead === 0 ? 'today' : g.daysAhead === 1 ? 'tomorrow' : `in ${g.daysAhead} days`}`));
  }

  if (f1?.name) {
    if (f1.results?.length && f1.statusState === 'post') {
      lines.push(`F1: ${f1.name} (Finished) — ${f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`);
    } else {
      lines.push(`F1: ${f1.name} — upcoming this weekend (${f1.status || f1.statusState || 'scheduled'})`);
    }
  }

  if (golf?.name) {
    // Known 2026 major venues — prevent Haiku from pulling wrong venue from training data
    const GOLF_VENUES = {
      'U.S. Open': 'Shinnecock Hills, Southampton, New York',
      'The Open Championship': 'Royal Portrush, Northern Ireland',
      'Masters': 'Augusta National, Georgia',
      'PGA Championship': 'Quail Hollow Club, Charlotte',
    };
    const venue = golf.venue || Object.entries(GOLF_VENUES).find(([k]) => (golf.name||'').includes(k))?.[1] || '';
    if (golf.statusState === 'post') {
      const lb = (golf.leaders || []).slice(0, 3).map(l => `${l.name} ${l.score}`).join(', ') || '(no leaderboard)';
      lines.push(`GOLF: ${golf.name}${venue ? ` at ${venue}` : ''} — FINISHED. Final leaderboard: ${lb}`);
    } else if (golf.hasStarted && golf.statusState === 'in') {
      const lb = (golf.leaders || []).slice(0, 3).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ') || '(no leaderboard)';
      lines.push(`GOLF: ${golf.name}${venue ? ` at ${venue}` : ''} — IN PROGRESS — live leaderboard, no winner yet. Leaderboard: ${lb}`);
    } else {
      // Tournament not yet started — write preview only, NO scores or leaders
      const VENUE_CONTEXT = {
        'Shinnecock Hills': "One of the founding clubs of the USGA (1891) — a true links-style course on Long Island where wind off Peconic Bay is a constant factor. Fast, firm greens punish anything short of perfect contact. Par is a victory here.",
        'Royal Portrush': 'Links golf on the Antrim coast — wind is the defining factor; distance control matters more than raw power.',
        'Augusta National': 'Home of The Masters — the most exclusive major venue; second-shot placement is everything here.',
        'Quail Hollow Club': 'Charlotte, NC — known for "The Green Mile", the brutally difficult finishing stretch of 16-17-18.',
      };
      const venueCtx = Object.entries(VENUE_CONTEXT).find(([k]) => venue.includes(k))?.[1] || '';
      const FAVORITES = {
        'U.S. Open': 'Scottie Scheffler (world No. 1), Rory McIlroy (4-time major winner and past U.S. Open champion), Bryson DeChambeau (defending U.S. Open champion)',
        'The Open Championship': 'Rory McIlroy, Jon Rahm, Shane Lowry',
        'Masters': 'Scottie Scheffler, Rory McIlroy, Jon Rahm',
        'PGA Championship': 'Scottie Scheffler, Xander Schauffele, Brooks Koepka',
      };
      const favoritesKey = Object.keys(FAVORITES).find(k => (golf.name||'').includes(k));
      const favorites = favoritesKey ? FAVORITES[favoritesKey] : '';
      lines.push(`GOLF PREVIEW (NOT YET STARTED — no scores, no leaderboard): ${golf.name}${venue ? ` at ${venue}` : ''}. ${venueCtx ? `VENUE: ${venueCtx}` : ''} ${favorites ? `FAVORITES: ${favorites}.` : ''} Write this as a preview — what to watch for, who analysts expect to contend, why this major/tournament matters. Do NOT state any scores, current standings, or leader names from this tournament.`);
    }
  }

  if (tennis?.tours?.length) {
    tennis.tours.forEach(t => {
      const tag = t.isMajor ? `${t.tour} GRAND SLAM` : t.tour;
      const res = t.results?.length ? ` Recent: ${t.results.map(r => `${r.winner} def. ${r.loser} ${r.score}`).join('; ')}` : '';
      lines.push(`TENNIS (${tag}): ${t.name} — ${t.status || 'in progress'}.${res}`);
    });
  }

  if (worldCup?.length) {
    const played = worldCup.filter(m => m.statusState === 'in' || m.statusState === 'post').length;
    lines.push(`WORLD CUP: 2026 — ${played} match(es) played so far`);
  }

  if (nhl && (nhl.final || nhl.next)) {
    const g = nhl.final || nhl.next;
    const loc = [g.venue, g.venueCity].filter(Boolean).join(', ');
    if (nhl.final) {
      const w = g.home.winner ? g.home : g.away, l = g.home.winner ? g.away : g.home;
      lines.push(`NHL: ${g.note || 'game'} — ${w.team} ${w.score}–${l.score} ${l.team}${g.seriesNote ? ` [Series: ${g.seriesNote}]` : ''}${loc ? ` at ${loc}` : ''}`);
    } else {
      lines.push(`NHL UPCOMING: ${g.note || g.shortName} — ${g.away.team} at ${g.home.team}${g.seriesNote ? ` [Series: ${g.seriesNote}]` : ''}${loc ? ` at ${loc}` : ''}. NO result yet.`);
    }
  }

  if (ufc?.name) {
    if (ufc.statusState === 'post' && ufc.mainEvent) {
      const me = ufc.mainEvent;
      const decisionNote = me.wentToDecision ? `via decision after ${me.scheduledRounds} rounds` : `in round ${me.round}${me.time ? ` (${me.time})` : ''}`;
      const cardNote = ufc.card.length ? ` Other card results: ${ufc.card.map(c => `${c.winner} def. ${c.loser} (${c.weightClass})`).join('; ')}.` : '';
      lines.push(`UFC: ${ufc.name} — FINISHED. Main event (${me.weightClass}): ${me.winner} def. ${me.loser} ${decisionNote}.${cardNote}`);
    } else {
      lines.push(`UFC UPCOMING: ${ufc.name} — no results yet.`);
    }
  }

  if (markets) {
    const mkt = Object.entries(markets)
      .filter(([, q]) => q?.dayChangePct !== null && q?.dayChangePct !== undefined)
      .map(([sym, q]) => {
        const day = `${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`;
        const wk  = (q.weekChangePct !== null && q.weekChangePct !== undefined)
          ? ` (${q.weekChangePct >= 0 ? '+' : ''}${q.weekChangePct.toFixed(1)}% wk)` : '';
        return `${sym} ${day}${wk}`;
      }).join(', ');
    if (mkt) lines.push(`MARKETS: ${mkt}`);
  }

  if (topStories?.length) {
    lines.push('');
    lines.push("TODAY'S BIGGEST STORIES (web-researched, real & sourced — LEAD THE BRIEF WITH THESE; the ★ is the single biggest story of the day):");
    topStories.forEach((s) => {
      lines.push(`${s.isLead ? '★' : '-'} [${s.category}] ${s.headline}`);
      if (s.whatHappened) lines.push(`   what happened: ${s.whatHappened}`);
      if (s.whyItMatters) lines.push(`   why it matters: ${s.whyItMatters}`);
      if (s.depth) lines.push(`   DEPTH (use this — market impact / index inclusion / how to participate / historical comps): ${s.depth}`);
      if (s.whatToSay) lines.push(`   what to say: ${s.whatToSay}`);
      if (Array.isArray(s.sources) && s.sources[0]) lines.push(`   source: ${s.sources[0]}`);
    });
  }

  if (trending?.length) {
    lines.push('TRENDING HEADLINES (for culture/context):');
    trending.slice(0, 8).forEach(t => lines.push(`- [${t.source}] ${t.title}`));
  }

  // Per-section web research (Change 1) — sourced facts for NHL/F1/Golf + culture.
  if (sectionStories && Object.keys(sectionStories).length) {
    const sec = [];
    const fmt = (label, r) => {
      if (!r || r.no_data) return;
      sec.push(`${label}: ${r.headline || r.fact}${r.fact && r.headline ? ` — ${r.fact}` : ''}${r.url ? ` (source: ${r.url})` : ''}`);
    };
    fmt('NHL (web)', sectionStories.nhl);
    fmt('F1 (web)', sectionStories.f1);
    fmt('GOLF (web)', sectionStories.golf);
    (sectionStories.culture || []).forEach((c, i) => fmt(`CULTURE ${i + 1} (web)`, c));
    if (sec.length) {
      lines.push('');
      lines.push('SECTION RESEARCH (web-sourced, real — use as grounded facts):');
      lines.push(...sec.map(s => `- ${s}`));
    }
  }

  return lines.join('\n') || '(no data available)';
}

// ─────────────────────────────────────────────────────────────────────────────
// In feed-only mode (no OpenAI web search), filter NewsAPI topStories to
// Tier-1 sources only. Drops stories with no URL, unknown sources, or
// known filler domains (Britannica, Wikipedia event lists, tabloids, etc.).
// ─────────────────────────────────────────────────────────────────────────────
const TIER1_DOMAINS = [
  'cnbc.com', 'wsj.com', 'reuters.com', 'apnews.com', 'bloomberg.com',
  'nytimes.com', 'washingtonpost.com', 'bbc.com', 'bbc.co.uk', 'axios.com',
  'politico.com', 'ft.com', 'marketwatch.com', 'theguardian.com',
  'espn.com', 'nba.com', 'nhl.com', 'mlb.com', 'nfl.com', 'pgatour.com',
  'formula1.com', 'theathletic.com', 'frontofficesports.com',
  'variety.com', 'hollywoodreporter.com', 'ign.com', 'polygon.com',
  'rollingstone.com', 'pitchfork.com', 'billboard.com', 'deadline.com',
  'sec.gov', 'cbsnews.com', 'nbcnews.com', 'abcnews.go.com', 'npr.org',
  'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com',
];
const BLOCKED_DOMAINS = [
  'britannica.com', 'wikipedia.org', 'wikimedia.org',
  'nypost.com/gossip', 'tmz.com', 'pagesix.com', 'dailymail.co.uk',
  'thesun.co.uk', 'mirror.co.uk',
];

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function filterToTrustedSources(stories) {
  if (!Array.isArray(stories)) return [];
  return stories.filter(s => {
    const urls = Array.isArray(s.sources) ? s.sources : [];
    if (!urls.length) return false;                    // no source URL → drop
    const dom = domainOf(urls[0]);
    if (!dom) return false;
    if (BLOCKED_DOMAINS.some(b => dom.includes(b) || urls[0].includes(b))) return false;
    return TIER1_DOMAINS.some(t => dom.includes(t));  // must match a trusted domain
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes('--regen')) return regenAll();
  resetWarnings(); // start each run with a clean section-warnings slate
  const isPreview = process.argv.includes('--preview');
  const issueNum  = getNextIssueNum();
  const today     = new Date();
  const date      = formatDate(today);
  const slug      = isPreview ? 'preview' : `issue-${pad(issueNum)}`;

  console.log(`\n${line('═')}`);
  console.log(`  GuyTalk Brief Generator${isPreview ? ' · PREVIEW MODE' : ''}`);
  console.log(`  ${isPreview ? 'Preview' : `Issue #${pad(issueNum)}`} · ${date}`);
  console.log(`${line('═')}\n`);
  if (isPreview) console.log('  ⚡ Preview mode — saves to brief/preview/ only. Nothing published.\n');

  if (!isPreview && !process.argv.includes('--force') && alreadyGeneratedTodayOnPending(slug, date)) {
    console.log(`  ⏭  ${slug} already generated today (${date}) on \`pending\` — skipping so this run doesn't overwrite a reviewed/edited brief.`);
    console.log('     Pass --force to regenerate anyway.\n');
    process.exit(42); // distinct "skipped" code — the workflow treats this as a no-op, not a failure
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  console.log('📡 Fetching data...');

  // OpenAI research runs in parallel with ESPN feeds — it is the PRIMARY story
  // discovery layer. fetchTopStories() (NewsAPI → Haiku) runs only as fallback.
  const prev3ForResearch = loadPreviousBriefs(3);
  const [sportsResult, marketsResult, golfResult, trendingResult, f1Result, wcResult, upcomingResult, screenersResult, nhlResult, ufcResult, tennisResult, topStoriesResult, openAIResearchResult] = await Promise.allSettled([
    fetchNBA(),
    fetchMarkets(),
    fetchGolf(),
    fetchTrending(),
    fetchF1(),
    fetchWorldCup(),
    fetchNBAUpcoming(),
    fetchMarketScreeners(),
    fetchNHL(),
    fetchUFC(),
    fetchTennis(),
    fetchTopStories(),   // fallback: NewsAPI → Haiku ranking (used when OpenAI research fails)
    fetchOpenAIResearch({ date, recentIssues: prev3ForResearch }),  // PRIMARY research layer
  ]);

  let sports       = sportsResult.status    === 'fulfilled' ? sportsResult.value    : null;
  const markets    = marketsResult.status   === 'fulfilled' ? marketsResult.value   : null;
  const screeners  = screenersResult.status === 'fulfilled' ? screenersResult.value : null;
  let nhl          = nhlResult.status === 'fulfilled' ? nhlResult.value : null;
  if (nhl) console.log(`   ✓ NHL: ${nhl.final ? nhl.final.shortName + ' (Final)' : ''}${nhl.next ? ` next: ${nhl.next.shortName}` : ''}`);
  let ufc          = ufcResult.status === 'fulfilled' ? ufcResult.value : null;
  if (ufc) console.log(`   ✓ UFC: ${ufc.name} (${ufc.statusState === 'post' ? 'Final' : 'upcoming'})`);
  // Attach market-wide screeners (FMP) to the markets object so they're saved
  // with the issue and rendered. Falls back to watchlist movers if no FMP key.
  if (markets && screeners) {
    markets.__screeners = screeners;
    console.log(`   ✓ Market screeners: ${screeners.gainers.length} gainers, ${screeners.losers.length} losers, ${screeners.actives.length} most-active`);
  } else if (markets) {
    console.log('   ⚠  No FMP screeners (set FMP_API_KEY) — using watchlist movers fallback');
  }
  const golf       = golfResult.status      === 'fulfilled' ? golfResult.value      : null;
  const trending   = trendingResult.status  === 'fulfilled' ? trendingResult.value  : null;
  let   f1         = f1Result.status        === 'fulfilled' ? f1Result.value        : null;

  // ── OpenAI research pack (PRIMARY story source) ───────────────────────────
  let researchPack = openAIResearchResult.status === 'fulfilled' ? (openAIResearchResult.value || null) : null;
  if (openAIResearchResult.status === 'rejected') {
    console.log(`   ✗ OpenAI research threw: ${openAIResearchResult.reason?.message || openAIResearchResult.reason}`);
  }

  // ── Anthropic web search fallback ────────────────────────────────────────
  // When OpenAI research fails/times out, use Anthropic Sonnet + web_search
  // with the same 6-bucket prompt. This gives real, fresh stories across sports,
  // markets, culture and tech instead of falling back to ESPN feeds + NewsAPI only.
  if (!researchPack?.searchActive) {
    try {
      console.log('   📋 OpenAI research unavailable — trying Anthropic web search fallback...');
      const anthPack = await fetchAnthropicResearchPack({ date, recentIssues: prev3ForResearch });
      if (anthPack?.searchActive) {
        researchPack = anthPack;
      } else {
        console.log('   ⚠  Anthropic fallback also unavailable — using feed-only mode');
      }
    } catch (anthErr) {
      console.log(`   ⚠  Anthropic fallback threw: ${anthErr.message}`);
    }
  }

  // researchMode is the source of truth for the whole pipeline's quality level.
  // 'openai-search'    = gpt-4.1 searched the web and returned verified stories.
  // 'anthropic-search' = Anthropic Sonnet web_search used as fallback.
  // 'feed-only'        = both web searches unavailable; ESPN + Tier-1 NewsAPI only.
  const researchMode = researchPack?.searchActive
    ? (researchPack.searchModel?.includes('anthropic') ? 'anthropic-search' : 'openai-search')
    : 'feed-only';

  // Feed-only mode is the "feels the same" problem: static Players-to-Know pool,
  // generic ESPN/NewsAPI content, no fresh angles. Don't retry and don't silently
  // ship it on a real (scheduled/dispatch) run — fail cleanly and alert Jake so he
  // can supply fresher input, instead of publishing a degraded brief. Preview runs
  // are exempt since nothing gets published from --preview.
  if (researchMode === 'feed-only' && !isPreview) {
    console.log('\n❌ Both OpenAI and Anthropic web-search research failed — aborting.');
    console.log('   Feed-only mode is disabled for real runs; no degraded brief will be generated.');
    console.log('   Run scripts/notify-research-failure.js to alert Jake, or re-run this workflow.\n');
    process.exit(1);
  }

  // topStories: prefer research pack; in feed-only mode filter NewsAPI to Tier-1 sources only.
  const topStoriesRaw = topStoriesResult.status === 'fulfilled' ? (topStoriesResult.value || []) : [];
  const topStories = researchPack
    ? researchPackToTopStories(researchPack)
    : filterToTrustedSources(topStoriesRaw);

  if (researchMode === 'openai-search' || researchMode === 'anthropic-search') {
    const source = researchMode === 'anthropic-search' ? 'Anthropic fallback' : 'OpenAI';
    console.log(`   ✓ ${source} research active — ${researchPack.stories?.length || 0} web-verified stories`);
    const leadStoryForLog = topStories.find(s => s.isLead) || topStories[0];
    if (leadStoryForLog) {
      const isSportsCategory = ['Sports','NBA','NHL','MLB','NFL','UFC','F1','Golf','World Cup'].includes(leadStoryForLog.category || '');
      console.log(`   ★ Today's lead: [${leadStoryForLog.category}] "${(leadStoryForLog.headline || '').slice(0, 70)}"`);
      if (!isSportsCategory) console.log(`   ★ NON-SPORTS LEAD — ${leadStoryForLog.category} story takes the hero position`);
      if (researchPack?.relevanceScan?.leadJustification) {
        console.log(`   ★ Why: ${researchPack.relevanceScan.leadJustification.slice(0, 100)}`);
      }
    }
  } else {
    console.log('');
    console.log('   📋 FEED-ONLY MODE — both OpenAI and Anthropic web research unavailable');
    console.log(`      Sports: ESPN structured feeds only`);
    console.log(`      Stories: Tier-1 sources only (${topStories.length} passed, ${topStoriesRaw.length - topStories.length} dropped)`);
    console.log(`      Culture: trusted entertainment sources only — no filler`);
    console.log('      Verification degraded — publish gate will apply stricter checks');
    console.log('');
  }
  const worldCup   = wcResult.status        === 'fulfilled' ? wcResult.value        : null;
  const upcoming   = upcomingResult.status  === 'fulfilled' ? upcomingResult.value  : null;
  const tennis     = tennisResult.status    === 'fulfilled' ? tennisResult.value    : null;
  if (tennis) {
    const slam = tennis.anyMajor ? ' ⭐ GRAND SLAM' : '';
    console.log(`   ✓ Tennis:${slam} ${tennis.tours.map(t => `${t.tour} ${t.name}`).join(', ')}`);
  }

  // Fetch box scores + highlight meta for any games (real player stats + recap links)
  let boxScores = {};
  let gameMetas = {};
  if (sports?.length) {
    console.log(`   ✓ NBA: ${sports.length} game(s) — ${sports.map(g => g.shortName).join(', ')}`);
    for (const game of sports.slice(0, 2)) {
      const sport = game.sport?.toLowerCase() || 'nba';
      try {
        if (sport === 'nba') {
          const leaders = await fetchNBABoxScore(game.id);
          if (leaders?.length) {
            boxScores[game.id] = leaders;
            console.log(`   ✓ Box score: ${game.shortName} — ${leaders[0].name} ${leaders[0].pts}pts`);
          }
        }
        const meta = await fetchGameMeta(game.id, sport);
        if (meta) gameMetas[game.id] = meta;
      } catch (_) {}
    }
  } else {
    console.log(`   ⚠  NBA: no games yesterday — trying MLB...`);
    try {
      const mlb = await fetchMLB();
      if (mlb?.length) {
        sports = mlb;
        console.log(`   ✓ MLB: ${mlb.length} game(s) — ${mlb.map(g => g.shortName).join(', ')}`);
      } else {
        console.log(`   ⚠  MLB: no data — sports section will cover F1/upcoming`);
      }
    } catch (e) {
      console.log(`   ⚠  MLB fetch failed: ${e.message}`);
    }
  }

  if (markets)             console.log(`   ✓ Markets: ${Object.keys(markets).filter(k => markets[k]?.price).length} tickers`);
  else                     console.log(`   ⚠  Markets: no data — add FINNHUB_API_KEY to .env.local`);

  if (golf?.name)          console.log(`   ✓ Golf: ${golf.name} — leader: ${golf.leaders?.[0]?.name || 'TBD'} ${golf.leaders?.[0]?.score || ''}`);
  else                     console.log(`   ⚠  Golf: no active tournament found`);

  if (f1?.name)            console.log(`   ✓ F1: ${f1.name} (${f1.status || f1.statusState}) — P1: ${f1.results?.[0]?.driver || 'TBD'}`);
  else                     console.log(`   ⚠  F1: no data`);

  if (worldCup?.length)    console.log(`   ✓ World Cup: ${worldCup.length} match(es) found`);
  else                     console.log(`   ⚠  World Cup: no active matches (tournament may not have started)`);

  if (upcoming?.length)    console.log(`   ✓ Upcoming NBA: ${upcoming.length} game(s) — ${upcoming.map(g => g.shortName).join(', ')}`);

  if (trending?.length)    console.log(`   ✓ Trending: ${trending.length} headlines`);
  else                     console.log(`   ⚠  Trending: no data`);

  // ── Generate AI copy ───────────────────────────────────────────────────────
  console.log('\n✍️  Generating GuyTalk copy with Claude Haiku...');
  let copy = null;
  let sectionStories = {};
  let dynamicSports = [];
  let factPack = null;
  try {
    const prev3 = loadPreviousBriefs(3);
    if (prev3.length) console.log(`   ✓ Repetition guard: loaded ${prev3.length} previous brief(s)`);

    // Don't re-report a completed race we already covered — pivot to a preview of
    // the next track. Swapping f1 to a 'pre'/no-results object makes the whole
    // downstream pipeline (copy + circuit image) treat it as an upcoming race.
    // NHL repetition guard — don't re-report a completed game already in the last brief.
    // When the same game fires again (e.g. Hurricanes Cup win the morning after), null
    // out nhl.final so fetchDynamicSports treats it as no active NHL story.
    const nhlGameNote = nhl?.final?.note || nhl?.final?.shortName || '';
    const nhlAlreadyCovered = nhlGameNote && nhl?.final
      && prev3.some(p => p.nhlFinal && p.nhlGame && p.nhlGame === nhlGameNote);
    if (nhlAlreadyCovered) {
      console.log(`   ↪ NHL: ${nhlGameNote} already covered — dropping from today's brief`);
      nhl = { ...nhl, final: null };
    }

    const f1AlreadyCovered = f1?.name && f1.statusState === 'post'
      && prev3.some(p => p.f1Event && p.f1Event === f1.name && p.f1State === 'post');
    if (f1AlreadyCovered && f1.nextRace?.name) {
      console.log(`   ↪ F1: ${f1.name} already covered — pivoting to next race (${f1.nextRace.name})`);
      f1 = {
        name: f1.nextRace.name,
        shortName: f1.nextRace.name,
        venue: '',
        status: 'Upcoming',
        statusState: 'pre',
        champLeader: f1.champLeader,   // keep the real, sourced title-race stat
        results: [],
        nextRace: null,
        daysAway: f1.nextRace.daysAway,
      };
    }
    const streamingPick = STREAMING_PICKS[issueNum % STREAMING_PICKS.length];

    // ── Web research — dynamic sports discovery + culture/hero, in parallel ─────
    // Discovery finds the sports actually generating coverage today (no hardcoded
    // list); culture/hero ground the rest. Image searches avoid the previous
    // issue's image URLs so we never publish a repeated image.
    const prevImageUrls = loadPrevImageUrls();
    console.log('   🔎 Research: building sports from feeds + culture...');
    const leadSubject = (topStories.find(s => s.isLead) || topStories[0])?.headline || null;
    const [secRes, dynRes] = await Promise.allSettled([
      fetchSectionStories({ dateLabel: date, leadSubject, issueNum, prevImageUrls, golf, topStories }),
      fetchDynamicSports({ sports, nhl, f1, ufc, golf, tennis, worldCup, upcoming, issueNum, prevImageUrls, prevBriefs: prev3, topStories }),
    ]);
    sectionStories = secRes.status === 'fulfilled' ? (secRes.value || {}) : {};

    // Override culture with research pack items when available — they are web-verified
    // and scored for quality. In feed-only mode, filter NewsAPI culture to trusted
    // entertainment sources only; no random filler or tabloid items.
    if (researchPack) {
      const rpCulture = researchPackToCulture(researchPack);
      if (rpCulture.length) {
        sectionStories.culture = rpCulture;
        console.log(`   ✓ Culture: ${rpCulture.length} item(s) from OpenAI research pack`);
      } else {
        // Research pack returned 0 Culture-tagged items — keep NewsAPI feed as-is
        console.log(`   ⚠  Culture: research pack had 0 Culture items — using feed stories`);
      }
    } else {
      // Feed-only: block known tabloid domains; accept any other entertainment source.
      // Using a blacklist (not whitelist) so legitimate entertainment journalism passes through.
      const rawCulture = sectionStories.culture || [];
      const filtered = rawCulture.filter(c => {
        const url = c.url || '';
        if (!url) return false;
        const dom = domainOf(url);
        return !BLOCKED_DOMAINS.some(b => dom.includes(b) || url.includes(b));
      });
      if (filtered.length !== rawCulture.length) {
        console.log(`   📋 Culture: filtered ${rawCulture.length - filtered.length} blocked-domain item(s) in feed-only mode (${filtered.length} kept)`);
      }
      sectionStories.culture = filtered;
    }
    if (secRes.status === 'rejected') console.log(`   ⚠  Section research failed (non-blocking): ${secRes.reason?.message || secRes.reason}`);
    const dynamic = dynRes.status === 'fulfilled' ? (dynRes.value || { lead: null, sports: [] }) : { lead: null, sports: [] };
    if (dynRes.status === 'rejected') console.log(`   ⚠  Dynamic sports failed (non-blocking): ${dynRes.reason?.message || dynRes.reason}`);
    dynamicSports = Array.isArray(dynamic.sports) ? dynamic.sports : [];

    // Fact Pack — one bundled OpenAI call enriching ammo for both generateCopy() and editBrief().
    // Runs after research so sectionStories and dynamicSports are available. Fail-open: null = Phase 1.
    if (process.env.OPENAI_API_KEY) {
      try {
        factPack = await fetchFactPack({ topStories, dynamicSports, sectionStories });
      } catch (err) {
        console.log(`   ⚠  Fact Pack failed (non-blocking): ${err.message}`);
      }
    } else {
      console.log('   ⚠  Fact Pack skipped — no OPENAI_API_KEY');
    }

    // Section-inclusion safety net (editorial-config.js): discovery already drops
    // EXCLUDEd leagues, but enforce it again here so a renamed variant (e.g.
    // "Women's NBA") can never slip into a published section.
    const beforeExcl = dynamicSports.length;
    dynamicSports = dynamicSports.filter((s) => !isExcluded(s.label || s.name));
    if (dynamicSports.length !== beforeExcl) console.log(`   ⤫  Dropped ${beforeExcl - dynamicSports.length} excluded sport(s) per editorial-config`);

    // Strip CDN proxy layers (WaPo imrs, Guardian overlay) from all sport images.
    dynamicSports.forEach(s => { if (s.imageUrl) s.imageUrl = cleanImageUrl(s.imageUrl); });

    // Final dedup safety net: drop any image that still matches the previous issue
    // (research already avoids them, but never publish a repeat — render text-only).
    const prevSet = new Set(prevImageUrls);
    dynamicSports.forEach(s => { if (s.imageUrl && prevSet.has(s.imageUrl)) s.imageUrl = null; });

    // Enrich golf object with known purse data (ESPN doesn't return purse amounts)
    if (golf?.name) {
      const GOLF_PURSE = {
        'U.S. Open':             { total: '$21,500,000', winner: '$3,870,000' },
        'Masters':               { total: '$20,000,000', winner: '$3,600,000' },
        'The Open Championship': { total: '$17,000,000', winner: '$3,100,000' },
        'PGA Championship':      { total: '$17,000,000', winner: '$3,100,000' },
        'Players Championship':  { total: '$25,000,000', winner: '$4,500,000' },
        'Arnold Palmer':         { total: '$20,000,000', winner: '$3,600,000' },
        'Genesis Invitational':  { total: '$20,000,000', winner: '$3,600,000' },
        'FedEx St. Jude':        { total: '$20,000,000', winner: '$3,600,000' },
        'BMW Championship':      { total: '$20,000,000', winner: '$3,600,000' },
        'Tour Championship':     { total: '$100,000,000', winner: '$18,000,000' },
      };
      const purseKey = Object.keys(GOLF_PURSE).find(k => (golf.name || '').includes(k));
      if (purseKey) golf.purse = GOLF_PURSE[purseKey];
    }

    copy = await generateCopy({ sports, markets, golf, tennis, trending, topStories, sectionStories, dynamicSports, f1, worldCup, nhl, upcoming, boxScores, gameMetas, prev3, streamingPick, factPack, issueNum });

    // Validate copy.lead — sometimes the model returns a bare array (ammo only) instead
    // of the expected object. Detect and retry once with a tighter prompt.
    if (copy && (Array.isArray(copy.lead) || !copy.lead?.headline)) {
      console.log('   ⚠  copy.lead came back malformed (array or missing headline) — retrying lead section...');
      addWarning('lead', 'retry', 'malformed lead — retried');
      const { generateLeadOnly } = require('./lib/copy');
      const retried = await generateLeadOnly({ sports, topStories, factPack });
      if (retried?.headline) {
        copy.lead = retried;
        console.log(`   ✓ Lead retry succeeded: "${retried.headline}"`);
      } else {
        console.log('   ⚠  Lead retry also failed — brief will have no lead (QA will block)');
      }
    }

    // Validate culture — QA requires minimum 2 items.
    if (copy && (!Array.isArray(copy.culture) || copy.culture.length < 2)) {
      const cultureCount = Array.isArray(copy.culture) ? copy.culture.length : 0;
      console.log(`   ⚠  culture has ${cultureCount} item(s), need 2 — retrying culture section...`);
      addWarning('culture', 'retry', `only ${cultureCount} item(s)`);
      const { generateCultureOnly } = require('./lib/copy');
      const retriedCulture = await generateCultureOnly({ topStories, sectionStories, streamingPick, factPack });
      if (Array.isArray(retriedCulture) && retriedCulture.length >= 2) {
        copy.culture = retriedCulture;
        console.log(`   ✓ Culture retry succeeded: ${retriedCulture.length} item(s)`);
      } else if (Array.isArray(retriedCulture) && retriedCulture.length > (copy.culture?.length || 0)) {
        copy.culture = retriedCulture;
        console.log(`   ⚠  Culture retry improved to ${retriedCulture.length} item(s) — still under 2`);
      }
    }

    // Validate F1 — QA requires ≥3 ammo items when F1 section is included.
    if (copy && f1?.name && (!Array.isArray(copy.f1?.ammo) || copy.f1.ammo.length < 3)) {
      const f1Count = Array.isArray(copy.f1?.ammo) ? copy.f1.ammo.length : 0;
      console.log(`   ⚠  f1 has ${f1Count} ammo item(s), need 3 — retrying f1 section...`);
      addWarning('f1', 'retry', `only ${f1Count} ammo item(s)`);
      const f1Web = (() => {
        const r = sectionStories?.f1;
        const base = (!r || r.no_data) ? '' : `${r.headline ? r.headline + ' — ' : ''}${r.fact || ''}`.trim();
        const fp = factPack?.f1;
        const ammoStr = Array.isArray(fp?.ammo) && fp.ammo.length ? `AMMO FACTS: ${fp.ammo.join(' | ')}` : '';
        return [base, ammoStr].filter(Boolean).join(' | ') || null;
      })();
      const retriedF1 = await generateF1Only({ f1, f1Web, factPack });
      if (retriedF1?.ammo?.length >= 3) {
        copy.f1 = retriedF1;
        console.log(`   ✓ F1 retry succeeded: "${retriedF1.headline}"`);
      } else {
        console.log('   ⚠  F1 retry failed — brief will have thin F1 ammo');
      }
    }

    // Merge the three-label beats (from copy) into each discovered sport so the
    // template renders What happened / Why it matters / What to bring up per card.
    if (dynamicSports.length) {
      const beats = Array.isArray(copy?.dynamicSportsText) ? copy.dynamicSportsText : [];
      // Bind beats to sports by LABEL, not by array position. The LLM occasionally
      // returns beats in a different order or drops one, which used to shift every
      // section by one slot (golf gets soccer content, MLB gets golf content, etc).
      // Match on the echoed label first; fall back to positional only when the
      // positional beat carries no label (older format) or its label matches.
      const norm = (x) => String(x || '').toLowerCase().trim();
      const beatsByLabel = new Map();
      beats.forEach(b => { if (b && norm(b.label)) beatsByLabel.set(norm(b.label), b); });

      const stripLabel = (b) => { if (!b) return b; const { label, ...rest } = b; return rest; };

      dynamicSports = await Promise.all(dynamicSports.map(async (s, i) => {
        const sportLabel = norm(s.label || s.name);
        let beat = null;
        // 1) Prefer an exact label match
        if (sportLabel && beatsByLabel.has(sportLabel)) {
          beat = beatsByLabel.get(sportLabel);
        } else {
          // 2) Fall back to positional — but ONLY if it's safe: either the beat has
          //    no label (can't verify) or its label matches this sport. If the
          //    positional beat's label points at a DIFFERENT sport, refuse to merge
          //    (a thin section beats a cross-contaminated one).
          const pos = beats[i];
          const posLabel = norm(pos?.label);
          if (pos && (!posLabel || posLabel === sportLabel)) {
            beat = pos;
          } else if (pos && posLabel && posLabel !== sportLabel) {
            console.log(`   ⚠  dynamicSports: beat[${i}] labeled "${pos.label}" ≠ section "${s.label || s.name}" — skipped to avoid cross-contamination`);
            beat = null;
          }
        }
        const merged = { ...s, ...stripLabel(beat || {}) };
        // Players to Know — fresh web search for this specific matchup first (starters
        // + one breakout/bench player, each with a real current stat), so the section
        // doesn't just recycle whichever names happen to already be in the static
        // PLAYERS roster and happen to appear verbatim in the facts text. Falls back
        // to the old static-roster scan if the search is unavailable or finds nothing.
        if (!merged.playerLinks?.length && merged.headline) {
          try {
            const { searchPlayersToKnow } = require('./lib/imageSearch');
            const found = await searchPlayersToKnow({ label: merged.label || merged.name, headline: merged.headline });
            if (found?.length) merged.playerLinks = found.map(p => ({ name: p.name, url: p.url || '#', note: p.note }));
          } catch (_) {}
        }
        if (!merged.playerLinks?.length) {
          const links = buildPlayerLinksFromFacts(merged.facts, merged.headline);
          if (links.length) merged.playerLinks = links;
        }
        // F1 preview cards rarely name drivers in facts — inject the top grid drivers
        if (!merged.playerLinks?.length && (merged._sport === 'f1' || /formula.?1|grand prix/i.test(merged.name || ''))) {
          const f1Drivers = Object.entries(PLAYERS)
            .filter(([, p]) => p.sport === 'f1')
            .slice(0, 6)
            .map(([name, p]) => ({ name, url: officialPlayerUrl(p) }));
          if (f1Drivers.length) merged.playerLinks = f1Drivers;
        }
        // Golf cards: inject course + purse into merged entry for ctx-card rendering
        if (merged.label === 'Golf' || /open championship|masters|pga championship|us open/i.test(merged.name || '')) {
          if (!merged.course) merged.course = copy?.golf?.course || golf?.course || null;
          if (golf?.purse) {
            if (!merged.purse) merged.purse = `${golf.purse.total} total — winner takes ${golf.purse.winner}`;
            const purseAmmo = `${golf.name} total purse: ${golf.purse.total} — winner takes ${golf.purse.winner}`;
            if (!Array.isArray(merged.ammo)) merged.ammo = [];
            if (!merged.ammo.some(a => /purse|\$/.test(a))) merged.ammo.push(purseAmmo);
          }
        }
        // ourPick fallback — LLM sometimes omits it; construct from known data for
        // ongoing/upcoming events where a pick is expected.
        if (!merged.ourPick) {
          if (merged.label === 'F1' && !merged._isFinal) {
            const champ = f1?.champLeader;
            if (champ?.name) {
              merged.ourPick = `${champ.name} to podium — he leads the championship by ${champ.lead} points and consistent pace at a power circuit gives him the edge.`;
            }
          } else if ((merged.label === 'Golf') && !merged._isFinal) {
            const leader = golf?.leaders?.[0];
            if (leader?.name) {
              merged.ourPick = `${leader.name} to win — he's leading at ${leader.score} and U.S. Open leaders with a 4+ shot cushion heading into Sunday close it out more often than not.`;
            }
          }
        }
        return merged;
      }));
      // Search for YouTube highlight videos — one per sport, in parallel
      try {
        const { searchWebVideo, buildSportVideoQuery } = require('./lib/imageSearch');
        const videoResults = await Promise.allSettled(
          dynamicSports.map(s => (!s.videoUrl && buildSportVideoQuery(s)) ? searchWebVideo(buildSportVideoQuery(s)) : Promise.resolve(null))
        );
        dynamicSports = dynamicSports.map((s, i) => ({
          ...s,
          videoUrl: s.videoUrl || videoResults[i]?.value || null,
        }));
      } catch (_) {}

      console.log(`   ✓ Discovered sports (${dynamicSports.length}): ${dynamicSports.map(s => `${s.isLead ? '★ ' : ''}${s.label} [${s.category}]${s.playerLinks?.length ? ` (${s.playerLinks.length} players)` : ''}${s.videoUrl ? ' 🎬' : ''}`).join(', ')}`);
    }
    if (copy) {
      if (copy.title)          console.log(`   ✓ Headline: "${copy.title}"`);
      if (copy.lead)           console.log(`   ✓ Sports angle`);
      if (copy.markets?.mood)  console.log(`   ✓ Markets take`);
      if (copy.finalSharpTake) console.log(`   ✓ Sharp take`);
    } else {
      console.log(`   ⚠  Skipped — add ANTHROPIC_API_KEY to .env.local`);
    }
  } catch (err) {
    console.log(`   ⚠  Copy generation failed: ${err.message}`);
  }

  // ── Editorial pass — Claude enforces the GuyTalk Editorial Bible ────────────
  // Claude Haiku gathered the facts and drafted the raw stories above. This is the
  // FINAL writing pass (Claude Sonnet): it checks formatting, sharpens every
  // "What to say" / "Why it matters", enforces GUYTALK_EDITORIAL_BIBLE.md, flags
  // weak content, and checks source links. Sections that still can't meet the
  // standard are flagged in editor.blocking, which qa-brief.js turns into a hard
  // publish block. Fail-open: if Anthropic is unavailable the Claude draft ships
  // with reviewed:false and a loud warning.
  let editorMeta = { reviewed: false, blocking: [], changed: [], notes: [], brokenLinks: [], reason: 'no copy to edit' };
  if (copy) {
    console.log('\n🧐 Editorial pass — Claude enforcing the GuyTalk Editorial Bible...');
    try {
      const facts = buildFactsContext({ sports, markets, golf, tennis, f1, worldCup, nhl, ufc, upcoming, boxScores, trending, topStories, sectionStories });
      const factsWithPack = factPack
        ? facts + '\n\nFACT PACK AMMO (structured, verified — use to check and sharpen ammo arrays in the copy):\n' +
          Object.entries(factPack)
            .map(([k, v]) => {
              if (Array.isArray(v)) return v.map((item, i) => Array.isArray(item?.ammo) && item.ammo.length ? `- ${k.toUpperCase()} ${i + 1}: ${item.ammo.join(' | ')}` : '').filter(Boolean).join('\n');
              return Array.isArray(v?.ammo) && v.ammo.length ? `- ${k.toUpperCase()}: ${v.ammo.join(' | ')}` : '';
            })
            .filter(Boolean)
            .join('\n')
        : facts;
      const links = (trending || []).map(t => t.url).filter(Boolean);
      // Hard 15-minute wall clock: Sonnet 4.6 at 8192 max_tokens can take
      // 10-13 minutes to stream. This ceiling prevents infinite hangs if the
      // stream stalls mid-response while still giving the editor enough room.
      const EDITOR_HARD_LIMIT_MS = 15 * 60 * 1000;
      const result = await Promise.race([
        editBrief({ copy, context: factsWithPack, links }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('editorial pass hard-timeout (10 min)')), EDITOR_HARD_LIMIT_MS)
        ),
      ]);
      copy = result.copy;
      editorMeta = result.editor;
      if (editorMeta.reviewed) {
        console.log(`   ✓ Edited by ${editorMeta.model}`);
        if (editorMeta.changed.length) console.log(`   ✓ Rewrote: ${editorMeta.changed.join(', ')}`);
        if (editorMeta.blocking.length) {
          console.log(`   ⛔ ${editorMeta.blocking.length} section(s) FLAGGED — QA will block publish:`);
          editorMeta.blocking.forEach(b => console.log(`        • ${b.section}: ${b.reason}`));
        } else {
          console.log(`   ✓ All sections meet the Bible — no blocks`);
        }
      } else {
        console.log(`   ⚠  NOT editor-reviewed: ${editorMeta.reason}`);
        console.log(`   ⚠  Brief will publish on the Claude draft only (fail-open).`);
        addWarning('editor', 'failed', editorMeta.reason || 'editor pass did not run');
      }
      if (editorMeta.brokenLinks?.length) {
        console.log(`   🔗 ${editorMeta.brokenLinks.length} broken source link(s):`);
        editorMeta.brokenLinks.forEach(l => console.log(`        • ${l.url} — ${l.reason}`));
      }
    } catch (err) {
      editorMeta = { reviewed: false, blocking: [], changed: [], notes: [], brokenLinks: [], reason: `editor crashed: ${err.message}` };
      console.log(`   ⚠  Editorial pass crashed: ${err.message} — keeping Claude draft (fail-open)`);
      addWarning('editor', 'failed', `crashed: ${err.message}`);
    }
  }

  // ── Round-2 post-processing (run on the final, editor-reviewed copy) ────────
  //   Fix 2: Culture is entertainment-only (drops sports items + cross-section dupes).
  //   Fix 4: a completed tournament (golf) always gets a Sports card, ranked in.
  filterCultureToEntertainment(copy);
  dynamicSports = injectCompletedGolf(dynamicSports, golf, copy, sectionStories);

  // ── The Rec — fresh web search each issue, not a rotation from a fixed list ─
  // Jake: "biggest offender" — find something people are actually talking about
  // this week (new drop, viral podcast, current-event tie-in), matched to the
  // week's theme. Bounded/no-retry; falls open to null so buildRec() in html.js
  // keeps using the static RECS rotation if the search fails or is unavailable.
  let recPick = null;
  try {
    const { searchRecPick } = require('./lib/imageSearch');
    const theme = [copy?.title, copy?.finalSharpTake, ...(topStories || []).slice(0, 3).map(t => t.headline || t.title)]
      .filter(Boolean).join(' | ');
    const avoidBrands = loadPreviousBriefs(8).map(p => p.recBrand).filter(Boolean);
    recPick = await searchRecPick({ theme, avoidBrands });
    if (recPick) console.log(`   ✓ The Rec: fresh pick — ${recPick.brand}`);
    else console.log(`   ⚠  The Rec: search unavailable/failed — falling back to static rotation`);
  } catch (err) {
    console.log(`   ⚠  The Rec search crashed: ${err.message} — falling back to static rotation`);
  }

  // ── Assemble issue data object ─────────────────────────────────────────────
  const issueData = {
    num:     issueNum,
    slug,
    date,
    title:   copy?.title || autoTitle({ sports, golf, f1, worldCup, upcoming, topStories }),
    deck:    DECK_LINES[issueNum % DECK_LINES.length],
    sports,
    markets,
    golf,
    tennis,
    f1,
    worldCup,
    nhl,
    upcoming,
    gameMetas,
    trending,
    topStories,
    sectionStories,
    dynamicSports,
    heroImage: (sectionStories?.heroImage && !sectionStories.heroImage.no_data)
      ? sectionStories.heroImage.url
      : null,
    // Hero banner = the ranked #1 story (Fix 1's Lead), with a validated/relevant
    // image or the brand fallback graphic — never the structured-feed marquee game.
    heroOverride: await buildSmartHeroOverride(dynamicSports, topStories),
    recPick,
    copy,
    editor:  editorMeta,
    factPack: factPack || null,
    researchPack: researchPack || null,
    // 'openai-search' = gpt-4.1 web search was active and verified stories.
    // 'feed-only'     = web search unavailable; ESPN + Tier-1 NewsAPI only.
    researchMode,
    // Section retries / failures / editor hard-blocks from this run, persisted so
    // the approval email can surface them (populated by generateCopy + editBrief).
    generationWarnings: [...GENERATION_WARNINGS],
  };

  // ── Verified fact sheet — written before verification for auditing ──────────
  // Logs a human-readable table of verified facts (ESPN + research) that all
  // sections should draw from. Future issues: cross-check condensed sections
  // against this table before approving.
  if (copy) {
    try {
      const factSheet = [];
      factSheet.push(`VERIFIED FACT SHEET — ${slug} — ${new Date().toISOString()}`);
      factSheet.push('='.repeat(72));
      factSheet.push('SOURCE: ESPN structured data (ground truth)');
      (sports || []).forEach(g => {
        const w = g.home?.winner ? g.home : g.away, l = g.home?.winner ? g.away : g.home;
        factSheet.push(`  [SPORT] ${w?.team} ${w?.score}–${l?.score} ${l?.team} (${g.status || ''})${g.seriesNote ? ' | ' + g.seriesNote : ''}`);
      });
      if (golf?.name) factSheet.push(`  [GOLF] ${golf.name} | venue: ${golf.venue || 'see established facts'} | status: ${golf.statusState}`);
      if (f1?.name)   factSheet.push(`  [F1] ${f1.name} | P1: ${f1.results?.[0]?.driver || '?'} (${f1.results?.[0]?.team || '?'})`);
      if (markets?.SPY?.dayChangePct != null) factSheet.push(`  [MARKETS] SPY ${markets.SPY.dayChangePct >= 0 ? '+' : ''}${markets.SPY.dayChangePct.toFixed(2)}% | DIA ${markets.DIA?.dayChangePct?.toFixed(2) || '?'}% | QQQ ${markets.QQQ?.dayChangePct?.toFixed(2) || '?'}%`);
      factSheet.push('');
      factSheet.push('SOURCE: OpenAI web research');
      (researchPack?.stories || []).forEach(s => {
        factSheet.push(`  [conf:${s.scores?.confidence || '?'}/5] ${s.headline} — ${(s.sourceNames || []).join(', ')}`);
      });
      factSheet.push('');
      factSheet.push('SECTIONS USING VERIFIED FACTS:');
      factSheet.push('  Markets, Lead, F1, Golf, Culture (must all agree on shared events)');
      factSheet.push('  Condensed: Final Sharp Take, Today at a Glance, Email Preview, Social Copy');
      factSheet.push('  Rule: condensed sections must reuse facts from above — never introduce new claims');
      factSheet.push('='.repeat(72));

      const logDir = path.join(__dirname, '..', 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, `factsheet-${slug}.txt`), factSheet.join('\n'));
      console.log(`   ✓ Fact sheet: logs/factsheet-${slug}.txt`);
    } catch (_) { /* non-blocking */ }
  }

  // ── Final verification (OpenAI) — gate before the brief is pushed ──────────
  // Runs AFTER the full brief is assembled so it can check the complete final
  // copy, not just individual sections. pass = false blocks QA and the push.
  let verification = { pass: true, skipped: true, reason: 'not yet run', blocking: [], warnings: [] };
  if (copy) {
    console.log('\n🔍 Final verification (OpenAI)...');
    try {
      verification = await verifyBrief({ issueData, researchPack });
    } catch (err) {
      console.log(`   ⚠  Verification crashed: ${err.message} — treating as pass (fail-open)`);
    }
  }
  issueData.verification = verification;

  // ── Write files ────────────────────────────────────────────────────────────
  console.log('\n📝 Writing files...');

  // JSON data file
  const dataDir  = path.join(BRIEF_DIR, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const jsonPath = path.join(dataDir, `${slug}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(issueData, null, 2));
  console.log(`   ✓ brief/data/${slug}.json`);

  // HTML file — preview always writes to brief/preview/, issues to brief/issue-NNN/
  const htmlDir  = path.join(BRIEF_DIR, slug);
  if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
  const htmlPath = path.join(htmlDir, 'index.html');
  // Load 3 most recent other issues for "more issues" section
  const relatedForNew = (() => {
    try {
      return fs.readdirSync(dataDir)
        .filter(f => f.endsWith('.json') && f.startsWith('issue-') && !f.includes(slug))
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch(_){return null;} })
        .filter(Boolean)
        .sort((a,b) => (b.num||0)-(a.num||0))
        .slice(0, 3);
    } catch(_) { return []; }
  })();
  fs.writeFileSync(htmlPath, buildHtml(issueData, relatedForNew));
  console.log(`   ✓ brief/${slug}/index.html`);

  // Archive index
  if (!isPreview) {
    try {
      buildArchive(ROOT);
      console.log(`   ✓ briefs/index.html (archive updated)`);
    } catch (e) {
      console.log(`   ⚠  Archive build failed: ${e.message}`);
    }
  }

  // Social cards: square (IG feed) + vertical (TikTok / Reels)
  if (!isPreview) {
    try {
      const { generateCard, generateTikTokCard, generateOgCard } = require('./lib/social-card');
      const cardPath   = generateCard(issueData);
      const tiktokPath = generateTikTokCard(issueData);
      const ogPath     = generateOgCard(issueData);
      console.log(`   ✓ ${path.relative(ROOT, cardPath)}`);
      console.log(`   ✓ ${path.relative(ROOT, tiktokPath)}`);
      console.log(`   ✓ ${path.relative(ROOT, ogPath)}`);
    } catch (e) {
      console.log(`   ⚠  Social card failed: ${e.message}`);
    }

    // Daily "what to say" video (resilient — never let it break the brief)
    try {
      const { generateVideo } = require('./generate-video');
      const videoPath = generateVideo(issueData);
      console.log(`   ✓ ${path.relative(ROOT, videoPath)}  (post to TikTok/Reels — add trending audio)`);
    } catch (e) {
      console.log(`   ⚠  Video skipped: ${e.message}`);
    }
  }

  // ── Review checklist ───────────────────────────────────────────────────────
  console.log(`\n${line()}`);
  console.log('  ✅ REVIEW CHECKLIST — scan before it goes live:');
  console.log(line());

  const checks = [];

  if (sports?.length)     checks.push(`□ [VERIFY] Sports scoreboards — confirm scores match ESPN`);
  else                    checks.push(`□ [WARN]   No NBA/MLB games — sports covers F1/upcoming/news`);
  if (f1?.results?.length) checks.push(`□ [VERIFY] F1: ${f1.name} — confirm ${f1.results[0]?.driver} result on ESPN`);
  if (worldCup?.length)   checks.push(`□ [INFO]   World Cup matches found — verify scores are current`);

  if (golf?.leaders?.[0]) checks.push(`□ [VERIFY] Golf leaderboard — verify ${golf.leaders[0].name} still leads`);
  else if (golf)          checks.push(`□ [INFO]   Golf: ${golf.name} not yet in progress`);
  else                    checks.push(`□ [WARN]   No golf data — section shows no active tournament`);

  if (markets)            checks.push(`□ [VERIFY] Market prices + weekly % auto-filled — spot-check SPY/QQQ`);
  else                    checks.push(`□ [WARN]   No market data — add FINNHUB_API_KEY to .env.local`);

  if (copy) {
    checks.push(`□ [REVIEW] AI copy generated — scan sports angle, culture stories, sharp take`);
    if (!copy.culture?.length)  checks.push(`□ [WARN]   Culture section may be sparse — check trending data quality`);
  } else {
    checks.push(`□ [WARN]   No AI copy (missing ANTHROPIC_API_KEY) — briefs will be thin`);
  }

  checks.push(`□ [AUTO]   briefs/index.html archive updated automatically`);

  checks.forEach(c => console.log(`  ${c}`));

  // Section-generation warnings (retries / failures / editor hard-blocks) — make
  // them loud at the end of the run so they're caught before approval.
  if (GENERATION_WARNINGS.length) {
    console.log(`\n  ⚠️  GENERATION WARNINGS (${GENERATION_WARNINGS.length}) — sections that retried, failed, or were blocked:`);
    console.log(formatWarnings());
  } else {
    console.log(`\n  ✅ No generation warnings — all sections generated cleanly on the first try.`);
  }

  if (isPreview) {
    console.log(`\n  📄 File saved: ~/Projects/GuyTalk/brief/preview/index.html`);
    console.log(`  🌐 Open:       open ~/Projects/GuyTalk/brief/preview/index.html`);
    console.log(`  ✋ Not an issue — nothing will be published until you run npm run brief`);
  } else {
    console.log(`\n  Preview:  open brief/${slug}/index.html`);
    console.log(`  Deploy:   git add . && git commit -m "Add ${slug}" && git push`);
  }
  console.log(`${line()}\n`);

  // auto-open: --preview always opens, --open flag also opens (used by brief:review and launchd)
  if (isPreview || process.argv.includes('--open')) {
    require('child_process').execSync(`open "${htmlPath}"`);
  }
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

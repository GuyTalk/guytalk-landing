'use strict';

/**
 * Daily "biggest stories" research — the organic-news layer the brief was missing.
 *
 * The rest of the pipeline only sees structured feeds (ESPN scores, Finnhub
 * PRICES, a thin Reddit/NewsAPI headline list). A genuinely huge story that is
 * NEWS rather than a price or a score — a record IPO, a major ruling, a big
 * product launch — is invisible to it, and the anti-hallucination rules
 * (correctly) forbid the writer from inventing it. This module gives the
 * pipeline real web search: it asks Claude to find the day's biggest stories,
 * grounded in sources, and for the single biggest market/business story to
 * answer the depth questions (market impact, how to participate, historical
 * comps). The output is fed to the writer/editor as sourced facts.
 *
 * Runs on the same Anthropic infrastructure as copy.js / editor.js — same
 * ANTHROPIC_API_KEY, same @anthropic-ai/sdk, no new dependency.
 *
 * Fail-open: any missing key / SDK / API error returns [] so daily generation
 * never blocks. Stories are only ever ADDED as sourced context; nothing here
 * fabricates scores, prices, or standings.
 */

// Opus for the editorial judgment + synthesis. Override via env if needed.
const RESEARCH_MODEL = process.env.ANTHROPIC_RESEARCH_MODEL || 'claude-opus-4-8';
const MAX_CONTINUATIONS = 4; // web-search server loop may pause_turn; resume a few times

const { isExcluded, scoreImportance } = require('./editorial-config');
const { resolveAndValidate }          = require('./images');

function extractJsonArray(text) {
  if (!text) return null;
  // Strip a ```json fence if present; the model often narrates before the array.
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  const body = cleaned.slice(start);
  // 1) Clean parse of [ ... last ] .
  const end = body.lastIndexOf(']');
  if (end > 0) {
    try { const v = JSON.parse(body.slice(0, end + 1)); if (Array.isArray(v)) return v; } catch { /* fall through */ }
  }
  // 2) Truncated output (hit max_tokens) — close the array at the last complete object.
  const lastObj = body.lastIndexOf('}');
  if (lastObj > 0) {
    try { const v = JSON.parse(body.slice(0, lastObj + 1) + ']'); if (Array.isArray(v)) return v; } catch { /* give up */ }
  }
  return null;
}

async function fetchTopStories({ dateLabel } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('   ⚠  Research skipped — ANTHROPIC_API_KEY missing'); return []; }

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch { console.log('   ⚠  Research skipped — @anthropic-ai/sdk not installed'); return []; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const today = dateLabel || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const prompt = `You are the lead editor of GuyTalk, a daily brief for men 25-45 who want to walk into any room informed. Today is ${today}.

Search the web for the BIGGEST, most relevant news stories happening RIGHT NOW — the things people are actually talking about today. Cover business & markets, tech, world/national news, and major culture. EXCLUDE routine sports scores (a separate feed handles those), but DO include a genuinely massive sports-business or championship story if it is one of the day's biggest stories.

Rank by real importance, not recency alone. The #1 story should be the single thing a smart guy most needs to know today.

For the single biggest MARKET or BUSINESS story, you MUST answer these in the "depth" field: how it affects the rest of the market and major indices (e.g. is the S&P 500 likely to add it), how a regular person can participate if relevant, and the historical comparison (how similar events have played out weeks/months/a year later). Be specific and grounded in what you found.

Rules:
- Only include stories you actually found in search and can cite with a real source URL.
- Be factual and specific (names, numbers, dates). Never invent a detail. If you cannot verify a claim, leave it out.
- Opinion is allowed only in "whatToSay" (label it as a take, not reporting).
- No investment advice — describe what happened and what it means, never "buy/sell/should".

Return ONLY a JSON array (no prose before or after, no markdown fence) of 4-6 objects:
[
  {
    "category": "Markets" | "Business" | "Tech" | "World" | "Culture",
    "headline": "tight, specific headline",
    "whatHappened": "1-2 sentences, specific and factual",
    "whyItMatters": "1-2 sentences on why a guy should care",
    "depth": "ONLY for the single biggest market/business story: 2-4 sentences on market impact + index implications + how to participate + historical comps. Empty string otherwise.",
    "whatToSay": "one natural, opinionated line a guy would actually say out loud",
    "sources": ["https://...", "https://..."],
    "isLead": true for the single biggest overall story, false for the rest
  }
]`;

  try {
    const messages = [{ role: 'user', content: prompt }];
    let res = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages,
    });

    // The web-search server loop can pause (pause_turn) before it finishes —
    // resume by re-sending the assistant turn until it ends naturally.
    let continuations = 0;
    while (res.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
      messages.push({ role: 'assistant', content: res.content });
      res = await client.messages.create({
        model: RESEARCH_MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
        messages,
      });
      continuations += 1;
    }

    const text = (res.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const stories = extractJsonArray(text);
    if (!Array.isArray(stories) || !stories.length) {
      console.log('   ⚠  Research returned no parseable stories');
      return [];
    }
    // Keep only well-formed, sourced stories.
    const clean = stories.filter((s) => s && s.headline && Array.isArray(s.sources) && s.sources.length);
    console.log(`   ✓ Research: ${clean.length} sourced top stories (lead: "${(clean.find((s) => s.isLead) || clean[0]).headline.slice(0, 48)}…")`);
    return clean;
  } catch (e) {
    console.log(`   ⚠  Research failed (non-blocking): ${e.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-section web research — Culture (×2) + hero image only.
//
// Sports are no longer hardcoded here; they're discovered dynamically (see
// fetchDynamicSports below). This module still grounds the culture section and
// finds a fresh hero image, flagging `no_data: true` when nothing concrete is
// found so the editor can hard-block an empty section instead of inventing filler.
//
// Each search is its own web_search call, run in parallel, returning ONE compact
// object: { headline, source, url, fact, no_data }. Fail-open everywhere.
// ─────────────────────────────────────────────────────────────────────────────

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  if (end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

// One grounded web_search call → a single normalized fact object (or no_data).
async function runSectionSearch(client, { query, instruction }) {
  const prompt = `${instruction}
Run this web search and use only what you actually find: ${query}

Return ONLY a single JSON object — no prose, no markdown fence:
{"headline":"tight, specific headline","source":"publisher name","url":"https://real-source","fact":"one key fact: a NAMED person, a specific NUMBER (score/stat/%/$), or a concrete EVENT that happened"}

If you cannot find a result containing at least one of (a named person, a specific number, a concrete event that happened), return exactly:
{"no_data":true}`;

  const messages = [{ role: 'user', content: prompt }];
  let res = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages,
  });
  let continuations = 0;
  while (res.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
    messages.push({ role: 'assistant', content: res.content });
    res = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages,
    });
    continuations += 1;
  }
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const obj = extractJsonObject(text);
  if (!obj || obj.no_data === true) return { no_data: true };
  // A result is only usable if it actually carries a concrete fact.
  if (!obj.fact || !String(obj.fact).trim()) return { no_data: true };
  return {
    headline: obj.headline || '',
    source:   obj.source || '',
    url:      Array.isArray(obj.sources) ? obj.sources[0] : (obj.url || ''),
    fact:     String(obj.fact).trim(),
    no_data:  false,
  };
}

async function fetchSectionStories({ dateLabel, leadSubject, issueNum, prevImageUrls = [] } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch { return {}; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const today = dateLabel || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // Culture only — sports are discovered dynamically (fetchDynamicSports).
  const jobs = [
    { key: 'culture1', instruction: 'You are finding the single most-talked-about sports/entertainment/culture story for men 25-45 right now. Avoid celebrity gossip.',
      query: `trending today ${today} sports entertainment culture viral` },
    { key: 'culture2', instruction: 'You are finding a notable movie, TV, music, or viral culture moment from today. Avoid celebrity relationship gossip.',
      query: `${today} movie news OR celebrity news OR viral clip OR Twitter trending` },
  ];

  const settled = await Promise.allSettled(
    jobs.map(j => runSectionSearch(client, j).then(r => ({ key: j.key, r })))
  );

  const out = {};
  const culture = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { r } = s.value;
    if (r && !r.no_data) culture.push(r);
  }
  out.culture = culture;        // 0–2 sourced culture items
  out.cultureNoData = culture.length === 0;

  // Hero image for the news lead — fresh per issue (date + issue number in the
  // query), and never the same URL as the previous issue (dedup + one retry).
  if (leadSubject) {
    out.heroImage = await findFreshImage(client, {
      subject: leadSubject, today, issueNum, avoid: prevImageUrls,
      prefer: 'Prefer ESPN CDN for sports subjects, Wikimedia for everything else.',
    });
  }

  console.log(`   ✓ Section research: culture:${culture.length} hero:${out.heroImage && !out.heroImage.no_data ? 'ok' : 'none'}`);

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic sports discovery — replaces the old hardcoded NHL/F1/Golf/World Cup
// searches. Each morning we find what sports are ACTUALLY generating coverage,
// then pull sourced facts (and, for individual sports, a highlight video + an
// action photo) for each. Nothing with no concrete fact survives.
//
//   Step 1  broad discovery → 3-5 { name, category: 'individual'|'team' }
//   Step 2  per sport: targeted facts; individual → highlight video + photo;
//           team → optional game photo. Every image query carries the date +
//           issue number and avoids the previous issue's image URLs.
//   Step 3  the top-ranked surviving story is The Lead.
//
// Export: { lead, sports: [{ name, label, category, headline, facts,
//                            imageUrl, videoUrl, source, url, isLead }] }
// Fail-open: returns { lead: null, sports: [] } on any error.
// ─────────────────────────────────────────────────────────────────────────────

// One web_search call that must return a single real URL (or null).
async function runUrlSearch(client, { instruction, query }) {
  const prompt = `${instruction}
Run this web search and use ONLY real results you actually find: ${query}

Return ONLY a single JSON object — no prose, no markdown fence:
{"url":"https://direct-real-working-url"}
If you cannot find a real, working URL, return exactly: {"none":true}`;
  const messages = [{ role: 'user', content: prompt }];
  let res = await client.messages.create({
    model: RESEARCH_MODEL, max_tokens: 1500, thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20260209', name: 'web_search' }], messages,
  });
  let c = 0;
  while (res.stop_reason === 'pause_turn' && c < MAX_CONTINUATIONS) {
    messages.push({ role: 'assistant', content: res.content });
    res = await client.messages.create({
      model: RESEARCH_MODEL, max_tokens: 1500, thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }], messages,
    });
    c += 1;
  }
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const obj = extractJsonObject(text);
  if (!obj || obj.none === true || !obj.url) return null;
  const url = String(obj.url).trim();
  return /^https?:\/\//.test(url) ? url : null;
}

// Find a real image URL for `subject`, fresh for this issue and never matching a
// URL the previous issue used. Every candidate is resolved to a direct image
// (Wikimedia File: → Special:FilePath, article page → og:image) and validated
// (must serve image/*) before it's accepted — a URL that can't be confirmed as a
// real image is dropped, never embedded as a dead link (see images.js).
// One dedup retry with a modified query.
async function findFreshImage(client, { subject, today, issueNum, avoid = [], prefer = '' }) {
  const avoidSet = new Set(avoid.filter(Boolean));
  const instr = `Find ONE real, current image of: ${subject}. ${prefer} Prefer a DIRECT image URL (ending in .jpg/.png/.webp), e.g. an upload.wikimedia.org file or an ESPN/Getty photo CDN — NOT a Wikipedia "File:" page and NOT an article/recap page.${avoidSet.size ? ` Do NOT return any of these already-used URLs: ${[...avoidSet].join(' , ')}` : ''}`;
  const q1 = `${subject} ${today} issue ${issueNum || ''} action photo site:espn.com OR site:en.wikipedia.org image`;

  // Resolve + validate a raw candidate; honor the avoid set on the FINAL url.
  const accept = async (raw) => {
    if (!raw) return null;
    const valid = await resolveAndValidate(raw);
    if (!valid || avoidSet.has(valid)) return null;
    return valid;
  };

  let url = await accept(await runUrlSearch(client, { instruction: instr, query: q1 }));
  if (!url) {
    // Either none found, a dupe, or it failed validation — try a different framing.
    url = await accept(await runUrlSearch(client, {
      instruction: instr,
      query: `${subject} latest different direct photo ${today} site:upload.wikimedia.org OR site:gettyimages.com OR site:espn.com`,
    }));
  }
  return url ? { url, no_data: false } : { no_data: true };
}

// Discovery tags each story 'individual' or 'team'. We trust that tag; anything
// missing or unexpected defaults to 'team' (per spec: when ambiguous, team). No
// sport names are hardcoded here — the category comes entirely from discovery.
function normalizeCategory(category) {
  return String(category || '').toLowerCase() === 'individual' ? 'individual' : 'team';
}

async function discoverSports(client, today) {
  const prompt = `You are the sports editor of GuyTalk, a daily brief for men 25-45. Today is ${today}.

Run these two web searches and read what comes back:
1. "top sports news today ${today}"
2. "biggest sports stories right now ${today}"

From the results, identify the 3-5 sports or events ACTUALLY generating the most coverage today — a finished game or series, a live tournament, a major result, or a marquee matchup. Use the real sport/league/tournament/team/athlete names you see.

Rank by how big the story is RIGHT NOW (importance, not recency alone).

For each, set "category":
- "individual" = one or a few competitors you can put a face to (F1, Golf, Tennis, UFC, Boxing, MMA, track, cycling, skiing, NASCAR, etc.)
- "team" = team leagues (NBA, NFL, MLB, NHL, soccer, World Cup, etc.)
When unsure, use "team".

Return ONLY a JSON array (no prose, no markdown fence), most important first:
[{"name":"display name of the sport/event, e.g. 'NBA Finals', 'Stanley Cup Final', 'Roland Garros', 'UFC 312'","category":"individual" | "team"}]`;
  const messages = [{ role: 'user', content: prompt }];
  let res = await client.messages.create({
    model: RESEARCH_MODEL, max_tokens: 4000, thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20260209', name: 'web_search' }], messages,
  });
  let c = 0;
  while (res.stop_reason === 'pause_turn' && c < MAX_CONTINUATIONS) {
    messages.push({ role: 'assistant', content: res.content });
    res = await client.messages.create({
      model: RESEARCH_MODEL, max_tokens: 4000, thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }], messages,
    });
    c += 1;
  }
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const arr = extractJsonArray(text);
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const cand of arr) {
    const name = cand && String(cand.name || '').trim();
    if (!name) continue;
    // Section-inclusion rules (editorial-config.js) — drop EXCLUDEd leagues
    // (e.g. WNBA) before they ever pull facts or an image.
    if (isExcluded(name)) { console.log(`   ⤫  Sports discovery: excluded "${name}" per editorial-config`); continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, category: normalizeCategory(cand.category) });
    if (out.length >= 5) break;
  }
  return out;
}

async function fetchDynamicSports({ dateLabel, issueNum, prevImageUrls = [] } = {}) {
  const empty = { lead: null, sports: [] };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('   ⚠  Dynamic sports skipped — ANTHROPIC_API_KEY missing'); return empty; }
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch { console.log('   ⚠  Dynamic sports skipped — @anthropic-ai/sdk not installed'); return empty; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const today = dateLabel || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // ── Step 1 — discovery ──────────────────────────────────────────────────────
  let candidates = [];
  try { candidates = await discoverSports(client, today); }
  catch (e) { console.log(`   ⚠  Sports discovery failed (non-blocking): ${e.message}`); return empty; }
  if (!candidates.length) { console.log('   ⚠  Sports discovery returned no candidates'); return empty; }
  console.log(`   ✓ Discovered ${candidates.length}: ${candidates.map(c => `${c.name} [${c.category}]`).join(', ')}`);

  // ── Step 2 — targeted facts (+ video/photo for individual; photo for team) ──
  const avoid = (prevImageUrls || []).filter(Boolean);
  const settled = await Promise.allSettled(candidates.map(async (cand) => {
    const facts = await runSectionSearch(client, {
      instruction: `You are researching today's ${cand.name} for a daily brief. Pull the single most important concrete result/news: who, what happened, the score or outcome, and one key name or number.`,
      query: `${cand.name} results highlights news ${today}`,
    });
    if (!facts || facts.no_data || !facts.fact) return { cand, facts: null };

    let videoUrl = null, imageUrl = null;
    if (cand.category === 'individual') {
      // A real highlight clip (only kept if genuinely found) + an action photo
      // of the athlete from THIS event.
      [videoUrl, imageUrl] = await Promise.all([
        runUrlSearch(client, {
          instruction: `Find ONE real highlight video of ${cand.name} from ${today}. Only a real video page (YouTube, the official league/tour, or a broadcaster). Never a search page.`,
          query: `${cand.name} highlight video ${today}`,
        }),
        findFreshImage(client, {
          subject: `${cand.name} ${facts.headline || ''} athlete in action`, today, issueNum, avoid,
          prefer: 'Prefer an action photo of the specific athlete/driver/fighter from this event. ESPN/Getty/Wikimedia are all fine.',
        }).then(r => (r && !r.no_data ? r.url : null)),
      ]);
    } else {
      // Team sports: one game photo if a good one comes back, else text-only.
      imageUrl = await findFreshImage(client, {
        subject: `${cand.name} ${facts.headline || ''} game`, today, issueNum, avoid,
        prefer: 'Prefer a photo from this game/match. ESPN/Getty/Wikimedia are fine.',
      }).then(r => (r && !r.no_data ? r.url : null));
    }

    return {
      cand,
      facts,
      sport: {
        name: cand.name,
        label: cand.name,
        category: cand.category,
        headline: facts.headline || cand.name,
        facts: facts.fact,
        source: facts.source || '',
        url: facts.url || '',
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
        isLead: false,
      },
    };
  }));

  // ── Step 3 — score by importance, sort desc; top = The Lead. No facts → dropped.
  // Discovery order is recency/coverage-biased (it once led with a World Cup
  // GROUP-STAGE result over an NBA title + a Stanley Cup). We override it with an
  // explicit, tunable importance score (see editorial-config.js): a title-decider
  // or historic first (Tier 1) beats a routine result (Tier 3), and the Sports
  // subsections render in score order, not a fixed league order.
  const sports = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !s.value || !s.value.sport) continue;
    sports.push(s.value.sport);
  }
  if (!sports.length) { console.log('   ⚠  No discovered sport returned concrete facts — sports will fall back to structured feeds'); return empty; }

  const FINAL_RESULT_RE = /\b(final|won|wins|beat|def\.|defeated|clinch|champions?|title|crowned)\b/i;
  sports.forEach((s, i) => {
    const isFinalResult = FINAL_RESULT_RE.test(`${s.headline} ${s.facts}`);
    const { score, tier } = scoreImportance({ name: s.name, headline: s.headline, facts: s.facts, isFinalResult });
    s.importance = score;
    s.tier = tier;
    s._discoveryRank = i; // stable tiebreak: preserve discovery order within a score
    s.isLead = false;
  });
  // Highest score first; ties keep discovery order.
  sports.sort((a, b) => (b.importance - a.importance) || (a._discoveryRank - b._discoveryRank));
  sports.forEach((s) => { delete s._discoveryRank; });
  sports[0].isLead = true;
  const lead = sports[0];
  console.log(`   ✓ Dynamic sports ranked (${sports.length}): ${sports.map(s => `${s.isLead ? '★ ' : ''}${s.label} [T${s.tier}/${s.importance}]${s.videoUrl ? ' 🎬' : ''}${s.imageUrl ? ' 🖼' : ''}`).join('  ·  ')}`);
  return { lead, sports };
}

module.exports = { fetchTopStories, fetchSectionStories, fetchDynamicSports };

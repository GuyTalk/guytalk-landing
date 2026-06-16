'use strict';

/**
 * Daily "biggest stories" research — cost-controlled rewrite.
 *
 * Two model tiers to cut per-run cost from ~$20 to ~$1-3:
 *   SYNTH_MODEL   (Sonnet) — broad synthesis: top stories + sports discovery (2 calls, adaptive thinking)
 *   EXTRACT_MODEL (Haiku)  — narrow extraction: facts, images, URLs (all other calls, no thinking)
 *
 * All knobs are env-overridable:
 *   ANTHROPIC_RESEARCH_MODEL   — override SYNTH_MODEL  (default: claude-sonnet-4-6)
 *   ANTHROPIC_EXTRACT_MODEL    — override EXTRACT_MODEL (default: claude-haiku-4-5-20251001)
 *   RESEARCH_MAX_CONTINUATIONS — max pause_turn resumes per call (default: 2)
 *   RESEARCH_MAX_SPORTS        — max sports discovered (default: 3)
 *   RESEARCH_HIGHLIGHT_VIDEOS  — set to "1" to re-enable highlight video search (default: off)
 *
 * Fail-open: any error returns [] / {} so generation never blocks.
 */

const SYNTH_MODEL   = process.env.ANTHROPIC_RESEARCH_MODEL || 'claude-sonnet-4-6';
const EXTRACT_MODEL = process.env.ANTHROPIC_EXTRACT_MODEL  || 'claude-haiku-4-5-20251001';

const MAX_CONTINUATIONS       = parseInt(process.env.RESEARCH_MAX_CONTINUATIONS || '2', 10);
const MAX_SPORTS              = parseInt(process.env.RESEARCH_MAX_SPORTS        || '3', 10);
const ENABLE_HIGHLIGHT_VIDEOS = process.env.RESEARCH_HIGHLIGHT_VIDEOS === '1';

const { isExcluded, scoreImportance } = require('./editorial-config');
const { resolveAndValidate }          = require('./images');

function extractJsonArray(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  const body = cleaned.slice(start);
  const end = body.lastIndexOf(']');
  if (end > 0) {
    try { const v = JSON.parse(body.slice(0, end + 1)); if (Array.isArray(v)) return v; } catch { /* fall through */ }
  }
  const lastObj = body.lastIndexOf('}');
  if (lastObj > 0) {
    try { const v = JSON.parse(body.slice(0, lastObj + 1) + ']'); if (Array.isArray(v)) return v; } catch { /* give up */ }
  }
  return null;
}

function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const end = cleaned.lastIndexOf('}');
  if (end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function getText(res) {
  return (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

// Shared runner: caps web_search via max_uses, optional adaptive thinking.
// allowed_callers:'direct' lets Haiku (which lacks programmatic tool calling) use web_search.
// Mutates `messages` in-place so continuation context accumulates naturally.
async function runSearch(client, { model, messages, maxTokens, maxUses, useThinking = false }) {
  const toolDef = { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses, allowed_callers: ['direct'] };
  const base = {
    model,
    max_tokens: maxTokens,
    tools: [toolDef],
    ...(useThinking ? { thinking: { type: 'adaptive' } } : {}),
  };
  let res = await client.messages.create({ ...base, messages });
  let c = 0;
  while (res.stop_reason === 'pause_turn' && c < MAX_CONTINUATIONS) {
    messages.push({ role: 'assistant', content: res.content });
    res = await client.messages.create({ ...base, messages });
    c += 1;
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top stories — SYNTH_MODEL, adaptive thinking, max_uses=3
// ─────────────────────────────────────────────────────────────────────────────
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
    // No adaptive thinking here — web search provides grounding, and thinking
    // causes this call to exceed the 10-min SDK timeout with 3 searches queued.
    const res = await runSearch(client, {
      model: SYNTH_MODEL, messages, maxTokens: 8000, maxUses: 3, useThinking: false,
    });
    const text = getText(res);
    const stories = extractJsonArray(text);
    if (!Array.isArray(stories) || !stories.length) {
      console.log('   ⚠  Research returned no parseable stories');
      return [];
    }
    const clean = stories.filter(s => s && s.headline && Array.isArray(s.sources) && s.sources.length);
    console.log(`   ✓ Research: ${clean.length} sourced top stories (lead: "${(clean.find(s => s.isLead) || clean[0]).headline.slice(0, 48)}…")`);
    return clean;
  } catch (e) {
    console.log(`   ⚠  Research failed (non-blocking): ${e.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section extraction — EXTRACT_MODEL (Haiku), no thinking, max_uses=1
// ─────────────────────────────────────────────────────────────────────────────

async function runSectionSearch(client, { query, instruction, wantBackground = false } = {}) {
  const bgField = wantBackground
    ? `,"background":"one BACKGROUND/context fact for someone who doesn't follow it: a drought ('first title since 1973'), a streak, a record, a first career win, the stakes, or what makes it unusual — a real, searchable fact, not filler"`
    : '';
  const bgRule = wantBackground
    ? `\nAlso find ONE background fact (drought/streak/record/first-time/stakes). If you genuinely can't find one, set "background":"" — never invent it.`
    : '';
  const prompt = `${instruction}
Run this web search and use only what you actually find: ${query}${bgRule}

Return ONLY a single JSON object — no prose, no markdown fence:
{"headline":"tight, specific headline","source":"publisher name","url":"https://real-source","fact":"one concrete detail: a NAMED title/person, a specific NUMBER, a concrete EVENT, or a new release with its name and what's happening"${bgField}}

If you genuinely cannot find any relevant result at all, return exactly:
{"no_data":true}`;

  try {
    const messages = [{ role: 'user', content: prompt }];
    const res = await runSearch(client, {
      model: EXTRACT_MODEL, messages, maxTokens: 1500, maxUses: 1, useThinking: false,
    });
    const text = getText(res);
    const obj = extractJsonObject(text);
    if (!obj || obj.no_data === true) return { no_data: true };
    if (!obj.fact || !String(obj.fact).trim()) return { no_data: true };
    return {
      headline:   obj.headline || '',
      source:     obj.source || '',
      url:        Array.isArray(obj.sources) ? obj.sources[0] : (obj.url || ''),
      fact:       String(obj.fact).trim(),
      background: obj.background ? String(obj.background).trim() : '',
      no_data:    false,
    };
  } catch (e) { console.log(`   ⚠  Section search error (${query.slice(0, 40)}): ${e.message}`); return { no_data: true }; }
}

async function fetchSectionStories({ dateLabel, leadSubject, issueNum, prevImageUrls = [], golf } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch { return {}; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const today = dateLabel || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const NO_SPORTS = ' Do NOT return any sports result, game, match, fight (UFC/boxing/MMA), or soccer/World Cup story — those are covered elsewhere. Entertainment, music, streaming, TV, film, gaming, or lifestyle only.';
  // New releases (movies in theaters, shows dropping on streaming, albums out today) are
  // fully valid culture items — the fact field should name the title and what happened.
  const RELEASE_NOTE = ' A new movie release, streaming drop, album, or game launch counts as a strong pick — name the title and the release detail as the fact.';
  const jobs = [
    {
      key: 'culture1',
      instruction: 'You are finding the single most-talked-about ENTERTAINMENT/culture story for men 25-45 right now (movies, TV, streaming, music, gaming, tech, lifestyle). Avoid celebrity relationship gossip.' + NO_SPORTS + RELEASE_NOTE,
      query: `trending today ${today} movies TV streaming music gaming culture new release`,
    },
    {
      key: 'culture2',
      instruction: 'You are finding a notable movie in theaters, TV episode, streaming drop, album release, or video game launch from today or this week. Avoid celebrity relationship gossip.' + NO_SPORTS + RELEASE_NOTE,
      query: `${today} new movie release OR streaming premiere OR album drop OR video game launch`,
    },
  ];

  if (golf && golf.statusState === 'post' && golf.leaders && golf.leaders[0]) {
    const w = golf.leaders[0];
    jobs.push({
      key: 'golf',
      wantBackground: true,
      instruction: `You are researching ${w.name}'s win at the ${golf.name} (final, ${w.score}). Find the single most important BACKGROUND fact: is this his first career PGA Tour win, his first in N years, a drought-breaker, or a notable milestone? State it specifically.`,
      query: `${w.name} ${golf.name} winner first PGA Tour win years drought ${today}`,
    });
  }

  const settled = await Promise.allSettled(
    jobs.map(j => runSectionSearch(client, j).then(r => ({ key: j.key, r })))
  );

  const out = {};
  const culture = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { key, r } = s.value;
    if (!r || r.no_data) continue;
    if (key === 'golf') out.golf = r;
    else culture.push(r);
  }
  out.culture = culture;
  out.cultureNoData = culture.length === 0;

  // Hero image — single attempt only; generate-brief.js nulls repeats at render time
  if (leadSubject) {
    out.heroImage = await findFreshImage(client, {
      subject: leadSubject, today, issueNum, avoid: prevImageUrls,
      prefer: 'Prefer ESPN CDN for sports subjects, Wikimedia for everything else.',
    });
  }

  console.log(`   ✓ Section research: culture:${culture.length}${out.golf ? ' golf-bg:ok' : ''} hero:${out.heroImage && !out.heroImage.no_data ? 'ok' : 'none'}`);

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL extraction — EXTRACT_MODEL, no thinking, max_uses=1
// ─────────────────────────────────────────────────────────────────────────────

async function runUrlSearch(client, { instruction, query }) {
  const prompt = `${instruction}
Run this web search and use ONLY real results you actually find: ${query}

Return ONLY a single JSON object — no prose, no markdown fence:
{"url":"https://direct-real-working-url"}
If you cannot find a real, working URL, return exactly: {"none":true}`;
  try {
    const messages = [{ role: 'user', content: prompt }];
    const res = await runSearch(client, {
      model: EXTRACT_MODEL, messages, maxTokens: 800, maxUses: 1, useThinking: false,
    });
    const text = getText(res);
    const obj = extractJsonObject(text);
    if (!obj || obj.none === true || !obj.url) return null;
    const url = String(obj.url).trim();
    return /^https?:\/\//.test(url) ? url : null;
  } catch (e) { console.log(`   ⚠  URL search error: ${e.message}`); return null; }
}

// Single-attempt image search — no retry. generate-brief.js nulls any URL that
// repeats the previous issue, so a miss just renders text-only instead of paying
// for a second search call.
async function findFreshImage(client, { subject, today, issueNum, avoid = [], prefer = '' }) {
  const avoidSet = new Set(avoid.filter(Boolean));
  const instr = `Find ONE real, current image of: ${subject}. ${prefer} Prefer a DIRECT image URL (ending in .jpg/.png/.webp), e.g. an upload.wikimedia.org file or an ESPN/Getty photo CDN — NOT a Wikipedia "File:" page and NOT an article/recap page.${avoidSet.size ? ` Do NOT return any of these already-used URLs: ${[...avoidSet].join(' , ')}` : ''}`;
  const q = `${subject} ${today} issue ${issueNum || ''} action photo site:espn.com OR site:en.wikipedia.org image`;

  const raw = await runUrlSearch(client, { instruction: instr, query: q });
  if (!raw) return { no_data: true };
  const valid = await resolveAndValidate(raw);
  if (!valid || avoidSet.has(valid)) return { no_data: true };
  return { url: valid, no_data: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic sports discovery
//   Step 1: discoverSports — SYNTH_MODEL, adaptive thinking, max_uses=2
//   Step 2: per-sport facts + images — EXTRACT_MODEL, no thinking, max_uses=1
//   Step 3: rank by importance; top = The Lead
// ─────────────────────────────────────────────────────────────────────────────

function normalizeCategory(category) {
  return String(category || '').toLowerCase() === 'individual' ? 'individual' : 'team';
}

async function discoverSports(client, today) {
  const prompt = `You are the sports editor of GuyTalk, a daily brief for men 25-45. Today is ${today}.

Run these two web searches and read what comes back:
1. "top sports news today ${today}"
2. "biggest sports stories right now ${today}"

From the results, identify the ${MAX_SPORTS}-${MAX_SPORTS + 2} sports or events ACTUALLY generating the most coverage today — a finished game or series, a live tournament, a major result, or a marquee matchup. Use the real sport/league/tournament/team/athlete names you see.

Rank by how big the story is RIGHT NOW (importance, not recency alone).

For each, set "category":
- "individual" = one or a few competitors you can put a face to (F1, Golf, Tennis, UFC, Boxing, MMA, track, cycling, skiing, NASCAR, etc.)
- "team" = team leagues (NBA, NFL, MLB, NHL, soccer, World Cup, etc.)
When unsure, use "team".

Return ONLY a JSON array (no prose, no markdown fence), most important first:
[{"name":"display name of the sport/event, e.g. 'NBA Finals', 'Stanley Cup Final', 'Roland Garros', 'UFC 312'","category":"individual" | "team"}]`;

  const messages = [{ role: 'user', content: prompt }];
  const res = await runSearch(client, {
    model: SYNTH_MODEL, messages, maxTokens: 3000, maxUses: 2, useThinking: true,
  });
  const text = getText(res);
  const arr = extractJsonArray(text);
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const cand of arr) {
    const name = cand && String(cand.name || '').trim();
    if (!name) continue;
    if (isExcluded(name)) { console.log(`   ⤫  Sports discovery: excluded "${name}" per editorial-config`); continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, category: normalizeCategory(cand.category) });
    if (out.length >= MAX_SPORTS) break;
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

  let candidates = [];
  try { candidates = await discoverSports(client, today); }
  catch (e) { console.log(`   ⚠  Sports discovery failed (non-blocking): ${e.message}`); return empty; }
  if (!candidates.length) { console.log('   ⚠  Sports discovery returned no candidates'); return empty; }
  console.log(`   ✓ Discovered ${candidates.length}: ${candidates.map(c => `${c.name} [${c.category}]`).join(', ')}`);

  const avoid = (prevImageUrls || []).filter(Boolean);
  const isWorldCup = (name) => /world cup|fifa|usmnt|soccer/i.test(name);

  const settled = await Promise.allSettled(candidates.map(async (cand) => {
    const wc = isWorldCup(cand.name);
    const facts = await runSectionSearch(client, {
      instruction: wc
        ? `You are researching today's ${cand.name} for a US daily brief. LEAD with the U.S. men's national team (USMNT) game if they played today — who they beat/lost to and the score — then you may add other notable results in the "fact" as a short trailing clause. If the USMNT did not play, give the single biggest result.`
        : `You are researching today's ${cand.name} for a daily brief. Pull the single most important concrete result/news: who, what happened, the score or outcome, and one key name or number.`,
      query: wc ? `USMNT United States World Cup result today ${today}` : `${cand.name} results highlights news ${today}`,
      wantBackground: true,
    });
    if (!facts || facts.no_data || !facts.fact) return { cand, facts: null };

    let videoUrl = null, imageUrl = null;
    if (cand.category === 'individual') {
      const tasks = [
        ENABLE_HIGHLIGHT_VIDEOS
          ? runUrlSearch(client, {
              instruction: `Find ONE real highlight video of ${cand.name} from ${today}. Only a real video page (YouTube, the official league/tour, or a broadcaster). Never a search page.`,
              query: `${cand.name} highlight video ${today}`,
            })
          : Promise.resolve(null),
        findFreshImage(client, {
          subject: `${cand.name} ${facts.headline || ''} athlete in action`, today, issueNum, avoid,
          prefer: 'Prefer a LANDSCAPE action photo of the specific athlete/driver/fighter from this event. ESPN/Getty/Wikimedia are all fine. NOT a stadium/arena building or logo.',
        }).then(r => (r && !r.no_data ? r.url : null)),
      ];
      [videoUrl, imageUrl] = await Promise.all(tasks);
    } else {
      imageUrl = await findFreshImage(client, {
        subject: `${cand.name} ${facts.headline || ''} players in action`, today, issueNum, avoid,
        prefer: 'Prefer a LANDSCAPE photo of PLAYERS in action from this game/match. ESPN/Getty/Wikimedia are fine. NOT a stadium/arena building exterior, NOT a logo or trophy on a table.',
      }).then(r => (r && !r.no_data ? r.url : null));
    }

    return {
      cand,
      facts,
      sport: {
        name:       cand.name,
        label:      cand.name,
        category:   cand.category,
        headline:   facts.headline || cand.name,
        facts:      facts.fact,
        background: facts.background || '',
        source:     facts.source || '',
        url:        facts.url || '',
        imageUrl:   imageUrl || null,
        videoUrl:   videoUrl || null,
        isLead:     false,
      },
    };
  }));

  const sports = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !s.value || !s.value.sport) continue;
    sports.push(s.value.sport);
  }
  if (!sports.length) {
    console.log('   ⚠  No discovered sport returned concrete facts — sports will fall back to structured feeds');
    return empty;
  }

  const FINAL_RESULT_RE = /\b(final|won|wins|beat|def\.|defeated|clinch|champions?|title|crowned)\b/i;
  sports.forEach((s, i) => {
    const isFinalResult = FINAL_RESULT_RE.test(`${s.headline} ${s.facts}`);
    const { score, tier } = scoreImportance({ name: s.name, headline: s.headline, facts: s.facts, isFinalResult });
    s.importance = score;
    s.tier = tier;
    s._discoveryRank = i;
    s.isLead = false;
  });
  sports.sort((a, b) => (b.importance - a.importance) || (a._discoveryRank - b._discoveryRank));
  sports.forEach(s => { delete s._discoveryRank; });
  sports[0].isLead = true;
  const lead = sports[0];
  console.log(`   ✓ Dynamic sports ranked (${sports.length}): ${sports.map(s => `${s.isLead ? '★ ' : ''}${s.label} [T${s.tier}/${s.importance}]${s.videoUrl ? ' 🎬' : ''}${s.imageUrl ? ' 🖼' : ''}`).join('  ·  ')}`);
  return { lead, sports };
}

module.exports = { fetchTopStories, fetchSectionStories, fetchDynamicSports };

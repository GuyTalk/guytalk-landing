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
// Per-section web research (Change 1) — NHL, F1, Golf, Culture (×2), hero image.
//
// The structured feeds can't see "did the NHL game happen / what's the golf
// leaderboard / what's trending in culture right now". These searches fill that
// in with real, sourced facts so every section is grounded — and, critically,
// flag `no_data: true` when nothing concrete is found, so the editor can hard-
// block an empty section instead of letting the writer invent filler.
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

async function fetchSectionStories({ dateLabel, nhl, f1, golf, leadSubject } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch { return {}; }
  const client = new (Anthropic.default || Anthropic)({ apiKey });

  const today = dateLabel || new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const f1Name   = f1?.name || f1?.shortName || null;
  const golfName = golf?.name || null;

  // Build the job list. Each job runs one web_search call (Change 1 spec).
  const jobs = [];
  jobs.push({ key: 'nhl', instruction: 'You are researching the NHL Stanley Cup Final for a daily brief.',
    query: `NHL Stanley Cup Final ${today} game result OR score OR recap` });

  if (f1Name) jobs.push({ key: 'f1', instruction: 'You are researching the current Formula 1 race weekend. Distinguish a completed session from an upcoming one.',
    query: `Formula 1 ${f1Name} ${today} qualifying result OR race result OR practice` });

  if (golfName) jobs.push({ key: 'golf', instruction: 'You are researching the current PGA Tour golf tournament leaderboard.',
    query: `${golfName} leaderboard ${today} round leader score` });

  jobs.push({ key: 'culture1', instruction: 'You are finding the single most-talked-about sports/entertainment/culture story for men 25-45 right now. Avoid celebrity gossip.',
    query: `trending today ${today} sports entertainment culture viral` });
  jobs.push({ key: 'culture2', instruction: 'You are finding a notable movie, TV, music, or viral culture moment from today. Avoid celebrity relationship gossip.',
    query: `${today} movie news OR celebrity news OR viral clip OR Twitter trending` });

  if (leadSubject) jobs.push({ key: 'heroImage', instruction: 'Find ONE real, current image URL for the subject below. Prefer ESPN CDN for sports subjects, Wikimedia for everything else. The "url" field must be a direct image/page URL.',
    query: `${leadSubject} ${today} site:espn.com OR site:en.wikipedia.org image` });

  const settled = await Promise.allSettled(
    jobs.map(j => runSectionSearch(client, j).then(r => ({ key: j.key, r })))
  );

  const out = {};
  const culture = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { key, r } = s.value;
    if (key === 'culture1' || key === 'culture2') {
      if (r && !r.no_data) culture.push(r);
    } else {
      out[key] = r || { no_data: true };
    }
  }
  out.culture = culture;        // 0–2 sourced culture items
  out.cultureNoData = culture.length === 0;

  const summarize = (k) => out[k]?.no_data ? `${k}:no_data` : `${k}:ok`;
  console.log(`   ✓ Section research: ${['nhl','f1','golf'].filter(k => out[k]).map(summarize).join(' ')} culture:${culture.length} hero:${out.heroImage && !out.heroImage.no_data ? 'ok' : 'none'}`);

  return out;
}

module.exports = { fetchTopStories, fetchSectionStories };

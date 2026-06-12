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

module.exports = { fetchTopStories };

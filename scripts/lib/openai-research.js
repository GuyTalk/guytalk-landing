'use strict';

/**
 * OpenAI research layer — the FIRST editorial step in every brief.
 *
 * Uses OpenAI Responses API with web_search_preview to discover, verify, and rank
 * today's top stories before any copy is written. Replaces the old NewsAPI →
 * Haiku-ranking path, which had zero fact verification.
 *
 * Falls back to null on any error so the caller continues with the old path.
 */

const SEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4o-search-preview';

async function fetchOpenAIResearch({ date, recentIssues = [] } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try { OpenAI = require('openai'); }
  catch (_) { console.log('   ⚠  openai package not installed — research skipped'); return null; }

  const client = new (OpenAI.default || OpenAI)({ apiKey });

  const todayStr = date || new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const recentLeads = recentIssues.map(b => b.sportsThesis || b.lead || '').filter(Boolean).slice(0, 3);
  const avoidLine = recentLeads.length
    ? `\n\nAVOID REPEATING these angles from the last 3 issues:\n${recentLeads.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '';

  const prompt = `Today is ${todayStr}. You are the lead researcher and editor for GuyTalk, a daily brief for men ages 25-45.

Search for the most relevant stories TODAY across all categories. Only include REAL, CONFIRMED stories from trusted sources — never speculation or future projections.

SEARCH (cover all of these):
1. Major sports results today: NBA, NHL, MLB, World Cup 2026, UFC/boxing if a card happened, F1 only if a race is this weekend or just finished, golf only if a tournament is actively in progress
2. Markets/business: biggest market moves and corporate news today
3. Culture: what men 25-45 are actually talking about — major streaming drops, big tech announcements, major music moments, viral mainstream moments. NOT celebrity gossip/relationship drama
4. Current events: major widely-relevant news (political neutrality required)
5. The most genuinely interesting story that fits none of the above

TRUSTED SOURCES (search these specifically):
Sports: ESPN, NBA.com, NHL.com, MLB.com, The Athletic, Front Office Sports
Markets: CNBC, Bloomberg, WSJ, Reuters, Yahoo Finance, MarketWatch
Culture: Variety, Hollywood Reporter, Polygon, IGN, Rolling Stone, Pitchfork
News: AP, Reuters, BBC, Politico, CNN

NEVER include:
- Speculative pages like "Major Events of 2026" or future-event lists
- Future results presented as completed (if you cannot confirm it happened, skip it)
- Horoscopes, custody battles, celebrity dating/divorce/gossip, random tabloid filler
- Stories more than 36 hours old unless still clearly the biggest ongoing story
- Unverified championship wins, deaths, deals, or "record" claims from a single soft source${avoidLine}

SCORING — rate each story 1-5 on:
- freshness: how new/breaking (5=breaking today, 1=3+ days old)
- confidence: how well-sourced (5=multiple Tier-1 outlets confirmed, 1=single vague source)
- conversation: would a 30-year-old guy actually bring this up (5=everyone's talking about it)
- variety: does this fill a category gap in the issue

SELECT 6-9 stories total: 2-4 sports, 1-2 markets/business, 1-2 culture, 0-1 current events. Set isLead:true on the single most important story of the day (may be any category). Include ALL rejected candidates with reasons.

Return ONLY valid JSON (no markdown):
{
  "stories": [
    {
      "id": "category-n",
      "category": "Sports|Markets|Business|Tech|Culture|Current Events|UFC|F1|Golf|World Cup",
      "sport": "NBA|NHL|MLB|UFC|Boxing|F1|Golf|Soccer|World Cup|null",
      "isLead": false,
      "headline": "tight specific headline under 12 words",
      "whatHappened": "1-2 factual sentences with names and real numbers",
      "whyItMatters": "1-2 sentences of non-obvious stakes",
      "guytalkRead": "3-4 sentences — opinionated take grounded only in confirmed facts",
      "context": [
        "specific verifiable fact 1 (number/stat/record)",
        "specific verifiable fact 2",
        "specific verifiable fact 3",
        "specific verifiable fact 4 (optional)"
      ],
      "whatToSay": "one natural line a 30-year-old would actually say at work or a bar",
      "sources": ["https://real-url"],
      "sourceNames": ["ESPN"],
      "scores": { "freshness": 5, "confidence": 5, "conversation": 4, "variety": 4 },
      "selectionReason": "why this story was selected",
      "verificationConcerns": ""
    }
  ],
  "rejectedStories": [
    { "headline": "headline", "reason": "why rejected" }
  ],
  "researchNotes": "brief summary of today's news landscape"
}`;

  try {
    let responseText = '';

    let usedSearch = false;
    if (typeof client.responses?.create === 'function') {
      try {
        const response = await client.responses.create({
          model: SEARCH_MODEL,
          tools: [{ type: 'web_search_preview' }],
          input: prompt,
        });
        // Handle both output_text convenience property and raw output array
        responseText = response.output_text || '';
        if (!responseText && Array.isArray(response.output)) {
          responseText = response.output
            .filter(b => b.type === 'message')
            .flatMap(b => Array.isArray(b.content) ? b.content : [b.content])
            .filter(c => c?.type === 'output_text' || c?.type === 'text')
            .map(c => c.text || c.output_text || '')
            .join('');
        }
        if (responseText) usedSearch = true;
      } catch (searchErr) {
        // 404 = model not available on this account — fall through to Chat Completions
        if (searchErr.status === 404 || searchErr.status === 400 || searchErr.code === 'model_not_found') {
          console.log(`   ⚠  ${SEARCH_MODEL} not available (${searchErr.status || searchErr.code}) — using gpt-4o (no live web search)`);
        } else {
          throw searchErr;
        }
      }
    }

    if (!responseText) {
      // Web search was not available. A Chat Completions call without search would
      // generate plausible-sounding but potentially invented stories — worse than the
      // NewsAPI → Haiku fallback which at least uses real current headlines. Return
      // null so the caller falls back to the trusted NewsAPI path.
      console.log('   ⚠  OpenAI web search unavailable — skipping research (NewsAPI fallback will run)');
      return null;
    }

    // Extract JSON from response (model may prepend/append prose)
    const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no JSON object in OpenAI response');
    const pack = JSON.parse(cleaned.slice(start, end + 1));

    if (!Array.isArray(pack.stories) || !pack.stories.length) {
      throw new Error('research returned no stories');
    }

    // Ensure exactly one isLead
    const hasLead = pack.stories.some(s => s.isLead);
    if (!hasLead) pack.stories[0].isLead = true;

    const lead = pack.stories.find(s => s.isLead) || pack.stories[0];
    console.log(`   ✓ OpenAI Research: ${pack.stories.length} stories — lead: "${(lead.headline || '').slice(0, 55)}"`);
    if (pack.rejectedStories?.length) {
      console.log(`   ↩ Rejected ${pack.rejectedStories.length}: ${pack.rejectedStories.slice(0, 3).map(r => (r.reason || '').slice(0, 40)).join(' | ')}`);
    }

    return {
      ...pack,
      timestamp: new Date().toISOString(),
      searchModel: SEARCH_MODEL,
    };
  } catch (err) {
    console.log(`   ⚠  OpenAI Research failed: ${err.message} — falling back to NewsAPI path`);
    return null;
  }
}

module.exports = { fetchOpenAIResearch };

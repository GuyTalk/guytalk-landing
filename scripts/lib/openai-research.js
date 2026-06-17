'use strict';

/**
 * OpenAI research layer — the FIRST editorial step in every brief.
 *
 * Uses the OpenAI Responses API with the web_search_preview tool so the model
 * actually searches the web before selecting stories.
 *
 * Confirmed working model: gpt-4.1 via client.responses.create()
 * NOT available on this account: gpt-4o-search-preview, gpt-4o-mini-search-preview
 *
 * Returns a researchPack object when web search succeeds, null otherwise.
 * Callers must treat null as "feed-only mode" — do NOT fall back to Chat
 * Completions without search (that produces plausible-sounding invented stories).
 */

const SEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1';

async function fetchOpenAIResearch({ date, recentIssues = [] } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try { OpenAI = require('openai'); }
  catch (_) { console.log('   ⚠  openai package not installed — research skipped'); return null; }

  const client = new (OpenAI.default || OpenAI)({ apiKey });

  if (typeof client.responses?.create !== 'function') {
    console.log('   ⚠  OpenAI Responses API not available in this SDK version — research skipped');
    return null;
  }

  const todayStr = date || new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const recentLeads = recentIssues.map(b => b.sportsThesis || b.lead || '').filter(Boolean).slice(0, 3);
  const avoidLine = recentLeads.length
    ? `\n\nAVOID REPEATING these angles from the last 3 issues:\n${recentLeads.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '';

  const prompt = `Today is ${todayStr}. You are the lead researcher and editor for GuyTalk, a daily brief for men ages 25-45.

Search the web for the most important stories happening TODAY. Only include REAL, CONFIRMED events from trusted sources — never speculation, future projections, or "major events of 2026"-style pages.

SEARCH (cover all of these with actual web searches):
1. Major sports results from the last 24 hours: NBA, NHL, MLB, World Cup 2026, UFC/boxing if a card happened, F1 if a race just finished or is this weekend, golf if a major tournament is in progress
2. Markets/business: biggest market moves and corporate news today
3. Culture: what men 25-45 are actually talking about — major streaming drops, big tech announcements, major music moments, viral mainstream moments. NOT celebrity gossip/relationship drama/horoscopes/custody battles
4. Current events: major widely-relevant news (political neutrality required)
5. The most genuinely interesting story that fits none of the above

TRUSTED SOURCES (search these specifically):
Sports: ESPN, NBA.com, NHL.com, MLB.com, The Athletic, Front Office Sports
Markets: CNBC, Bloomberg, WSJ, Reuters, Yahoo Finance, MarketWatch
Culture: Variety, Hollywood Reporter, Polygon, IGN, Rolling Stone, Pitchfork
News: AP, Reuters, BBC, Politico, CNN

NEVER include:
- Speculative pages like "Major Events of 2026" or future-event lists
- Britannica, Wikipedia "in this year" articles
- Future results presented as completed (if you cannot confirm it happened, skip it)
- Horoscopes, custody battles, celebrity dating/divorce/gossip, tabloid filler
- Stories more than 36 hours old unless clearly the biggest ongoing story
- Unverified championship wins, deaths, deals, or "record" claims from a single soft source${avoidLine}

SCORING — rate each story 1-5:
- freshness: how new/breaking (5=confirmed today, 1=3+ days old)
- confidence: how well-sourced (5=multiple Tier-1 outlets confirmed, 1=single vague source)
- conversation: would a 30-year-old guy actually bring this up
- variety: does this fill a category gap in the issue

SELECT 6-9 stories total: 2-4 sports, 1-2 markets/business, 1-2 culture, 0-1 current events. Set isLead:true on the single biggest story of the day. Include ALL rejected candidates with reasons.

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
      "sources": ["https://real-url-you-actually-found"],
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
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
      max_output_tokens: 6000,
    });

    // Extract text from response (handle both output_text shorthand and raw output array)
    let responseText = response.output_text || '';
    if (!responseText && Array.isArray(response.output)) {
      responseText = response.output
        .filter(b => b.type === 'message')
        .flatMap(b => Array.isArray(b.content) ? b.content : [b.content])
        .filter(c => c?.type === 'output_text' || c?.type === 'text')
        .map(c => c.text || c.output_text || '')
        .join('');
    }

    if (!responseText) throw new Error('empty response from OpenAI Responses API');

    // Extract JSON from response (model may prepend/append prose, or truncate)
    const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf('{');
    if (start < 0) throw new Error('no JSON object in response');
    const end = cleaned.lastIndexOf('}');
    if (end <= start) throw new Error('no closing brace in response');

    let pack;
    try {
      pack = JSON.parse(cleaned.slice(start, end + 1));
    } catch (parseErr) {
      // Partial truncation recovery: find the last complete story object
      const storiesStart = cleaned.indexOf('"stories"', start);
      const arrStart     = cleaned.indexOf('[', storiesStart);
      if (storiesStart < 0 || arrStart < 0) throw parseErr;
      // Walk backwards from the parse error to find the last complete object
      let body = cleaned.slice(arrStart);
      const lastClose = body.lastIndexOf('}');
      if (lastClose < 0) throw parseErr;
      body = body.slice(0, lastClose + 1) + ']';
      try {
        const stories = JSON.parse(body);
        if (!Array.isArray(stories) || !stories.length) throw parseErr;
        console.log(`   ⚠  JSON truncated — recovered ${stories.length} complete stories`);
        pack = { stories, rejectedStories: [], researchNotes: 'response truncated' };
      } catch (_) {
        throw parseErr;
      }
    }

    if (!Array.isArray(pack.stories) || !pack.stories.length) {
      throw new Error('research returned no stories');
    }

    // Ensure exactly one isLead
    const hasLead = pack.stories.some(s => s.isLead);
    if (!hasLead) pack.stories[0].isLead = true;

    const lead = pack.stories.find(s => s.isLead) || pack.stories[0];
    console.log(`   ✓ OpenAI research active (${SEARCH_MODEL} + web search): ${pack.stories.length} stories — lead: "${(lead.headline || '').slice(0, 55)}"`);
    if (pack.rejectedStories?.length) {
      console.log(`   ↩ Rejected ${pack.rejectedStories.length}: ${pack.rejectedStories.slice(0, 3).map(r => (r.reason || '').slice(0, 40)).join(' | ')}`);
    }

    return {
      ...pack,
      timestamp: new Date().toISOString(),
      searchModel: SEARCH_MODEL,
      searchActive: true,
    };
  } catch (err) {
    // Distinguish model-not-found from other errors (useful for diagnosing account issues)
    const is404 = err.status === 404 || err.code === 'model_not_found';
    if (is404) {
      console.log(`   ✗ OpenAI research unavailable: ${SEARCH_MODEL} returned 404 (model not on this account)`);
    } else {
      console.log(`   ✗ OpenAI research failed: ${err.message}`);
    }
    console.log('   📋 Running in feed-only mode — ESPN + filtered NewsAPI only');
    return null;
  }
}

module.exports = { fetchOpenAIResearch };

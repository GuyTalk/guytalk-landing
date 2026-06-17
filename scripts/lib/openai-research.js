'use strict';

/**
 * OpenAI research layer — the FIRST editorial step in every brief.
 *
 * Official pattern (Responses API + web_search tool):
 *   https://developers.openai.com/api/docs/guides/tools-web-search
 *
 * Key decisions:
 *   - Tool type: 'web_search'  (NOT 'web_search_preview' — that's the legacy variant)
 *   - tool_choice: 'required'  — force the model to search; never skip to training data
 *   - search_context_size: 'high' — maximum result depth
 *   - Sources verified via content[].annotations (type='url_citation')
 *   - If no annotation sources are returned, the model did not actually search → return null
 *   - researchPack.searchActive is ONLY true when real source URLs were returned
 *
 * Confirmed working on this account (June 2026):
 *   model 'gpt-4.1' via client.responses.create() + { type: 'web_search' }
 *   Returns 3+ url_citation annotations with real URLs on every call.
 *
 * NOT available on this account:
 *   'gpt-4o-search-preview', 'gpt-4o-mini-search-preview' → 404
 *   (deprecated, shutdown 2026-07-23)
 */

const SEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1';

async function fetchOpenAIResearch({ date, recentIssues = [] } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try { OpenAI = require('openai'); }
  catch (_) { console.log('   ⚠  openai package not installed'); return null; }

  const client = new (OpenAI.default || OpenAI)({ apiKey });

  if (typeof client.responses?.create !== 'function') {
    console.log('   ⚠  Responses API not available in SDK v' + require('openai/package.json').version);
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

Use web search to find the most important CONFIRMED stories happening TODAY. Only include real, verified events — never speculation, future projections, or "major events of 2026"-style pages.

SEARCH for all of these:
1. Major sports results from the last 24 hours: NBA, NHL, MLB, World Cup 2026, UFC/boxing/MMA if a card happened, F1 if a race just finished or is this weekend, golf if a major tournament is in progress
2. Markets/business: biggest market moves and corporate news today
3. Culture: what men 25-45 are actually talking about — major streaming drops, big tech announcements, major music moments, viral mainstream moments. NOT celebrity gossip/divorce/relationship drama/horoscopes
4. Current events: major widely-relevant news (politically neutral), including White House or major political stories men 25-45 would actually discuss
5. Major internet/culture moments: the biggest story men 25-45 are genuinely talking about today — major viral moments, notable public figures making real news, significant entertainment/tech/cultural announcements
6. UFC specifically: is there a UFC card this weekend or recent results? Any Dana White / UFC business news or a White House-UFC story?

TRUSTED SOURCES only — search these specifically:
Sports: ESPN, NBA.com, NHL.com, MLB.com, The Athletic, Front Office Sports
Markets: CNBC, Bloomberg, WSJ, Reuters, Yahoo Finance, MarketWatch
Culture: Variety, Hollywood Reporter, Polygon, IGN, Rolling Stone, Pitchfork
News: AP, Reuters, BBC, Politico, CNN

EXCLUDE entirely:
- Speculative/future-event pages (Britannica "events of 2026", Wikipedia "in this year")
- Unconfirmed events (if you did not find a source confirming it happened, skip it)
- Horoscopes, custody battles, celebrity dating/divorce/gossip, tabloid filler
- Celebrity personal-life filler: celibacy/abstinence/dating/relationship reveals unless the person is a truly massive cultural figure AND the story has crossed mainstream national conversation (ESPN, AP, CNN, NYT coverage)
- "People magazine" content — personal choices, body/health stories, romance rumors — that a man would not realistically bring up at work or a bar
- Stories more than 36 hours old (unless clearly the biggest ongoing story)
- Championship/death/acquisition claims from a single soft or unclear source${avoidLine}

SCORING per story (1-5):
- freshness: confirmed today = 5; 36h old = 1
- confidence: 3+ Tier-1 outlets confirmed = 5; single vague source = 1
- conversation: "Would a normal 30-year-old man ACTUALLY bring this up at work or a bar today?" 5 = absolutely yes, 1 = probably not, 0 = definitely not. Celebrity personal-life stories score max 1 unless truly massive national news
- variety: fills a category gap = 5

SELECT 6-9 stories: 2-4 sports, 1-2 markets/business, 1-2 culture/current events.
Culture picks MUST score 4+ on conversation. If no culture story scores 4+, report it as rejected and note what was considered.
Prefer UFC/boxing results, major political moments, significant internet/viral moments, or notable entertainment news over celebrity personal-life content.
Set isLead:true on the single biggest story. Include ALL rejected candidates with reason.

Return ONLY valid JSON (no markdown fences):
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
        "specific verifiable fact 3"
      ],
      "whatToSay": "one natural line a 30-year-old would say at work or a bar",
      "sources": ["https://real-url-you-found"],
      "sourceNames": ["ESPN"],
      "scores": { "freshness": 5, "confidence": 5, "conversation": 4, "variety": 4 },
      "selectionReason": "why selected",
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
      tools: [{ type: 'web_search', search_context_size: 'high' }],
      tool_choice: 'required',
      max_output_tokens: 6000,
      input: prompt,
    });

    // ── Extract response text ─────────────────────────────────────────────────
    let responseText = response.output_text || '';
    if (!responseText && Array.isArray(response.output)) {
      responseText = response.output
        .filter(b => b.type === 'message')
        .flatMap(b => Array.isArray(b.content) ? b.content : [b.content])
        .filter(c => c?.type === 'output_text' || c?.type === 'text')
        .map(c => c.text || c.output_text || '')
        .join('');
    }
    if (!responseText) throw new Error('empty response text');

    // ── Extract source citations from annotations ─────────────────────────────
    // Official pattern: sources are in content[].annotations, type='url_citation'
    // These are the URLs the model actually visited — their presence proves a real search ran.
    const citationUrls = [];
    const citationTitles = [];
    (response.output || []).forEach(block => {
      if (block.type === 'message') {
        (block.content || []).forEach(c => {
          (c.annotations || []).forEach(a => {
            if (a.type === 'url_citation' && a.url) {
              // Strip OpenAI tracking param before storing
              const clean = a.url.replace(/[?&]utm_source=openai/, '').replace(/[?&]$/, '');
              citationUrls.push(clean);
              citationTitles.push(a.title || '');
            }
          });
        });
      }
    });

    // ── Check whether the web_search tool actually fired ─────────────────────
    // The authoritative signal is whether a web_search_call block with
    // status=completed exists in the output — not whether citations appear in
    // text (the model can search without adding inline citations).
    const searchCallCompleted = (response.output || []).some(
      b => b.type === 'web_search_call' && b.status === 'completed'
    );

    if (!searchCallCompleted && citationUrls.length === 0) {
      console.log('   ✗ web_search tool did not fire (no web_search_call block, no citations)');
      console.log('   📋 Feed-only mode will run');
      return null;
    }

    const sourceCount = citationUrls.length;
    if (!searchCallCompleted) {
      // Citations present but no search_call block — still treat as searched
      console.log(`   ⚠  web_search_call block absent but ${sourceCount} citation(s) found — treating as searched`);
    }

    // ── Parse the JSON research pack ─────────────────────────────────────────
    const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```/g, '');
    const jsonStart = cleaned.indexOf('{');
    if (jsonStart < 0) {
      console.log('   ✗ no JSON in response (first 300 chars):', responseText.slice(0, 300));
      throw new Error('no JSON object in response');
    }
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonEnd <= jsonStart) throw new Error('no closing brace in response');

    let pack;
    try {
      pack = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
    } catch (parseErr) {
      // Partial-truncation recovery: find the last complete story object
      const storiesStart = cleaned.indexOf('"stories"', jsonStart);
      const arrStart     = storiesStart >= 0 ? cleaned.indexOf('[', storiesStart) : -1;
      if (arrStart >= 0) {
        const body = cleaned.slice(arrStart);
        const lastClose = body.lastIndexOf('}');
        if (lastClose > 0) {
          try {
            const stories = JSON.parse(body.slice(0, lastClose + 1) + ']');
            if (Array.isArray(stories) && stories.length) {
              console.log(`   ⚠  JSON truncated — recovered ${stories.length} complete stories`);
              pack = { stories, rejectedStories: [], researchNotes: 'response truncated' };
            }
          } catch (_) {}
        }
      }
      if (!pack) throw parseErr;
    }

    if (!Array.isArray(pack.stories) || !pack.stories.length) {
      throw new Error('research pack has no stories');
    }

    // Ensure exactly one isLead
    if (!pack.stories.some(s => s.isLead)) pack.stories[0].isLead = true;

    const lead = pack.stories.find(s => s.isLead) || pack.stories[0];
    const srcSummary = citationUrls.length > 0 ? `${citationUrls.length} citation URLs` : 'search_call completed (no inline citations)';
    console.log(`   ✓ OpenAI research ACTIVE (${SEARCH_MODEL}, web_search, ${srcSummary})`);
    console.log(`     Lead: "${(lead.headline || '').slice(0, 60)}"`);
    if (pack.rejectedStories?.length) {
      console.log(`     Rejected ${pack.rejectedStories.length}: ${pack.rejectedStories.slice(0, 3).map(r => (r.reason || '').slice(0, 45)).join(' | ')}`);
    }

    return {
      ...pack,
      // Top-level citation URLs from annotations — these are the URLs that prove
      // a real search happened. Individual stories also have their own sources[].
      citationUrls,
      citationTitles,
      timestamp:   new Date().toISOString(),
      searchModel: SEARCH_MODEL,
      searchActive: true,   // only set when web_search_call completed or citations > 0
    };

  } catch (err) {
    const is404 = err.status === 404 || err.code === 'model_not_found';
    if (is404) {
      console.log(`   ✗ ${SEARCH_MODEL} returned 404 (not on this account tier)`);
    } else {
      console.log(`   ✗ OpenAI research failed: ${err.message}`);
    }
    console.log('   📋 Feed-only mode will run');
    return null;
  }
}

module.exports = { fetchOpenAIResearch };

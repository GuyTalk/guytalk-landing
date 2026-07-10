'use strict';

/**
 * GuyTalk — Social Pulse refresher.
 *
 * Uses OpenAI web search to find the 3-5 most notable social media moments
 * from the last 24 hours: CEO tweets, athlete posts, viral cultural moments
 * that men 25-45 are talking about.
 *
 * Commits to brief/data/live-social.json via GitHub API.
 * Called by GitHub Actions workflow every 2 hours.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_PAT     = process.env.GITHUB_PAT;
const CRON_SECRET    = process.env.CRON_SECRET;
const GH_OWNER       = 'GuyTalk';
const GH_REPO        = 'guytalk-landing';
const FILE_PATH      = 'brief/data/live-social.json';

function ghFetch(apiPath, opts = {}) {
  return fetch(`https://api.github.com${apiPath}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'GuyTalk-Social-Cron',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

async function fetchSocialMoments() {
  const { default: OpenAI } = await import('openai').catch(() => ({ default: require('openai') }));
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const resp = await client.responses.create({
    model: 'gpt-4.1',
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    input: `Today is ${today}. Search X (Twitter) and news sites for the 4-5 most viral posts, tweets, or public statements from the LAST 6 HOURS that men 25-45 are talking about. Prioritize by virality — what is actually trending or blowing up right now.

Search specifically for:
- Viral tweets from CEOs, executives, athletes, coaches, public figures (high retweet/like counts)
- Trending topics on X right now and the post that sparked them
- Athletes posting breaking news (trades, signings, injuries) directly on X
- Outrageous or surprising things a public figure just said publicly
- Viral moments in sports, business, finance, tech, or culture from today
- Any X post that has gone viral in the last few hours (100k+ likes, major media pickup)

Respond ONLY with a valid JSON array (no markdown, no code fences):
[
  {
    "platform": "X",
    "author": "Full Name",
    "handle": "@handle",
    "quote": "The actual quote or as close a paraphrase as possible (max 200 chars, keep it punchy)",
    "why": "One sharp sentence: why this is blowing up / what it actually means.",
    "url": "Direct link to tweet or best news coverage of it",
    "timestamp": "ISO 8601 time if known, else today's date"
  }
]

Rules:
- PRIORITIZE posts from the last 6 hours; fall back to last 24h if needed
- Never invent a quote — only verifiable real statements
- Return 4-5 items; 3 minimum if you cannot find enough
- Rank by cultural impact — what are guys actually talking about right now?
- If you cannot verify ANY real posts (e.g. X search results are unreliable or stale), respond with an empty JSON array \`[]\`. Never respond with prose, an explanation, or a refusal — ONLY ever a JSON array, even when it's empty.
`,
  });

  const text = (resp.output_text || '').trim();
  // Strip markdown code fences if model included them
  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let moments;
  try {
    moments = JSON.parse(clean);
    if (!Array.isArray(moments)) throw new Error('not array');
  } catch (_) {
    // Try extracting first [...] block
    const m = clean.match(/\[[\s\S]*\]/);
    if (m) {
      moments = JSON.parse(m[0]);
    } else {
      // Model refused/explained in prose instead of returning JSON (X search is
      // unreliable for real-time content) — fail open with 0 moments rather than
      // 500ing the whole cron. See guytalk_incident_071026 memory.
      console.warn('[refresh-social] model returned non-JSON prose instead of an array:', text.slice(0, 200));
      moments = [];
    }
  }

  return moments.filter(
    (m) => m && typeof m.author === 'string' && typeof m.quote === 'string'
  ).slice(0, 5);
}

async function commitFile(data) {
  const content = JSON.stringify({ moments: data, fetchedAt: new Date().toISOString() }, null, 2);
  const apiUrl  = `/repos/${GH_OWNER}/${GH_REPO}/contents/${FILE_PATH}`;
  let sha;
  const getRes = await ghFetch(`${apiUrl}?ref=main`);
  if (getRes.ok) { sha = (await getRes.json())?.sha; }

  const body = {
    message: `chore: refresh Social Pulse (${new Date().toISOString()})`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: 'main',
    ...(sha ? { sha } : {}),
  };
  const putRes = await ghFetch(apiUrl, { method: 'PUT', body: JSON.stringify(body) });
  if (!putRes.ok) {
    const err = await putRes.text().catch(() => '');
    throw new Error(`GitHub PUT failed ${putRes.status}: ${err}`);
  }
}

module.exports = async function handler(req, res) {
  // Optional CRON_SECRET guard
  const auth = req.headers['x-cron-secret'] || req.query.secret;
  if (CRON_SECRET && auth !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  if (!GITHUB_PAT)     return res.status(500).json({ error: 'GITHUB_PAT not set' });

  try {
    const moments = await fetchSocialMoments();
    if (!moments.length) {
      // Nothing verifiable this cycle — leave the existing live-social.json alone
      // rather than overwriting good data with an empty list.
      return res.json({ ok: true, count: 0, skipped: true, fetchedAt: new Date().toISOString() });
    }
    await commitFile(moments);
    return res.json({ ok: true, count: moments.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[refresh-social]', err);
    return res.status(500).json({ error: err.message });
  }
};

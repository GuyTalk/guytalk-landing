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
    input: `Today is ${today}. Search for the 4-5 most notable social media posts, tweets, or public statements from the LAST 24 HOURS that men 25-45 would be talking about. Focus on:
- CEO/executive tweets or public statements that moved markets or sparked debate
- Athletes, coaches, or team accounts posting something notable
- Viral moments in sports, business, finance, or culture
- Major company announcements made via social media
- Controversial or surprising things public figures said publicly

For each, return a JSON object. Respond ONLY with a valid JSON array (no markdown, no code fences):
[
  {
    "platform": "X",
    "author": "Full Name",
    "handle": "@handle",
    "quote": "The actual quote or close paraphrase of what they said (max 180 chars)",
    "why": "One sentence: why this is worth knowing / what it signals.",
    "url": "Best URL to the post or coverage of it",
    "timestamp": "ISO 8601 approximate time if known, else today's date"
  }
]

Rules:
- ONLY include moments from the last 24 hours — nothing older
- Each item must have a real person/account and real quote or verifiable statement
- No speculation — only things that actually happened and are publicly documented
- Return 3-5 items maximum
- If you cannot find enough real recent social moments, return fewer items rather than inventing
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
    if (m) moments = JSON.parse(m[0]);
    else throw new Error('Could not parse social moments JSON');
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
    await commitFile(moments);
    return res.json({ ok: true, count: moments.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[refresh-social]', err);
    return res.status(500).json({ error: err.message });
  }
};

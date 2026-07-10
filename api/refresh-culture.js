// Vercel cron — refreshes the Live page's Culture section.
//
// Fetches the top entertainment headlines (pageSize 8) from NewsAPI, maps each to
// { headline, source, url, summary } (summary = description, truncated to 200
// chars), and commits them to brief/data/live-culture.json via the GitHub API.
// api/live.js then serves that file under the `culture` key.
//
// Schedule: a daily Vercel cron runs this as a backstop (Hobby plan forbids
// sub-daily crons); a GitHub Actions workflow hits the endpoint every 4h for
// true freshness. See .github/workflows/refresh-culture.yml + vercel.json.
//
// Why a git commit instead of writing the file directly: Vercel functions run on
// a read-only filesystem and the cron + live.js are separate lambdas, so a written
// file can't be shared. Committing to the repo (which Vercel auto-deploys) is the
// no-extra-infra way to persist it. Reuses GITHUB_PAT (already set for approve.js).

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GITHUB_PAT   = process.env.GITHUB_PAT;
const CRON_SECRET  = process.env.CRON_SECRET; // optional — Vercel sends it if set
const GH_OWNER     = 'GuyTalk';
const GH_REPO      = 'guytalk-landing';
const FILE_PATH    = 'brief/data/live-culture.json';

const MAX_SUMMARY = 200; // chars; NewsAPI descriptions can run long

function ghFetch(apiPath, opts = {}) {
  return fetch(`https://api.github.com${apiPath}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'GuyTalk-Culture-Cron',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

// description → summary, trimmed to MAX_SUMMARY chars (with an ellipsis so the
// cut never lands mid-thought past the limit).
function toSummary(desc) {
  const t = String(desc || '').trim();
  return t.length > MAX_SUMMARY ? `${t.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : t;
}

// Use Claude to add a "why it matters" field to each story — 1-2 sentences
// written for men 25-45, specific and contextual, not generic hype.
async function enrichStories(stories) {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY || !stories.length) return stories;
  let AnthropicSDK;
  try { AnthropicSDK = require('@anthropic-ai/sdk'); } catch (_) { return stories; }
  try {
    const client = new (AnthropicSDK.default || AnthropicSDK)({ apiKey: ANTHROPIC_API_KEY });
    const storyList = stories.map((s, i) =>
      `${i + 1}. ${s.headline}\n   Summary: ${s.summary}`
    ).join('\n\n');
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `For each of these entertainment/culture headlines, write a "why it matters" for men ages 25-45. Be specific — who this person is, why this moment is culturally significant, what it signals. NOT generic hype. 1-2 punchy sentences each. Return ONLY a JSON array in the same order: [{"why":"..."}, ...]\n\n${storyList}`,
      }],
    });
    const text = (msg.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```/g, '');
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    if (s < 0 || e < 0) return stories;
    const whys = JSON.parse(text.slice(s, e + 1));
    return stories.map((st, i) => ({ ...st, why: whys[i]?.why || '' }));
  } catch (e) {
    console.error('[refresh-culture] enrichStories failed:', e?.message || e);
    return stories;
  }
}

// Use OpenAI web search to find real recent X (Twitter) posts about the top stories.
async function fetchSocialMoments(stories) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY || !stories.length) return null;
  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return null; }
  try {
    const client = new (OpenAI.default || OpenAI)({ apiKey: OPENAI_API_KEY });
    const topStories = stories.slice(0, 3).map(s => s.headline).join('; ');
    const response = await client.responses.create({
      model: 'gpt-4.1',
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
      max_output_tokens: 800,
      input: `Find 2-3 recent viral X (Twitter) posts from verified public figures or journalists about these entertainment stories: ${topStories}. For each return: platform="X", author name, @handle, verbatim quote from the post, why it sparked conversation (1 sentence). IMPORTANT: Do NOT generate or guess tweet URLs — they will 404. For url: if you found the actual tweet URL from search results use it, otherwise leave url as empty string "". Never invent a /status/ URL. Return ONLY JSON array: [{"platform":"X","author":"...","handle":"@...","quote":"verbatim text of tweet","why":"one sentence why it went viral","url":""}]`,
    });
    let text = response.output_text || '';
    if (!text && Array.isArray(response.output)) {
      text = response.output.filter(b => b.type === 'message').flatMap(b => b.content || [])
        .filter(c => c.type === 'output_text' || c.type === 'text').map(c => c.text || '').join('');
    }
    if (!text) return null;
    text = text.replace(/```json\s*/gi, '').replace(/```/g, '');
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    if (s < 0 || e < 0) return null;
    const moments = JSON.parse(text.slice(s, e + 1));
    return Array.isArray(moments) && moments.length ? { moments, fetchedAt: new Date().toISOString() } : null;
  } catch (_) {
    return null;
  }
}

// Top entertainment headlines for the Live "culture" section. Maps each article
// to { category, headline, source, url, summary }. category is fixed to
// "Entertainment" so the story card keeps its label; the other four are the
// fields the spec requires.
async function fetchHeadlines() {
  const res = await fetch(
    `https://newsapi.org/v2/top-headlines?category=entertainment&language=en&pageSize=8&apiKey=${NEWS_API_KEY}`,
    { headers: { 'User-Agent': 'GuyTalk-Culture-Cron' } }
  );
  if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
  const json = await res.json();
  return (json.articles || [])
    .filter((a) => a.title && a.title !== '[Removed]')
    .map((a) => ({
      category: 'Entertainment',
      headline: a.title,
      source:   a.source?.name || '',
      url:      a.url || '',
      summary:  toSummary(a.description),
    }));
}

// Create-or-update brief/data/live-culture.json on main via the GitHub API.
async function commitFile(contentStr) {
  const apiUrl = `/repos/${GH_OWNER}/${GH_REPO}/contents/${FILE_PATH}`;
  let sha;
  const getRes = await ghFetch(`${apiUrl}?ref=main`);
  if (getRes.ok) { sha = (await getRes.json())?.sha; }

  const putRes = await ghFetch(apiUrl, {
    method: 'PUT',
    body: JSON.stringify({
      message: `chore: refresh Live culture headlines (${new Date().toISOString()})`,
      content: Buffer.from(contentStr, 'utf8').toString('base64'),
      branch: 'main',
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    throw new Error(`GitHub PUT failed (HTTP ${putRes.status}) ${body}`.trim());
  }
}

// Trigger GitHub Actions workflow_dispatch (used when running as the 7am brief cron).
async function triggerBrief() {
  if (!GITHUB_PAT) return { ok: false, error: 'GITHUB_PAT not set' };
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/generate-brief.yml/dispatches`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  return resp.status === 204 ? { ok: true } : { ok: false, status: resp.status };
}

module.exports = async (req, res) => {
  // Optional guard: if CRON_SECRET is configured, require Vercel's bearer token.
  if (CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${CRON_SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  }
  if (!GITHUB_PAT) { res.status(500).json({ error: 'GITHUB_PAT not set in Vercel env' }); return; }

  // At 11 UTC (7am ET) also fire the brief generation workflow.
  const shouldTriggerBrief = new Date().getUTCHours() === 11;
  const briefResult = shouldTriggerBrief ? await triggerBrief() : null;

  if (!NEWS_API_KEY) {
    return res.status(200).json({ ok: true, brief: briefResult, skipped: 'NEWS_API_KEY not set' });
  }

  let stories;
  try { stories = await fetchHeadlines(); }
  catch (err) { return res.status(502).json({ error: `NewsAPI fetch failed: ${err.message}`, brief: briefResult }); }

  // Never overwrite the live file with nothing — keep the last good copy.
  if (!stories.length) { return res.status(200).json({ ok: true, brief: briefResult, skipped: 'no usable headlines' }); }

  // Enrich stories with AI "why it matters" + fetch social moments in parallel
  const [enriched, social] = await Promise.all([
    enrichStories(stories),
    fetchSocialMoments(stories),
  ]);

  const payload = JSON.stringify(
    { updatedAt: new Date().toISOString(), source: 'newsapi', stories: enriched, ...(social ? { social } : {}) },
    null, 2
  );
  try { await commitFile(payload); }
  catch (err) { return res.status(502).json({ error: `commit failed: ${err.message}`, brief: briefResult }); }

  res.status(200).json({ ok: true, count: stories.length, brief: briefResult });
};

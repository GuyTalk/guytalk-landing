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

  const payload = JSON.stringify(
    { updatedAt: new Date().toISOString(), source: 'newsapi', stories },
    null, 2
  );
  try { await commitFile(payload); }
  catch (err) { return res.status(502).json({ error: `commit failed: ${err.message}`, brief: briefResult }); }

  res.status(200).json({ ok: true, count: stories.length, brief: briefResult });
};

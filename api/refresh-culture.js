// Vercel cron — refreshes the Live page's Culture/Trending section.
//
// Runs every 4 hours (see vercel.json crons). Fetches the top US headlines from
// NewsAPI across business / entertainment / technology / sports, picks the top 6
// (round-robin across categories for variety), and commits them to
// brief/data/live-culture.json via the GitHub API. api/live.js then serves that
// file as `trending`.
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

const CATEGORIES = ['business', 'entertainment', 'technology', 'sports'];
const CAT_LABEL  = { business: 'Business', entertainment: 'Entertainment', technology: 'Technology', sports: 'Sports' };

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

// Fetch each category, tag the articles, round-robin into a top-6 with variety.
async function fetchHeadlines() {
  const byCat = {};
  await Promise.all(CATEGORIES.map(async (cat) => {
    byCat[cat] = [];
    try {
      const res = await fetch(
        `https://newsapi.org/v2/top-headlines?country=us&category=${cat}&pageSize=5&apiKey=${NEWS_API_KEY}`,
        { headers: { 'User-Agent': 'GuyTalk-Culture-Cron' } }
      );
      if (!res.ok) return;
      const json = await res.json();
      (json.articles || []).forEach((a) => {
        if (!a.title || a.title === '[Removed]') return;
        byCat[cat].push({
          category: CAT_LABEL[cat],
          headline: a.title,
          summary:  a.description || '',
          url:      a.url || '',
          source:   a.source?.name || '',
        });
      });
    } catch (_) { /* skip this category */ }
  }));

  // Round-robin across categories so all four are represented in the top 6.
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < 6; i++) {
    let added = false;
    for (const cat of CATEGORIES) {
      const item = byCat[cat][i];
      if (!item) continue;
      const key = item.headline.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      added = true;
      if (out.length >= 6) break;
    }
    if (!added) break; // no category has an item at this index — done
  }
  return out;
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

module.exports = async (req, res) => {
  // Optional guard: if CRON_SECRET is configured, require Vercel's bearer token.
  if (CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${CRON_SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  }
  if (!NEWS_API_KEY) { res.status(500).json({ error: 'NEWS_API_KEY not set in Vercel env' }); return; }
  if (!GITHUB_PAT)   { res.status(500).json({ error: 'GITHUB_PAT not set in Vercel env' }); return; }

  let stories;
  try { stories = await fetchHeadlines(); }
  catch (err) { res.status(502).json({ error: `NewsAPI fetch failed: ${err.message}` }); return; }

  // Never overwrite the live file with nothing — keep the last good copy.
  if (!stories.length) { res.status(200).json({ ok: true, skipped: 'no usable headlines' }); return; }

  const payload = JSON.stringify(
    { updatedAt: new Date().toISOString(), source: 'newsapi', stories },
    null, 2
  );
  try { await commitFile(payload); }
  catch (err) { res.status(502).json({ error: `commit failed: ${err.message}` }); return; }

  res.status(200).json({ ok: true, count: stories.length });
};

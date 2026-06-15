// Vercel serverless function — GuyTalk brief PREVIEW endpoint
//
//   GET /api/preview?token=TOKEN → renders the not-yet-published brief
//
// The brief lives only on the `pending` branch until approval, and the project
// builds ONLY the production branch (no Vercel preview deploy of `pending`), so
// /brief/issue-NNN/ 404s pre-approval. This endpoint serves the already-built
// brief HTML straight from `pending` over the GitHub API — and because it's
// served from the production domain, the brief's absolute asset references
// (/assets/brief.css, font + image URLs) all resolve. Lets Jake read the full
// brief on his phone BEFORE tapping "Send to subscribers". Read-only: it never
// publishes or sends anything.

const crypto = require('crypto');

const APPROVAL_TOKEN = process.env.APPROVAL_TOKEN;
const GITHUB_PAT     = process.env.GITHUB_PAT;
const GH_OWNER       = 'GuyTalk';
const GH_REPO        = 'guytalk-landing';
const STAGE_BRANCH   = 'pending';

function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function ghFetch(apiPath, opts = {}) {
  return fetch(`https://api.github.com${apiPath}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'GuyTalk-Preview',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

// Latest issue slug staged on `pending` (mirrors approve.js).
async function getLatestSlug() {
  const listRes = await ghFetch(`/repos/${GH_OWNER}/${GH_REPO}/contents/brief/data?ref=${STAGE_BRANCH}`);
  if (!listRes.ok) return null;
  const files = await listRes.json();
  if (!Array.isArray(files)) return null;
  const issues = files
    .map(f => f && f.name)
    .filter(n => /^issue-\d{3}\.json$/.test(n))
    .sort();
  return issues.length ? issues[issues.length - 1].replace('.json', '') : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).end('Method not allowed'); return; }

  const token = req.query.token;
  if (!APPROVAL_TOKEN) { res.status(500).send('Server misconfiguration. Check Vercel env.'); return; }
  if (!token || !safeTokenEqual(token, APPROVAL_TOKEN)) { res.status(403).send('Invalid or missing preview token.'); return; }
  if (!GITHUB_PAT)    { res.status(500).send('GITHUB_PAT not set — cannot read the staged brief.'); return; }

  const slug = await getLatestSlug();
  if (!slug) { res.status(404).send('No staged brief found on the pending branch.'); return; }

  const htmlRes = await ghFetch(
    `/repos/${GH_OWNER}/${GH_REPO}/contents/brief/${slug}/index.html?ref=${STAGE_BRANCH}`,
    { headers: { Accept: 'application/vnd.github.raw' } }
  );
  if (!htmlRes.ok) { res.status(502).send(`Could not load the staged brief (HTTP ${htmlRes.status}).`); return; }

  const html = await htmlRes.text();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); // never index the unapproved preview
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
};

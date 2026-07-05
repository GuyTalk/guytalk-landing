'use strict';

/**
 * Trigger the GitHub Actions brief generation workflow via the GitHub API.
 *
 * Called by Vercel Cron at exactly 7am ET daily — far more reliable than
 * GitHub Actions' own scheduler, which can delay 1-3 hours under load.
 *
 * Requires GITHUB_TOKEN secret in Vercel (a fine-grained PAT with
 * Actions: write permission on the guytalk-landing repo).
 *
 * The actual brief generation still runs in GitHub Actions (~25 min) —
 * this just fires the workflow_dispatch trigger at the right time.
 */

const OWNER = 'GuyTalk';
const REPO  = 'guytalk-landing';
const WF    = 'generate-brief.yml';

module.exports = async function handler(req, res) {
  // Allow manual testing via ?dry=1
  const dry = req.query.dry === '1';

  const token = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_PAT not set' });

  if (dry) return res.json({ ok: true, dry: true, message: 'Would trigger generate-brief workflow' });

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WF}/dispatches`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (resp.status === 204) {
    console.log('[trigger-brief] workflow dispatched successfully');
    return res.json({ ok: true, triggered: true });
  }

  const body = await resp.text();
  console.error('[trigger-brief] GitHub API error:', resp.status, body);
  return res.status(502).json({ error: `GitHub API returned ${resp.status}`, body });
};

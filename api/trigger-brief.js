// Vercel cron — reliably kicks off the daily brief generation.
//
// Why this exists (2026-07-09): GitHub Actions' own `schedule:` trigger for
// generate-brief.yml is unreliable — confirmed runs delayed 1-2+ hours on some
// mornings and simply not firing at all on others, so the 7am review email
// silently never went out. Vercel's daily cron has been firing exactly on time
// for the other jobs (refresh-culture, refresh-social, social-queue), so this
// endpoint uses that reliable clock to fire a `workflow_dispatch` via the GitHub
// API instead of trusting GH's internal schedule queue. generate-brief.yml's
// `schedule:` trigger was removed to avoid a double-run if GH's queue ever does
// fire on its own.

const GITHUB_PAT  = process.env.GITHUB_PAT;
const CRON_SECRET = process.env.CRON_SECRET; // optional — Vercel sends it if set
const GH_OWNER    = 'GuyTalk';
const GH_REPO     = 'guytalk-landing';
const WORKFLOW     = 'generate-brief.yml';

module.exports = async (req, res) => {
  if (CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${CRON_SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  }

  if (!GITHUB_PAT) { res.status(500).json({ error: 'GITHUB_PAT not set' }); return; }

  const ghRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'GuyTalk-Brief-Trigger',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );

  if (ghRes.status === 204) {
    res.status(200).json({ ok: true, dispatched: WORKFLOW });
  } else {
    const body = await ghRes.text().catch(() => '');
    res.status(502).json({ ok: false, status: ghRes.status, body });
  }
};

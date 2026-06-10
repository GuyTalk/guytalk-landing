'use strict';

/**
 * Daily social auto-queue.
 *
 * Pushes the latest brief issues into Buffer's queue, which then auto-posts to
 * the connected X / Instagram / TikTok channels (all three live under the
 * `guytalkmedia` Buffer org). This is the last manual step in the social
 * pipeline — running it on a cron means the socials run themselves.
 *
 * Triggered daily by Vercel Cron (see vercel.json), after the morning brief
 * has published. No posting happens here directly — everything routes through
 * Buffer's API. Append `?dry=1` to preview without queueing.
 *
 * Source: scripts/lib/social-queue.js (shared with the CLI).
 */

const { queueSocialPosts } = require('../scripts/lib/social-queue');

module.exports = async function handler(req, res) {
  // Optional guard: when CRON_SECRET is configured, require it (Vercel Cron sends it).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    const token = (req.query && req.query.token) || '';
    if (auth !== `Bearer ${secret}` && token !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const apiKey = process.env.BUFFER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'BUFFER_API_KEY not configured' });

  const dryRun = !!(req.query && (req.query.dry === '1' || req.query.dry === 'true'));
  const single = (req.query && req.query.issue) || null;

  try {
    const result = await queueSocialPosts({ apiKey, dryRun, single });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'social queue failed' });
  }
};

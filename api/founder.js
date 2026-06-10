'use strict';

/**
 * GuyTalk Founder dashboard data API.
 *
 * Token-gated (FOUNDER_TOKEN). Returns the founder's at-a-glance view:
 *   - live Beehiiv subscriber count (the ONLY thing Beehiiv is used for —
 *     it's the subscriber list; the daily brief is delivered via Resend)
 *   - publishing stats derived from the local brief archive (issues, cadence,
 *     latest issue + whether it passed the editorial pass)
 *   - an optional embedded PostHog dashboard (POSTHOG_EMBED_URL) for live
 *     traffic / signup / brief-read charts
 *   - a maintained changelog of recent work (founder-changelog.json)
 *
 * Read-only. No fabricated data — if a source is unreachable it returns null
 * for that block rather than guessing.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLICATION_ID = 'pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be';
// First issue shipped ~May 20, 2026 (issue-001). Used for "days live".
const LAUNCH_DATE = '2026-05-20T00:00:00Z';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Constant-time-ish: compare against self so timing doesn't leak length.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Beehiiv is the subscriber list of record. Only the subscriber count is
// meaningful here — open/click/sent stats on the publication are from Beehiiv's
// own welcome/confirmation emails, NOT the daily brief (which ships via Resend),
// so we deliberately don't surface them as "brief performance".
async function fetchBeehiiv(key) {
  try {
    const r = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}?expand[]=stats`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return null;
    const body = await r.json();
    const s = (body.data || body).stats || {};
    return {
      activeSubscriptions: s.active_subscriptions ?? null,
      activeFree: s.active_free_subscriptions ?? null,
      activePremium: s.active_premium_subscriptions ?? null,
    };
  } catch (_) { return null; }
}

function readChangelog() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'founder-changelog.json'), 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 20) : [];
  } catch (_) { return []; }
}

// Pull publishing stats from the local brief archive (brief/data/issue-NNN.json).
function publishing() {
  try {
    const dir = path.join(process.cwd(), 'brief', 'data');
    const files = fs.readdirSync(dir).filter((f) => /^issue-\d{3}\.json$/.test(f)).sort();
    if (!files.length) return null;

    const last = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
    const num = Number(last.num || files[files.length - 1].match(/\d+/)[0]);
    const slug = last.slug || `issue-${String(num).padStart(3, '0')}`;

    const daysLive = Math.max(1, Math.round((Date.now() - Date.parse(LAUNCH_DATE)) / 86400000));

    return {
      issuesPublished: num,        // highest issue number = total shipped
      daysLive,
      latestIssue: { num: String(num).padStart(3, '0'), slug, date: last.date || '', title: last.title || '' },
      // Did the latest brief pass the editorial-bible pass?
      editorReviewed: !!(last.editor && last.editor.reviewed),
      editorBlocking: last.editor && Array.isArray(last.editor.blocking) ? last.editor.blocking.length : 0,
    };
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  const expected = process.env.FOUNDER_TOKEN;
  const token = (req.query && req.query.token) || '';
  if (!expected) return res.status(500).json({ error: 'FOUNDER_TOKEN not configured' });
  if (!token || !safeEqual(token, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const key = process.env.BEEHIIV_API_KEY;
  const beehiiv = key ? await fetchBeehiiv(key) : null;

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    generatedAt: new Date().toISOString(),
    beehiiv,
    publishing: publishing(),
    // Live PostHog Founder Overview, shared publicly and embedded here. An env
    // var still overrides if the shared link is ever rotated.
    posthogEmbedUrl: process.env.POSTHOG_EMBED_URL || 'https://us.posthog.com/embedded/IPjWuaaf0lJrwGc8AcXtoS4oBfqK1w',
    changelog: readChangelog(),
    links: {
      posthogFounder: 'https://us.posthog.com/project/428450/dashboard/1681629',
      posthogShared: 'https://us.posthog.com/shared/IPjWuaaf0lJrwGc8AcXtoS4oBfqK1w',
      posthogLive: 'https://us.posthog.com/project/428450/dashboard/1681616',
      beehiiv: 'https://app.beehiiv.com',
      site: 'https://www.guytalkmedia.com',
    },
  });
};

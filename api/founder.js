'use strict';

/**
 * GuyTalk Founder dashboard data API.
 *
 * Token-gated (FOUNDER_TOKEN). Returns the founder's at-a-glance view:
 *   - live Beehiiv stats (subscribers, open/click rate, total sent, last post)
 *   - a maintained changelog of recent work (founder-changelog.json)
 *   - system status (latest published issue)
 *
 * Read-only. No fabricated data — if a source is unreachable it returns null
 * for that block rather than guessing.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLICATION_ID = 'pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Constant-time-ish: compare against self so timing doesn't leak length.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

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
      openRate: s.average_open_rate ?? null,
      clickRate: s.average_click_rate ?? null,
      totalSent: s.total_sent ?? null,
    };
  } catch (_) { return null; }
}

async function fetchLatestPost(key) {
  try {
    const r = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/posts?limit=1&order_by=created&direction=desc&expand[]=stats`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return null;
    const body = await r.json();
    const p = (body.data || [])[0];
    if (!p) return null;
    return {
      title: p.title || '',
      status: p.status || '',
      publishDate: p.publish_date || p.created || null,
      opens: p.stats?.email?.opens ?? null,
      clicks: p.stats?.email?.clicks ?? null,
      webUrl: p.web_url || '',
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

function latestIssue() {
  try {
    const dir = path.join(process.cwd(), 'brief', 'data');
    const files = fs.readdirSync(dir).filter((f) => /^issue-\d{3}\.json$/.test(f)).sort();
    const last = files[files.length - 1];
    if (!last) return null;
    const d = JSON.parse(fs.readFileSync(path.join(dir, last), 'utf8'));
    const num = String(d.num || last.match(/\d+/)[0]).padStart(3, '0');
    return { num, slug: d.slug || `issue-${num}`, date: d.date || '', title: d.title || '' };
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
  const [beehiiv, lastPost] = await Promise.all([
    key ? fetchBeehiiv(key) : Promise.resolve(null),
    key ? fetchLatestPost(key) : Promise.resolve(null),
  ]);

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    generatedAt: new Date().toISOString(),
    beehiiv,
    lastPost,
    latestIssue: latestIssue(),
    changelog: readChangelog(),
    links: {
      posthogFounder: 'https://us.posthog.com/project/428450/dashboard/1681629',
      posthogLive: 'https://us.posthog.com/project/428450/dashboard/1681616',
      beehiiv: 'https://app.beehiiv.com',
      site: 'https://www.guytalkmedia.com',
    },
  });
};

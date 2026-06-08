'use strict';

/**
 * Beehiiv → PostHog daily subscriber snapshot.
 *
 * Pulls the live publication stats from Beehiiv and captures them into PostHog
 * as a `beehiiv_subscribers` event, so the newsletter's core metrics
 * (active subscribers, open/click rate) show up ON the Founder Overview
 * dashboard — no second tab needed.
 *
 * Triggered daily by Vercel Cron (see vercel.json). Idempotent-ish: each run
 * writes one dated snapshot; PostHog trends chart the daily series.
 *
 * Sources: Beehiiv REST API (BEEHIIV_API_KEY) → PostHog capture (public phc_ key).
 * No fabricated data — if Beehiiv is unreachable, nothing is written.
 */

const PUBLICATION_ID = 'pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be';
const POSTHOG_KEY = 'phc_t9vvXWz7JWBsWkHmmNXCb2KMF79puQomJnJvREWKQbq8'; // public ingest key (already in site)

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

  const key = process.env.BEEHIIV_API_KEY;
  if (!key) return res.status(500).json({ error: 'BEEHIIV_API_KEY not configured' });

  try {
    const r = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}?expand[]=stats`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return res.status(502).json({ error: `beehiiv ${r.status}` });
    const body = await r.json();
    const s = (body.data || body).stats || {};

    const properties = {
      active_subscriptions: s.active_subscriptions ?? null,
      active_free_subscriptions: s.active_free_subscriptions ?? null,
      active_premium_subscriptions: s.active_premium_subscriptions ?? null,
      average_open_rate: s.average_open_rate ?? null,
      average_click_rate: s.average_click_rate ?? null,
      total_sent: s.total_sent ?? null,
    };

    // Don't write a blank snapshot.
    if (properties.active_subscriptions == null) {
      return res.status(502).json({ error: 'no stats from beehiiv' });
    }

    const capture = await fetch('https://us.i.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: 'beehiiv_subscribers',
        distinct_id: 'guytalk-newsletter',
        properties,
        timestamp: new Date().toISOString(),
      }),
    });
    if (!capture.ok) return res.status(502).json({ error: `posthog ${capture.status}` });

    return res.json({ ok: true, captured: properties });
  } catch (err) {
    return res.status(500).json({ error: 'sync failed' });
  }
};

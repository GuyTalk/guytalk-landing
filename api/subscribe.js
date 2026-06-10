'use strict';

/**
 * GuyTalk — newsletter signup (server-side).
 *
 * The homepage form previously POSTed straight to Beehiiv's subscribe-forms
 * endpoint from the browser with `mode: 'no-cors'`, which makes the response
 * opaque: the form showed "success" even when Beehiiv never recorded the
 * subscriber. Real signups silently failed (captured in PostHog, missing from
 * Beehiiv). This endpoint creates the subscription via the Beehiiv API using
 * the server-side key, reads the actual result, and reports success/failure.
 */

const PUBLICATION_ID = 'pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const key = process.env.BEEHIIV_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'Signup is temporarily unavailable.' });

  // Vercel parses JSON bodies; tolerate a raw string body too.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }

  try {
    const r = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          reactivate_existing: true,      // re-subscribe someone who left
          send_welcome_email: true,       // send the welcome, not a confirmation
          double_opt_override: 'off',     // signups go straight to active (no pending)
          utm_source: 'guytalkmedia.com',
          utm_medium: 'website_signup',
          referring_site: 'https://www.guytalkmedia.com',
        }),
      }
    );
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ ok: false, error: 'Could not complete signup. Please try again.', detail: json });
    }
    // status is 'active' or 'validating'/'pending' depending on double opt-in.
    const status = json?.data?.status || 'pending';
    return res.status(200).json({ ok: true, status });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Could not reach the mailing service. Please try again.' });
  }
};

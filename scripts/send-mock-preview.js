#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: '.env.local' });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APPROVAL_TOKEN = process.env.APPROVAL_TOKEN;
const NOTIFY_EMAIL   = 'j.rwilliams284@gmail.com';
const SITE_URL       = 'https://www.guytalkmedia.com';
const mockUrl        = SITE_URL + '/brief/preview/';

async function main() {
  if (!RESEND_API_KEY) { console.error('No RESEND_API_KEY'); process.exit(1); }
  const { Resend } = require('resend');
  const resend = new Resend(RESEND_API_KEY);

  const html = `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <div style="font-size:22px;font-weight:900;letter-spacing:-0.5px;margin-bottom:4px">GuyTalk<span style="color:#3b82f6">.</span></div>
  <div style="color:#6b7280;font-size:13px;margin-bottom:24px">EDITORIAL MOCK &middot; FORMAT PREVIEW</div>

  <div style="background:#1e3a5f;color:white;border-radius:12px;padding:24px;margin-bottom:24px">
    <div style="font-size:11px;letter-spacing:.1em;font-weight:700;color:#93c5fd;margin-bottom:8px">WHAT THIS MOCK SHOWS</div>
    <h2 style="margin:0 0 16px;font-size:20px;line-height:1.3">New format: Giannis lead, 2 sports, Quick Hits, deeper culture + markets</h2>
    <p style="margin:0;color:#dbeafe;font-size:14px;line-height:1.6">
      Shows what tomorrow's brief looks like when we rebalance away from sports-heavy coverage
      on days where the real conversation is happening elsewhere.
    </p>
  </div>

  <div style="margin-bottom:20px">
    <div style="font-weight:700;margin-bottom:10px;font-size:15px">Key changes shown:</div>
    <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:2.2">
      <li><strong>Lead:</strong> Giannis to Miami (biggest sports story of the day) instead of 4th day of WC recap</li>
      <li><strong>Sports:</strong> 2 sections (World Cup + MLB scores) instead of 4 tournament previews</li>
      <li><strong>NEW &mdash; Quick Hits:</strong> Scannable box for Wimbledon Day 2, F1 sprint, injury status, NBA trade details</li>
      <li><strong>Culture:</strong> 3 real items with stakes (Clive Davis obit, Swift/Kelce pre-wedding, Deadpool hits $1B)</li>
      <li><strong>Markets:</strong> Nasdaq down 4.1% on the week &mdash; "what this means for your wallet" angle</li>
    </ul>
  </div>

  <a href="${mockUrl}" style="display:block;background:#111827;color:white;text-align:center;padding:16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:16px">
    View Mock Brief &rarr;
  </a>

  <p style="color:#9ca3af;font-size:12px;text-align:center">Mock only &mdash; no subscribers receive this. Reply with feedback.</p>
</div>`;

  const result = await resend.emails.send({
    from: 'GuyTalk <brief@guytalkmedia.com>',
    to: NOTIFY_EMAIL,
    subject: 'GuyTalk Editorial Mock — New Format Preview',
    html,
  });
  console.log('Sent:', result.data?.id || JSON.stringify(result));
}

main().catch(e => { console.error(e.message); process.exit(1); });

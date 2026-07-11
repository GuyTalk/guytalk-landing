#!/usr/bin/env node
'use strict';
// Sends Jake an email whenever the "Generate brief" workflow step fails —
// most commonly because both OpenAI and Anthropic web-search research failed
// and generate-brief.js aborted on purpose rather than quietly falling back to
// feed-only mode (stale/generic content — the exact "feels the same" problem
// this gate exists to prevent). Could also fire on any other generation crash.
// No brief is generated on this run. Called by generate-brief.yml on failure.

require('dotenv').config({ path: '.env.local' });

const path          = require('path');
const { execSync }  = require('child_process');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL || 'j.rwilliams284@gmail.com';
const FROM_EMAIL     = process.env.FROM_EMAIL   || 'GuyTalk <onboarding@resend.dev>';
const ROOT           = path.join(__dirname, '..');

async function main() {
  if (!RESEND_API_KEY) { console.log('   ⚠  RESEND_API_KEY not set — skipping research failure email'); return; }

  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true,
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch (_) {}

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8F5;">
<tr><td align="center" style="padding:32px 16px 48px;">
<table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

  <tr><td style="padding:0 0 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#0F1724;">GuyTalk<span style="color:#2B6FFF;">.</span></td>
      <td align="right" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9E9891;">Research Failed</td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;border:1px solid #E5E2DB;border-radius:14px;overflow:hidden;">

    <div style="background:#7F1D1D;padding:16px 24px;">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:rgba(255,255,255,0.6);">No brief generated today</p>
      <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff;line-height:1.2;letter-spacing:-0.02em;">Both web-search research providers failed</p>
    </div>

    <div style="padding:20px 24px;">
      <p style="font-size:13px;color:#444;margin:0 0 16px;line-height:1.5;">
        The "Generate brief" step failed this morning — most likely because OpenAI web search
        and the Anthropic fallback both failed or timed out. Generation stops on purpose in that
        case instead of falling back to feed-only mode, which reuses static player pools and
        generic ESPN/NewsAPI content — the exact "feels the same" quality problem this gate
        exists to prevent. (If the actual cause was something else, the workflow log has it.)<br><br>
        Nothing was generated. Nothing was staged to <code>pending</code>. No email went to subscribers.
      </p>

      <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 16px;">
        <p style="margin:0;font-size:13px;color:#92400E;line-height:1.5;">
          <b>To publish today's brief:</b><br>
          1. Check GitHub Actions logs for the actual OpenAI/Anthropic error<br>
          2. If it's a transient outage, re-run the "Generate Daily Brief" workflow manually<br>
          3. If it keeps failing, run generation locally with fresh research input
        </p>
      </div>
    </div>
  </td></tr>

  <tr><td style="padding:20px 0 0;text-align:center;">
    <p style="font-size:11px;color:#B0ADA8;margin:0;line-height:1.6;">
      This is your private research-failure alert. No email was sent to subscribers.<br>
      <span style="font-family:monospace;font-size:10px;">run: ${ts} &nbsp;·&nbsp; commit: ${commit}</span>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      NOTIFY_EMAIL,
      subject: `⚠ GuyTalk research failed — no brief generated today`,
      html,
    }),
  });

  if (res.ok) {
    console.log(`   ✓ Research failure email sent to ${NOTIFY_EMAIL}`);
  } else {
    const err = await res.json().catch(() => ({}));
    console.log(`   ⚠  Research failure email failed: ${err.message || res.status}`);
  }
}

main().catch(err => console.error(`   ✗ notify-research-failure: ${err.message}`));

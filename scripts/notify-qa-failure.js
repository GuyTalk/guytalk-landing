#!/usr/bin/env node
'use strict';
// Sends Jake an email when the brief fails QA and won't be staged.
// Called by run-brief.sh on QA failure. Reads the log file for detail.

require('dotenv').config({ path: '.env.local' });

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL || 'j.rwilliams284@gmail.com';
const FROM_EMAIL     = process.env.FROM_EMAIL   || 'GuyTalk <onboarding@resend.dev>';
const ROOT           = path.join(__dirname, '..');

function getRunMeta() {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true,
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch (_) {}
  return { ts, commit };
}

async function main() {
  if (!RESEND_API_KEY) { console.log('   ⚠  RESEND_API_KEY not set — skipping QA failure email'); return; }

  const { ts: runTs, commit: runCommit } = getRunMeta();

  // Grab today's log tail for context (last 60 lines)
  const today   = new Date().toISOString().slice(0, 10);
  const logPath = path.join(ROOT, 'logs', `brief-${today}.log`);
  let logSnippet = '(log not found)';
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    logSnippet = lines.slice(-60).join('\n');
  }

  // Determine which issue was being generated
  const dirs = fs.readdirSync(path.join(ROOT, 'brief'))
    .filter(d => /^issue-\d{3}$/.test(d)).sort();
  const latestSlug = dirs[dirs.length - 1] || 'unknown';

  const logHtml = logSnippet
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(❌[^\n]*)/g, '<span style="color:#DC2626;font-weight:700;">$1</span>')
    .replace(/(⚠️[^\n]*)/g, '<span style="color:#D97706;font-weight:600;">$1</span>')
    .replace(/(✅[^\n]*)/g, '<span style="color:#16A34A;">$1</span>');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8F5;">
<tr><td align="center" style="padding:32px 16px 48px;">
<table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

  <tr><td style="padding:0 0 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#0F1724;">GuyTalk<span style="color:#2B6FFF;">.</span></td>
      <td align="right" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9E9891;">QA Failed · ${latestSlug}</td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;border:1px solid #E5E2DB;border-radius:14px;overflow:hidden;">

    <div style="background:#7F1D1D;padding:16px 24px;">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:rgba(255,255,255,0.6);">Brief not staged</p>
      <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff;line-height:1.2;letter-spacing:-0.02em;">${latestSlug} failed QA — fix needed</p>
    </div>

    <div style="padding:20px 24px;">
      <p style="font-size:13px;color:#444;margin:0 0 16px;line-height:1.5;">
        The brief generated this morning but did not pass QA checks.<br>
        Nothing was staged to <code>pending</code>. No email was sent to subscribers.<br>
        Review the failures below, fix manually, then push.
      </p>

      <div style="background:#0F1724;border-radius:8px;padding:16px;margin-bottom:20px;overflow-x:auto;">
        <pre style="margin:0;font-size:11px;line-height:1.6;color:#ccc;white-space:pre-wrap;font-family:monospace;">${logHtml}</pre>
      </div>

      <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px 16px;">
        <p style="margin:0;font-size:13px;color:#92400E;line-height:1.5;">
          <b>To fix and publish manually:</b><br>
          1. Review <code>logs/brief-${today}.log</code><br>
          2. Edit the issue JSON if needed<br>
          3. Run: <code>npm run brief:qa</code><br>
          4. Then: <code>git add brief/ &amp;&amp; git commit -m "fix ${latestSlug}" &amp;&amp; git push origin HEAD:pending --force-with-lease</code>
        </p>
      </div>
    </div>
  </td></tr>

  <tr><td style="padding:20px 0 0;text-align:center;">
    <p style="font-size:11px;color:#B0ADA8;margin:0;line-height:1.6;">
      This is your private QA failure alert. No email was sent to subscribers.<br>
      <span style="font-family:monospace;font-size:10px;">run: ${runTs} &nbsp;·&nbsp; commit: ${runCommit}</span>
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
      subject: `⚠ GuyTalk ${latestSlug} failed QA — action needed`,
      html,
    }),
  });

  if (res.ok) {
    console.log(`   ✓ QA failure email sent to ${NOTIFY_EMAIL}`);
  } else {
    const err = await res.json().catch(() => ({}));
    console.log(`   ⚠  QA failure email failed: ${err.message || res.status}`);
  }
}

main().catch(err => console.error(`   ✗ notify-qa-failure: ${err.message}`));

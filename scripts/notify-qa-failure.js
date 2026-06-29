#!/usr/bin/env node
'use strict';
// Sends Jake a QA failure alert email so he can fix and rerun manually.
// Called by GitHub Actions when qa-brief.js exits with code 1.
// Usage: node scripts/notify-qa-failure.js [/path/to/qa-output.txt]

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || 'GuyTalk <onboarding@resend.dev>';
const NOTIFY_EMAIL   = 'j.rwilliams284@gmail.com';
const SITE_URL       = 'https://www.guytalkmedia.com';
const GITHUB_RUN_URL = process.env.GITHUB_RUN_URL || '';
const ISSUE_SLUG     = process.env.ISSUE_SLUG || 'unknown';
const ROOT           = path.join(__dirname, '..');

function getIssueNum(slug) {
  const m = slug.match(/issue-(\d+)/);
  return m ? m[1].padStart(3, '0') : '???';
}

function getIssueTitle(slug) {
  try {
    const dataPath = path.join(ROOT, 'brief', 'data', `${slug}.json`);
    if (!fs.existsSync(dataPath)) return null;
    const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return d.title || null;
  } catch (_) { return null; }
}

function readQaOutput(outputFile) {
  if (!outputFile || !fs.existsSync(outputFile)) return '';
  return fs.readFileSync(outputFile, 'utf8').trim();
}

// Convert QA plain-text output to styled HTML rows
function buildQaRows(rawOutput) {
  if (!rawOutput) return '<p style="color:#888;font-size:13px;">QA output not available.</p>';

  const lines = rawOutput.split('\n');
  const rows = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';

    let icon = '';
    let color = '#444';
    let bg = 'transparent';

    if (trimmed.startsWith('✅') || trimmed.startsWith('✓') || trimmed.startsWith('[✓]')) {
      icon = '✅'; color = '#15803d'; bg = 'rgba(22,163,74,0.04)';
    } else if (trimmed.startsWith('❌') || trimmed.startsWith('✗') || trimmed.startsWith('[✗]')) {
      icon = '❌'; color = '#b91c1c'; bg = 'rgba(220,38,38,0.05)';
    } else if (trimmed.startsWith('⚠️') || trimmed.startsWith('⚠')) {
      icon = '⚠️'; color = '#b45309'; bg = 'rgba(184,124,53,0.05)';
    } else if (trimmed.startsWith('↳') || trimmed.startsWith('└')) {
      return `<tr><td style="padding:2px 16px 4px 36px;font-size:12px;color:#888;font-family:monospace;">${escHtml(trimmed)}</td></tr>`;
    } else if (trimmed.startsWith('═') || trimmed.startsWith('─')) {
      return `<tr><td style="padding:6px 0;"><hr style="border:none;border-top:1px solid #eee;margin:0;"></td></tr>`;
    } else if (trimmed.startsWith('[')) {
      return `<tr><td style="padding:10px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#9E9891;">${escHtml(trimmed.replace(/^\[|\]$/g, ''))}</td></tr>`;
    } else {
      return `<tr><td style="padding:3px 0;font-size:12.5px;color:#666;font-family:monospace;">${escHtml(trimmed)}</td></tr>`;
    }

    const text = trimmed.replace(/^[✅❌⚠️✓✗⚠]\s*/, '');
    return `<tr style="background:${bg};"><td style="padding:6px 12px;font-size:13.5px;color:${color};border-radius:4px;">${icon} ${escHtml(text)}</td></tr>`;
  }).filter(Boolean);

  return `<table width="100%" cellpadding="0" cellspacing="2" style="border-collapse:collapse;">${rows.join('')}</table>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  if (!RESEND_API_KEY) {
    console.log('   ⚠  RESEND_API_KEY not set — cannot send QA failure alert');
    process.exit(0);
  }

  const outputFile = process.argv[2];
  const qaOutput   = readQaOutput(outputFile);
  const issueNum   = getIssueNum(ISSUE_SLUG);
  const issueTitle = getIssueTitle(ISSUE_SLUG);

  const qaRows = buildQaRows(qaOutput);
  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const githubBtn = GITHUB_RUN_URL
    ? `<table cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr>
        <td style="background:#F2F0EB;border:1.5px solid #E5E2DB;border-radius:8px;text-align:center;">
          <a href="${escHtml(GITHUB_RUN_URL)}" style="display:block;padding:11px 20px;font-weight:600;font-size:13px;color:#0F1724;text-decoration:none;">
            View full log on GitHub Actions →
          </a>
        </td>
      </tr></table>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8F5;">
<tr><td align="center" style="padding:32px 16px 48px;">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

  <tr><td style="padding:0 0 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#0F1724;">
        GuyTalk<span style="color:#2B6FFF;">.</span>
      </td>
      <td align="right" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9E9891;">
        QA FAILED · ISSUE-${escHtml(issueNum)}
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;border:1px solid #E5E2DB;border-radius:14px;overflow:hidden;">

    <!-- Red failure banner -->
    <div style="background:#FEF2F2;border-bottom:1px solid #FECACA;padding:16px 24px;">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:#B91C1C;">
        Brief not staged
      </p>
      <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#0F1724;line-height:1.2;letter-spacing:-0.02em;">
        issue-${escHtml(issueNum)} failed QA — fix needed
      </p>
    </div>

    <div style="padding:20px 24px;">

      <p style="font-size:14px;color:#6E6862;margin:0 0 8px;line-height:1.6;">
        The brief generated this morning but did not pass QA checks.<br>
        Nothing was pushed to the site. No email was sent to subscribers.<br>
        Review the failures below, fix manually, then push.
      </p>

      ${issueTitle ? `<p style="font-size:13px;color:#9E9891;margin:0 0 20px;font-style:italic;">"${escHtml(issueTitle)}"</p>` : ''}

      <!-- QA results -->
      <div style="background:#F8F7F4;border:1px solid #E5E2DB;border-radius:8px;padding:14px 12px;margin-bottom:20px;overflow-x:auto;">
        ${qaRows}
      </div>

      <!-- Recovery steps -->
      <div style="background:#0F1724;border-radius:10px;padding:16px 18px;margin-bottom:16px;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.5);">
          To fix and publish manually:
        </p>
        <p style="margin:0 0 6px;font-size:12.5px;color:rgba(255,255,255,0.75);line-height:1.7;font-family:monospace;">
          1. Review <span style="color:#6B9FFF;">logs/brief-${new Date().toISOString().slice(0,10)}.log</span><br>
          2. Edit the issue JSON if needed<br>
          3. Run: <span style="color:#4ADE80;">npm run brief:qa</span><br>
          4. Then: <span style="color:#4ADE80;">git add brief/ &amp;&amp; git commit -m "fix issue-${escHtml(issueNum)}" &amp;&amp; git push</span>
        </p>
      </div>

      ${githubBtn}

    </div>
  </td></tr>

  <tr><td style="padding:20px 0 0;text-align:center;">
    <p style="font-size:11px;color:#B0ADA8;margin:0;line-height:1.6;">
      This is your private QA failure alert. No email was sent to subscribers.<br>
      ${todayStr}
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
      subject: `GuyTalk #${issueNum} — QA failed, action needed`,
      html,
    }),
  });

  if (res.ok) {
    console.log(`   ✓ QA failure alert sent to ${NOTIFY_EMAIL}`);
  } else {
    const err = await res.json().catch(() => ({}));
    console.error(`   ✗ Failed to send alert: ${err.message || res.status}`);
  }
}

main().catch(err => {
  console.error(`   ✗ notify-qa-failure: ${err.message}`);
  process.exit(0); // don't fail the CI job over a notification error
});

#!/usr/bin/env node
'use strict';
// Sends Jake a review email after the brief is generated.
// The email contains a preview + one-tap "Send to subscribers" button.

require('dotenv').config({ path: '.env.local' });

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

function getRunMeta() {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true,
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..') }).toString().trim(); } catch (_) {}
  return { ts, commit };
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APPROVAL_TOKEN = process.env.APPROVAL_TOKEN;
const SITE_URL       = 'https://www.guytalkmedia.com';
const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL || 'j.rwilliams284@gmail.com';
const FROM_EMAIL     = process.env.FROM_EMAIL || 'GuyTalk <onboarding@resend.dev>';
const ROOT           = path.join(__dirname, '..');

function getLatestBrief() {
  const dirs = fs.readdirSync(path.join(ROOT, 'brief'))
    .filter(d => /^issue-\d{3}$/.test(d))
    .sort();
  const slug = dirs[dirs.length - 1];
  if (!slug) return null;
  const dataPath = path.join(ROOT, 'brief', 'data', `${slug}.json`);
  if (!fs.existsSync(dataPath)) return null;
  return { data: JSON.parse(fs.readFileSync(dataPath, 'utf8')), slug };
}

async function main() {
  if (!RESEND_API_KEY) { console.log('   ⚠  RESEND_API_KEY not set — skipping review notification'); return; }
  if (!APPROVAL_TOKEN) { console.log('   ⚠  APPROVAL_TOKEN not set — skipping review notification'); return; }

  const brief = getLatestBrief();
  if (!brief) { console.log('   ⚠  No brief found — skipping review notification'); return; }

  const { data, slug } = brief;
  const num        = String(data.num).padStart(3, '0');
  const approveUrl = `${SITE_URL}/api/approve?token=${APPROVAL_TOKEN}`;
  const previewUrl = `${SITE_URL}/api/preview?token=${APPROVAL_TOKEN}`;
  const { ts: runTs, commit: runCommit } = getRunMeta();

  // Quick look bullets
  const bullets = [];
  if (data.sports?.length) {
    const g = data.sports[0];
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    bullets.push(`<b>Sports:</b> ${g.note || g.shortName} — ${w?.team} ${w?.score}, ${l?.team} ${l?.score}`);
  }
  if (data.markets?.SPY?.dayChangePct != null) {
    const chg = data.markets.SPY.dayChangePct;
    bullets.push(`<b>Markets:</b> S&P 500 ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% today`);
  }
  if (data.golf?.leaders?.[0]) {
    const leader = data.golf.leaders[0];
    bullets.push(`<b>Golf:</b> ${leader.name} leads ${data.golf.name} at ${leader.score}`);
  }
  if (data.f1?.name) {
    const f1Str = data.f1.results?.[0]?.driver
      ? `${data.f1.results[0].driver} wins ${data.f1.shortName || data.f1.name}`
      : `${data.f1.shortName || data.f1.name} — this weekend`;
    bullets.push(`<b>F1:</b> ${f1Str}`);
  }
  if (data.worldCup?.length) {
    const active = data.worldCup.find(m => m.statusState === 'in' || m.statusState === 'post');
    const wcStr = active
      ? `${active.away.team} vs ${active.home.team} — ${active.away.score}–${active.home.score}`
      : 'FIFA World Cup 2026 opens June 11';
    bullets.push(`<b>World Cup:</b> ${wcStr}`);
  }
  if (data.copy?.culture?.[0]?.head) {
    bullets.push(`<b>Culture:</b> ${data.copy.culture[0].head}`);
  }
  const fpSections = data.factPack ? Object.keys(data.factPack).filter(k => data.factPack[k] != null) : [];
  if (fpSections.length) {
    bullets.push(`<b>Fact Pack:</b> ${fpSections.length} section(s) enriched — ${fpSections.join(', ')}`);
  }

  const bulletsHtml = bullets.map(b =>
    `<tr><td style="padding:8px 0;font-size:14px;line-height:1.5;color:#444;border-top:1px solid #eee;">
      <span style="color:#2B6FFF;font-weight:700;margin-right:6px;">→</span>${b}
    </td></tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8F5;">
<tr><td align="center" style="padding:32px 16px 48px;">
<table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

  <tr><td style="padding:0 0 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#0F1724;">GuyTalk<span style="color:#2B6FFF;">.</span></td>
      <td align="right" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:#9E9891;">Issue #${num} · Review</td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;border:1px solid #E5E2DB;border-radius:14px;overflow:hidden;">

    <div style="background:#0F1724;padding:16px 24px;">
      <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:rgba(255,255,255,0.5);">Ready to review</p>
      <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#fff;line-height:1.2;letter-spacing:-0.02em;">${data.title}</p>
    </div>

    <div style="padding:20px 24px;">

      <p style="font-size:13px;color:#9E9891;margin:0 0 16px;line-height:1.5;">
        ${data.date} · Issue #${num}<br>
        Review below, then tap to send.
      </p>

      ${bulletsHtml ? `<div style="background:#F8F7F4;border-radius:8px;padding:4px 12px;margin-bottom:20px;">
        <table width="100%" cellpadding="0" cellspacing="0">${bulletsHtml}</table>
      </div>` : ''}

      <!-- Secondary CTA: read the FULL brief before sending. /api/preview serves
           the staged brief from the pending branch (rendered on the prod domain so
           styles/images resolve) — read-only, publishes nothing. -->
      <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:10px;">
        <tr>
          <td style="border:1.5px solid #0F1724;border-radius:10px;text-align:center;">
            <a href="${previewUrl}" target="_blank" style="display:block;padding:13px 24px;font-weight:700;font-size:15px;color:#0F1724;text-decoration:none;letter-spacing:-0.01em;">
              Preview the full brief →
            </a>
          </td>
        </tr>
      </table>

      <!-- Primary CTA: Approve + Send. Preview above lets you read it first. -->
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        <tr>
          <td style="background:#16A34A;border-radius:10px;text-align:center;">
            <a href="${approveUrl}" style="display:block;padding:15px 24px;font-weight:700;font-size:15px;color:#fff;text-decoration:none;letter-spacing:-0.01em;">
              ✓ Send to subscribers →
            </a>
          </td>
        </tr>
      </table>

    </div>
  </td></tr>

  <tr><td style="padding:20px 0 0;text-align:center;">
    <p style="font-size:11px;color:#B0ADA8;margin:0;line-height:1.6;">
      This is your private review email. Only you can see this.<br>
      Tap the green button to send to all subscribers.<br>
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
      subject: `GuyTalk #${num} ready — tap to send`,
      html,
    }),
  });

  if (res.ok) {
    console.log(`   ✓ Review email sent to ${NOTIFY_EMAIL}`);
  } else {
    const err = await res.json().catch(() => ({}));
    console.log(`   ⚠  Review email failed: ${err.message || res.status}`);
  }
}

main().catch(err => console.error(`   ✗ notify-review: ${err.message}`));

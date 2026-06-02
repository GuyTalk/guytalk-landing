#!/usr/bin/env node
'use strict';
// GuyTalk — Daily Brief Email Sender
// Pulls active subscribers from Beehiiv, sends the brief via Gmail SMTP.
//
// SETUP (one-time):
//   1. Enable 2FA on guytalkdaily@gmail.com (myaccount.google.com → Security)
//   2. Create an App Password: myaccount.google.com → Security → App Passwords
//      → Select "Mail" + "Other (GuyTalk)" → Copy the 16-char password
//   3. Add to .env.local:  GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
//
// Run:  node scripts/send-brief.js
//       node scripts/send-brief.js --dry-run    (preview HTML, no send)
//       node scripts/send-brief.js --issue issue-014  (specific issue)

require('dotenv').config({ path: '.env.local' });

const fs          = require('fs');
const path        = require('path');
const nodemailer  = require('nodemailer');

const BEEHIIV_API_KEY  = process.env.BEEHIIV_API_KEY;
const GMAIL_USER       = 'guytalkdaily@gmail.com';
const GMAIL_APP_PASS   = process.env.GMAIL_APP_PASSWORD;
const PUB_ID           = 'pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be';
const SITE_URL         = 'https://www.guytalkmedia.com';
const ROOT             = path.join(__dirname, '..');
const DRY_RUN          = process.argv.includes('--dry-run');
const FORCED_ISSUE     = (() => {
  const idx = process.argv.indexOf('--issue');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Beehiiv: fetch all active subscriber emails
// ─────────────────────────────────────────────────────────────────────────────
async function getSubscribers() {
  const emails = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUB_ID}/subscriptions?status=active&per_page=100&page=${page}`,
      { headers: { 'Authorization': `Bearer ${BEEHIIV_API_KEY}` } }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(`Beehiiv subscriptions → ${res.status}: ${JSON.stringify(json)}`);

    const subs = json.data || json.subscriptions || [];
    subs.forEach(s => { if (s.email) emails.push(s.email); });

    const totalPages = json.total_pages ?? json.pagination?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return emails;
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue helpers
// ─────────────────────────────────────────────────────────────────────────────
function getLatestSlug() {
  if (FORCED_ISSUE) return FORCED_ISSUE;
  const dirs = fs.readdirSync(path.join(ROOT, 'brief'))
    .filter(d => /^issue-\d{3}$/.test(d))
    .sort();
  return dirs[dirs.length - 1];
}

function readData(slug) {
  const p = path.join(ROOT, 'brief', 'data', `${slug}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build email HTML (inline styles for email client compatibility)
// ─────────────────────────────────────────────────────────────────────────────
function buildEmailHtml(data, slug) {
  const briefUrl  = `${SITE_URL}/brief/${slug}/`;
  const num       = String(data.num).padStart(3, '0');

  // Prefer AI sharp-take bullets — they're more compelling than raw scores
  let bullets = [];
  const aiBullets = data.copy?.sharpTake?.bullets;
  if (Array.isArray(aiBullets) && aiBullets.length >= 2) {
    bullets = aiBullets.slice(0, 3).map(b => `<span style="color:#0F1724">${b}</span>`);
  } else {
    // Fallback: build from raw data
    if (data.sports?.length) {
      const g = data.sports[0];
      const w = g.home?.winner ? g.home : g.away;
      const l = g.home?.winner ? g.away : g.home;
      bullets.push(`<b style="color:#0F1724">Sports:</b> ${g.note || g.shortName} — ${w?.team} ${w?.score}, ${l?.team} ${l?.score}`);
    }
    if (data.markets?.SPY?.dayChangePct != null) {
      const chg = data.markets.SPY.dayChangePct;
      bullets.push(`<b style="color:#0F1724">Markets:</b> S&amp;P 500 ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% today`);
    }
    if (data.golf?.leaders?.[0]) {
      const leader = data.golf.leaders[0];
      const golfVerb = data.golf.statusState === 'post' ? 'wins' : 'leads';
      bullets.push(`<b style="color:#0F1724">Golf:</b> ${leader.name} ${golfVerb} ${data.golf.name} at ${leader.score}`);
    }
    if (data.f1?.name) {
      const f1Str = data.f1.results?.[0]?.driver
        ? `${data.f1.results[0].driver} wins ${data.f1.shortName || data.f1.name}`
        : `${data.f1.shortName || data.f1.name} — this weekend`;
      bullets.push(`<b style="color:#0F1724">F1:</b> ${f1Str}`);
    }
  }

  const bulletsHtml = bullets.length
    ? bullets.slice(0, 5).map(b => `
        <tr>
          <td style="padding:8px 0;font-size:15px;line-height:1.55;color:#6E6862;border-top:1px solid #E5E2DB;">
            <span style="color:#2B6FFF;font-weight:700;margin-right:6px;">→</span>${b}
          </td>
        </tr>`).join('')
    : `<tr><td style="padding:8px 0;color:#6E6862;font-size:15px;">Full brief ready — click below to read.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GuyTalk #${num}</title>
</head>
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8F5;">
<tr><td align="center" style="padding:32px 16px 64px;">
<table width="100%" style="max-width:580px;" cellpadding="0" cellspacing="0">

  <!-- Wordmark row -->
  <tr>
    <td style="padding:0 0 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-weight:800;font-size:20px;letter-spacing:-0.03em;color:#0F1724;">
            GuyTalk<span style="color:#2B6FFF;">.</span>
          </td>
          <td align="right" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.14em;color:#9E9891;">
            Issue #${num}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Card -->
  <tr>
    <td style="background:#FFFFFF;border:1px solid #E5E2DB;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

      <!-- Blue header -->
      <div style="background:#2B6FFF;padding:14px 28px;">
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.75);">${data.date}</span>
      </div>

      <!-- Body -->
      <div style="padding:28px 28px 24px;">

        <!-- Headline -->
        <p style="font-weight:800;font-size:27px;line-height:1.12;letter-spacing:-0.025em;color:#0F1724;margin:0 0 10px;">
          ${data.title}
        </p>
        <p style="font-size:16px;color:#6E6862;margin:0 0 24px;line-height:1.6;">
          Five minutes. Everything you need.
        </p>

        <!-- Quick look -->
        <div style="background:#F2F0EB;border-radius:10px;padding:16px 18px;margin-bottom:24px;">
          <p style="font-weight:700;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#2B6FFF;margin:0 0 10px;">
            Quick look
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${bulletsHtml}
          </table>
        </div>

        <!-- CTA button -->
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#2B6FFF;border-radius:10px;box-shadow:0 4px 14px rgba(43,111,255,0.28);">
              <a href="${briefUrl}" style="display:inline-block;padding:14px 28px;font-weight:700;font-size:15px;color:#FFFFFF;text-decoration:none;letter-spacing:-0.01em;">
                Read today's brief →
              </a>
            </td>
          </tr>
        </table>

      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:24px 0 0;text-align:center;">
      <p style="font-size:12px;color:#9E9891;margin:0 0 6px;line-height:1.6;">
        You're receiving this because you subscribed to GuyTalk.
      </p>
      <p style="font-size:12px;color:#9E9891;margin:0 0 6px;">
        <a href="${SITE_URL}" style="color:#9E9891;text-decoration:underline;">guytalkmedia.com</a>
        &nbsp;·&nbsp;
        <a href="https://www.guytalkmedia.com/unsubscribe/" style="color:#9E9891;text-decoration:underline;">Unsubscribe</a>
      </p>
      <p style="font-size:11px;color:#B8B4AC;margin:0;">
        GuyTalk · PO Box (coming soon) · United States
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  // Guard: API keys
  if (!BEEHIIV_API_KEY) {
    console.error('\n❌ BEEHIIV_API_KEY not set in .env.local\n');
    process.exit(1);
  }

  const slug = getLatestSlug();
  if (!slug) { console.error('❌ No brief issues found in brief/'); process.exit(1); }

  const data = readData(slug);
  if (!data) {
    console.error(`❌ No data file: brief/data/${slug}.json`);
    process.exit(1);
  }

  const num     = String(data.num).padStart(3, '0');
  const subject = `GuyTalk #${num} — ${data.title}`;
  const html    = buildEmailHtml(data, slug);

  // Dry run — write preview and exit
  if (DRY_RUN) {
    const outPath = path.join(ROOT, 'logs', `email-preview-${slug}.html`);
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    fs.writeFileSync(outPath, html);
    console.log(`\n✅ Dry run complete`);
    console.log(`   Email preview: logs/email-preview-${slug}.html`);
    console.log(`   Open it: open logs/email-preview-${slug}.html\n`);
    return;
  }

  // Guard: Gmail app password
  if (!GMAIL_APP_PASS) {
    console.error('\n❌ GMAIL_APP_PASSWORD not set in .env.local');
    console.error('   1. Enable 2FA: myaccount.google.com → Security → 2-Step Verification');
    console.error('   2. Create App Password: myaccount.google.com → Security → App Passwords');
    console.error('   3. Add to .env.local: GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx\n');
    process.exit(1);
  }

  // Fetch subscriber list
  console.log(`\n📬 Sending ${slug} to subscribers...`);
  console.log('   Fetching subscriber list from Beehiiv...');
  const emails = await getSubscribers();
  console.log(`   ✓ ${emails.length} active subscriber(s)`);

  if (emails.length === 0) {
    console.log('   No active subscribers — nothing sent.\n');
    return;
  }

  // Set up Gmail transport
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS },
  });

  // Send to each subscriber
  console.log(`   Sending "${subject}"...`);
  let sent = 0, failed = 0;
  for (const email of emails) {
    try {
      await transporter.sendMail({
        from:    `GuyTalk <${GMAIL_USER}>`,
        to:      email,
        subject: subject,
        html:    html,
      });
      sent++;
      console.log(`   ✓ ${email}`);
    } catch (err) {
      failed++;
      console.error(`   ✗ ${email}: ${err.message}`);
    }
  }

  console.log(`\n   ✅ Done — ${sent} sent, ${failed} failed`);
  console.log(`   Brief URL: ${SITE_URL}/brief/${slug}/\n`);
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

#!/usr/bin/env node
'use strict';
// GuyTalk — Beehiiv Email Sender
// Reads the latest brief, creates a Beehiiv post, and sends it to all subscribers.
// Requires: BEEHIIV_API_KEY in .env.local
// Run: node scripts/send-brief.js [--issue issue-016] [--dry-run]

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const API_KEY  = process.env.BEEHIIV_API_KEY;
const PUB_ID   = 'd4c6a5c9-3ff9-4986-b17a-9e5650d915be';
const SITE_URL = 'https://guytalk.com';
const ROOT     = path.join(__dirname, '..');
const DRY_RUN  = process.argv.includes('--dry-run');
const FORCED_ISSUE = (() => {
  const idx = process.argv.indexOf('--issue');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
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

function readHtml(slug) {
  const p = path.join(ROOT, 'brief', slug, 'index.html');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

async function beehiiv(method, endpoint, body) {
  const url = `https://api.beehiiv.com/v2${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Beehiiv ${method} ${endpoint} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build email HTML
// Clean, inline-style email that renders well across clients.
// ─────────────────────────────────────────────────────────────────────────────
function buildEmailHtml(data, slug) {
  const briefUrl  = `${SITE_URL}/brief/${slug}/`;
  const signupUrl = `${SITE_URL}/#signup`;
  const num       = String(data.num).padStart(3, '0');

  // Extract TL;DR bullets from the sports/markets/golf data for the preview
  const bullets = [];

  if (data.sports && data.sports.length > 0) {
    const g = data.sports[0];
    bullets.push(`<b>Sports:</b> ${g.shortName || g.awayTeam + ' vs ' + g.homeTeam}`);
  }
  if (data.markets) {
    const spyKey = Object.keys(data.markets).find(k => k === 'SPY' || k === 'spy');
    if (spyKey && data.markets[spyKey]?.dayChange) {
      const chg = data.markets[spyKey].dayChange;
      const dir = chg >= 0 ? '+' : '';
      bullets.push(`<b>Markets:</b> S&amp;P 500 ${dir}${chg}% on the day`);
    }
  }
  if (data.golf && data.golf.name) {
    const leader = data.golf.leaders?.[0];
    if (leader) bullets.push(`<b>Golf:</b> ${leader.name} leads ${data.golf.name}`);
    else bullets.push(`<b>Golf:</b> ${data.golf.name} underway`);
  }

  const bulletsHtml = bullets.length
    ? bullets.map(b => `
      <tr>
        <td style="padding: 7px 0; font-size: 15px; line-height: 1.5; color: #6E6862; border-top: 1px solid #E5E2DB;">
          <span style="color: #2B6FFF; font-weight: 700; margin-right: 6px;">→</span>${b}
        </td>
      </tr>`).join('')
    : `<tr><td style="padding:7px 0; color:#6E6862; font-size:15px;">Full brief ready — click below to read.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${data.title}</title>
</head>
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F9F8F5;">
<tr><td align="center" style="padding: 32px 16px 64px;">

  <!-- Card wrapper -->
  <table width="100%" style="max-width:600px;" cellpadding="0" cellspacing="0">

    <!-- Nav bar -->
    <tr>
      <td style="padding: 0 0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:'Inter Tight',-apple-system,sans-serif; font-weight:800; font-size:20px; letter-spacing:-0.03em; color:#0F1724;">
              GuyTalk<span style="color:#2B6FFF;">.</span>
            </td>
            <td align="right" style="font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.14em; color:#9E9891;">
              Issue #${num}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Header card -->
    <tr>
      <td style="background:#FFFFFF; border:1px solid #E5E2DB; border-radius:16px; overflow:hidden; padding:0; box-shadow:0 2px 12px rgba(0,0,0,0.06);">

        <!-- Blue top bar -->
        <div style="background:#2B6FFF; padding:12px 24px;">
          <span style="font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.18em; color:rgba(255,255,255,0.75);">${data.date}</span>
        </div>

        <!-- Content -->
        <div style="padding:28px 28px 24px;">
          <p style="font-family:'Inter Tight',-apple-system,sans-serif; font-weight:800; font-size:28px; line-height:1.12; letter-spacing:-0.03em; color:#0F1724; margin:0 0 12px;">
            ${data.title}
          </p>
          <p style="font-size:16px; color:#6E6862; margin:0 0 24px; line-height:1.6;">
            Five minutes. Everything you need.
          </p>

          <!-- TL;DR -->
          <div style="background:#F2F0EB; border-radius:10px; padding:16px 18px; margin-bottom:24px;">
            <p style="font-family:'Inter Tight',-apple-system,sans-serif; font-weight:700; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#2B6FFF; margin:0 0 12px;">
              Quick look
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${bulletsHtml}
            </table>
          </div>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="border-radius:10px; background:#2B6FFF; box-shadow:0 4px 14px rgba(43,111,255,0.3);">
                <a href="${briefUrl}" style="display:inline-block; padding:14px 26px; font-family:'Inter Tight',-apple-system,sans-serif; font-weight:700; font-size:15px; color:#FFFFFF; text-decoration:none; letter-spacing:-0.01em;">
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
      <td style="padding: 28px 0 0;">
        <p style="font-size:12px; color:#9E9891; line-height:1.6; margin:0 0 8px; text-align:center;">
          You're receiving this because you subscribed to GuyTalk.
        </p>
        <p style="font-size:12px; color:#9E9891; text-align:center; margin:0;">
          <a href="${SITE_URL}" style="color:#9E9891;">guytalk.com</a>
          &nbsp;·&nbsp;
          <a href="${signupUrl}" style="color:#9E9891;">Subscribe</a>
          &nbsp;·&nbsp;
          <a href="{{unsubscribe_url}}" style="color:#9E9891;">Unsubscribe</a>
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
  if (!API_KEY) {
    console.error('\n❌ BEEHIIV_API_KEY not set in .env.local');
    console.error('   Get it: beehiiv.com → Settings → API → Generate key');
    console.error('   Then add: BEEHIIV_API_KEY=your_key_here\n');
    process.exit(1);
  }

  const slug = getLatestSlug();
  if (!slug) { console.error('❌ No brief issues found in brief/'); process.exit(1); }

  const data = readData(slug);
  if (!data) {
    console.error(`❌ No data file found: brief/data/${slug}.json`);
    process.exit(1);
  }

  const num     = String(data.num).padStart(3, '0');
  const subject = `GuyTalk #${num} — ${data.title}`;
  const preview = `${data.date} · Five minutes. Everything you need.`;

  console.log(`\n📬 Sending brief to Beehiiv...`);
  console.log(`   Issue:   ${slug}`);
  console.log(`   Subject: ${subject}`);

  const emailHtml = buildEmailHtml(data, slug);

  if (DRY_RUN) {
    const outPath = path.join(ROOT, 'logs', `email-preview-${slug}.html`);
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    fs.writeFileSync(outPath, emailHtml);
    console.log(`\n   🔍 Dry run — email HTML saved to: logs/email-preview-${slug}.html`);
    console.log('   No post created.\n');
    return;
  }

  // 1. Create draft post
  console.log('   Creating Beehiiv post...');
  const post = await beehiiv('POST', `/publications/${PUB_ID}/posts`, {
    platform:      'email',
    status:        'draft',
    subject:       subject,
    preview_text:  preview,
    subtitle:      preview,
    content: {
      free:    emailHtml,
      premium: emailHtml,
    },
    audience:      'free',
    send_at:       null,
  });

  const postId = post.data?.id;
  if (!postId) throw new Error(`No post ID returned: ${JSON.stringify(post)}`);
  console.log(`   ✓ Draft created: ${postId}`);

  // 2. Confirm (send immediately)
  console.log('   Sending to subscribers...');
  await beehiiv('POST', `/publications/${PUB_ID}/posts/${postId}/status`, {
    status: 'confirmed',
  });

  console.log(`   ✓ Sent — ${slug} is live in subscribers' inboxes`);
  console.log(`   🔗 Brief URL: ${SITE_URL}/brief/${slug}/\n`);
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

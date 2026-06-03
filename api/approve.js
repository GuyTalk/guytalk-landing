// Vercel serverless function — GuyTalk brief approval endpoint
//
// Flow (two-step to prevent email-client prefetch from triggering a send):
//   GET /api/approve?token=TOKEN         → confirmation page showing brief + subscriber count
//   GET /api/approve?token=TOKEN&go=1    → validates, checks idempotency lock, sends, posts to X

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { TwitterApi } = require('twitter-api-v2');

function safeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const APPROVAL_TOKEN  = process.env.APPROVAL_TOKEN;
const BEEHIIV_API_KEY = process.env.BEEHIIV_API_KEY;
const X_API_KEY       = process.env.X_API_KEY;
const X_API_SECRET    = process.env.X_API_KEY_SECRET;
const X_ACCESS_TOKEN  = process.env.X_ACCESS_TOKEN;
const X_ACCESS_SECRET = process.env.X_ACCESS_TOKEN_SECRET;
const PO_BOX          = process.env.PO_BOX || 'PO Box [ADD MAILING ADDRESS]';
const PUB_ID          = 'pub_d4c6a5c9-3ff9-4986-b17a-9e5650d915be';
const SITE_URL        = 'https://www.guytalkmedia.com';
const FROM_EMAIL      = process.env.FROM_EMAIL || 'GuyTalk <onboarding@resend.dev>';

// ── Idempotency: write a lock file to /tmp after a successful send ────────────
// Prevents double-sends within the same Vercel warm instance (~5-10 min window).
function getLockPath(slug) {
  return path.join('/tmp', `gt-sent-${slug}.lock`);
}
function isAlreadySent(slug) {
  try { return fs.existsSync(getLockPath(slug)); } catch { return false; }
}
function markAsSent(slug) {
  try { fs.writeFileSync(getLockPath(slug), new Date().toISOString()); } catch (_) {}
}

// ── Post to X after approval ──────────────────────────────────────────────────
function buildSocialBullets(data) {
  const aiB = data.copy?.sharpTake?.bullets;
  if (Array.isArray(aiB) && aiB.length >= 2) return aiB.slice(0, 3);
  const bullets = [];
  if (data.sports?.length) {
    const g = data.sports[0];
    const w = g.home?.winner ? g.home : g.away;
    const l = g.home?.winner ? g.away : g.home;
    bullets.push(`${g.shortName || g.note} — ${w?.team} ${w?.score}, ${l?.team} ${l?.score}`);
  }
  if (data.markets?.SPY?.dayChangePct != null) {
    const chg = data.markets.SPY.dayChangePct;
    bullets.push(`S&P 500 ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% today`);
  }
  if (data.golf?.leaders?.[0]) {
    const golfVerb = data.golf.statusState === 'post' ? 'wins' : 'leads';
    bullets.push(`${data.golf.leaders[0].name} ${golfVerb} ${data.golf.name}`);
  } else if (data.f1?.name) {
    bullets.push(data.f1.results?.[0]?.driver
      ? `${data.f1.results[0].driver} wins ${data.f1.shortName || data.f1.name}`
      : `${data.f1.shortName || data.f1.name} this weekend`);
  }
  return bullets.slice(0, 3);
}

async function postToX(data, slug) {
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) return;
  try {
    const client   = new TwitterApi({ appKey: X_API_KEY, appSecret: X_API_SECRET, accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_SECRET });
    const num      = String(data.num).padStart(3, '0');
    const briefUrl = `${SITE_URL}/brief/${slug}/`;
    const bullets  = buildSocialBullets(data);
    const bulletLines = bullets.map(b => `→ ${b}`).join('\n');
    const tweet = `GuyTalk #${num}\n\n${bulletLines}\n\n${briefUrl}`;
    await client.v2.tweet(tweet.slice(0, 280));
  } catch (_) {
    // X post failure never blocks email delivery
  }
}

// ── Brief data helpers ────────────────────────────────────────────────────────
function getLatestBrief() {
  const dataDir = path.join(process.cwd(), 'brief', 'data');
  if (!fs.existsSync(dataDir)) return null;
  const files = fs.readdirSync(dataDir)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort();
  if (!files.length) return null;
  const latest = files[files.length - 1];
  const data = JSON.parse(fs.readFileSync(path.join(dataDir, latest), 'utf8'));
  return { data, slug: latest.replace('.json', '') };
}

// ── Fetch subscribers from Beehiiv ────────────────────────────────────────────
async function getSubscribers() {
  const emails = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUB_ID}/subscriptions?status=active&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${BEEHIIV_API_KEY}` } }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(`Beehiiv ${res.status}`);
    const subs = json.data || json.subscriptions || [];
    subs.forEach(s => { if (s.email) emails.push(s.email); });
    const totalPages = json.total_pages ?? json.pagination?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return emails;
}

// ── Get subscriber count without fetching all emails (fast check) ─────────────
async function getSubscriberCount() {
  try {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${PUB_ID}/subscriptions?status=active&per_page=1&page=1`,
      { headers: { Authorization: `Bearer ${BEEHIIV_API_KEY}` } }
    );
    const json = await res.json();
    return json.total_results ?? json.pagination?.total ?? null;
  } catch {
    return null;
  }
}

// ── Build subscriber email HTML ───────────────────────────────────────────────
function buildEmailHtml(data, slug, unsubEmail) {
  const briefUrl = `${SITE_URL}/brief/${slug}/`;
  const num      = String(data.num).padStart(3, '0');
  const unsubUrl = unsubEmail
    ? `https://app.beehiiv.com/unsubscribe?email=${encodeURIComponent(unsubEmail)}&pub_id=${PUB_ID}`
    : `${SITE_URL}/unsubscribe/`;

  const bullets = [];
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
  if (data.worldCup?.length) {
    const active = data.worldCup.find(m => m.statusState === 'in' || m.statusState === 'post');
    const wcStr = active
      ? `${active.away.team} vs ${active.home.team} — ${active.away.score}–${active.home.score}`
      : 'FIFA World Cup 2026 opens June 11';
    bullets.push(`<b style="color:#0F1724">World Cup:</b> ${wcStr}`);
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
<body style="margin:0;padding:0;background:#F9F8F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F8F5;">
<tr><td align="center" style="padding:32px 16px 64px;">
<table width="100%" style="max-width:580px;" cellpadding="0" cellspacing="0">

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

  <tr>
    <td style="background:#FFFFFF;border:1px solid #E5E2DB;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="background:#2B6FFF;padding:14px 28px;">
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;color:rgba(255,255,255,0.75);">${data.date}</span>
      </div>
      <div style="padding:28px 28px 24px;">
        <p style="font-weight:800;font-size:27px;line-height:1.12;letter-spacing:-0.025em;color:#0F1724;margin:0 0 10px;">
          ${data.title}
        </p>
        <p style="font-size:16px;color:#6E6862;margin:0 0 24px;line-height:1.6;">
          Five minutes. Everything you need.
        </p>
        <div style="background:#F2F0EB;border-radius:10px;padding:16px 18px;margin-bottom:24px;">
          <p style="font-weight:700;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#2B6FFF;margin:0 0 10px;">Quick look</p>
          <table width="100%" cellpadding="0" cellspacing="0">${bulletsHtml}</table>
        </div>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#2B6FFF;border-radius:10px;box-shadow:0 4px 14px rgba(43,111,255,0.28);">
              <a href="${briefUrl}" style="display:inline-block;padding:14px 28px;font-weight:700;font-size:15px;color:#FFFFFF;text-decoration:none;">
                Read today's brief →
              </a>
            </td>
          </tr>
        </table>
      </div>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 0 0;text-align:center;">
      <p style="font-size:12px;color:#9E9891;margin:0 0 6px;">
        You're receiving this because you subscribed to GuyTalk.
      </p>
      <p style="font-size:12px;color:#9E9891;margin:0 0 4px;">
        <a href="${SITE_URL}" style="color:#9E9891;text-decoration:underline;">guytalkmedia.com</a>
        &nbsp;·&nbsp;
        <a href="${unsubUrl}" style="color:#9E9891;text-decoration:underline;">Unsubscribe</a>
      </p>
      <p style="font-size:11px;color:#B8B4AC;margin:0;">
        GuyTalk · ${PO_BOX} · United States
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Confirmation page (shown on first tap — prevents email prefetch sends) ────
function confirmPage(data, slug, subscriberCount, token) {
  const num      = String(data.num).padStart(3, '0');
  const briefUrl = `${SITE_URL}/brief/${slug}/`;
  const sendUrl  = `/api/approve?token=${encodeURIComponent(token)}&go=1`;
  const subLine  = subscriberCount != null ? `${subscriberCount} subscriber${subscriberCount !== 1 ? 's' : ''}` : 'your subscribers';

  const bullets = buildSocialBullets(data);
  const bulletRows = bullets.map(b =>
    `<p style="font-size:14px;color:#444;margin:6px 0;"><span style="color:#2B6FFF;font-weight:700;margin-right:6px;">→</span>${b}</p>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GuyTalk — Confirm Send</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F9F8F5;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#fff;border:1px solid #E5E2DB;border-radius:16px;padding:32px 28px;max-width:420px;width:100%;}
  .logo{font-weight:800;font-size:18px;letter-spacing:-0.02em;color:#0F1724;margin-bottom:20px;}
  .logo span{color:#2B6FFF;}
  .issue-num{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#9E9891;margin-bottom:8px;}
  h1{font-size:20px;font-weight:800;color:#0F1724;margin:0 0 6px;line-height:1.2;}
  .date{font-size:13px;color:#9E9891;margin:0 0 20px;}
  .bullets{background:#F8F7F4;border-radius:8px;padding:12px 16px;margin:0 0 24px;}
  .sub-count{font-size:14px;color:#6E6862;margin:0 0 20px;}
  .btn-send{display:block;width:100%;padding:15px;background:#16A34A;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;text-align:center;margin-bottom:10px;}
  .btn-read{display:block;width:100%;padding:13px;border:1.5px solid #E5E2DB;color:#0F1724;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;text-align:center;}
  .note{font-size:11px;color:#B0ADA8;text-align:center;margin-top:16px;line-height:1.6;}
</style>
</head>
<body>
<div class="card">
  <div class="logo">GuyTalk<span>.</span></div>
  <div class="issue-num">Issue #${num} · Ready to send</div>
  <h1>${data.title}</h1>
  <p class="date">${data.date}</p>
  <div class="bullets">${bulletRows}</div>
  <p class="sub-count">This will send to <strong>${subLine}</strong>.</p>
  <a href="${sendUrl}" class="btn-send">Confirm — Send to ${subLine} →</a>
  <a href="${briefUrl}" class="btn-read" target="_blank">Read the full brief first →</a>
  <p class="note">Only you can see this page.<br>Tap the green button to send.</p>
</div>
</body></html>`;
}

// ── Success / already-sent / error pages ──────────────────────────────────────
function sentPage(sent, failed, slug) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GuyTalk — Sent</title>
<style>
  body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F9F8F5;display:flex;align-items:center;justify-content:center;min-height:100vh;box-sizing:border-box;}
  .card{background:#fff;border:1px solid #E5E2DB;border-radius:16px;padding:40px 32px;max-width:400px;width:100%;text-align:center;}
  .icon{font-size:48px;margin-bottom:16px;}
  h1{font-size:24px;font-weight:800;color:#0F1724;margin:0 0 8px;letter-spacing:-0.02em;}
  p{font-size:15px;color:#6E6862;margin:0 0 24px;line-height:1.6;}
  a{display:inline-block;padding:12px 24px;background:#2B6FFF;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;}
</style></head>
<body><div class="card">
  <div class="icon">✅</div>
  <h1>Brief sent.</h1>
  <p>${sent} subscriber${sent !== 1 ? 's' : ''} received today's issue.${failed ? ` ${failed} failed.` : ''}</p>
  <a href="/brief/${slug}/">View the brief →</a>
</div></body></html>`;
}

function alreadySentPage(slug) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GuyTalk — Already Sent</title>
<style>
  body{margin:0;padding:40px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#F9F8F5;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#fff;border:1px solid #E5E2DB;border-radius:16px;padding:40px 32px;max-width:400px;width:100%;text-align:center;}
  .icon{font-size:48px;margin-bottom:16px;}
  h1{font-size:22px;font-weight:800;color:#0F1724;margin:0 0 8px;}
  p{font-size:14px;color:#6E6862;margin:0 0 20px;}
  a{display:inline-block;padding:12px 24px;background:#2B6FFF;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;}
</style></head>
<body><div class="card">
  <div class="icon">✓</div>
  <h1>Already sent.</h1>
  <p>This issue was already delivered to subscribers. Nothing was sent again.</p>
  <a href="/brief/${slug}/">View the brief →</a>
</div></body></html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GuyTalk — Error</title>
<style>
  body{margin:0;padding:40px 20px;font-family:-apple-system,sans-serif;background:#F9F8F5;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#fff;border:1px solid #E5E2DB;border-radius:16px;padding:40px 32px;max-width:400px;width:100%;text-align:center;}
  h1{font-size:22px;font-weight:800;color:#DC2626;margin:0 0 8px;}
  p{font-size:14px;color:#6E6862;margin:0;}
</style></head>
<body><div class="card">
  <h1>Something went wrong.</h1>
  <p>${msg}</p>
</div></body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).end('Method not allowed');
    return;
  }

  // Validate token
  const token = req.query.token;
  if (!APPROVAL_TOKEN) {
    res.status(500).send(errorPage('Server misconfiguration. Check Vercel environment variables.'));
    return;
  }
  if (!token || !safeTokenEqual(token, APPROVAL_TOKEN)) {
    res.status(403).send(errorPage('Invalid or missing approval token.'));
    return;
  }

  // Check env vars
  if (!RESEND_API_KEY || !BEEHIIV_API_KEY) {
    res.status(500).send(errorPage('Missing environment variables. Check Vercel config.'));
    return;
  }

  // Get brief data
  const brief = getLatestBrief();
  if (!brief) {
    res.status(404).send(errorPage('No brief data found in deployment.'));
    return;
  }
  const { data, slug } = brief;

  // ── Step 1: Confirmation page (no go=1 param) ─────────────────────────────
  // Email clients prefetch links — this step ensures a prefetch never triggers a send.
  if (req.query.go !== '1') {
    const count = await getSubscriberCount().catch(() => null);
    res.status(200).send(confirmPage(data, slug, count, token));
    return;
  }

  // ── Step 2: Idempotency check ─────────────────────────────────────────────
  if (isAlreadySent(slug)) {
    res.status(200).send(alreadySentPage(slug));
    return;
  }

  // ── Step 3: Fetch subscribers ─────────────────────────────────────────────
  let emails;
  try {
    emails = await getSubscribers();
  } catch (err) {
    res.status(500).send(errorPage(`Failed to fetch subscribers: ${err.message}`));
    return;
  }

  if (!emails.length) {
    res.status(200).send(sentPage(0, 0, slug));
    return;
  }

  // ── Step 4: Build and send via Resend batch API ───────────────────────────
  const num     = String(data.num).padStart(3, '0');
  const subject = `GuyTalk #${num} — ${data.title}`;
  const payloads = emails.map(email => ({
    from:    FROM_EMAIL,
    to:      email,
    subject: subject,
    html:    buildEmailHtml(data, slug, email),
  }));

  const BATCH = 100;
  let sent = 0, failed = 0;
  for (let i = 0; i < payloads.length; i += BATCH) {
    const batch = payloads.slice(i, i + BATCH);
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });
      if (r.ok) {
        const result = await r.json();
        const d      = Array.isArray(result?.data) ? result.data : [];
        sent   += d.filter(e => e?.id).length;
        failed += batch.length - d.filter(e => e?.id).length;
      } else {
        failed += batch.length;
      }
    } catch (_) {
      failed += batch.length;
    }
  }

  // ── Step 5: Write idempotency lock ────────────────────────────────────────
  if (sent > 0) markAsSent(slug);

  // ── Step 6: Post to X (non-blocking) ─────────────────────────────────────
  await postToX(data, slug);

  res.status(200).send(sentPage(sent, failed, slug));
};

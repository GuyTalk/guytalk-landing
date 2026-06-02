#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');
const https = require('https');

const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const BASE_URL       = 'https://www.guytalkmedia.com';

const isDryRun = process.argv.includes('--dry-run');
if (!BUFFER_API_KEY && !isDryRun) {
  console.error('❌  BUFFER_API_KEY not set. Add it to .env.local');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET' };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Build caption for Instagram / TikTok / X
// ─────────────────────────────────────────────────────────────────────────────
function buildCaption(issue, platform) {
  const { title, copy, slug, date, sports, markets, golf, upcoming } = issue;
  const bullets = copy?.sharpTake?.bullets || [];
  const briefUrl = `${BASE_URL}/brief/${slug}/`;

  // Build a punchy hook from bullet content or raw data
  const hook = (() => {
    if (bullets[0]) return bullets[0];
    if (sports?.length) {
      const g = sports[0];
      const w = g.home?.winner ? g.home : g.away;
      const l = g.home?.winner ? g.away : g.home;
      return `${w.team} ${w.score}–${l.score} over ${l.team}. ${g.seriesNote || ''}`.trim();
    }
    if (upcoming?.length) return `${upcoming[0].note || upcoming[0].shortName} tips off ${upcoming[0].daysAhead <= 1 ? 'tomorrow' : 'this week'}.`;
    return 'Five minutes. Everything you need.';
  })();

  // Bullets block
  const bulletLines = bullets.slice(0, 3)
    .map(b => `→ ${b}`)
    .join('\n');

  // Dynamic tags based on content
  const coreTags = ['#GuyTalk', '#DailyBrief', '#MorningRead'];
  const sportsTags = sports?.length ? ['#Sports', '#NBA'] : upcoming?.length ? ['#NBAFinals', '#NBA'] : ['#Sports'];
  const marketsTags = markets?.SPY ? ['#Markets', '#Investing'] : [];
  const golfTags = golf?.leaders?.[0] ? ['#Golf', '#PGATour'] : [];
  const f1Tags = issue.f1?.name ? ['#F1', '#Formula1'] : [];
  const allTags = [...coreTags, ...sportsTags, ...marketsTags, ...golfTags, ...f1Tags, '#MensLifestyle'].join(' ');

  if (platform === 'x') {
    // X: concise, punchy, character-limited (280). No link (already has card preview).
    const shortBullet = bullets[0] ? `\n\n${bullets[0]}` : '';
    return `${title}${shortBullet}\n\nguytalkmedia.com/brief/${slug}/`.trim();
  }

  if (platform === 'tiktok') {
    return `${hook}\n\n${title}\n\n${bulletLines || '→ Full breakdown in bio'}\n\nLink in bio 👆\n\n${allTags}`.trim();
  }

  // Instagram
  return `${hook}\n\n${title}\n\n${bulletLines || '→ Full brief at the link.'}\n\nLink in bio 👆 — ${briefUrl}\n\n${allTags}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Post to Buffer (schedule or now)
// ─────────────────────────────────────────────────────────────────────────────
async function queueToBuffer(profileId, text, scheduledAt) {
  const params = {
    'profile_ids[]': profileId,
    text,
    access_token: BUFFER_API_KEY,
  };
  if (scheduledAt) {
    params.scheduled_at = scheduledAt.toISOString();
  } else {
    params.now = 'true';
  }
  return httpPost('https://api.bufferapp.com/1/updates/create.json', params);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Buffer profiles
// ─────────────────────────────────────────────────────────────────────────────
async function getProfiles() {
  const res = await httpGet(`https://api.bufferapp.com/1/profiles.json?access_token=${BUFFER_API_KEY}`);
  if (res.status !== 200 || !Array.isArray(res.body)) {
    console.error('❌  Could not fetch Buffer profiles:', res.status, res.body);
    return { instagram: null, tiktok: null, twitter: null };
  }
  const instagram = res.body.find(p => p.service === 'instagram');
  const tiktok    = res.body.find(p => p.service === 'tiktok');
  const twitter   = res.body.find(p => p.service === 'twitter');
  return { instagram, tiktok, twitter };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const dryRun = isDryRun;
  const single = process.argv.find(a => a.startsWith('--issue='))?.replace('--issue=', '');

  console.log(`\n${'═'.repeat(44)}`);
  console.log(`  GuyTalk Social Queue${dryRun ? ' · DRY RUN' : ''}`);
  console.log(`${'═'.repeat(44)}\n`);

  // Load issue JSON files — deduplicated by date (same logic as archive)
  const dataDir = path.join(__dirname, '..', 'brief', 'data');
  const allFiles = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json') && f.startsWith('issue-'))
    .sort();

  let files;
  if (single) {
    files = allFiles.filter(f => f.includes(single));
    if (!files.length) { console.error(`No data file for issue "${single}"`); process.exit(1); }
  } else {
    // Deduplicate by date (keep highest issue number per date), drop REPLACE placeholders
    const allIssues = allFiles.map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); return { f, d }; }
      catch (_) { return null; }
    }).filter(x => x && x.d.title && !x.d.title.startsWith('REPLACE'));

    const byDate = new Map();
    for (const { f, d } of allIssues) {
      const key = d.date || f;
      const existing = byDate.get(key);
      if (!existing || (d.num || 0) > (existing.d.num || 0)) byDate.set(key, { f, d });
    }
    // Only queue recent issues (last 7 days) — max 3 to avoid spamming stale content
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    files = Array.from(byDate.values())
      .sort((a, b) => (b.d.num || 0) - (a.d.num || 0))
      .filter(x => {
        if (!x.d.date) return true;
        const d = new Date(x.d.date);
        return !isNaN(d) && d >= cutoff;
      })
      .slice(0, 3)
      .sort((a, b) => (a.d.num || 0) - (b.d.num || 0))
      .map(x => x.f);
    if (!files.length) {
      // Fallback: just the most recent issue
      files = Array.from(byDate.values())
        .sort((a, b) => (b.d.num || 0) - (a.d.num || 0))
        .slice(0, 1)
        .map(x => x.f);
    }
  }

  // Get Buffer profiles (skip in dry-run)
  let instagram = null, tiktok = null, twitter = null;
  if (!dryRun) {
    const profiles = await getProfiles();
    instagram = profiles.instagram;
    tiktok    = profiles.tiktok;
    twitter   = profiles.twitter;
    if (!instagram && !tiktok && !twitter) {
      console.error('❌  No Instagram, TikTok, or X profiles found in Buffer');
      process.exit(1);
    }
    if (instagram) console.log(`  ✓ Instagram: ${instagram.formatted_username || instagram._id}`);
    if (tiktok)    console.log(`  ✓ TikTok:    ${tiktok.formatted_username   || tiktok._id}`);
    if (twitter)   console.log(`  ✓ X:         ${twitter.formatted_username  || twitter._id}`);
  } else {
    console.log('  ℹ  Dry-run — skipping Buffer profile fetch');
  }
  console.log('');

  // Schedule: spread posts over the next 3 days, 2 per day
  // Start at next 9am ET
  const now = new Date();
  const scheduleStart = new Date(now);
  scheduleStart.setHours(9, 0, 0, 0);
  if (scheduleStart <= now) scheduleStart.setDate(scheduleStart.getDate() + 1);

  const slotHours = [9, 17]; // 9am and 5pm
  const slots = [];
  for (let day = 0; day < 5; day++) {
    for (const h of slotHours) {
      const d = new Date(scheduleStart);
      d.setDate(d.getDate() + day);
      d.setHours(h, 0, 0, 0);
      slots.push(d);
    }
  }

  let slotIdx = 0;

  for (const file of files) {
    const issue = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const { slug, title } = issue;

    const igCaption  = buildCaption(issue, 'instagram');
    const ttCaption  = buildCaption(issue, 'tiktok');
    const xCaption   = buildCaption(issue, 'x');
    const scheduled  = slots[slotIdx] || null;
    slotIdx++;

    console.log(`  📱 ${slug} — ${title.slice(0, 60)}...`);
    console.log(`     Scheduled: ${scheduled?.toLocaleString() || 'now'}`);

    if (dryRun) {
      console.log(`     [DRY RUN] Instagram: ${igCaption.slice(0, 80)}...`);
      console.log(`     [DRY RUN] TikTok:    ${ttCaption.slice(0, 80)}...`);
      console.log(`     [DRY RUN] X:         ${xCaption.slice(0, 80)}...`);
      console.log('');
      continue;
    }

    if (instagram) {
      try {
        const r = await queueToBuffer(instagram._id, igCaption, scheduled);
        console.log(`     ✓ Instagram queued (${r.status})`);
      } catch (e) {
        console.log(`     ⚠  Instagram failed: ${e.message}`);
      }
    }

    if (tiktok) {
      try {
        const r = await queueToBuffer(tiktok._id, ttCaption, scheduled);
        console.log(`     ✓ TikTok queued (${r.status})`);
      } catch (e) {
        console.log(`     ⚠  TikTok failed: ${e.message}`);
      }
    }

    if (twitter) {
      try {
        const r = await queueToBuffer(twitter._id, xCaption, scheduled);
        console.log(`     ✓ X queued (${r.status})`);
      } catch (e) {
        console.log(`     ⚠  X failed: ${e.message}`);
      }
    }

    console.log('');
    // Rate-limit: 250ms between posts
    await new Promise(r => setTimeout(r, 250));
  }

  console.log('  Done. Check your Buffer queue → https://buffer.com/app/queue\n');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});

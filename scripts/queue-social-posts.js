#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');
const https = require('https');

const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const BASE_URL       = 'https://www.guytalkmedia.com';
const BUFFER_ENDPOINT = 'https://api.buffer.com';

const isDryRun = process.argv.includes('--dry-run');
if (!BUFFER_API_KEY && !isDryRun) {
  console.error('❌  BUFFER_API_KEY not set. Add it to .env.local');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL helper
// ─────────────────────────────────────────────────────────────────────────────
function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: 'api.buffer.com',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BUFFER_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
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
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Get org ID from account
// ─────────────────────────────────────────────────────────────────────────────
async function getOrgId() {
  const res = await graphql(`
    query GetOrganizations {
      account {
        organizations {
          id
          name
        }
      }
    }
  `);
  const orgs = res.body?.data?.account?.organizations;
  if (!orgs?.length) throw new Error('No organizations found for this API key');
  return orgs[0].id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get channels for org
// ─────────────────────────────────────────────────────────────────────────────
async function getChannels(orgId) {
  const res = await graphql(`
    query GetChannels($orgId: OrganizationId!) {
      channels(input: { organizationId: $orgId }) {
        id
        name
        service
        descriptor
      }
    }
  `, { orgId });
  return res.body?.data?.channels || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a post on a channel
// ─────────────────────────────────────────────────────────────────────────────
async function createPost(channelId, text, scheduledAt, imageUrl) {
  const input = {
    channelId,
    text,
    schedulingType: 'automatic',
    mode: scheduledAt ? 'customScheduled' : 'addToQueue',
  };
  if (scheduledAt) input.dueAt = scheduledAt.toISOString();
  if (imageUrl) input.imageUrls = [imageUrl];

  const res = await graphql(`
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
            status
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `, { input });

  if (res.body?.errors?.length) throw new Error(res.body.errors[0].message);
  const result = res.body?.data?.createPost;
  if (result?.message) throw new Error(result.message);
  return result?.post;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build caption per platform
// ─────────────────────────────────────────────────────────────────────────────
function buildCaption(issue, platform) {
  const { title, copy, slug, sports, markets, golf, upcoming, f1 } = issue;
  const bullets = copy?.sharpTake?.bullets || [];
  const briefUrl = `${BASE_URL}/brief/${slug}/`;

  const hook = (() => {
    if (bullets[0]) return bullets[0];
    if (upcoming?.length) return `${upcoming[0].note || upcoming[0].shortName} tips off ${upcoming[0].daysAhead <= 1 ? 'tomorrow' : 'this week'}.`;
    if (sports?.length) {
      const g = sports[0];
      const w = g.home?.winner ? g.home : g.away;
      const l = g.home?.winner ? g.away : g.home;
      return `${w.team} ${w.score}–${l.score} over ${l.team}.`;
    }
    return 'Five minutes. Everything you need.';
  })();

  const bulletLines = bullets.slice(0, 3).map(b => `→ ${b}`).join('\n');

  const coreTags   = ['#GuyTalk', '#DailyBrief', '#MorningRead'];
  const sportsTags = upcoming?.length ? ['#NBAFinals', '#NBA'] : sports?.length ? ['#Sports', '#NBA'] : ['#Sports'];
  const marketsTags = markets?.SPY ? ['#Markets', '#Investing'] : [];
  const golfTags   = golf?.leaders?.[0] ? ['#Golf', '#PGATour'] : [];
  const f1Tags     = f1?.name ? ['#F1', '#Formula1'] : [];
  const allTags    = [...coreTags, ...sportsTags, ...marketsTags, ...golfTags, ...f1Tags, '#MensLifestyle'].join(' ');

  if (platform === 'x' || platform === 'twitter') {
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
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const single = process.argv.find(a => a.startsWith('--issue='))?.replace('--issue=', '');

  console.log(`\n${'═'.repeat(44)}`);
  console.log(`  GuyTalk Social Queue${isDryRun ? ' · DRY RUN' : ''}`);
  console.log(`${'═'.repeat(44)}\n`);

  // Load issue JSON files
  const dataDir = path.join(__dirname, '..', 'brief', 'data');
  const allFiles = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json') && f.startsWith('issue-'))
    .sort();

  let files;
  if (single) {
    files = allFiles.filter(f => f.includes(single));
    if (!files.length) { console.error(`No data file for issue "${single}"`); process.exit(1); }
  } else {
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
      files = Array.from(byDate.values())
        .sort((a, b) => (b.d.num || 0) - (a.d.num || 0))
        .slice(0, 1)
        .map(x => x.f);
    }
  }

  // Get Buffer channels
  let channels = { instagram: null, tiktok: null, twitter: null };
  if (!isDryRun) {
    console.log('  Connecting to Buffer...');
    const orgId = await getOrgId();
    console.log(`  ✓ Org ID: ${orgId}`);
    const allChannels = await getChannels(orgId);

    channels.instagram = allChannels.find(c => c.service?.toLowerCase() === 'instagram');
    channels.tiktok    = allChannels.find(c => c.service?.toLowerCase() === 'tiktok');
    channels.twitter   = allChannels.find(c =>
      c.service?.toLowerCase() === 'twitter' || c.service?.toLowerCase() === 'x'
    );

    if (channels.instagram) console.log(`  ✓ Instagram: ${channels.instagram.name || channels.instagram.id}`);
    if (channels.tiktok)    console.log(`  ✓ TikTok:    ${channels.tiktok.name    || channels.tiktok.id}`);
    if (channels.twitter)   console.log(`  ✓ X:         ${channels.twitter.name   || channels.twitter.id}`);

    if (!channels.instagram && !channels.tiktok && !channels.twitter) {
      console.error('❌  No channels found in Buffer. Connect channels at buffer.com');
      process.exit(1);
    }
  } else {
    console.log('  ℹ  Dry-run — skipping Buffer channel fetch');
  }
  console.log('');

  // Schedule slots: 9am and 5pm over next 5 days
  const now = new Date();
  const scheduleStart = new Date(now);
  scheduleStart.setHours(9, 0, 0, 0);
  if (scheduleStart <= now) scheduleStart.setDate(scheduleStart.getDate() + 1);

  const slots = [];
  for (let day = 0; day < 5; day++) {
    for (const h of [9, 17]) {
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

    const igCaption = buildCaption(issue, 'instagram');
    const ttCaption = buildCaption(issue, 'tiktok');
    const xCaption  = buildCaption(issue, 'x');
    const scheduled = slots[slotIdx] || null;
    const cardUrl   = `${BASE_URL}/assets/social-cards/${slug}.png`;
    slotIdx++;

    console.log(`  📱 ${slug} — ${title.slice(0, 60)}`);
    console.log(`     Scheduled: ${scheduled?.toLocaleString() || 'add to queue'}`);
    console.log(`     Card: ${cardUrl}`);

    if (isDryRun) {
      console.log(`     [DRY] X:         ${xCaption.slice(0, 100)}`);
      console.log(`     [DRY] Instagram: ${igCaption.slice(0, 100)}`);
      console.log(`     [DRY] TikTok:    ${ttCaption.slice(0, 100)}`);
      console.log('');
      continue;
    }

    if (channels.twitter) {
      try {
        await createPost(channels.twitter.id, xCaption, scheduled);
        console.log('     ✓ X queued');
      } catch (e) { console.log(`     ⚠  X failed: ${e.message}`); }
    }

    if (channels.instagram) {
      try {
        await createPost(channels.instagram.id, igCaption, scheduled, cardUrl);
        console.log('     ✓ Instagram queued');
      } catch (e) { console.log(`     ⚠  Instagram failed: ${e.message}`); }
    }

    if (channels.tiktok) {
      try {
        await createPost(channels.tiktok.id, ttCaption, scheduled, cardUrl);
        console.log('     ✓ TikTok queued');
      } catch (e) { console.log(`     ⚠  TikTok failed: ${e.message}`); }
    }

    console.log('');
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  Done.${isDryRun ? '' : ' Check your queue → https://publish.buffer.com'}\n`);
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});

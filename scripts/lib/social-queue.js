'use strict';

/**
 * Shared social-queue logic.
 *
 * Pushes the latest brief issues into Buffer's queue, which then auto-posts to
 * the connected X / Instagram / TikTok channels on schedule. Used by both the
 * CLI (scripts/queue-social-posts.js) and the daily Vercel cron
 * (api/social-queue.js) so there's a single source of truth.
 *
 * No posting happens here directly — everything routes through Buffer's API.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const BASE_URL = 'https://www.guytalkmedia.com';
const DATA_DIR = path.join(__dirname, '..', '..', 'brief', 'data');

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL helper
// ─────────────────────────────────────────────────────────────────────────────
function graphql(apiKey, query, variables = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: 'api.buffer.com',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
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

async function getOrgId(apiKey) {
  const res = await graphql(apiKey, `
    query GetOrganizations {
      account { organizations { id name } }
    }
  `);
  const orgs = res.body?.data?.account?.organizations;
  if (!orgs?.length) throw new Error('No organizations found for this API key');
  return orgs[0].id;
}

async function getChannels(apiKey, orgId) {
  const res = await graphql(apiKey, `
    query GetChannels($orgId: OrganizationId!) {
      channels(input: { organizationId: $orgId }) {
        id name service descriptor
      }
    }
  `, { orgId });
  return res.body?.data?.channels || [];
}

async function createPost(apiKey, channelId, text, scheduledAt, imageUrl, metadata) {
  const input = {
    channelId,
    text,
    schedulingType: 'automatic',
    mode: scheduledAt ? 'customScheduled' : 'addToQueue',
  };
  if (scheduledAt) input.dueAt = scheduledAt.toISOString();
  if (imageUrl) input.assets = [{ image: { url: imageUrl } }];
  if (metadata) input.metadata = metadata;

  const res = await graphql(apiKey, `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id text dueAt status } }
        ... on MutationError { message }
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

  const coreTags    = ['#GuyTalk', '#DailyBrief', '#MorningRead'];
  const sportsTags  = upcoming?.length ? ['#NBAFinals', '#NBA'] : sports?.length ? ['#Sports', '#NBA'] : ['#Sports'];
  const marketsTags = markets?.SPY ? ['#Markets', '#Investing'] : [];
  const golfTags    = golf?.leaders?.[0] ? ['#Golf', '#PGATour'] : [];
  const f1Tags      = f1?.name ? ['#F1', '#Formula1'] : [];
  const allTags     = [...coreTags, ...sportsTags, ...marketsTags, ...golfTags, ...f1Tags, '#MensLifestyle'].join(' ');

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
// Select which issue files to queue (latest 3 within the last 7 days)
// ─────────────────────────────────────────────────────────────────────────────
function selectIssueFiles(single) {
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('issue-'))
    .sort();

  if (single) {
    const files = allFiles.filter(f => f.includes(single));
    if (!files.length) throw new Error(`No data file for issue "${single}"`);
    return files;
  }

  const allIssues = allFiles.map(f => {
    try { const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); return { f, d }; }
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
  let files = Array.from(byDate.values())
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
  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build schedule slots: 9am and 5pm over the next 5 days
// ─────────────────────────────────────────────────────────────────────────────
function buildSlots() {
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
  return slots;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry — queue posts to Buffer.
//   opts: { apiKey, dryRun, single, log }
//   returns: { dryRun, channels, issues: [...] }
// ─────────────────────────────────────────────────────────────────────────────
async function queueSocialPosts({ apiKey, dryRun = false, single = null, log = () => {} } = {}) {
  if (!apiKey && !dryRun) throw new Error('BUFFER_API_KEY not set');

  const files = selectIssueFiles(single);

  // Resolve connected Buffer channels (skipped on dry run).
  let channels = { instagram: null, tiktok: null, twitter: null };
  if (!dryRun) {
    const orgId = await getOrgId(apiKey);
    const allChannels = await getChannels(apiKey, orgId);
    channels.instagram = allChannels.find(c => c.service?.toLowerCase() === 'instagram');
    channels.tiktok    = allChannels.find(c => c.service?.toLowerCase() === 'tiktok');
    channels.twitter   = allChannels.find(c => ['twitter', 'x'].includes(c.service?.toLowerCase()));
    if (channels.instagram) log(`  ✓ Instagram: ${channels.instagram.name || channels.instagram.id}`);
    if (channels.tiktok)    log(`  ✓ TikTok:    ${channels.tiktok.name    || channels.tiktok.id}`);
    if (channels.twitter)   log(`  ✓ X:         ${channels.twitter.name   || channels.twitter.id}`);
    if (!channels.instagram && !channels.tiktok && !channels.twitter) {
      throw new Error('No channels found in Buffer. Connect channels at buffer.com');
    }
  }

  const slots = buildSlots();
  let slotIdx = 0;
  const issues = [];

  for (const file of files) {
    const issue = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    const { slug, title } = issue;

    const captions = {
      instagram: buildCaption(issue, 'instagram'),
      tiktok:    buildCaption(issue, 'tiktok'),
      x:         buildCaption(issue, 'x'),
    };
    const scheduled  = slots[slotIdx] || null;
    const cardUrl    = `${BASE_URL}/assets/social-cards/${slug}.png`;
    const tiktokCard = `${BASE_URL}/assets/tiktok-cards/${slug}.jpg`;
    slotIdx++;

    const entry = { slug, title, scheduled: scheduled ? scheduled.toISOString() : null, results: {} };
    log(`  📱 ${slug} — ${(title || '').slice(0, 60)}`);
    log(`     Scheduled: ${scheduled?.toLocaleString() || 'add to queue'}`);

    if (dryRun) {
      entry.results = { x: 'dry', instagram: 'dry', tiktok: 'dry' };
      entry.captions = captions;
      issues.push(entry);
      continue;
    }

    if (channels.twitter) {
      try { await createPost(apiKey, channels.twitter.id, captions.x, scheduled); entry.results.x = 'queued'; log('     ✓ X queued'); }
      catch (e) { entry.results.x = `failed: ${e.message}`; log(`     ⚠  X failed: ${e.message}`); }
    }
    if (channels.instagram) {
      try { await createPost(apiKey, channels.instagram.id, captions.instagram, scheduled, cardUrl, { instagram: { type: 'post', shouldShareToFeed: true } }); entry.results.instagram = 'queued'; log('     ✓ Instagram queued'); }
      catch (e) { entry.results.instagram = `failed: ${e.message}`; log(`     ⚠  Instagram failed: ${e.message}`); }
    }
    if (channels.tiktok) {
      try { await createPost(apiKey, channels.tiktok.id, captions.tiktok, scheduled, tiktokCard); entry.results.tiktok = 'queued'; log('     ✓ TikTok queued'); }
      catch (e) { entry.results.tiktok = `failed: ${e.message}`; log(`     ⚠  TikTok failed: ${e.message}`); }
    }

    issues.push(entry);
    await new Promise(r => setTimeout(r, 300));
  }

  return { dryRun, channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v ? (v.name || v.id) : null])), issues };
}

module.exports = { queueSocialPosts, buildCaption, selectIssueFiles };

#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const { queueSocialPosts } = require('./lib/social-queue');

const isDryRun = process.argv.includes('--dry-run');
const single   = process.argv.find(a => a.startsWith('--issue='))?.replace('--issue=', '') || null;
const apiKey   = process.env.BUFFER_API_KEY;

if (!apiKey && !isDryRun) {
  console.error('❌  BUFFER_API_KEY not set. Add it to .env.local');
  process.exit(1);
}

async function main() {
  console.log(`\n${'═'.repeat(44)}`);
  console.log(`  GuyTalk Social Queue${isDryRun ? ' · DRY RUN' : ''}`);
  console.log(`${'═'.repeat(44)}\n`);

  if (!isDryRun) console.log('  Connecting to Buffer...');

  const result = await queueSocialPosts({ apiKey, dryRun: isDryRun, single, log: console.log });

  if (isDryRun) {
    for (const issue of result.issues) {
      console.log(`\n  [DRY] X:         ${issue.captions.x.slice(0, 100)}`);
      console.log(`  [DRY] Instagram: ${issue.captions.instagram.slice(0, 100)}`);
      console.log(`  [DRY] TikTok:    ${issue.captions.tiktok.slice(0, 100)}`);
    }
  }

  console.log(`\n  Done.${isDryRun ? '' : ' Check your queue → https://publish.buffer.com'}\n`);
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});

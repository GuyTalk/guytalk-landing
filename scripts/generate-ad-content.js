#!/usr/bin/env node
'use strict';

/**
 * GuyTalk Ad Content Generator
 *
 * Generates Marketing Studio UGC videos and scenario images using Higgsfield CLI.
 *
 * Usage:
 *   node scripts/generate-ad-content.js              # generate all ad types
 *   node scripts/generate-ad-content.js --ugc        # UGC videos only
 *   node scripts/generate-ad-content.js --images     # website images only
 *   node scripts/generate-ad-content.js --video      # scenario videos only
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ADS_DIR    = path.join(__dirname, '..', 'assets', 'ads');
const IMAGES_DIR = path.join(__dirname, '..', 'assets', 'website-images');

for (const d of [ADS_DIR, IMAGES_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function run(cmd, label) {
  console.log(`  Generating: ${label}...`);
  try {
    const url = execSync(cmd, { encoding: 'utf8', timeout: 300000 }).trim();
    if (!url.startsWith('http')) throw new Error(`Unexpected: ${url}`);
    return url;
  } catch (e) {
    console.log(`  ⚠  Failed (${label}): ${e.message?.slice(0, 120)}`);
    return null;
  }
}

function download(url, outPath, label) {
  if (!url) return;
  execSync(`curl -sL "${url}" -o "${outPath}"`);
  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${label} → ${path.relative(process.cwd(), outPath)} (${size}MB)`);
}

// ─── MALE AVATARS ───────────────────────────────────────────────────────────
const AVATARS = {
  liam:   '734451fd-d418-40bd-9dee-5b467658b0d4',
  erik:   'e572fd1d-eed1-4dff-b9ef-d48c2e652477',
  stefan: '35cd52c0-e92b-44b1-b56d-b4ea5e609c00',
  malik:  '94950cff-b90a-4416-8384-ce554ff387e1',
  felix:  '83711427-335b-4b9c-b89a-b6fa78579b49',
  joon:   '48b5553f-4bad-4b87-9a39-4f0088664ed7',
};

// ─── HOOKS ──────────────────────────────────────────────────────────────────
const HOOKS = {
  interview:   '26cac2dd-99cb-4818-a678-509b0dab2c32',
  cameraBump:  '2db84ed8-7082-4981-9c9c-9d61b3c28668',
  epicFail:    'ec9fdf99-314d-480d-a656-10d9861341e7',
  randomMic:   'd50eb41c-fcfa-4f4d-93aa-473cdc6bc3b2',
  productHit:  '3d45fb46-254f-4c83-9685-8e3d28945a67',
};

function avatarJson(id) {
  return JSON.stringify([{ id, type: 'preset' }]).replace(/"/g, '\\"');
}

function msVideo(prompt, avatarId, hookId, outFile) {
  if (fs.existsSync(path.join(ADS_DIR, outFile))) {
    console.log(`  ↩  ${outFile} already exists`);
    return;
  }
  const url = run(
    `higgsfield generate create marketing_studio_video --prompt "${prompt.replace(/"/g, '\\"').replace(/\n/g, ' ')}" --avatars "${avatarJson(avatarId)}" --hook_id "${hookId}" --aspect_ratio 9:16 --duration 15 --generate_audio true --wait`,
    outFile
  );
  download(url, path.join(ADS_DIR, outFile), outFile);
}

function scenarioVideo(prompt, outFile) {
  if (fs.existsSync(path.join(ADS_DIR, outFile))) {
    console.log(`  ↩  ${outFile} already exists`);
    return;
  }
  const url = run(
    `higgsfield generate create seedance_2_0 --prompt "${prompt.replace(/"/g, '\\"')}" --aspect_ratio 9:16 --duration 5 --genre drama --resolution 720p --wait`,
    outFile
  );
  download(url, path.join(ADS_DIR, outFile), outFile);
}

function websiteImage(prompt, outFile, ratio = '16:9') {
  if (fs.existsSync(path.join(IMAGES_DIR, outFile))) {
    console.log(`  ↩  ${outFile} already exists`);
    return;
  }
  const url = run(
    `higgsfield generate create nano_banana_2 --prompt "${prompt.replace(/"/g, '\\"')}" --aspect_ratio ${ratio} --resolution 2k --wait`,
    outFile
  );
  download(url, path.join(IMAGES_DIR, outFile), outFile);
}

// ─── CONTENT LIBRARY ────────────────────────────────────────────────────────
const UGC_ADS = [
  {
    file: 'ugc-liam-interview.mp4',
    avatar: AVATARS.liam, hook: HOOKS.interview,
    prompt: "A regular guy in his 30s talks to camera: 'I started reading this newsletter called GuyTalk — five minutes every morning. Sports scores, market moves, what's happening in the world. I walk into every meeting already knowing what everyone's about to bring up. And it's completely free. That's the whole pitch.'",
  },
  {
    file: 'ugc-stefan-camera-bump.mp4',
    avatar: AVATARS.stefan, hook: HOOKS.cameraBump,
    prompt: "Guy gets bumped by camera, laughs it off, then: 'Okay so this actually happened — my client brought up something about the Fed and I had literally read about it in GuyTalk that morning. Five minutes a day. Free newsletter. Subscribe. I'm not making this up.'",
  },
  {
    file: 'ugc-malik-interview.mp4',
    avatar: AVATARS.malik, hook: HOOKS.interview,
    prompt: "Malik talks to camera, relaxed and direct: 'I started reading GuyTalk and now I'm the guy who always knows what's going on. Sports, markets, what's trending — all in one email, takes 5 minutes, free. That's literally it. Subscribe.'",
  },
  {
    file: 'ugc-felix-epic-fail.mp4',
    avatar: AVATARS.felix, hook: HOOKS.epicFail,
    prompt: "Guy completely wipes out trying a backflip, lands hard, immediately sits up calm and holds up phone: 'So I found this newsletter called GuyTalk and now I read it every morning. Sports, finance, culture — five minutes. Free. Anyway.' Then lies back down.",
  },
  {
    file: 'ugc-joon-random-mic.mp4',
    avatar: AVATARS.joon, hook: HOOKS.randomMic,
    prompt: "Joon is vlogging casually, a random object falls into his hand, he immediately uses it as a microphone and launches into: 'GuyTalk daily brief — sports, markets, culture, five minutes, free. This is the most important newsletter you are not subscribed to. Sign up at guytalkmedia.com.'",
  },
];

const SCENARIO_VIDEOS = [
  {
    file: 'scenario-morning-routine.mp4',
    prompt: 'young professional man, early 30s, morning at home, kitchen counter, coffee in hand, reading his phone with a slight smile, getting ready for work, natural morning light, cinematic 9:16',
  },
  {
    file: 'scenario-commute.mp4',
    prompt: 'man on subway commute scrolling phone reading news, confident relaxed expression, morning rush hour, other commuters in background, candid street photography style, 9:16 vertical',
  },
  {
    file: 'scenario-golf-round.mp4',
    prompt: 'group of professional men on a golf course fairway, mid-conversation, one gesturing confidently, laughing, golden hour light, cinematic sports photography, 9:16 vertical',
  },
];

const WEBSITE_IMAGES = [
  { file: 'hero-morning-guy.jpg',  ratio: '16:9', prompt: 'professional man in his early 30s at a clean modern desk, morning coffee, reading something on his phone with a slight smile, soft natural window light, editorial photography style, 16:9' },
  { file: 'scenario-golf.jpg',     ratio: '16:9', prompt: 'three professional guys in business casual at a golf course, mid-round conversation, one gesturing confidently while the others listen, green fairway background, natural sunlight, editorial photo style, 16:9' },
  { file: 'scenario-office.jpg',   ratio: '16:9', prompt: 'modern office meeting room, one guy confidently presenting at a whiteboard while colleagues are engaged, professional confident energy, natural window light, editorial style, 16:9' },
  { file: 'scenario-tailgate.jpg', ratio: '16:9', prompt: 'guys at an NFL tailgate, one holding his phone up showing something to the group, everyone laughing and engaged, stadium in background, autumn afternoon light, candid photo, 16:9' },
  { file: 'hero-wide.jpg',         ratio: '16:9', prompt: 'wide shot of a busy modern city street at dawn, glass office buildings, professionals walking with coffee, cinematic morning light, photorealistic, 16:9' },
];

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  const doUgc    = process.argv.includes('--ugc')    || !process.argv.some(a => a.startsWith('--'));
  const doImages = process.argv.includes('--images') || !process.argv.some(a => a.startsWith('--'));
  const doVideo  = process.argv.includes('--video')  || !process.argv.some(a => a.startsWith('--'));

  console.log('\n  GuyTalk Ad Content Generator\n');

  if (doUgc) {
    console.log('  ── UGC Marketing Videos ──');
    for (const ad of UGC_ADS) {
      msVideo(ad.prompt, ad.avatar, ad.hook, ad.file);
    }
  }

  if (doVideo) {
    console.log('\n  ── Scenario Videos ──');
    for (const v of SCENARIO_VIDEOS) {
      scenarioVideo(v.prompt, v.file);
    }
  }

  if (doImages) {
    console.log('\n  ── Website Images ──');
    for (const img of WEBSITE_IMAGES) {
      websiteImage(img.prompt, img.file, img.ratio);
    }
  }

  console.log('\n  Done. Assets in assets/ads/ and assets/website-images/\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });

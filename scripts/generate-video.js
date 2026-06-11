#!/usr/bin/env node
'use strict';

/**
 * Free daily "what to say" video generator.
 *
 * Renders a handful of branded 1080×1920 frames from a brief issue (hook →
 * headline → today's hits → the bar take → CTA) and stitches them into a ~15s
 * 9:16 clip for TikTok / Reels / Shorts. No subscription — canvas + a bundled
 * static ffmpeg binary. Output: assets/videos/<slug>.mp4
 *
 * Usage:
 *   npm run video                 # latest issue
 *   npm run video -- --issue=044  # specific issue
 *
 * Tip: leave it silent and add trending audio inside the TikTok/Reels app —
 * that's what the algorithm rewards.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createCanvas, registerFont } = require('canvas');
const ffmpegPath = require('ffmpeg-static');

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'brief', 'data');
const OUT_DIR  = path.join(ROOT, 'assets', 'videos');
const W = 1080, H = 1920, FPS = 30;

// ── Brand ─────────────────────────────────────────────────────────────────────
const C = {
  bgTop: '#0C1B33', bgBot: '#070F1F', accent: '#3B82F6',
  text: '#F4F6FB', text2: '#9DB0D0',
  cats: { sports: '#3B82F6', markets: '#22C55E', golf: '#EAB308', f1: '#EF4444', worldcup: '#14B8A6', culture: '#A855F7' },
};
let F = { black: 'sans-serif', bold: 'sans-serif', reg: 'sans-serif' };
(function fonts() {
  const dir = path.join(ROOT, 'assets', 'fonts');
  const reg = (file, family) => { const fp = path.join(dir, file); if (fs.existsSync(fp)) { try { registerFont(fp, { family }); return true; } catch (_) {} } return false; };
  if (reg('Inter-Black.ttf', 'Inter Black')) F.black = 'Inter Black';
  if (reg('Inter-Bold.ttf', 'Inter Bold'))   F.bold  = 'Inter Bold';
  if (reg('Inter-Regular.ttf', 'Inter'))      F.reg   = 'Inter';
})();

function wrap(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}

// Trim to a clean sentence end (preferred) or word boundary — never mid-word.
function trimTo(text, max) {
  text = String(text).trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (sentenceEnd > max * 0.5) return slice.slice(0, sentenceEnd + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:]+$/, '') + '…';
}

// ── Frame renderer ──────────────────────────────────────────────────────────────
function frame(issue, slide, idx) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const PAD = 96;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bgTop); g.addColorStop(1, C.bgBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.accent; ctx.fillRect(0, 0, 12, H);

  // Header wordmark
  ctx.textBaseline = 'alphabetic';
  ctx.font = `40px "${F.black}"`; ctx.fillStyle = C.text;
  ctx.fillText('GuyTalk', PAD, 150);
  const ww = ctx.measureText('GuyTalk').width;
  ctx.fillStyle = C.accent; ctx.fillText('.', PAD + ww + 2, 150);
  if (issue._dateStr) { ctx.font = `24px "${F.reg}"`; ctx.fillStyle = C.text2; const d = issue._dateStr; ctx.fillText(d, W - PAD - ctx.measureText(d).width, 150); }

  // Main lines (auto-sized). Compute the block first so the kicker can sit
  // right above it instead of being stranded near the top.
  const maxW = W - PAD * 2;
  let size = slide.size || 96;
  let lines;
  for (;;) {
    ctx.font = `${size}px "${F.black}"`;
    lines = [];
    for (const para of slide.lines) lines.push(...wrap(ctx, para, maxW));
    const lh = size * 1.1;
    if (lines.length * lh <= 1020 || size <= 44) break;
    size -= 3;
  }
  const lh = size * 1.1;
  const blockH = lines.length * lh;
  let y = (H - blockH) / 2 + size * 0.82;   // baseline of first line, vertically centered

  // Kicker — anchored just above the text block
  if (slide.kicker) {
    ctx.font = `26px "${F.bold}"`; ctx.fillStyle = slide.kickerColor || C.accent;
    ctx.fillText(slide.kicker.toUpperCase(), PAD, y - size * 0.72 - 30);
  }

  ctx.font = `${size}px "${F.black}"`; ctx.fillStyle = C.text;
  for (const ln of lines) { ctx.fillText(ln, PAD, y); y += lh; }

  // Footer
  if (slide.footer) {
    ctx.font = `30px "${F.bold}"`; ctx.fillStyle = C.text2;
    ctx.fillText(slide.footer, PAD, H - 150);
  }
  if (slide.cta) {
    ctx.font = `34px "${F.black}"`; ctx.fillStyle = C.accent;
    ctx.fillText(slide.cta, PAD, H - 100);
  }

  const fp = path.join(os.tmpdir(), `gtvf_${idx}.png`);
  fs.writeFileSync(fp, canvas.toBuffer('image/png'));
  return fp;
}

// ── Build the slide list from an issue ──────────────────────────────────────────
const HIT_ORDER = [['sports', '🏀'], ['markets', '📈'], ['golf', '⛳'], ['f1', '🏎'], ['worldcup', '⚽'], ['culture', '🎬']];
function slidesFor(issue) {
  const copy = issue.copy || {};
  const headline = copy.title || issue.title || 'GuyTalk Daily Brief';
  const hits = HIT_ORDER.map(([k]) => (copy.todaysHits && copy.todaysHits[k] || '').trim()).filter(Boolean).slice(0, 3);
  const take = (copy.theTake && (copy.theTake.bar || copy.theTake.office)) || copy.keyTakeaway || '';

  const slides = [
    { lines: ['Don’t be the last', 'guy to know.'], size: 104, footer: 'The 5-minute brief', dur: 2.6 },
    { kicker: 'Today’s headline', lines: [headline], size: 92, dur: 3.4 },
  ];
  if (hits.length) slides.push({ kicker: 'Today’s hits', lines: hits, size: 56, dur: 4.0 });
  if (take)        slides.push({ kicker: 'The line to drop', lines: [trimTo(take, 175)], size: 60, dur: 4.2 });
  slides.push({ lines: ['Read it free.', 'Every morning.'], size: 100, footer: 'guytalkmedia.com', cta: 'Link in bio →', dur: 2.8 });
  return slides;
}

// ── ffmpeg: image -> clip (fade + gentle zoom) -> concat ────────────────────────
function clipFromFrame(framePath, dur, out) {
  const d = Math.max(0.6, dur);
  const fadeOut = (d - 0.4).toFixed(2);
  // Static frame + clean fades (fast & reliable — zoompan is pathologically slow).
  const vf = [
    `scale=${W}:${H}`,
    `fade=t=in:st=0:d=0.4`,
    `fade=t=out:st=${fadeOut}:d=0.4`,
    `format=yuv420p`,
  ].join(',');
  execFileSync(ffmpegPath, ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(d), '-i', framePath,
    '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', String(FPS), out],
    { stdio: 'ignore' });
}

// Build the video for a given issue object. Returns the output mp4 path.
// `log` is optional (silent when omitted), so the brief pipeline can call it quietly.
function generateVideo(issue, { log = () => {} } = {}) {
  issue._dateStr = issue.date ? issue.date.replace(/^[A-Za-z]+,\s*/, '') : '';
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const slides = slidesFor(issue);
  const clips = [];
  slides.forEach((s, i) => {
    const fp = frame(issue, s, i);
    const clip = path.join(os.tmpdir(), `gtvc_${i}.mp4`);
    clipFromFrame(fp, s.dur, clip);
    clips.push(clip);
    fs.unlinkSync(fp);
    log(`     ✓ slide ${i + 1}/${slides.length} (${s.dur}s)`);
  });

  const listFile = path.join(os.tmpdir(), 'gtv_list.txt');
  fs.writeFileSync(listFile, clips.map(c => `file '${c}'`).join('\n'));
  const out = path.join(OUT_DIR, `${issue.slug}.mp4`);
  execFileSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out],
    { stdio: 'ignore' });

  clips.forEach(c => fs.unlinkSync(c));
  fs.unlinkSync(listFile);
  return out;
}

function main() {
  const single = process.argv.find(a => a.startsWith('--issue='))?.replace('--issue=', '') || null;
  const files = fs.readdirSync(DATA_DIR).filter(f => /^issue-\d+\.json$/.test(f)).sort();
  const pick = single ? files.find(f => f.includes(single)) : files[files.length - 1];
  if (!pick) { console.error('No matching issue.'); process.exit(1); }

  const issue = JSON.parse(fs.readFileSync(path.join(DATA_DIR, pick), 'utf8'));
  console.log(`\n  🎬 Building video for ${issue.slug} — ${issue.title?.slice(0, 50)}\n`);
  const out = generateVideo(issue, { log: console.log });
  const secs = slidesFor(issue).reduce((a, s) => a + s.dur, 0).toFixed(1);
  console.log(`\n  ✅ ${path.relative(ROOT, out)}  (~${secs}s, 1080×1920)`);
  console.log(`     Post to TikTok / Reels / Shorts — add trending audio in-app.\n`);
}

module.exports = { generateVideo, slidesFor };

if (require.main === module) main();

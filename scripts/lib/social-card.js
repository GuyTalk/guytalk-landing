'use strict';

const fs   = require('fs');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'assets', 'social-cards');

const C = {
  bg:      '#0A1628',
  surface: '#111E33',
  accent:  '#2B6FFF',
  text:    '#F0EDE8',
  text2:   '#8A9BBB',
  border:  '#1D2D47',
  green:   '#16A34A',
  amber:   '#B87C35',
};

const SIZE = 1080;

// Try to register Inter if TTF is available; falls back to system sans-serif
function tryRegisterFonts() {
  const fontsDir = path.join(__dirname, '..', '..', 'assets', 'fonts');
  const pairs = [
    ['Inter-Regular.ttf', { family: 'GT', weight: 'regular' }],
    ['Inter-Bold.ttf',    { family: 'GT', weight: 'bold' }],
  ];
  for (const [file, opts] of pairs) {
    const fp = path.join(fontsDir, file);
    if (fs.existsSync(fp)) {
      try { registerFont(fp, opts); } catch (_) {}
    }
  }
}
tryRegisterFonts();

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function generateCard(issue) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const { num, slug, date, title, copy } = issue;
  const label    = `#${String(num).padStart(3, '0')}`;
  // date may be a full string ("Tuesday, June 2, 2026") or ISO — use as-is if already formatted
  const dateStr  = date
    ? (/^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : date.replace(/^[A-Za-z]+,\s*/, ''))  // strip "Tuesday, " prefix
    : '';
  const headline = copy?.title || title || 'GuyTalk Daily Brief';
  const bullets  = (copy?.sharpTake?.bullets || []).slice(0, 3);

  const canvas = createCanvas(SIZE, SIZE);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle grid lines
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 10; i++) {
    const y = 140 + i * 95;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Left accent bar
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, 7, SIZE);

  // ── Header ────────────────────────────────────────────────────────────────
  const PAD = 72;

  // Wordmark "GuyTalk."
  ctx.font = 'bold 48px -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = C.text;
  ctx.fillText('GuyTalk', PAD, 96);
  const wordmarkW = ctx.measureText('GuyTalk').width;
  ctx.fillStyle = C.accent;
  ctx.fillText('.', PAD + wordmarkW, 96);

  // Issue label (top right)
  ctx.font = 'bold 17px -apple-system, "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = C.accent;
  const issueLabel = `ISSUE ${label}`;
  const issueLabelW = ctx.measureText(issueLabel).width;
  ctx.fillText(issueLabel, SIZE - PAD - issueLabelW, 82);

  // Date (top right, below issue)
  if (dateStr) {
    ctx.font = '16px -apple-system, "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = C.text2;
    const dateW = ctx.measureText(dateStr).width;
    ctx.fillText(dateStr, SIZE - PAD - dateW, 106);
  }

  // Header divider
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(PAD, 128); ctx.lineTo(SIZE - PAD, 128); ctx.stroke();
  ctx.globalAlpha = 1;

  // ── Headline ───────────────────────────────────────────────────────────────
  const headlineMaxW = SIZE - PAD * 2;
  let fontSize = 88;
  ctx.font = `900 ${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  let headlineLines = wrapText(ctx, headline, headlineMaxW);

  // Scale down if too many lines
  while (headlineLines.length > 3 && fontSize > 56) {
    fontSize -= 4;
    ctx.font = `900 ${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    headlineLines = wrapText(ctx, headline, headlineMaxW);
  }
  headlineLines = headlineLines.slice(0, 3);

  const lineH    = fontSize * 1.08;
  const blockH   = headlineLines.length * lineH;
  const topArea  = 158;
  const btmArea  = bullets.length > 0 ? 350 : 130;
  const available = SIZE - topArea - btmArea;
  const startY   = topArea + (available - blockH) / 2 + fontSize * 0.85;

  ctx.fillStyle = C.text;
  headlineLines.forEach((line, i) => {
    ctx.fillText(line, PAD, startY + i * lineH);
  });

  // ── Bullets ────────────────────────────────────────────────────────────────
  if (bullets.length > 0) {
    const bulletColors = [C.accent, C.green, C.amber];
    const bulletTop = SIZE - btmArea + 20;

    // Divider above bullets
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(PAD, bulletTop); ctx.lineTo(SIZE - PAD, bulletTop); ctx.stroke();
    ctx.globalAlpha = 1;

    bullets.forEach((b, i) => {
      const y = bulletTop + 38 + i * 68;
      // Arrow
      ctx.font = `bold 20px -apple-system, "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = bulletColors[i] || C.accent;
      ctx.fillText('→', PAD, y);

      // Bullet text
      const bText = b.length > 68 ? b.slice(0, 68) + '…' : b;
      ctx.font = `20px -apple-system, "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = C.text2;
      ctx.fillText(bText, PAD + 34, y);
    });
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = SIZE - 44;

  ctx.font = `bold 17px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = C.text2;
  ctx.fillText('guytalkmedia.com', PAD, footerY);

  // "FREE DAILY BRIEF" pill
  const pillText = 'FREE DAILY BRIEF';
  ctx.font = `bold 14px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  const pillW = ctx.measureText(pillText).width + 36;
  const pillH = 32;
  const pillX = SIZE - PAD - pillW;
  const pillY = footerY - 22;

  drawRoundRect(ctx, pillX, pillY, pillW, pillH, 8);
  ctx.fillStyle = C.accent;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.fillText(pillText, pillX + 18, pillY + 21);

  // Save
  const outPath = path.join(OUTPUT_DIR, `${slug}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

module.exports = { generateCard };

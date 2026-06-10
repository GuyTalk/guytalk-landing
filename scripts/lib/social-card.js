'use strict';

const fs   = require('fs');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'assets', 'social-cards');
const TIKTOK_DIR = path.join(__dirname, '..', '..', 'assets', 'tiktok-cards');

const C = {
  bgTop:   '#0C1B33',
  bgBot:   '#070F1F',
  accent:  '#3B82F6',
  text:    '#F4F6FB',
  text2:   '#9DB0D0',
  border:  '#1E2E4A',
  cats: {                       // per-category accent for the hit rows
    sports:   '#3B82F6',
    markets:  '#22C55E',
    golf:     '#EAB308',
    f1:       '#EF4444',
    worldcup: '#14B8A6',
    culture:  '#A855F7',
  },
};

const SIZE = 1080;

// Register Inter so the canvas actually has the weights we ask for. The old
// card asked for `-apple-system` which node-canvas can't resolve, so every
// size silently fell back to a tiny default — that's why cards were near-blank.
let FONTS = { black: 'sans-serif', bold: 'sans-serif', regular: 'sans-serif' };
(function registerFonts() {
  const dir = path.join(__dirname, '..', '..', 'assets', 'fonts');
  const reg = (file, family) => {
    const fp = path.join(dir, file);
    if (fs.existsSync(fp)) { try { registerFont(fp, { family }); return true; } catch (_) {} }
    return false;
  };
  if (reg('Inter-Black.ttf',   'Inter Black'))   FONTS.black   = 'Inter Black';
  if (reg('Inter-Bold.ttf',    'Inter Bold'))    FONTS.bold    = 'Inter Bold';
  if (reg('Inter-Regular.ttf', 'Inter'))         FONTS.regular = 'Inter';
})();

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t.replace(/[\s;,]+$/, '') + '…';
}

// Pull the per-category one-liners the brief already writes.
const HIT_ORDER = ['sports', 'markets', 'golf', 'f1', 'worldcup', 'culture'];
const HIT_LABEL = { sports: 'SPORTS', markets: 'MARKETS', golf: 'GOLF', f1: 'F1', worldcup: 'WORLD CUP', culture: 'CULTURE' };

function getHits(issue) {
  const hits = issue.copy?.todaysHits || {};
  return HIT_ORDER
    .map(key => ({ key, label: HIT_LABEL[key], text: (hits[key] || '').trim() }))
    .filter(h => h.text);
}

function generateCard(issue, opts = {}) {
  const vertical = opts.format === 'vertical';
  const W = SIZE;                          // 1080 wide for both
  const H = vertical ? 1920 : SIZE;        // 9:16 for TikTok/Reels, 1:1 for IG feed
  const outDir = vertical ? TIKTOK_DIR : OUTPUT_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const { num, slug, date, title, copy } = issue;
  const label    = `#${String(num).padStart(3, '0')}`;
  const dateStr  = date
    ? (/^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : date.replace(/^[A-Za-z]+,\s*/, ''))
    : '';
  const headline = copy?.title || title || 'GuyTalk Daily Brief';
  const hits     = getHits(issue).slice(0, 4);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, C.bgTop);
  grad.addColorStop(1, C.bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, 10, H);

  const PAD = 80;
  const RIGHT = W - PAD;

  // ── Header ──────────────────────────────────────────────────────────────────
  ctx.textBaseline = 'alphabetic';
  ctx.font = `40px "${FONTS.black}"`;
  ctx.fillStyle = C.text;
  ctx.fillText('GuyTalk', PAD, 104);
  const wW = ctx.measureText('GuyTalk').width;
  ctx.fillStyle = C.accent;
  ctx.fillText('.', PAD + wW + 2, 104);

  ctx.font = `22px "${FONTS.bold}"`;
  ctx.fillStyle = C.accent;
  const issueLabel = `ISSUE ${label}`;
  ctx.fillText(issueLabel, RIGHT - ctx.measureText(issueLabel).width, 92);
  if (dateStr) {
    ctx.font = `20px "${FONTS.regular}"`;
    ctx.fillStyle = C.text2;
    ctx.fillText(dateStr, RIGHT - ctx.measureText(dateStr).width, 122);
  }

  // ── Layout budget (computed bottom-up so nothing ever overflows) ───────────────
  const maxW       = W - PAD * 2;
  const footerTop  = H - 96;                    // everything above stays clear of footer
  const hitRowH    = 74;
  const hitsHdrH   = hits.length ? 58 : 0;
  const hitsBlockH = hits.length ? hitsHdrH + hits.length * hitRowH : 0;
  const dividerY   = hits.length ? footerTop - hitsBlockH - 28 : footerTop;
  // Vertical cards get a tall safe-zone top margin (clear of TikTok's UI chrome).
  const headTop    = vertical ? 380 : 196;
  const headBottom = (hits.length ? dividerY : footerTop) - 36;
  const headZone   = headBottom - headTop;

  // ── Headline (sized to fit its zone) ───────────────────────────────────────────
  let fontSize = vertical ? 104 : 92;
  let lines, lineH;
  for (;;) {
    ctx.font = `${fontSize}px "${FONTS.black}"`;
    lines = wrapText(ctx, headline, maxW);
    lineH = fontSize * 1.07;
    if (lines.length * lineH <= headZone || fontSize <= 48) break;
    fontSize -= 3;
  }
  ctx.fillStyle = C.text;
  ctx.font = `${fontSize}px "${FONTS.black}"`;
  // Vertical: center the headline in its (tall) zone; square: top-align.
  const blockH = lines.length * lineH;
  let y = headTop + fontSize + (vertical ? Math.max(0, (headZone - blockH) / 2) : 0);
  for (const line of lines) { ctx.fillText(line, PAD, y); y += lineH; }

  // ── Today's hits ──────────────────────────────────────────────────────────────
  if (hits.length) {
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, dividerY); ctx.lineTo(RIGHT, dividerY); ctx.stroke();

    ctx.font = `22px "${FONTS.bold}"`;
    ctx.fillStyle = C.text2;
    ctx.fillText("TODAY'S HITS", PAD, dividerY + 42);

    let ry = dividerY + hitsHdrH + 38;
    for (const hit of hits) {
      // Colored category chip
      ctx.font = `20px "${FONTS.bold}"`;
      const chipText = hit.label;
      const chipW = ctx.measureText(chipText).width + 28;
      drawRoundRect(ctx, PAD, ry - 27, chipW, 38, 8);
      ctx.fillStyle = C.cats[hit.key] || C.accent;
      ctx.fill();
      ctx.fillStyle = '#0A0F1A';
      ctx.fillText(chipText, PAD + 14, ry);

      // Hit text — single line, truncated to fit so rows stay uniform
      ctx.font = `30px "${FONTS.bold}"`;
      ctx.fillStyle = C.text;
      const textX = PAD + chipW + 22;
      ctx.fillText(truncateToWidth(ctx, hit.text, RIGHT - textX), textX, ry);
      ry += hitRowH;
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footerY = H - 56;
  ctx.font = `24px "${FONTS.bold}"`;
  ctx.fillStyle = C.text2;
  ctx.fillText('guytalkmedia.com', PAD, footerY);

  const pillText = 'FREE DAILY BRIEF';
  ctx.font = `18px "${FONTS.bold}"`;
  const pillW = ctx.measureText(pillText).width + 40;
  const pillH = 44;
  const pillX = RIGHT - pillW;
  const pillY = footerY - 30;
  drawRoundRect(ctx, pillX, pillY, pillW, pillH, 10);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(pillText, pillX + 20, pillY + 29);

  const outPath = path.join(outDir, `${slug}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

// 9:16 vertical card for TikTok / Reels — same brand system, taller frame.
function generateTikTokCard(issue) {
  return generateCard(issue, { format: 'vertical' });
}

module.exports = { generateCard, generateTikTokCard };

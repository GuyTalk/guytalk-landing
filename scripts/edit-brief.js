#!/usr/bin/env node
'use strict';

/**
 * GuyTalk standalone editorial pass.
 * Re-runs the OpenAI editor on an already-generated issue against the current
 * GUYTALK_EDITORIAL_BIBLE.md, then re-renders the HTML. Use after editing the
 * Bible, or to re-edit without re-fetching data / re-drafting with Claude.
 *
 * Usage:
 *   node scripts/edit-brief.js            # latest issue
 *   node scripts/edit-brief.js issue-042  # a specific issue
 */

require('dotenv').config({ path: '.env.local' });

const fs   = require('fs');
const path = require('path');

const { editBrief } = require('./lib/editor');
const { buildHtml } = require('./lib/html');

const ROOT     = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'brief', 'data');

function latestSlug() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^issue-\d{3}\.json$/.test(f))
    .sort();
  if (!files.length) { console.error('No issue data files found.'); process.exit(1); }
  return files[files.length - 1].replace('.json', '');
}

// Rebuild a raw-facts block from a saved issue (mirrors generate-brief.js)
function factsFromIssue(d) {
  const lines = [];
  if (d.sports?.length) {
    lines.push('GAMES:');
    d.sports.forEach(g => {
      const w = g.home.winner ? g.home : g.away;
      const l = g.home.winner ? g.away : g.home;
      let s = `- ${g.note || g.name}: ${w.team} ${w.score}–${l.team} ${l.score} (${g.status})`;
      if (g.seriesNote) s += ` [Series: ${g.seriesNote}]`;
      lines.push(s);
    });
  }
  if (d.upcoming?.length) {
    lines.push('UPCOMING:');
    d.upcoming.slice(0, 3).forEach(g => lines.push(`- ${g.shortName}${g.note ? ` (${g.note})` : ''}`));
  }
  if (d.f1?.name) {
    lines.push(d.f1.results?.length && d.f1.statusState === 'post'
      ? `F1: ${d.f1.name} (Finished) — ${d.f1.results.slice(0, 3).map(r => `P${r.pos} ${r.driver} (${r.team})`).join(', ')}`
      : `F1: ${d.f1.name} — upcoming`);
  }
  if (d.golf?.name) {
    const lb = d.golf.leaders?.slice(0, 3).map(l => `${l.name} ${l.score} (${l.pos})`).join(', ') || 'no leaderboard yet';
    lines.push(`GOLF: ${d.golf.name} — ${lb}`);
  }
  if (d.markets) {
    const mkt = Object.entries(d.markets)
      .filter(([, q]) => q?.dayChangePct != null)
      .map(([sym, q]) => `${sym} ${q.dayChangePct >= 0 ? '+' : ''}${q.dayChangePct.toFixed(1)}%`)
      .join(', ');
    if (mkt) lines.push(`MARKETS: ${mkt}`);
  }
  if (d.trending?.length) {
    lines.push('TRENDING HEADLINES:');
    d.trending.slice(0, 8).forEach(t => lines.push(`- [${t.source}] ${t.title}`));
  }
  return lines.join('\n') || '(no data available)';
}

async function main() {
  const arg  = process.argv[2];
  const slug = arg?.startsWith('issue-') ? arg : latestSlug();
  const jsonPath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(jsonPath)) { console.error(`No data file for "${slug}"`); process.exit(1); }

  const issue = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!issue.copy) { console.error(`${slug} has no copy to edit.`); process.exit(1); }

  console.log(`\n🧐 Editorial pass on ${slug} (${issue.date || '?'})...`);

  const result = await editBrief({ copy: issue.copy, context: factsFromIssue(issue) });
  issue.copy   = result.copy;
  issue.editor = result.editor;
  if (issue.copy?.title) issue.title = issue.copy.title;

  if (result.editor.reviewed) {
    console.log(`   ✓ Edited by ${result.editor.model}`);
    if (result.editor.changed.length) console.log(`   ✓ Rewrote: ${result.editor.changed.join(', ')}`);
    if (result.editor.blocking.length) {
      console.log(`   ⛔ ${result.editor.blocking.length} section(s) FLAGGED — QA will block publish:`);
      result.editor.blocking.forEach(b => console.log(`        • ${b.section}: ${b.reason}`));
    } else {
      console.log(`   ✓ All sections meet the Bible — no blocks`);
    }
  } else {
    console.log(`   ⚠  NOT editor-reviewed: ${result.editor.reason}`);
  }

  // Persist JSON + re-render HTML
  fs.writeFileSync(jsonPath, JSON.stringify(issue, null, 2));
  const related = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('issue-') && !f.includes(slug))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch (_) { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.num || 0) - (a.num || 0))
    .slice(0, 3);
  const htmlDir = path.join(ROOT, 'brief', slug);
  if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(path.join(htmlDir, 'index.html'), buildHtml(issue, related));

  console.log(`   ✓ brief/data/${slug}.json + brief/${slug}/index.html updated`);
  console.log(`\n   Next: npm run brief:qa ${slug}\n`);
}

main().catch(err => { console.error(`\n❌ ${err.message}`); process.exit(1); });

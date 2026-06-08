'use strict';

/**
 * GuyTalk social drafter.
 *
 * Turns the LIVE site data (The Rundown + trending + scores) into ready-to-post
 * social copy using Claude — grounded ONLY in real fetched facts. It DRAFTS and
 * PRINTS; it does not publish anywhere. Wiring to Buffer/Canva is a deliberate
 * separate step pending channel sign-off.
 *
 * Compliance: same rules as the brief/Live — no invented facts, no financial
 * advice (outputs are scrubbed by a FIN_ADVICE guard).
 *
 * Usage: node scripts/generate-social.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const BASE = process.env.SOCIAL_BASE || 'https://www.guytalkmedia.com';
const FIN_ADVICE = /\b(price targets?|buying opportunity|under-?valued|over-?valued|should (?:buy|sell|hold|invest)|time to (?:buy|sell)|buy the dip|load up|portfolio allocation|consider (?:adding|reducing)|smart money|good time to (?:buy|sell)|investors? should)\b/i;

const getJSON = (path) =>
  fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

function buildFacts(talk, live) {
  const lines = [];
  if (talk?.rundown) lines.push(`RUNDOWN: ${talk.rundown}`);
  if (live?.f1) {
    const p = (live.f1.positions || [])[0];
    lines.push(`F1: ${live.f1.event} — ${live.f1.sessionLabel}${p ? ` — P1 ${p.driver}` : ''}`);
  }
  if (live?.golf) {
    const l = (live.golf.leaderboard || [])[0];
    lines.push(`GOLF: ${live.golf.event}${l ? ` — leader ${l.name} ${l.score}` : ''}`);
  }
  for (const ev of (live?.liveNow || []).slice(0, 3)) lines.push(`LIVE: ${ev.title} — ${ev.statusText}`);
  for (const t of (talk?.trending || []).slice(0, 6)) lines.push(`STORY [${t.category}]: ${t.headline}`);
  return lines.join('\n');
}

async function main() {
  const [talk, live] = await Promise.all([getJSON('/api/talk'), getJSON('/api/live')]);
  const facts = buildFacts(talk, live);
  if (!facts.trim()) { console.error('No live facts available — aborting (nothing to post).'); process.exit(1); }

  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing.'); process.exit(1); }
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system =
    'You are GuyTalk — a sharp, fun, confident voice for guys who want to sound informed on sports, ' +
    'markets, and culture. Draft social posts from the REAL facts provided.\n' +
    'COMPLIANCE (non-negotiable): use ONLY facts in the input; never invent scores, stats, names, or ' +
    'events; no financial advice / buy-sell / price targets (describe, never advise); opinions ok but ' +
    'never invented data. Keep it punchy and native to each platform.\n' +
    'Return STRICT JSON only: { "x_post": string (<=270 chars, 1-2 hashtags, a hook + one real fact + ' +
    'soft nudge to guytalkmedia.com/live), "instagram_caption": string (2-4 short lines + 3-5 hashtags), ' +
    '"story_idea": string (one-line idea for a Story/Short) }. No markdown.';

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    system,
    messages: [{ role: 'user', content: `Today's real GuyTalk facts:\n${facts}\n\nReturn the JSON.` }],
  });

  const text = (msg.content || []).map((b) => b.text || '').join('');
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1) { console.error('No JSON from model.'); process.exit(1); }
  const out = JSON.parse(text.slice(s, e + 1));

  const scrub = (v) => (v && FIN_ADVICE.test(v) ? '[withheld: financial-advice guard]' : v);
  const x = scrub(out.x_post), ig = scrub(out.instagram_caption), story = scrub(out.story_idea);

  console.log('\n=== GuyTalk social drafts (review only — not published) ===\n');
  console.log('— X / Twitter —\n' + x + '\n');
  console.log('— Instagram caption —\n' + ig + '\n');
  console.log('— Story / Short idea —\n' + story + '\n');
  console.log('Source: live /api/talk + /api/live · grounded, advice-scrubbed. Nothing was posted.');
}

main().catch((e) => { console.error(e); process.exit(1); });

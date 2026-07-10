'use strict';

/**
 * GuyTalk Live — Trending Stories + "What Everyone's Talking About".
 *
 * This makes sections 6 & 7 LIVE-backed instead of static editorial:
 *
 *   Trending Stories      → real headlines from ESPN's public news API
 *                           (keyless) + NewsAPI top-headlines for business /
 *                           tech / culture when NEWS_API_KEY is configured.
 *                           Every item carries a real source link.
 *
 *   What Everyone's       → synthesized by Claude Haiku (the same model that
 *   Talking About           powers the daily brief) GROUNDED in the real
 *                           headlines above — it may only use facts from those
 *                           stories. If ANTHROPIC_API_KEY is absent it degrades
 *                           to a deterministic "derived" mode built straight
 *                           from the top headlines (clearly labelled).
 *
 * Provenance is returned per-section so the UI can label it
 * (ESPN / NewsAPI / Claude / Derived).
 *
 * Cache: 15 min fresh, 30 min stale-while-revalidate. The page polls this
 * less often than the scoreboard (news moves slower than scores).
 */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

// Keyless ESPN news feeds — one trending headline pulled from each.
const NEWS_FEEDS = [
  { url: `${ESPN}/basketball/nba/news`,            cat: 'NBA' },
  { url: `${ESPN}/football/nfl/news`,              cat: 'NFL' },
  { url: `${ESPN}/baseball/mlb/news`,              cat: 'MLB' },
  { url: `${ESPN}/hockey/nhl/news`,                cat: 'NHL' },
  { url: `${ESPN}/golf/pga/news`,                  cat: 'Golf' },
  { url: `${ESPN}/racing/f1/news`,                 cat: 'F1' },
  { url: `${ESPN}/football/college-football/news`, cat: 'College' },
];

// NewsAPI categories for non-sports culture (only used if NEWS_API_KEY is set).
const NEWSAPI_CATS = [
  { cat: 'Business', q: 'business' },
  { cat: 'Technology', q: 'technology' },
  { cat: 'Culture', q: 'entertainment' },
];

const json = (url, opts) =>
  fetch(url, { headers: { 'User-Agent': 'GuyTalkLive/1.0' }, ...opts })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Defense-in-depth financial-compliance guard: even if the model slips past the
// prompt, any AI text containing investment-advice language is rejected so it
// never ships. Pairs with the prompt rules in §4 of COMPLIANCE_AND_FACTUALITY.md.
const FIN_ADVICE = /\b(price targets?|buying opportunity|under-?valued|over-?valued|should (?:buy|sell|hold|invest)|time to (?:buy|sell)|buy the dip|load up|portfolio allocation|consider (?:adding|reducing)|smart money|good time to (?:buy|sell)|investors? should)\b/i;
const adviceFree = (s) => (s && FIN_ADVICE.test(s) ? '' : s);

// Compact market snapshot (top movers) to give The Rundown real market context.
// Real indices/futures via Yahoo Finance — same symbols and same fetcher as the
// Markets tab (api/lib/yahoo.js) — not ETF proxies. ETFs like USO/GLD diverge
// from the underlying (futures-roll costs, fund fees), which used to make the
// Rundown's oil/gold figures disagree with the Markets tiles a few pixels away.
const { fetchYahooQuote } = require('../scripts/lib/yahoo');
const MKT = [
  { l: 'S&P 500', s: '%5EGSPC' }, { l: 'Nasdaq', s: '%5EIXIC' }, { l: 'Dow', s: '%5EDJI' },
  { l: 'Bitcoin', s: 'BTC-USD' }, { l: 'Gold', s: 'GC%3DF' }, { l: 'Oil', s: 'CL%3DF' },
];
async function marketContext() {
  const rows = await Promise.all(MKT.map(async (m) => {
    const q = await fetchYahooQuote(json, m.s);
    return q ? { l: m.l, dp: q.changePercent } : null;
  }));
  const have = rows.filter(Boolean).sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp)).slice(0, 4);
  return have.map((r) => `${r.l} ${r.dp >= 0 ? '+' : ''}${r.dp.toFixed(1)}%`).join(', ');
}

/* ----------------------------------------------------------- Trending (live) */

async function fetchEspnNews() {
  const out = [];
  const results = await Promise.all(NEWS_FEEDS.map((f) => json(f.url).then((d) => ({ f, d }))));
  for (const { f, d } of results) {
    const a = (d?.articles || []).find((x) => x.type !== 'Media' && x.headline);
    if (!a) continue;
    const url = a.links?.web?.href || a.links?.mobile?.href || '';
    out.push({
      category: f.cat,
      headline: clean(a.headline),
      summary: clean(a.description).slice(0, 180),
      url,
      source: 'ESPN',
      published: a.published || '',
    });
  }
  return out;
}

async function fetchNewsApi(key) {
  if (!key) return [];
  const out = [];
  const results = await Promise.all(
    NEWSAPI_CATS.map((c) =>
      json(`https://newsapi.org/v2/top-headlines?country=us&category=${c.q}&pageSize=2&apiKey=${key}`)
        .then((d) => ({ c, d }))
    )
  );
  for (const { c, d } of results) {
    for (const a of (d?.articles || []).slice(0, 2)) {
      if (!a?.title || /\[Removed\]/i.test(a.title)) continue;
      out.push({
        category: c.cat,
        headline: clean(a.title).replace(/\s-\s[^-]+$/, ''),
        summary: clean(a.description).slice(0, 180),
        url: a.url || '',
        source: clean(a.source?.name) || 'NewsAPI',
        published: a.publishedAt || '',
      });
    }
  }
  return out;
}

function buildTrending(espn, newsapi) {
  // Interleave sports + culture for variety, dedupe by headline, cap at 8.
  const merged = [];
  const seen = new Set();
  const push = (it) => {
    const k = it.headline.toLowerCase().slice(0, 40);
    if (!it.headline || seen.has(k)) return;
    seen.add(k); merged.push(it);
  };
  const maxLen = Math.max(espn.length, newsapi.length);
  for (let i = 0; i < maxLen; i++) {
    if (espn[i]) push(espn[i]);
    if (newsapi[i]) push(newsapi[i]);
  }
  return merged.slice(0, 8);
}

/* ------------------------------------------- Talking points (AI or derived) */

// One grounded Claude call → { rundown, trending-why, talking points }.
async function buildAI(trending, marketLine, key) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });

  const stories = trending
    .map((t, i) => `[${i}] (${t.category}) ${t.headline}${t.summary ? ' — ' + t.summary : ''}`)
    .join('\n');

  const system =
    'You are GuyTalk — a sharp, fun, confident daily brief for guys who want to sound informed. ' +
    'You are given today\'s REAL sports/news headlines and market moves. ' +
    '\n\nCOMPLIANCE RULES (non-negotiable):\n' +
    '1. Use ONLY facts present in the provided inputs. NEVER invent or assume scores, statistics, ' +
    'standings, injuries, rankings, quotes, player news, or events. If the inputs do not support ' +
    'a claim, leave it out.\n' +
    '2. Do not present predictions or speculation as fact. Opinions are allowed but must read as ' +
    'opinion, never as invented data or reporting.\n' +
    '3. FINANCIAL: GuyTalk is informational only. For markets, describe ONLY what moved and by how ' +
    'much using the exact numbers given. NEVER give investment advice or buy/sell/hold guidance, ' +
    'price targets, valuations, or tell anyone what to do with money. Observe and explain, never advise.\n' +
    '4. Be confident and casual; never hedge or say "some say". Stay grounded.\n\n' +
    '\n5. CONTENT STANDARD — every item must clear this bar:\n' +
    '   • "why it matters" / "matters" = the CONSEQUENCE or stakes, NOT a restate of the headline. ' +
    'Say what it changes, sets up, or means going forward. Bad: "Team X won." Good: "The win moves Team X into the final and ends Team Y\'s season."\n' +
    '   • "stat" = the single most interesting CONCRETE detail from the story — a record, streak, margin, ' +
    'number, milestone, or historical comparison. Pull it ONLY from the provided inputs; if the inputs ' +
    'contain no such number/fact, set "stat" to an empty string. Never fabricate one.\n' +
    '   • "say" = a short, specific line someone could actually drop in conversation, built around the ' +
    'real detail — never a generic "did you see this". Bad: "Big game last night." Good: "Three straight ' +
    'wins now — they look like the team to beat."\n\n' +
    'Return STRICT JSON only (no markdown) with this exact shape: ' +
    '{ "rundown": string, "trending": [{"i": number, "why": string}], "talking": [{"topic": string, "matters": string, "stat": string, "say": string, "sourceIndex": number}] }. ' +
    'rundown = 2-3 punchy sentences on what matters right now across sports, markets, and culture, woven together like a smart friend catching you up (markets: describe the moves, never advise). ' +
    'trending = one short "why it matters" CONSEQUENCE sentence for EACH story index provided, grounded in that story (not a restate of the headline). ' +
    'talking = the 4 most conversation-driving topics, each with topic, a consequence-driven "matters", a concrete "stat" (or "" if none in the inputs), and one short quotable "say" line (in quotes) built on the real detail. Opinions ok; invented facts are not.';

  const user =
    `Markets right now: ${marketLine || 'n/a'}\n\nToday's real stories:\n${stories}\n\n` +
    'Return the JSON object.';

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = (msg.content || []).map((b) => b.text || '').join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json');
  const obj = JSON.parse(text.slice(start, end + 1));

  // Merge AI "why" back onto the real trending items (keeps real links).
  // Drop any "why" that trips the financial-advice guard.
  const enriched = trending.map((t, i) => {
    const w = (obj.trending || []).find((x) => x.i === i);
    return { ...t, why: w ? adviceFree(clean(w.why)) : '' };
  });

  // Talking points: drop any item whose copy contains investment-advice language.
  const talking = (obj.talking || []).slice(0, 5).map((o) => {
    const src = trending[o.sourceIndex] || null;
    const stat = adviceFree(clean(o.stat || ''));
    return {
      topic: clean(o.topic), matters: clean(o.matters), stat, say: clean(o.say),
      url: src?.url || '', source: src?.source || '',
    };
  }).filter((o) => o.topic && o.matters && o.say && !FIN_ADVICE.test(o.say) && !FIN_ADVICE.test(o.matters));

  // The Rundown is dropped entirely if it contains any advice language.
  return { rundown: adviceFree(clean(obj.rundown)), trending: enriched, talking };
}

// Deterministic fallback built straight from the real headlines — no AI, no
// invented facts. Every field is either a real headline/summary or a neutral
// conversational wrapper around it.
function buildTalkingDerived(trending) {
  return trending.slice(0, 4).map((t) => ({
    topic: t.headline,
    matters: t.summary || `A ${t.category} story making the rounds today.`,
    say: `"Did you catch this? ${t.headline.replace(/[.?!]+$/, '')}."`,
    url: t.url,
    source: t.source,
  }));
}

/* ------------------------------------------------------------------- handler */

// Load pre-fetched social moments from brief/data/live-social.json.
// Committed by api/refresh-social.js (GitHub Actions, every 2h).
function loadLiveSocial() {
  try {
    const fs   = require('fs');
    const path = require('path');
    const p = path.join(process.cwd(), 'brief', 'data', 'live-social.json');
    if (!fs.existsSync(p)) return null;
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const moments = Array.isArray(d) ? d : (Array.isArray(d.moments) ? d.moments : null);
    return moments && moments.length ? { moments, fetchedAt: d.fetchedAt || null } : null;
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  try {
    const [espn, newsapi, marketLine] = await Promise.all([
      fetchEspnNews(),
      fetchNewsApi(process.env.NEWS_API_KEY),
      marketContext(),
    ]);

    let trending = buildTrending(espn, newsapi);
    let talkingAbout = [];
    let rundown = '';
    let talkSource = 'derived';

    if (process.env.ANTHROPIC_API_KEY && trending.length) {
      try {
        const ai = await buildAI(trending, marketLine, process.env.ANTHROPIC_API_KEY);
        if (ai.trending?.length) trending = ai.trending;   // now carries AI "why"
        talkingAbout = ai.talking || [];
        rundown = ai.rundown || '';
        talkSource = talkingAbout.length ? 'ai' : 'derived';
      } catch (_) { /* fall through to derived */ }
    }
    if (!talkingAbout.length) {
      talkingAbout = buildTalkingDerived(trending);
      talkSource = 'derived';
    }

    const social = loadLiveSocial();

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.json({
      updatedAt: new Date().toISOString(),
      sources: {
        rundown: rundown ? 'ai' : null,
        trending: newsapi.length ? 'ESPN · NewsAPI' : 'ESPN',
        talkingAbout: talkSource, // 'ai' | 'derived'
        social: social ? 'OpenAI Search' : null,
      },
      rundown: rundown || null,
      trending: trending.length ? trending : null,
      talkingAbout: talkingAbout.length ? talkingAbout : null,
      social: social || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to build talk feed' });
  }
};

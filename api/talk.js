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

async function buildTalkingAI(trending, key) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });

  const stories = trending
    .map((t, i) => `[${i}] (${t.category}) ${t.headline}${t.summary ? ' — ' + t.summary : ''}`)
    .join('\n');

  const system =
    'You are GuyTalk, a sharp, fun daily brief for guys. From the real news stories ' +
    'provided, pick the 4 most conversation-driving topics for group chats, offices, and bars. ' +
    'CRITICAL: use ONLY facts present in the provided stories. Do NOT invent scores, names, ' +
    'quotes, or events. Keep it confident and casual, never hedge. ' +
    'Return STRICT JSON only: an array of 4 objects with keys ' +
    '"topic" (short), "matters" (one sentence on why it matters), ' +
    '"say" (one short conversational line, in quotes, that someone could actually say), ' +
    'and "sourceIndex" (the [n] of the story you used). No prose, no markdown.';

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    system,
    messages: [{ role: 'user', content: `Today's real stories:\n${stories}\n\nReturn the JSON array.` }],
  });

  const text = (msg.content || []).map((b) => b.text || '').join('');
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no json');
  const arr = JSON.parse(text.slice(start, end + 1));

  return arr.slice(0, 5).map((o) => {
    const src = trending[o.sourceIndex] || null;
    return {
      topic: clean(o.topic),
      matters: clean(o.matters),
      say: clean(o.say),
      url: src?.url || '',
      source: src?.source || '',
    };
  }).filter((o) => o.topic && o.matters && o.say);
}

// Deterministic fallback built straight from the real headlines.
function buildTalkingDerived(trending) {
  return trending.slice(0, 4).map((t) => ({
    topic: t.headline,
    matters: t.summary || `It's one of the biggest ${t.category} stories right now.`,
    say: `"Did you catch this? ${t.headline.replace(/[.?!]+$/, '')}."`,
    url: t.url,
    source: t.source,
  }));
}

/* ------------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  try {
    const [espn, newsapi] = await Promise.all([
      fetchEspnNews(),
      fetchNewsApi(process.env.NEWS_API_KEY),
    ]);

    const trending = buildTrending(espn, newsapi);

    let talkingAbout = null;
    let talkSource = 'derived';
    if (process.env.ANTHROPIC_API_KEY && trending.length) {
      try {
        talkingAbout = await buildTalkingAI(trending, process.env.ANTHROPIC_API_KEY);
        talkSource = 'ai';
      } catch (_) {
        talkingAbout = null; // fall through to derived
      }
    }
    if (!talkingAbout || !talkingAbout.length) {
      talkingAbout = buildTalkingDerived(trending);
      talkSource = 'derived';
    }

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.json({
      updatedAt: new Date().toISOString(),
      sources: {
        trending: newsapi.length ? 'ESPN · NewsAPI' : 'ESPN',
        talkingAbout: talkSource, // 'ai' | 'derived'
      },
      trending: trending.length ? trending : null,
      talkingAbout: talkingAbout.length ? talkingAbout : null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to build talk feed' });
  }
};

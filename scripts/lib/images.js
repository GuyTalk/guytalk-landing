'use strict';

/**
 * Image resolution + validation for the brief pipeline.
 *
 * The research layer (research.js) asks a model for "a real image URL." Left
 * alone, it cheerfully returns things that are NOT images:
 *   - Wikimedia file-DESCRIPTION pages:  …/wiki/File:Foo.jpg   (an HTML page)
 *   - ESPN/article pages:                …/nba/recap/_/gameId/… (an HTML page)
 * These render as broken <img>s. This module:
 *   1. RESOLVES known sources to a direct image URL where possible
 *      (Wikimedia File: → Special:FilePath; article page → its og:image).
 *   2. VALIDATES the result actually is an image (extension OR an image/*
 *      Content-Type on a HEAD/GET), dropping anything that isn't.
 *
 * Fail-closed for images (a bad image is worse than none): if we can't confirm
 * a URL is a real image, resolveAndValidate() returns null and the caller ships
 * the card/hero with no image rather than a dead link.
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif)(?:[?#].*)?$/i;

// Filename/URL signals that the image is NOT the people/action in the story —
// a stadium/arena building, an aerial/exterior, a logo, a map, or a trophy on a
// stand. We'd rather show no image than a building (Fix 6). Decoded + matched
// against the URL path (e.g. Wikimedia "PNC_Arena_Raleigh.JPG").
const IRRELEVANT_RE = /(arena|stadium|ballpark|ground|building|exterior|aerial|drone|panorama|skyline|map|logo|crest|emblem|wordmark|signage|entrance|facade|fa%C3%A7ade|trophy|cup_?\(|venue)/i;

function looksIrrelevant(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const file = path.split('/').pop() || path;
    return IRRELEVANT_RE.test(file);
  } catch { return IRRELEVANT_RE.test(String(url)); }
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/png,image/*,text/html;q=0.8,*/*;q=0.5',
};

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

// Wikimedia "wiki/File:Name.jpg" (or /wiki/Special:FilePath, or a Commons
// /wiki/File: link) → the canonical direct file URL via Special:FilePath, which
// 302s to the real upload.wikimedia.org binary. Returns null if it isn't one.
function resolveWikimedia(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/i.test(u.hostname)) return null;
    // Already a direct upload binary — leave it.
    if (/^upload\./i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/wiki\/(?:Special:FilePath\/|File:)(.+)$/i);
    if (!m) return null;
    const file = decodeURIComponent(m[1]).replace(/^File:/i, '');
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
  } catch { return null; }
}

// Pull an og:image / twitter:image out of an article/landing page's HTML.
// Used for ESPN/news URLs that point at a story, not a photo. Returns a URL or null.
async function extractOgImage(url) {
  const t = withTimeout(6000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: t.signal, headers: { ...BROWSER_HEADERS, Accept: 'text/html,*/*' } });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(ct)) return null;
    const html = (await res.text()).slice(0, 200000); // head is plenty; cap memory
    const metas = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    ];
    for (const re of metas) {
      const m = html.match(re);
      if (m && m[1]) {
        try { return new URL(m[1], url).toString(); } catch { /* skip */ }
      }
    }
    return null;
  } catch { return null; }
  finally { t.done(); }
}

// HEAD (then GET) probe — true only if the response is actually an image.
async function isLiveImage(url) {
  const probe = async (method) => {
    const t = withTimeout(6000);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: t.signal, headers: BROWSER_HEADERS });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      return { ok: res.ok, status: res.status, isImg: ct.startsWith('image/'), hasCt: !!ct };
    } catch { return null; }
    finally { t.done(); }
  };
  let r = await probe('HEAD');
  // Many CDNs reject/blank HEAD — confirm with a GET before judging.
  if (!r || !r.ok || (!r.isImg && !r.hasCt) || [403, 405, 501].includes(r.status)) {
    const g = await probe('GET');
    if (g) r = g;
  }
  return !!(r && r.ok && r.isImg);
}

/**
 * Resolve a candidate image URL to a direct, validated image — or null.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.allowArticleOgImage=true] follow article pages to their og:image
 * @returns {Promise<string|null>} a confirmed image URL, or null to drop it
 */
async function resolveAndValidate(url, { allowArticleOgImage = true, requireRelevant = true } = {}) {
  if (!url || typeof url !== 'string') return null;
  let candidate = url.trim();
  if (!/^https?:\/\//i.test(candidate)) return null;

  // 0) Relevance gate (Fix 6): drop stadium/arena/logo/trophy/aerial shots up
  //    front — prefer no image over a building. Checked on the source URL before
  //    resolution (the giveaway is usually in the filename).
  if (requireRelevant && looksIrrelevant(candidate)) return null;

  // 1) Known-source resolution.
  const wiki = resolveWikimedia(candidate);
  if (wiki) candidate = wiki;
  // Re-check the resolved filename too (FilePath keeps the original name).
  if (requireRelevant && looksIrrelevant(candidate)) return null;

  // 2) If it already looks/serves like an image, validate and accept.
  if (IMAGE_EXT_RE.test(candidate) || wiki) {
    if (await isLiveImage(candidate)) return candidate;
    // Wikimedia FilePath that didn't validate (rare) — give up on it.
    if (wiki) return null;
  } else if (await isLiveImage(candidate)) {
    // No image extension but the server says image/* — accept it.
    return candidate;
  }

  // 3) Looks like a page (ESPN recap/story, news article). Try its og:image.
  if (allowArticleOgImage) {
    const og = await extractOgImage(candidate);
    if (og && !(requireRelevant && looksIrrelevant(og))) {
      const ogResolved = resolveWikimedia(og) || og;
      if (await isLiveImage(ogResolved)) return ogResolved;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section fallbacks — existing hero assets; always served from local disk.
// ─────────────────────────────────────────────────────────────────────────────
const SECTION_FALLBACKS = {
  lead:     '/assets/hero/default.jpg',
  sports:   '/assets/hero/default.jpg',  // generic — never use a sport-specific image as catch-all
  nba:      '/assets/hero/nba.jpg',
  mlb:      null,                         // mlb.jpg contains Aaron Judge — null forces no-image until replaced
  nhl:      '/assets/hero/nhl.jpg',
  f1:       '/assets/hero/f1.jpg',
  golf:     '/assets/hero/golf.jpg',
  worldcup: null,                         // no generic soccer image yet — null is correct until one is added
  soccer:   null,
  tennis:   null,
  markets:  '/assets/hero/default.jpg',
  culture:  '/assets/hero/default.jpg',
  rec:      '/assets/hero/default.jpg',
};

// ESPN headshot CDN builders per sport.
const ESPN_HEADSHOT = {
  nba:  (id) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`,
  mlb:  (id) => `https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png`,
  golf: (id) => `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png`,
  f1:   (id) => `https://a.espncdn.com/i/headshots/racing/drivers/full/${id}.png`,
  nhl:  (id) => `https://a.espncdn.com/i/headshots/nhl/players/full/${id}.png`,
};

function espnHeadshot(sport, id) {
  if (!id) return null;
  const builder = ESPN_HEADSHOT[String(sport || '').toLowerCase()];
  return builder ? builder(id) : null;
}

// Try a list of candidate URLs in order; return the first confirmed live image.
async function firstLiveImage(urls) {
  for (const url of (urls || []).filter(Boolean)) {
    if (await isLiveImage(url)) return url;
  }
  return null;
}

// Resolve an athlete image: ESPN headshot CDN → article og:image → section fallback.
async function resolveAthleteImage({ sport, espnId, articleUrl, section = 'sports' }) {
  const candidates = [];
  const headshot = espnHeadshot(sport, espnId);
  if (headshot) candidates.push(headshot);
  if (articleUrl) {
    try {
      const og = await extractOgImage(articleUrl);
      if (og && !looksIrrelevant(og)) candidates.push(og);
    } catch (_) {}
  }
  const live = await firstLiveImage(candidates);
  return live || SECTION_FALLBACKS[section] || SECTION_FALLBACKS.sports;
}

// Resolve an article image: og:image → preset URL → section fallback.
async function resolveArticleImage({ articleUrl, preset, section = 'lead' }) {
  if (articleUrl) {
    try {
      const og = await extractOgImage(articleUrl);
      if (og && !looksIrrelevant(og) && await isLiveImage(og)) return og;
    } catch (_) {}
  }
  if (preset && await isLiveImage(preset)) return preset;
  return SECTION_FALLBACKS[section] || SECTION_FALLBACKS.lead;
}

module.exports = {
  resolveAndValidate, resolveWikimedia, extractOgImage, isLiveImage, looksIrrelevant, IMAGE_EXT_RE,
  SECTION_FALLBACKS, ESPN_HEADSHOT, espnHeadshot, firstLiveImage, resolveAthleteImage, resolveArticleImage,
};

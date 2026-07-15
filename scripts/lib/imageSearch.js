'use strict';

/**
 * Web-search-powered image finder.
 *
 * Given a plain-language query ("FIFA World Cup England Croatia match photo"),
 * asks OpenAI web_search to find recent news articles, then extracts og:images
 * from the cited URLs. Falls back to a caller-supplied URL on failure.
 *
 * This is the right way to get contextually correct images: ask GPT to search,
 * then scrape the og:image from whatever news pages it found. Don't ask GPT to
 * invent direct image URLs — CDN links hallucinate badly.
 */

const { extractOgImage, isLiveImage, looksIrrelevant, resolveWikimedia, cleanImageUrl, IMAGE_EXT_RE } = require('./images');
const { addWarning } = require('./warnings');

const SEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-4.1';

// Hard timeout well under the "5 min" ceiling — a hung web_search call must
// not stall the whole generation run. No SDK retries either: on failure we
// flag the brief for Jake to supply an image manually rather than burning
// more time/credit re-attempting.
const SEARCH_TIMEOUT_MS = 45_000;

/**
 * Search for a contextually relevant action/news photo.
 *
 * @param {string} query   Plain-language description, e.g. "England Croatia World Cup 2026 match photo"
 * @param {object} opts
 * @param {string|null} opts.fallback  URL to return if search fails
 * @param {'sports'|'news'} opts.kind  'sports' (default) asks for an on-field action shot —
 *   wrong for geopolitics/markets/politics leads, where nothing will ever match "athletes
 *   competing" and the search silently returns nothing every time. 'news' asks for a real
 *   editorial/wire photo of the actual story instead.
 * @returns {Promise<string|null>}
 */
async function searchWebImage(query, { fallback = null, kind = 'sports' } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return fallback; }

  const client = new (OpenAI.default || OpenAI)({ apiKey, maxRetries: 0 });
  if (typeof client.responses?.create !== 'function') return fallback;

  const prompt = kind === 'news'
    ? `Search for recent news coverage of: "${query}"

Find the most recent articles (today or yesterday) from major news outlets.
I need articles whose lead photo is a real editorial/wire photo directly depicting this specific story (e.g. the actual location, event, people, or aftermath involved) — from AP, Reuters, Getty, AFP, or a major outlet (Al Jazeera, BBC, ESPN, AP News).
STRONGLY AVOID a generic stock photo, a flag/map graphic, a studio anchor shot, a logo, or an unrelated file photo. If nothing genuinely depicts this specific story, say so — don't settle for a loosely-related image.
Just search and summarize what you found — I'll use the source URLs.`
    : `Search for recent news coverage of: "${query}"

Find the most recent articles (today or yesterday) from major sports/news outlets.
I need articles whose lead photo is an ON-FIELD / IN-GAME ACTION shot of the athletes competing (batting, pitching, shooting, tackling, driving, playing).
STRONGLY AVOID articles whose main image is a broadcaster/anchor, a microphone, a studio set, a stadium exterior, a team logo, a headshot, or a press conference. Prefer game-action wire photos (AP, Getty, Reuters) from the actual event.
Just search and summarize what you found — I'll use the source URLs.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal });

    // Extract citation URLs from annotations — this is the proven extraction pattern.
    const citedUrls = [];
    (response.output || []).forEach(block => {
      if (block.type === 'message') {
        (block.content || []).forEach(c => {
          (c.annotations || []).forEach(a => {
            if (a.type === 'url_citation' && a.url) {
              const clean = a.url.replace(/[?&]utm_source=openai/, '').replace(/[?&]$/, '');
              citedUrls.push(clean);
            }
          });
        });
      }
    });

    // Also scan response text for direct .jpg/.png/.webp URLs (rare but fast)
    const text = response.output_text || (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .filter(c => c?.type === 'output_text' || c?.type === 'text')
      .map(c => c.text || '')
      .join('');

    const directImgUrls = (text.match(/https?:\/\/[^\s"'<>)]+\.(?:jpe?g|png|webp)(?:[?#][^\s"'<>)]*)?/gi) || []);

    // Try direct image URLs first (fastest path — usually CDN links in og:image values)
    for (const url of directImgUrls) {
      const resolved = cleanImageUrl(resolveWikimedia(url) || url);
      if (!looksIrrelevant(resolved) && await isLiveImage(resolved)) {
        console.log(`   🖼  imageSearch hit (direct): ${resolved.slice(0, 80)}`);
        return resolved;
      }
    }

    // Try og:image from each cited article — this is the main path
    for (const url of citedUrls.slice(0, 6)) {
      try {
        const og = await extractOgImage(url);
        if (og && !looksIrrelevant(og)) {
          const ogResolved = cleanImageUrl(resolveWikimedia(og) || og);
          if (await isLiveImage(ogResolved)) {
            console.log(`   🖼  imageSearch hit (og): ${ogResolved.slice(0, 80)}`);
            return ogResolved;
          }
        }
      } catch (_) { /* skip this URL */ }
    }

    console.log(`   ⚠  imageSearch: no valid image for "${query.slice(0, 60)}"`);
    addWarning(`image:${query.slice(0, 40)}`, 'failed', 'web image search found no usable photo — needs a manual image from Jake');
    return fallback;
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.code === 'ERR_ABORTED' || err.message?.includes('aborted');
    console.error(`[imageSearch] "${query.slice(0, 60)}": ${isTimeout ? `timed out after ${SEARCH_TIMEOUT_MS / 1000}s` : err.message}`);
    addWarning(`image:${query.slice(0, 40)}`, 'failed', isTimeout ? 'image search timed out — needs a manual image from Jake' : `image search failed (${err.message}) — needs a manual image from Jake`);
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build a sport-specific image search query from a dynamicSports candidate object.
 */
function buildSportImageQuery(s) {
  // Normalize sport type from _sport / sportType fields or label/name fallback
  const label = (s.label || s.name || '').toLowerCase();
  const sport = s._sport || s.sportType ||
    (/world.?cup|soccer|fifa/.test(label) ? 'worldcup' :
     /\bf1\b|formula/.test(label) ? 'f1' :
     /golf|pga/.test(label) ? 'golf' :
     /\bmlb\b|baseball/.test(label) ? 'mlb' :
     /\bnba\b|basketball/.test(label) ? 'nba' :
     /\bnhl\b|hockey/.test(label) ? 'nhl' :
     /tennis/.test(label) ? 'tennis' :
     /\bufc\b|mma/.test(label) ? 'ufc' : '');
  const name    = s.name    || '';
  const hl      = s.headline || '';

  if (sport === 'worldcup') {
    // Try to extract home team from headline like "England 4–2 Croatia"
    const m = hl.match(/^([A-Za-z ]+?)\s+\d/);
    const teams = m ? m[1].trim() : '';
    return teams
      ? `FIFA World Cup 2026 ${teams} match action photo soccer`
      : 'FIFA World Cup 2026 soccer match action photo players';
  }
  if (sport === 'f1') {
    // Extract winner name from headline like "Charles Leclerc wins British Grand Prix"
    const winnerM = hl.match(/^([A-Za-z ]+?)\s+wins/i);
    const winner = winnerM ? winnerM[1].trim() : '';
    return winner
      ? `${winner} ${name} 2026 F1 race winner podium action photo site:formula1.com OR site:autosport.com OR site:crash.net OR site:motorsport.com`
      : `Formula 1 ${name} 2026 race winner podium action photo site:formula1.com OR site:autosport.com OR site:crash.net`;
  }
  if (sport === 'golf') {
    const leaderM = hl.match(/^([A-Za-z ]+?)\s+(wins|leads)/i);
    const leader = leaderM ? leaderM[1].trim() : '';
    return leader
      ? `${leader} ${name} 2026 golf action photo site:pgatour.com OR site:cbssports.com OR site:golfchannel.com OR site:golf.com`
      : `${name} 2026 PGA Tour golf leaderboard action photo player`;
  }
  if (sport === 'mlb') {
    const m = hl.match(/^(.+?)\s+\d+[–\-]/);
    const team = m ? m[1].trim() : name;
    return `${team} MLB player batting or pitching on-field game action photo 2026 site:mlb.com OR site:apnews.com OR site:espn.com`;
  }
  if (sport === 'nba') return 'NBA basketball playoff action photo 2026';
  if (sport === 'nhl') return 'NHL Stanley Cup hockey action photo 2026';
  if (sport === 'tennis') return `${name} tennis action photo 2026`;
  if (sport === 'ufc') {
    const winnerM = hl.match(/^([A-Za-z .]+?)\s+def\.?\s+/i);
    const winner = winnerM ? winnerM[1].trim() : '';
    return winner
      ? `${winner} ${name} fight action photo site:ufc.com OR site:mmafighting.com OR site:espn.com`
      : `${name} UFC fight action photo octagon site:ufc.com OR site:mmafighting.com`;
  }
  return `${name} sports action photo`;
}

/**
 * Build an image search query for a non-sports lead (markets, politics, tech).
 */
function buildLeadImageQuery(heroOverride) {
  if (!heroOverride) return null;
  const title = heroOverride.title || '';
  const eyebrow = heroOverride.eyebrow || '';
  if (!title) return null;

  const lower = title.toLowerCase();
  if (/fed\b|federal reserve|rate|powell|warsh/.test(lower)) {
    return `Federal Reserve press conference photo ${title.slice(0, 40)} 2026`;
  }
  if (/market|stocks?|nasdaq|s&p|dow/.test(lower)) {
    return `stock market news photo Wall Street 2026`;
  }
  if (/strike|airstrike|missile|naval|blockade|military|troops|invasion|ceasefire|war\b/.test(lower)) {
    return `${title.slice(0, 60)} AP Reuters wire photo 2026`;
  }
  if (/white house|president|executive/.test(lower)) {
    return `White House president news photo 2026`;
  }
  return `${eyebrow} ${title.slice(0, 50)} news photo 2026`;
}

/**
 * Search for fresh "Players to Know" for a specific game/matchup — starters
 * plus one breakout/bench player, each with a real current stat or recent
 * performance note. Replaces the old approach of scanning facts text for
 * substring matches against a small static roster (db.js PLAYERS), which is
 * why "Players to Know" barely changed issue to issue — it could only ever
 * surface a name that was both already hardcoded AND happened to appear
 * verbatim in that day's facts text.
 *
 * @param {object} opts
 * @param {string} opts.label     Sport/section label, e.g. "World Cup", "MLB"
 * @param {string} opts.headline  The section headline (names the teams/matchup)
 * @returns {Promise<Array<{name:string, note:string, url:string}>|null>}
 */
async function searchPlayersToKnow({ label, headline } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!label || !headline || !apiKey) return null;

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return null; }
  const client = new (OpenAI.default || OpenAI)({ apiKey, maxRetries: 0 });
  if (typeof client.responses?.create !== 'function') return null;

  const prompt = `Search for who to know in today's ${label} story: "${headline}"

Find 2-3 real, current players worth knowing for this specific matchup/story — starters plus, if relevant, one breakout or bench player. For EACH one give a real, specific, verifiable stat or recent-performance note (goals/points this tournament, a streak, a milestone, a notable recent game) — never invent one. If you can't verify a stat for a player, don't include them.

Return ONLY valid JSON (no markdown fences), an array of up to 3 objects:
[{"name":"Full Name","note":"one short clause with a real stat or performance note","url":"a real profile/bio URL you found, or empty string"}]`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal });

    const text = response.output_text || (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .filter(c => c?.type === 'output_text' || c?.type === 'text')
      .map(c => c.text || '')
      .join('');

    const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf('['), end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return null;

    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed) || !parsed.length) return null;

    const players = parsed
      .filter(p => p && p.name && p.note)
      .slice(0, 3)
      .map(p => ({ name: String(p.name), note: String(p.note), url: String(p.url || '') }));

    if (players.length) console.log(`   🔎 playersToKnow hit (${players.length}): ${players.map(p => p.name).join(', ')}`);
    return players.length ? players : null;
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.code === 'ERR_ABORTED' || err.message?.includes('aborted');
    console.error(`[playersToKnow] "${label} — ${headline.slice(0, 40)}": ${isTimeout ? `timed out after ${SEARCH_TIMEOUT_MS / 1000}s` : err.message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Search for a fresh "The Rec" pick — something people are actually talking
 * about this week (new drop, viral podcast, current-event tie-in), instead of
 * cycling the static RECS catalog. Bounded, no retry, fails open to null so
 * the caller can fall back to the old rotation.
 */
async function searchRecPick({ theme, avoidBrands = [] } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return null; }
  const client = new (OpenAI.default || OpenAI)({ apiKey, maxRetries: 0 });
  if (typeof client.responses?.create !== 'function') return null;

  const avoidLine = avoidBrands.length
    ? `\nDo NOT recommend any of these — already featured recently: ${avoidBrands.join(', ')}.`
    : '';

  const prompt = `You write "The Rec" for GuyTalk, a daily brief for men — one product/app/show/book recommendation people are actually talking about RIGHT NOW.

This week's brief covered: ${theme || 'general news, sports, and markets'}

Search the web for something genuinely trending this week — a new MasterClass or course drop, a viral podcast episode, new gear everyone's reviewing, a buzzy streaming release, a current-event tie-in product. It should feel current, not evergreen. Prefer something a guy could plausibly buy or start today.${avoidLine}

Return ONLY valid JSON (no markdown fences), one object:
{"brand":"Brand/product name","title":"One punchy sentence — what it is and the hook","body":"3-5 sentences in GuyTalk's voice: what it actually is, why it's worth it right now, and one honest flaw/trade-off. No hype-only copy.","url":"the real product/official URL you found","cta":"Short link text like 'Try X →' or 'Shop X →'"}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal });

    const text = response.output_text || (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .filter(c => c?.type === 'output_text' || c?.type === 'text')
      .map(c => c.text || '')
      .join('');

    const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '');
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || !parsed.brand || !parsed.title || !parsed.body || !parsed.url) return null;

    // Try to find a real hero image for the pick; fail open (no image is fine,
    // buildRec renders a text-only fallback card).
    const imageUrl = await searchWebImage(`${parsed.brand} ${parsed.title} official product photo`, { fallback: null });

    const pick = {
      brand: String(parsed.brand),
      title: String(parsed.title),
      body:  String(parsed.body),
      url:   String(parsed.url),
      cta:   String(parsed.cta || `Check out ${parsed.brand} →`),
      imageUrl: imageUrl || null,
    };
    console.log(`   🔎 recPick hit: ${pick.brand} — ${pick.title.slice(0, 60)}`);
    return pick;
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.code === 'ERR_ABORTED' || err.message?.includes('aborted');
    console.error(`[recPick] "${(theme || '').slice(0, 40)}": ${isTimeout ? `timed out after ${SEARCH_TIMEOUT_MS / 1000}s` : err.message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Search YouTube for highlight/recap video of a sports event.
 * Returns a youtube.com/watch?v=... URL or null.
 */
async function searchWebVideo(query, { fallback = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  let OpenAI;
  try { OpenAI = require('openai'); } catch (_) { return fallback; }
  const client = new (OpenAI.default || OpenAI)({ apiKey, maxRetries: 0 });
  if (typeof client.responses?.create !== 'function') return fallback;

  const prompt = `Find a YouTube highlight or recap video for: "${query}"

I need the direct YouTube URL (youtube.com/watch?v=...) for an actual video — not a search results page. Look for official league channels, ESPN, or broadcast highlight clips.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await client.responses.create({
      model: SEARCH_MODEL,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      tool_choice: 'required',
      input: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal });

    const text = (response.output_text || (response.output || [])
      .filter(b => b.type === 'message')
      .flatMap(b => Array.isArray(b.content) ? b.content : [])
      .map(c => c.text || '')
      .join(''));

    // YouTube watch URLs only (11-char video ID)
    const ytMatch = text.match(/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      console.log(`   🎬  videoSearch hit: ${ytMatch[0].slice(0, 80)}`);
      return ytMatch[0];
    }

    // Try citation URLs for YouTube
    const citedUrls = [];
    (response.output || []).forEach(block => {
      if (block.type === 'message') {
        (block.content || []).forEach(c => {
          (c.annotations || []).forEach(a => {
            if (a.type === 'url_citation' && a.url) citedUrls.push(a.url);
          });
        });
      }
    });

    const ytCitation = citedUrls.find(u => /youtube\.com\/watch\?v=/.test(u));
    if (ytCitation) {
      console.log(`   🎬  videoSearch hit (citation): ${ytCitation.slice(0, 80)}`);
      return ytCitation;
    }

    return fallback;
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.code === 'ERR_ABORTED' || err.message?.includes('aborted');
    console.error(`[searchWebVideo] "${query.slice(0, 60)}": ${isTimeout ? `timed out after ${SEARCH_TIMEOUT_MS / 1000}s` : err.message}`);
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build a sport-specific video search query for YouTube highlights.
 */
function buildSportVideoQuery(s) {
  const sport = s._sport || '';
  const hl    = s.headline || '';
  const name  = s.name || '';

  if (sport === 'worldcup') {
    const m = hl.match(/^([A-Za-z ]+?)\s+\d/);
    const teams = m ? m[1].trim() : '';
    return teams ? `${teams} FIFA World Cup 2026 highlights YouTube` : null;
  }
  if (sport === 'f1') return `Formula 1 ${name} 2026 race highlights YouTube`;
  if (sport === 'golf') return `${name} 2026 golf highlights YouTube`;
  if (sport === 'mlb') {
    const m = hl.match(/^(.+?)\s+\d+[–\-]/);
    const team = m ? m[1].trim() : name;
    return team ? `${team} MLB highlights 2026 YouTube` : null;
  }
  if (sport === 'nba') return `NBA ${name} highlights 2026 YouTube`;
  if (sport === 'nhl') return `NHL ${name} highlights 2026 YouTube`;
  return null;
}

module.exports = { searchWebImage, buildSportImageQuery, buildLeadImageQuery, searchWebVideo, buildSportVideoQuery, searchPlayersToKnow, searchRecPick };
